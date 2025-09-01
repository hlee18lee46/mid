// server.js
import express from "express";
import cors from "cors";
import morgan from "morgan";
import { WalletBuilder } from "@midnight-ntwrk/wallet";
import { NetworkId, nativeToken } from "@midnight-ntwrk/zswap";

const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan("dev"));

/**
 * ENV (provide via .env or your host):
 * INDEXER_HTTP, INDEXER_WS, RPC_HTTP, PROVER_HTTP, SEED_HEX, PORT
 * All have sensible defaults for Testnet-02 & localhost prover.
 */
const INDEXER_HTTP = process.env.INDEXER_HTTP || "https://indexer.testnet-02.midnight.network/api/v1/graphql";
const INDEXER_WS   = process.env.INDEXER_WS   || "wss://indexer.testnet-02.midnight.network/api/v1/graphql/ws";
const RPC_HTTP     = process.env.RPC_HTTP     || "https://rpc.testnet-02.midnight.network";
const PROVER_HTTP  = process.env.PROVER_HTTP  || "http://localhost:6300";
const SEED_HEX     = process.env.SEED_HEX     || "0000000000000000000000000000000000000000000000000000000000000000"; // demo
const PORT         = Number(process.env.PORT || 8787);

// Build wallet once and reuse across requests
let walletPromise = null;
async function getWallet() {
  if (!walletPromise) {
    walletPromise = (async () => {
      const w = await WalletBuilder.build(
        INDEXER_HTTP,
        INDEXER_WS,
        PROVER_HTTP,
        RPC_HTTP,
        SEED_HEX,
        NetworkId.TestNet
      );
      w.start(); // start subscriptions, etc.
      return w;
    })();
  }
  return walletPromise;
}

// Health endpoints
app.get("/healthz", (_req, res) => res.json({ status: "ok" }));
app.get("/readyz", async (_req, res) => {
  try {
    await getWallet();
    res.json({ status: "ready" });
  } catch (e) {
    res.status(503).json({ status: "not_ready", error: String(e?.message || e) });
  }
});

/**
 * POST /api/send
 * body: { recipient: "mn_shield-addr_...", amount: "1" | 1 }
 */
app.post("/api/send", async (req, res) => {
  try {
    const { recipient, amount } = req.body || {};
    if (typeof recipient !== "string" || !recipient.startsWith("mn_shield-addr_")) {
      return res.status(400).json({ error: "recipient must be a Midnight shield address (mn_shield-addr_...)" });
    }

    let amt;
    if (typeof amount === "bigint") amt = amount;
    else if (typeof amount === "number" && Number.isFinite(amount)) amt = BigInt(Math.trunc(amount));
    else if (typeof amount === "string" && /^\d+$/.test(amount.trim())) amt = BigInt(amount.trim());
    else return res.status(400).json({ error: "amount must be an integer (string or number)" });

    if (amt <= 0n) return res.status(400).json({ error: "amount must be > 0" });

    const wallet = await getWallet();

    // 1) Build recipe
    const recipe = await wallet.transferTransaction([
      { amount: amt, type: nativeToken(), receiverAddress: recipient }
    ]);

    // 2) Prove (uses your local prover at PROVER_HTTP)
    const proven = await wallet.proveTransaction(recipe);

    // 3) Submit
    const txId = await wallet.submitTransaction(proven);

    res.json({ ok: true, txId });
  } catch (e) {
    // Map common errors to clearer messages
    const msg = String(e?.message || e);
    // You can pattern-match here for indexer/prover/RPC problems if needed
    res.status(500).json({ ok: false, error: msg });
  }
});

// Graceful shutdown
const server = app.listen(PORT, () => {
  console.log(`tDUST sender API listening on http://localhost:${PORT}`);
  console.log(`Prover: ${PROVER_HTTP}`);
  console.log(`Indexer: ${INDEXER_HTTP}`);
  console.log(`RPC: ${RPC_HTTP}`);
});
process.on("SIGINT", () => server.close(() => process.exit(0)));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
