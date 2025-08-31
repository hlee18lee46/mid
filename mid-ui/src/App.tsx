import { useEffect, useState } from "react";
import { connectMidnight} from "./wallet";
import { buildTDustTransferTx } from "./tx";
import type { DAppConnectorAPI } from "./wallet";  // <-- type-only import

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

  // 1) Keyed object: state.balances.tDUST
  if (state?.balances?.tDUST != null) return String(state.balances.tDUST);

  // 2) Arrays of assets/balances/coins
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

  // 3) Last resort: deep search of JSON
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

  async function handleConnect() {
    try {
      const { api, providerName, walletName, apiVersion, serviceUris, state } = await connectMidnight();

      setApi(api);
      setProviderName(providerName || "");
      setWalletName(walletName || "");
      setApiVersion(apiVersion || "");
      setServiceUris(serviceUris || null);

      console.log("wallet state (on connect) =", state);
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
      console.log("wallet state (refresh) =", state);
      setBalance(deriveTDustBalanceFromState(state) || "");
      if (!addr) setAddr(deriveAddressFromState(state));
    } catch (e) {
      console.error(e);
      alert("Failed to refresh balance (see console).");
    }
  }

  async function sendTDust() {
    if (!api) return alert("Connect the wallet first.");
    if (!recipient) return alert("Enter recipient address.");
    if (!amount) return alert("Enter amount.");

    setSending(true);
    setLastTxId("");

    try {
      // 1) Build a REAL Midnight `Transaction` with the SDK:
      //    Replace buildTDustTransferTx implementation in src/tx.ts
      const tx = await buildTDustTransferTx({ to: recipient, amount });

      // 2) Wallet balances + proves it
      const balancedAndProven = await api.balanceAndProveTransaction(tx);

      // 3) Submit
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
      // Make the "missing builder" case super clear
      if (String(e.message || e).includes("Missing Midnight transaction builder")) {
        alert(
          "You need the Midnight JS SDK transaction builder. Install it and replace buildTDustTransferTx(...) to return a real `Transaction`."
        );
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
      </div>

      <div style={{ marginTop: 12 }}>
        <p>Provider key: {providerName || "—"}</p>
        <p>Wallet name: {walletName || "—"}</p>
        <p>API version: {apiVersion || "—"}</p>
        <p>Service URIs: {serviceUris ? "loaded" : "—"}</p>
        <p>Address: {addr || "—"}</p>
        <p>tDUST Balance: {balance !== "" ? balance : "—"}</p>
      </div>

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

