import { WalletBuilder } from '@midnight-ntwrk/wallet';
import { NetworkId } from '@midnight-ntwrk/zswap';

// Network endpoints
const INDEXER_HTTP = 'https://indexer.testnet.midnight.network/api/v1/graphql';
const INDEXER_WS   = 'wss://indexer.testnet.midnight.network/api/v1/graphql';
const NODE_HTTP    = 'https://rpc.testnet.midnight.network';
const PROVER_HTTP  = 'http://localhost:6300';

// tDUST token type id (string must be defined)
const TDUST = '0100010000000000000000000000000000000000000000000000000000000000000000';

// Args
const [,, RAW_SEED, RECEIVER, AMOUNT_STR] = process.argv;
if (!RAW_SEED || !RECEIVER || !AMOUNT_STR) {
  console.error('Usage: node send.mjs "<32-byte-seed-hex>" "<receiverShieldedAddr>" "<amountInteger>"');
  process.exit(1);
}

// normalize seed: strip optional 0x; must be exactly 64 hex chars
let seedHex = RAW_SEED.trim();
if (seedHex.startsWith('0x') || seedHex.startsWith('0X')) seedHex = seedHex.slice(2);
if (!/^[0-9a-fA-F]{64}$/.test(seedHex)) {
  console.error('❌ Seed must be EXACTLY 32 bytes of hex (64 hex chars).');
  process.exit(1);
}

// validate receiver (basic check)
if (!/^mn_shield-addr_test1[0-9a-z]+$/.test(RECEIVER)) {
  console.error('❌ Receiver does not look like a Midnight TESTNET shielded address.');
  process.exit(1);
}

// parse amount
let AMOUNT;
try { AMOUNT = BigInt(AMOUNT_STR); } catch { 
  console.error('❌ Amount must be an integer (e.g., "1").'); 
  process.exit(1);
}
if (AMOUNT <= 0n) {
  console.error('❌ Amount must be > 0.');
  process.exit(1);
}

// sanity for token type constant
if (typeof TDUST !== 'string' || TDUST.length === 0) {
  console.error('❌ Internal error: TDUST token type id is undefined/empty.');
  process.exit(1);
}

(async () => {
  try {
    const wallet = await WalletBuilder.buildFromSeed(
      INDEXER_HTTP, INDEXER_WS, PROVER_HTTP, NODE_HTTP,
      seedHex, NetworkId.TestNet, 'error'
    );
    await wallet.start();

    const tx = await wallet.transferTransaction([
      { amount: AMOUNT, receiverAddress: RECEIVER, tokenType: TDUST }
    ]);

    const proven = await wallet.proveTransaction(tx);
    const submitted = await wallet.submitTransaction(proven);

    console.log('✅ Submitted tx:', submitted);
    await wallet.close();
  } catch (e) {
    console.error('❌ Error during build/prove/submit:\n', e);
    process.exit(2);
  }
})();