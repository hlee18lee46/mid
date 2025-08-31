import { useEffect, useState } from "react";
import { connectMidnight } from "./wallet";
import { buildTDustTransferTx } from "./tx";
import type { DAppConnectorAPI } from "./wallet"; // type-only import

function MidnightDebug() {
  const [keys, setKeys] = useState<string[] | null>(null);
  useEffect(() => {
    const m = (window as any)?.midnight;
    const k = m ? Object.keys(m) : null;
    setKeys(k);
    console.log("window.midnight =", m);
  }, []);
  return (
    <pre style={{ background: "#111", color: "#0f0", padding: 8, overflow: "auto" }}>
      midnight providers: {keys ? JSON.stringify(keys) : "(window.midnight is undefined)"}
    </pre>
  );
}

// Heuristic to derive an address from wallet state so UI can show something
function deriveAddressFromState(state: any): string {
  if (!state) return "";
  return state?.addresses?.[0] || state?.address || state?.account?.address || "";
}

// Robust tDUST extractor: scans common shapes + nested arrays
function deriveTDustBalanceFromState(state: any): string {
  if (!state) return "";
  if (state?.balances?.tDUST != null) return String(state.balances.tDUST);
  const arrays: any[] = [];
  if (Array.isArray(state?.assets)) arrays.push(state.assets);
  if (Array.isArray(state?.balances)) arrays.push(state.balances);
  if (Array.isArray(state?.coins)) arrays.push(state.coins);
  for (const arr of arrays) {
    const hit = arr.find(
      (x: any) =>
        x?.asset === "tDUST" ||
        x?.ticker === "tDUST" ||
        x?.symbol === "tDUST" ||
        x?.denom === "tDUST"
    );
    if (hit?.amount != null) return String(hit.amount);
    if (hit?.balance != null) return String(hit.balance);
  }
  try {
    const json = JSON.stringify(state);
    const m = json.match(/"tDUST"\s*:\s*"?([\d.]+)"/i);
    if (m?.[1]) return m[1];
  } catch {}
  return "";
}

export default function App() {
  const [api, setApi] = useState<DAppConnectorAPI | null>(null);
  const [providerName, setProviderName] = useState("");
  const [walletName, setWalletName] = useState("");
  const [apiVersion, setApiVersion] = useState("");
  const [serviceUris, setServiceUris] = useState<any>(null);

  const [addr, setAddr] = useState("");
  const [balance, setBalance] = useState<string>("");

  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("1.0");
  const [sending, setSending] = useState(false);
  const [lastTxId, setLastTxId] = useState("");

  // ⬇️ these two hooks belong INSIDE the component
  const [lastStateJson, setLastStateJson] = useState<string>("");
  const [indexerMsg, setIndexerMsg] = useState<string>("");
  const [indexerOverride, setIndexerOverride] = useState<string>("");

  async function handleConnect() {
    try {
      const { api, providerName, walletName, apiVersion, serviceUris, state } = await connectMidnight();
      setApi(api);
      setProviderName(providerName || "");
      setWalletName(walletName || "");
      setApiVersion(apiVersion || "");
      setServiceUris(serviceUris || null);
      console.log("serviceUriConfig =", serviceUris); // 👈 see what fields exist

      console.log("wallet state (on connect) =", state);
      setLastStateJson(JSON.stringify(state, null, 2));
      setAddr(deriveAddressFromState(state));
      setBalance(deriveTDustBalanceFromState(state));
    } catch (e: any) {
      alert(e.message || String(e));
    }
  }

async function refreshBalance() {
  if (!api) return;
  try {
    const state = await api.state();
    setLastStateJson(JSON.stringify(state, null, 2));
    setBalance(deriveTDustBalanceFromState(state) || "");
    if (!addr) setAddr(deriveAddressFromState(state));
    await queryIndexerForTDust(); // NEW
  } catch (e) {
    console.error(e);
    alert("Failed to refresh balance (see console).");
  }
}


function getIndexerBase(): string | null {
  const fromOverride = (indexerOverride || "").trim();
  const fromWallet =
    (serviceUris?.indexerUrl as string) ||
    (serviceUris?.indexerUri as string) || // GraphQL from Lace
    (serviceUris?.indexer as string) ||
    "";
  const base = (fromOverride || fromWallet).replace(/\/+$/, "");
  return base || null;
}


async function queryIndexerForTDust() {
  const base = getIndexerBase();
  if (!base) return setIndexerMsg("No indexer URL. Paste one below or configure Lace to expose it.");
  if (!addr) return setIndexerMsg("No address to query yet.");

  // Helper to recognize GraphQL endpoints
  const isGraphQL = /\/graphql(\b|\/|$)/i.test(base);

  setIndexerMsg(isGraphQL ? "Querying indexer (GraphQL)..." : "Querying indexer (REST)...");

  // --- Common helper to pick an amount from any object that represents tDUST
  const isTDUST = (o: any) =>
    o?.asset === "tDUST" ||
    o?.symbol === "tDUST" ||
    o?.ticker === "tDUST" ||
    o?.denom === "tDUST" ||
    o?.unit === "tDUST" ||
    o?.name === "tDUST";

  const pickAmount = (o: any): string | null => {
    if (!o || typeof o !== "object") return null;
    const v = o.amount ?? o.quantity ?? o.balance ?? o.value ?? null;
    return v != null ? String(v) : null;
  };

  const scanPayload = (data: any): string | null => {
    if (!data) return null;

    // keyed map: { balances: { tDUST: "123" } }
    if (data?.balances?.tDUST != null) return String(data.balances.tDUST);

    // arrays in common keys
    for (const key of ["balances", "assets", "coins", "portfolio", "utxos", "items"]) {
      const arr = data?.[key];
      if (Array.isArray(arr)) {
        for (const it of arr) {
          if (isTDUST(it)) {
            const v = pickAmount(it);
            if (v) return v;
          }
          // nested assets in UTXO-like shapes
          const nested = it?.assets || it?.tokens || it?.outputs;
          if (Array.isArray(nested)) {
            for (const t of nested) {
              if (isTDUST(t)) {
                const v = pickAmount(t);
                if (v) return v;
              }
            }
          }
        }
      }
    }

    // top-level array (UTXOs)
    if (Array.isArray(data)) {
      for (const utxo of data) {
        const assets = utxo?.assets || utxo?.tokens || utxo?.outputs || [];
        if (Array.isArray(assets)) {
          for (const t of assets) {
            if (isTDUST(t)) {
              const v = pickAmount(t);
              if (v) return v;
            }
          }
        }
      }
    }

    // last-resort regex
    try {
      const text = JSON.stringify(data);
      const m =
        text.match(/"tDUST"\s*:\s*"?([\d.]+)"/i) ||
        text.match(/"amount"\s*:\s*"?([\d.]+)".{0,80}"(asset|symbol|ticker|unit|denom|name)":"tDUST"/i);
      if (m?.[1]) return m[1];
    } catch {}
    return null;
  };

  try {
    if (isGraphQL) {
      // ---- GraphQL mode
      const endpoint = base.replace(/\/+$/, "");
      const queries = [
        {
          // balances array
          q: `
            query Balances($a: String!) {
              balances(address: $a) {
                asset
                symbol
                ticker
                denom
                unit
                amount
                quantity
              }
            }
          `,
          pick: (d: any) => d?.balances,
        },
        {
          // address -> balances + utxos
          q: `
            query AddressBalances($a: String!) {
              address(address: $a) {
                balances {
                  asset
                  symbol
                  ticker
                  denom
                  unit
                  amount
                  quantity
                }
                utxos {
                  assets {
                    asset
                    symbol
                    ticker
                    denom
                    unit
                    amount
                    quantity
                  }
                }
              }
            }
          `,
          pick: (d: any) => d?.address?.balances || d?.address?.utxos,
        },
      ];

      for (const { q, pick } of queries) {
        const r = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query: q, variables: { a: addr } }),
        });
        if (!r.ok) continue;
        const body = await r.json();
        if (body?.errors?.length) continue;

        const payload = pick(body?.data || {});
        const v = scanPayload(payload);
        if (v) {
          setBalance(v);
          setIndexerMsg("Found via GraphQL indexer.");
          return;
        }
      }

      setIndexerMsg("GraphQL indexer responded, but no tDUST found. Use faucet, then retry.");
      return;
    } else {
      // ---- REST mode
      const a = addr;
      const candidates = [
        `${base}/v1/address/${encodeURIComponent(a)}/balances`,
        `${base}/v1/accounts/${encodeURIComponent(a)}/balances`,
        `${base}/v1/address/${encodeURIComponent(a)}/assets`,
        `${base}/v1/address/${encodeURIComponent(a)}/utxos`,
        `${base}/balances?address=${encodeURIComponent(a)}`,
        `${base}/assets?address=${encodeURIComponent(a)}`,
        `${base}/utxos?address=${encodeURIComponent(a)}`,
      ];

      for (const url of candidates) {
        try {
          const r = await fetch(url, { mode: "cors" });
          if (!r.ok) continue;
          const data = await r.json();
          const v = scanPayload(data);
          if (v) {
            setBalance(v);
            setIndexerMsg(`Found via REST indexer: ${url}`);
            return;
          }
        } catch {
          // try next
        }
      }
      setIndexerMsg("REST indexer queried, but no tDUST found. Use faucet, then retry.");
      return;
    }
  } catch (e: any) {
    setIndexerMsg(`Indexer error: ${e?.message || String(e)}`);
  }
}




  async function sendTDust() {
    if (!api) return alert("Connect the wallet first.");
    if (!recipient) return alert("Enter recipient address.");
    if (!amount) return alert("Enter amount.");

    setSending(true);
    setLastTxId("");

    try {
      const tx = await buildTDustTransferTx({ to: recipient, amount });
      const balancedAndProven = await api.balanceAndProveTransaction(tx);
      const submitted = await api.submitTransaction(balancedAndProven);
      console.log("submitted =", submitted);

      const txId =
        submitted?.txId ||
        submitted?.transactionId ||
        submitted?.hash ||
        JSON.stringify(submitted);
      setLastTxId(String(txId));

      await refreshBalance();
      alert(`Submitted! Tx: ${txId}`);
    } catch (e: any) {
      console.error(e);
      if (String(e.message || e).includes("Missing Midnight transaction builder")) {
        alert("Install the Midnight wallet SDK and make buildTDustTransferTx(...) return a real Transaction.");
      } else {
        alert(`Send failed: ${e?.message || String(e)}`);
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 860, margin: "0 auto" }}>
      <h1>Midnight Testnet — tDUST Transfer</h1>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={handleConnect}>Connect Wallet (Midnight)</button>
        <button onClick={refreshBalance} disabled={!api}>Refresh Balance</button>
        <button
          onClick={async () => console.log("wallet state (manual dump) =", await api?.state())}
          disabled={!api}
        >
          Dump state to console
        </button>
        <button onClick={queryIndexerForTDust} disabled={!serviceUris || !addr}>
          Query Indexer for tDUST
        </button>
        {indexerMsg && <span style={{ opacity: 0.8 }}>{indexerMsg}</span>}
      </div>

      <div style={{ marginTop: 12 }}>
        <p>Provider key: {providerName || "—"}</p>
        <p>Wallet name: {walletName || "—"}</p>
        <p>API version: {apiVersion || "—"}</p>
        <p>Service URIs: {serviceUris ? "loaded" : "—"}</p>
        <p>Address: {addr || "—"}</p>
        <p>tDUST Balance: {balance !== "" ? balance : "—"}</p>
        <p>
  Service URIs:
  <code style={{ display: "block", whiteSpace: "pre-wrap" }}>
    {serviceUris ? JSON.stringify(serviceUris, null, 2) : "—"}
  </code>
</p>
<div style={{ marginTop: 8, display: "grid", gap: 6, maxWidth: 720 }}>
  <label>
    Indexer URL override (optional):
    <input
      placeholder="https://<public-midnight-indexer>/..."
      value={indexerOverride}
      onChange={(e) => setIndexerOverride(e.target.value)}
      style={{ width: "100%" }}
    />
  </label>
  <small style={{ opacity: 0.8 }}>
    If Lace doesn’t expose an indexer URL, paste one here and click “Query Indexer for tDUST”.
  </small>
</div>

      </div>

      {lastStateJson && (
        <details style={{ marginTop: 12 }}>
          <summary>Show raw wallet state</summary>
          <pre style={{ background: "#222", color: "#ddd", padding: 12, whiteSpace: "pre-wrap" }}>
            {lastStateJson}
          </pre>
        </details>
      )}

      <hr style={{ margin: "16px 0" }} />

      <h3>Send tDUST</h3>
      <div style={{ display: "grid", gap: 8, maxWidth: 520 }}>
        <input
          placeholder="Recipient address (mn_shield-addr_...)"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
        />
        <input
          placeholder="Amount (e.g., 5)"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <button onClick={sendTDust} disabled={!api || sending}>
          {sending ? "Sending…" : "Send tDUST"}
        </button>
        {lastTxId && (
          <p style={{ wordBreak: "break-all" }}>
            Last tx id/hash: <code>{lastTxId}</code>
          </p>
        )}
      </div>

      <MidnightDebug />
    </div>
  );
}
