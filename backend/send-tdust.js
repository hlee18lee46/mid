// send-tdust.js
import 'dotenv/config';
import { WalletBuilder } from '@midnight-ntwrk/wallet';
import { NetworkId, nativeToken } from '@midnight-ntwrk/zswap';
import * as addrMod from '@midnight-ntwrk/wallet-sdk-address-format';

// If you want to generate a seed on the fly, uncomment:
// import { generateRandomSeed } from '@midnight-ntwrk/wallet-sdk-hd';
// Ensure Web Crypto API exists (needed by zswap/WASM for randomness)
import { webcrypto } from 'crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
import bip39 from 'bip39';


const {
  INDEXER_URL = 'https://indexer.testnet-02.midnight.network/api/v1/graphql',
  INDEXER_WS_URL = 'wss://indexer.testnet-02.midnight.network/api/v1/graphql/ws',
  PROVER_URL = 'http://localhost:6300',
  NODE_URL = 'https://rpc.testnet-02.midnight.network',
  SEED,
  MNEMONIC,
  TO_ADDR,
  AMOUNT_NAT = '1',
  LOG_LEVEL = 'warn'
} = process.env;

// Derive seed from mnemonic if SEED not provided
let seedHex = SEED;
if (!seedHex && MNEMONIC) {
  const mnemonic = MNEMONIC.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!bip39.validateMnemonic(mnemonic)) {
    console.error('MNEMONIC is not valid BIP-39 (check words/order).');
    process.exit(1);
  }
  //seedHex = bip39.mnemonicToEntropy(mnemonic); // 32-byte hex string
  const seedBuffer = bip39.mnemonicToSeedSync(mnemonic); // 64-byte BIP-39 seed
    seedHex = Buffer.from(seedBuffer).toString('hex');
}

if (!seedHex) {
  console.error('Provide SEED (hex) or MNEMONIC (24 words) in env.');
  process.exit(1);
}

if (!TO_ADDR) {
  console.error('Missing TO_ADDR in env (bech32m Midnight testnet address).');
  process.exit(1);
}

// Helper: small sleep
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// (Optional) very simple “wait until synced-ish” helper.
// Exact state shape may change; so we just wait a bit and log state updates.
// For real apps, replace with a robust check tied to your observed state fields.
async function waitForInitialSync(wallet, { maxMs = 90000 } = {}) {
  console.log('⌛ Waiting briefly for wallet to sync…');
  const start = Date.now();
  let firstPrinted = false;  // <-- declare the flag

  const sub = wallet.state().subscribe((s) => {
    if (!firstPrinted) {
      firstPrinted = true;
      // One-time peek so we can confirm balances/utxos exist
      console.log('STATE (first snapshot):', JSON.stringify(s, null, 2));
    }
    // TODO: if SDK exposes a tip flag (e.g., s.sync?.atTip), check it here
  });

  while (Date.now() - start < maxMs) {
    await new Promise((r) => setTimeout(r, 1500));
  }
  sub.unsubscribe();
}


async function main() {
  console.log('🪙 Building wallet…');

  // If you want a throwaway random wallet each run:
  // const seed = generateRandomSeed();
  const seed = SEED;

  const wallet = await WalletBuilder.build(
    INDEXER_URL,
    INDEXER_WS_URL,
    PROVER_URL,
    NODE_URL,
    seedHex,
    NetworkId.TestNet,
    LOG_LEVEL // 'warn' | 'error' | 'info' (depending on SDK)
  );

  // Start sync
  wallet.start();
let printedAddress = false;
const addrSub = wallet.state().subscribe((s) => {
  if (!printedAddress && s?.address) {
    printedAddress = true;
    console.log('📫 Wallet address:', s.address);
    addrSub.unsubscribe();
  }
});

  // (Recommended) give it a moment to catch up
  await waitForInitialSync(wallet);

  try {
    console.log(`✉️  Preparing transfer of ${AMOUNT_NAT} tDUST to: ${TO_ADDR}`);
    // Validate/parse bech32m address -> Address object expected by SDK internals
// --- address normalization helper (works with various SDK shapes) ---

function normalizeAddress(s) {
  try {
    // If the module provides a codec, try to use it
    if (addrMod.Bech32mCodec && addrMod.MidnightBech32m) {
      const codec = new addrMod.Bech32mCodec(addrMod.MidnightBech32m);
      // Try common decode/parse method names
      for (const m of ['parseAddress', 'decodeAddress', 'decode', 'fromBech32m']) {
        if (typeof codec[m] === 'function') {
          const parsed = codec[m](s);
          if (parsed) return parsed;
        }
      }
    }
  } catch (e) {
    // swallow and fall back
  }
  // Fall back to raw string; many SDK versions accept this
  return s;
}

// ... inside main(), right before transferTransaction:
const receiverAddress = normalizeAddress(TO_ADDR);

const transferRecipe = await wallet.transferTransaction([
  {
    amount: BigInt(AMOUNT_NAT),
    receiverAddress,          // <- use normalized value
    type: nativeToken()
  }
]);
    

    console.log('🔏 Proving transaction (this can take tens of seconds)…');
    // 2) Prove (ZK proofs happen via proving server)
    const provenTx = await wallet.proveTransaction(transferRecipe);

    console.log('📤 Submitting transaction…');
    // 3) Submit
    const submitted = await wallet.submitTransaction(provenTx);

    console.log('✅ Submitted transaction:', submitted);
  } catch (err) {
    console.error('❌ Error during transfer:', err);
  } finally {
    await wallet.close();
    console.log('👋 Wallet closed.');
  }
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
