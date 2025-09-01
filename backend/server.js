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
const seed = (process.env.SEED_HEX || "").trim();
console.log("SEED_HEX length:", seed.length);
if (!/^[0-9a-f]{64}$/i.test(seed)) {
  console.error("SEED_HEX must be exactly 64 hex chars (32 bytes). Current value invalid.");
}

/**
 * ENV (provide via .env or your host):
 * INDEXER_HTTP, INDEXER_WS, RPC_HTTP, PROVER_HTTP, SEED_HEX, PORT
 * All have sensible defaults for Testnet-02 & localhost prover.
 */
const INDEXER_HTTP = process.env.INDEXER_HTTP || "https://indexer.testnet-02.midnight.network/api/v1/graphql";
const INDEXER_WS   = process.env.INDEXER_WS   || "wss://indexer.testnet-02.midnight.network/api/v1/graphql/ws";
const RPC_HTTP     = process.env.RPC_HTTP     || "https://rpc.testnet-02.midnight.network";
const PROVER_HTTP  = process.env.PROVER_HTTP  || "http://localhost:6300";
const SEED_HEX     = "3c735f2688979f9f0de56cd88cee7064582e3d28a60c24fec20ff8a72e62e91a"; // demo
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
// Dump raw state() (object) – safest when state contains BigInts etc.
app.get("/state", async (_req, res) => {
  try {
    const w = await getWallet();
    const st = await w.state(); // often { state: {...} } or just {...}
    res.json(st);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Dump serializeState() (string) and try to extract shield address
app.get("/serialize-state", async (_req, res) => {
  try {
    const w = await getWallet();
    const s = await w.serializeState(); // SDK usually returns a JSON string
    let root = null;
    try { root = JSON.parse(s)?.state ?? JSON.parse(s); } catch {}
    const text = typeof s === "string" ? s : JSON.stringify(root);

    // naive regex scan for mn_shield-addr_...
    const m = text.match(/mn_shield-addr_[0-9a-z]+/i);
    if (m) return res.json({ address: m[0], via: "serializeState regex", raw: false });

    // scan parsed JSON (depth-first) to be thorough
    if (root && typeof root === "object") {
      const seen = new Set([root]);
      const stack = Object.values(root).filter(v => v && typeof v === "object");
      while (stack.length) {
        const cur = stack.pop();
        if (seen.has(cur)) continue;
        seen.add(cur);
        for (const [k, v] of Object.entries(cur)) {
          if (typeof v === "string" && v.startsWith("mn_shield-addr_")) {
            return res.json({ address: v, via: `serializeState object path: ${k}` });
          }
          if (v && typeof v === "object") stack.push(v);
        }
      }
    }

    res.status(404).json({ error: "No mn_shield-addr_ found in serializeState()", sample: text.slice(0, 500) + "..." });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// --- Put near other routes ---
app.get("/address", async (_req, res) => {
  try {
    const w = await getWallet();

    // 1) Try common getters (vary by SDK version)
    const tryGet = async (name) => (typeof w[name] === "function" ? await w[name]() : undefined);
    const candidates = [
      await tryGet("getAddresses"),
      await tryGet("getAddress"),
      await tryGet("receivingAddress"),
      await tryGet("shieldAddress"),
      await tryGet("getReceivingAddress"),
    ].filter(Boolean);

    for (const c of candidates) {
      // normalize: some return string, some return array
      const addr = Array.isArray(c) ? c[0] : c;
      if (typeof addr === "string" && addr.startsWith("mn_shield-addr_")) {
        return res.json({ address: addr, via: "wallet-getter" });
      }
    }

    // 2) Try state() deep scan
    try {
      const st = await w.state?.();
      if (st) {
        const stack = [st];
        const seen = new Set();
        while (stack.length) {
          const cur = stack.pop();
          if (!cur || typeof cur !== "object" || seen.has(cur)) continue;
          seen.add(cur);
          for (const v of Object.values(cur)) {
            if (typeof v === "string" && v.startsWith("mn_shield-addr_")) {
              return res.json({ address: v, via: "state()" });
            }
            if (v && typeof v === "object") stack.push(v);
          }
        }
      }
    } catch {}

    // 3) Try serializeState() text/JSON scan
    try {
      const s = await w.serializeState?.(); // often a JSON string
      if (typeof s === "string") {
        const m = s.match(/mn_shield-addr_[0-9a-z]+/i);
        if (m) return res.json({ address: m[0], via: "serializeState regex" });
        // parse and scan object too
        try {
          const root = JSON.parse(s)?.state ?? JSON.parse(s);
          const stack = [root];
          const seen = new Set();
          while (stack.length) {
            const cur = stack.pop();
            if (!cur || typeof cur !== "object" || seen.has(cur)) continue;
            seen.add(cur);
            for (const v of Object.values(cur)) {
              if (typeof v === "string" && v.startsWith("mn_shield-addr_")) {
                return res.json({ address: v, via: "serializeState object" });
              }
              if (v && typeof v === "object") stack.push(v);
            }
          }
        } catch {}
      }
    } catch {}

    return res.status(404).json({
      error: "This wallet build does not expose a shield address.",
      hint: "Install a wallet SDK version that provides getAddresses()/getAddress(), or run the backend with a seed whose address you already know and faucet that address.",
    });
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

// /wallet-debug — list method names + top-level props so we know what this build exposes
app.get("/wallet-debug", async (_req, res) => {
  try {
    const w = await getWallet();
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(w))
      .filter(k => typeof w[k] === "function")
      .sort();
    const props = Object.keys(w).sort();
    res.json({ methods, props });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// /address2 — best-effort: try common getters, then fall back to serialized state mining
app.get("/address2", async (_req, res) => {
  try {
    const w = await getWallet();

    // 1) Try common address getters across versions
    const candidates = [
      "getShieldAddress",
      "shieldAddress",
      "getReceivingAddress",
      "receivingAddress",
      "getAddress",
      "address",
      "getAddresses"
    ];

    for (const name of candidates) {
      if (typeof w[name] === "function") {
        try {
          const v = await w[name]();
          if (typeof v === "string" && v.startsWith("mn_shield-addr_")) {
            return res.json({ address: v, via: name });
          }
          if (Array.isArray(v)) {
            const a = v.find(x => typeof x === "string" && x.startsWith("mn_shield-addr_"));
            if (a) return res.json({ address: a, via: name });
          }
          // Sometimes methods return an object with an address field
          if (v && typeof v === "object") {
            const a =
              v.address ||
              v.shieldAddress ||
              v.receivingAddress ||
              v.addr ||
              (Array.isArray(v.addresses) && v.addresses.find(x => String(x).startsWith("mn_shield-addr_")));
            if (typeof a === "string" && a.startsWith("mn_shield-addr_")) {
              return res.json({ address: a, via: name });
            }
          }
        } catch {}
      }
    }

    // 2) Fallback: try to mine from state / serializeState
    let stateLike = null;
    try {
      if (typeof w.serializeState === "function") {
        const s = await w.serializeState();
        stateLike = JSON.parse(s)?.state ?? JSON.parse(s);
      }
    } catch {}
    if (!stateLike) {
      try {
        if (typeof w.state === "function") {
          const st = await w.state();
          stateLike = st?.state ?? st;
        }
      } catch {}
    }

    const tryMine = (root) => {
      if (!root || typeof root !== "object") return null;

      // Straight fields
      const direct =
        root.address ||
        root.shieldAddress ||
        root.receivingAddress ||
        (root.account && root.account.address) ||
        (root.wallet && root.wallet.address);
      if (typeof direct === "string" && direct.startsWith("mn_shield-addr_")) return direct;

      // Common arrays
      for (const key of ["addresses", "accounts", "wallets"]) {
        const arr = root[key];
        if (Array.isArray(arr)) {
          for (const it of arr) {
            if (typeof it === "string" && it.startsWith("mn_shield-addr_")) return it;
            if (it && typeof it === "object") {
              const a = it.address || it.shieldAddress || it.receivingAddress;
              if (typeof a === "string" && a.startsWith("mn_shield-addr_")) return a;
            }
          }
        }
      }

      // Deep scan
      const seen = new Set([root]);
      const stack = Object.values(root).filter(v => v && typeof v === "object");
      while (stack.length) {
        const cur = stack.pop();
        if (seen.has(cur)) continue;
        seen.add(cur);
        const a =
          cur.address || cur.shieldAddress || cur.receivingAddress ||
          (Array.isArray(cur.addresses) && cur.addresses.find(x => typeof x === "string" && x.startsWith("mn_shield-addr_")));
        if (typeof a === "string" && a.startsWith("mn_shield-addr_")) return a;
        if (Array.isArray(cur)) {
          for (const it of cur) if (it && typeof it === "object") stack.push(it);
        } else {
          for (const v of Object.values(cur)) if (v && typeof v === "object") stack.push(v);
        }
      }
      return null;
    };

    const mined = tryMine(stateLike);
    if (mined) return res.json({ address: mined, via: "serializeState/state mining" });

    res.status(501).json({
      error: "Could not determine shield address from this wallet build.",
      hints: {
        try_methods: candidates,
        available_methods: Object.getOwnPropertyNames(Object.getPrototypeOf(w)).filter(k => typeof w[k] === "function")
      }
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

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

// Helper: expose the wallet's first shield address so you can faucet it
app.get("/address", async (_req, res) => {
  try {
    const w = await getWallet();

    // Try common SDK methods – adjust to your SDK version if names differ
    if (typeof w.getAddress === "function") {
      const addr = await w.getAddress(); // single address
      return res.json({ address: addr });
    }
    if (typeof w.getAddresses === "function") {
      const addrs = await w.getAddresses(); // array
      return res.json({ addresses: addrs, address: addrs?.[0] });
    }
    if (typeof w.address === "function") {
      const addr = await w.address();
      return res.json({ address: addr });
    }

    return res.status(501).json({ error: "Wallet API does not expose an address getter in this build." });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Helper: quick balance check via indexer GraphQL (TDust only)
app.get("/balance", async (_req, res) => {
  try {
    const w = await getWallet();
    let address = null;

    if (typeof w.getAddress === "function") address = await w.getAddress();
    else if (typeof w.getAddresses === "function") {
      const addrs = await w.getAddresses();
      address = addrs?.[0] ?? null;
    } else if (typeof w.address === "function") address = await w.address();

    if (!address) return res.status(501).json({ error: "No address method found on wallet." });

    const q = `
      query Balances($a: String!) {
        address(address: $a) {
          balances { symbol amount quantity denom unit asset }
        }
      }
    `;
    const r = await fetch(INDEXER_HTTP, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: q, variables: { a: address } })
    });
    if (!r.ok) return res.status(502).json({ error: "indexer HTTP " + r.status });
    const body = await r.json();
    const balances = body?.data?.address?.balances ?? [];
    const td = balances.find(
      b => ["tDUST","TDUST","Tdust"].includes(b?.symbol) || b?.denom === "tDUST" || b?.unit === "tDUST"
    );
    res.json({ address, balances, tDUST: td?.amount ?? td?.quantity ?? null });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});


/**
 * POST /api/send
 * body: { recipient: "mn_shield-addr_...", amount: "1" | 1 }
 */
// /wallet-debug — list method names + top-level props so we know what this build exposes

// server.js (above /api/send)

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
app.get("/address", async (_req, res) => {
  try {
    const w = await getWallet();
    if (typeof w.getAddresses === "function") {
      const addrs = await w.getAddresses();
      return res.json({ address: addrs?.[0], addresses: addrs });
    }
    if (typeof w.getAddress === "function") {
      const addr = await w.getAddress();
      return res.json({ address: addr });
    }
    return res.status(501).json({ error: "No address getter on this version." });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});



app.get("/wallet-debug", async (_req, res) => {
  try {
    const w = await getWallet();
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(w))
      .filter(k => typeof w[k] === "function")
      .sort();
    const props = Object.keys(w).sort();
    res.json({ methods, props });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// /address2 — best-effort: try common getters, then fall back to serialized state mining
app.get("/address2", async (_req, res) => {
  try {
    const w = await getWallet();

    // 1) Try common address getters across versions
    const candidates = [
      "getShieldAddress",
      "shieldAddress",
      "getReceivingAddress",
      "receivingAddress",
      "getAddress",
      "address",
      "getAddresses"
    ];

    for (const name of candidates) {
      if (typeof w[name] === "function") {
        try {
          const v = await w[name]();
          if (typeof v === "string" && v.startsWith("mn_shield-addr_")) {
            return res.json({ address: v, via: name });
          }
          if (Array.isArray(v)) {
            const a = v.find(x => typeof x === "string" && x.startsWith("mn_shield-addr_"));
            if (a) return res.json({ address: a, via: name });
          }
          // Sometimes methods return an object with an address field
          if (v && typeof v === "object") {
            const a =
              v.address ||
              v.shieldAddress ||
              v.receivingAddress ||
              v.addr ||
              (Array.isArray(v.addresses) && v.addresses.find(x => String(x).startsWith("mn_shield-addr_")));
            if (typeof a === "string" && a.startsWith("mn_shield-addr_")) {
              return res.json({ address: a, via: name });
            }
          }
        } catch {}
      }
    }

    // 2) Fallback: try to mine from state / serializeState
    let stateLike = null;
    try {
      if (typeof w.serializeState === "function") {
        const s = await w.serializeState();
        stateLike = JSON.parse(s)?.state ?? JSON.parse(s);
      }
    } catch {}
    if (!stateLike) {
      try {
        if (typeof w.state === "function") {
          const st = await w.state();
          stateLike = st?.state ?? st;
        }
      } catch {}
    }

    const tryMine = (root) => {
      if (!root || typeof root !== "object") return null;

      // Straight fields
      const direct =
        root.address ||
        root.shieldAddress ||
        root.receivingAddress ||
        (root.account && root.account.address) ||
        (root.wallet && root.wallet.address);
      if (typeof direct === "string" && direct.startsWith("mn_shield-addr_")) return direct;

      // Common arrays
      for (const key of ["addresses", "accounts", "wallets"]) {
        const arr = root[key];
        if (Array.isArray(arr)) {
          for (const it of arr) {
            if (typeof it === "string" && it.startsWith("mn_shield-addr_")) return it;
            if (it && typeof it === "object") {
              const a = it.address || it.shieldAddress || it.receivingAddress;
              if (typeof a === "string" && a.startsWith("mn_shield-addr_")) return a;
            }
          }
        }
      }

      // Deep scan
      const seen = new Set([root]);
      const stack = Object.values(root).filter(v => v && typeof v === "object");
      while (stack.length) {
        const cur = stack.pop();
        if (seen.has(cur)) continue;
        seen.add(cur);
        const a =
          cur.address || cur.shieldAddress || cur.receivingAddress ||
          (Array.isArray(cur.addresses) && cur.addresses.find(x => typeof x === "string" && x.startsWith("mn_shield-addr_")));
        if (typeof a === "string" && a.startsWith("mn_shield-addr_")) return a;
        if (Array.isArray(cur)) {
          for (const it of cur) if (it && typeof it === "object") stack.push(it);
        } else {
          for (const v of Object.values(cur)) if (v && typeof v === "object") stack.push(v);
        }
      }
      return null;
    };

    const mined = tryMine(stateLike);
    if (mined) return res.json({ address: mined, via: "serializeState/state mining" });

    res.status(501).json({
      error: "Could not determine shield address from this wallet build.",
      hints: {
        try_methods: candidates,
        available_methods: Object.getOwnPropertyNames(Object.getPrototypeOf(w)).filter(k => typeof w[k] === "function")
      }
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
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
