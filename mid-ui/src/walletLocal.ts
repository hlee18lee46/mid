// walletLocal.ts
import { WalletBuilder } from "@midnight-ntwrk/wallet";
import { NetworkId } from "@midnight-ntwrk/zswap";

// Use your running proof server; these are the public Testnet-02 endpoints
const INDEXER_HTTP = "https://indexer.testnet-02.midnight.network/api/v1/graphql";
const INDEXER_WS   = "wss://indexer.testnet-02.midnight.network/api/v1/graphql/ws";
const PROVER_HTTP  = "http://localhost:6300"; // your Docker proof server
const RPC_HTTP     = "https://rpc.testnet-02.midnight.network";

// ⚠️ Demo seed (all zeros). Replace with your own 32-byte hex for persistent keys.
const ZERO_SEED_32B =
  "0000000000000000000000000000000000000000000000000000000000000000";

export async function buildLocalWallet() {
  const wallet = await WalletBuilder.build(
    INDEXER_HTTP,
    INDEXER_WS,
    PROVER_HTTP,
    RPC_HTTP,
    ZERO_SEED_32B,
    NetworkId.TestNet
  );
  wallet.start(); // starts indexer subscriptions, etc.
  return wallet;
}
