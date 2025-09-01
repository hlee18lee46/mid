// App.tsx
import { useEffect, useState } from "react";
import { connectMidnight } from "./wallet";
import type { DAppConnectorAPI } from "./wallet";
import {
  NetworkId,
  UnprovenOffer,
  UnprovenOutput,
  UnprovenTransaction,
  ProofErasedTransaction,
  SecretKeys,
  LocalState,
  createCoinInfo,
  nativeToken,
  type QualifiedCoinInfo,
} from "@midnight-ntwrk/ledger";

import { sendTDustWithLocalWallet } from "./sendWithLocalWallet";


async function demoModeSendTDust(recipientCPK: string, recipientEPK: string, amount: bigint): Promise<string> {
  const outInfo = createCoinInfo(nativeToken(), amount);
  const out = UnprovenOutput.new(outInfo, 0, recipientCPK, recipientEPK);
  const guaranteed = UnprovenOffer.fromOutput(out, nativeToken(), outInfo.value);
  const utx = new UnprovenTransaction(guaranteed);
  const pr: ProofErasedTransaction = utx.eraseProofs();
  const ids = pr.identifiers();
  if (ids?.length) return String(ids[0]);
  const bytes = pr.serialize(NetworkId.TestNet);
  return "demo_" + Array.from(bytes).slice(0, 24).map(b => b.toString(16).padStart(2,"0")).join("");
}

/**
 * Build a proof-erased tDUST transfer (no on-chain submission here).
 * @param qcoin  A spendable coin: { type, nonce, value, mt_index }
 * @param recipientCpk  mn_shield-cpk_...
 * @param recipientEpk  mn_shield-epk_...
 * @param amount        bigint
 */
export function buildProofErasedTDustTransfer(
  qcoin: QualifiedCoinInfo,
  recipientCpk: string,
  recipientEpk: string,
  amount: bigint
): { pr: ProofErasedTransaction; bytes: Uint8Array } {
  // 1) Make an UnprovenInput for a *user-owned* coin using LocalState.spend
  //    (We use demo keys here just to satisfy the API; wallet would normally supply keys.)
  const demoSeed = new Uint8Array(32);
  const sk = SecretKeys.fromSeed(demoSeed);
  let local = new LocalState();
  const [, ui] = local.spend(sk, qcoin, /*segment*/ 0);

  // 2) Create the recipient output
  const outInfo = createCoinInfo(nativeToken(), amount);
  const out = UnprovenOutput.new(outInfo, 0, recipientCpk, recipientEpk);

  // 3) Assemble guaranteed offer (input -> output), plus change back to sender (ignoring fees here)
  let guaranteed = UnprovenOffer
    .fromInput(ui, nativeToken(), qcoin.value)
    .merge(UnprovenOffer.fromOutput(out, nativeToken(), outInfo.value));

  const change = qcoin.value - outInfo.value; // NOTE: not fee-adjusted in this mock
  if (change > 0n) {
    const changeInfo = createCoinInfo(nativeToken(), change);
    const changeOut = UnprovenOutput.new(changeInfo, 1, sk.coinPublicKey, sk.encryptionPublicKey);
    guaranteed = guaranteed.merge(UnprovenOffer.fromOutput(changeOut, nativeToken(), changeInfo.value));
  }

  // 4) Wrap → erase proofs → serialize for TestNet
  const utx = new UnprovenTransaction(guaranteed);
  const pr: ProofErasedTransaction = utx.eraseProofs();
  const bytes = pr.serialize(NetworkId.TestNet);
  return { pr, bytes };
}

/* -------------------------------------------------------
   Provider discovery: prefer mnLace, then lace, else first
------------------------------------------------------- */
function getProvider(): any | null {
  const root = (window as any)?.midnight;
  if (!root || typeof root !== "object") return null;
  if (root.mnLace) return root.mnLace;
  if (root.lace) return root.lace;
  const key = Object.keys(root).find(k => root[k] && typeof root[k] === "object");
  return key ? root[key] : null;
}

async function requireWallet(): Promise<any> {
  const w = getProvider();
  if (!w) throw new Error("Wallet not injected. Open Lace (Midnight test profile) and reload.");
  if (typeof w.enable === "function") {
    try { await w.enable(); } catch {}
  }
  return w;
}

/* -------------------------------------------------------
   PATH A — High-level transfer via wallet (no coin list)
   (balanceAndProveTransaction → submitTransaction)
------------------------------------------------------- */
async function walletTransferTDust(receiverAddress: string, amount: bigint): Promise<string> {
  const w = await requireWallet();
  if (typeof (w as any).balanceAndProveTransaction !== "function" ||
      typeof (w as any).submitTransaction !== "function") {
    throw new Error("High-level transfer API not available on this wallet.");
  }

  const transfers = [{ amount, receiverAddress, type: "TDust" as any }];

  // Some wallets accept just the result object; others need a nested field.
  const res = await (w as any).balanceAndProveTransaction({ transfers });

  const candidates = [
    res,
    res?.transaction,
    res?.tx,
    res?.value,
    res?.provenTransaction,
    res?.signed,
    res?.signedTx,
    res?.payload,
  ].filter(Boolean);

  for (const c of candidates) {
    try {
      const id = await (w as any).submitTransaction(c);
      if (id) return String(id);
    } catch {
      // try next candidate
    }
  }
  throw new Error("Wallet submitTransaction returned no tx id.");
}

/* -------------------------------------------------------
   PATH B — Low-level ledger offer (needs coins list)
   (UnprovenOffer → UnprovenTransaction.eraseProofs → serialize)
------------------------------------------------------- */
function toBigIntSafe(x: any): bigint | null {
  if (typeof x === "bigint") return x;
  if (typeof x === "number" && Number.isFinite(x)) return BigInt(Math.trunc(x));
  if (typeof x === "string" && /^-?\d+$/.test(x.trim())) return BigInt(x.trim());
  return null;
}

function normalizeQCoin(o: any): QualifiedCoinInfo | null {
  if (!o || typeof o !== "object") return null;
  const type = o.type ?? o.token ?? o.tokenType ?? o.color ?? o.asset ?? null;
  const nonce = o.nonce ?? o.randomness ?? o.rand ?? null;
  const value = toBigIntSafe(o.value ?? o.amount ?? o.balance ?? o.quantity);
  const mt_index = toBigIntSafe(
    o.mt_index ?? o.mtIndex ?? o.merkleIndex ?? o.index ?? o.treeIndex ?? (("idx" in o) ? o.idx : undefined)
  );
  if (typeof type === "string" && typeof nonce === "string" && value != null && mt_index != null) {
    return { type, nonce, value, mt_index };
  }
  return null;
}

function extractQualifiedCoinsFrom(anyObj: any): QualifiedCoinInfo[] {
  const out: QualifiedCoinInfo[] = [];
  const seen = new Set<any>();
  const stack: any[] = [anyObj];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object" || seen.has(cur)) continue;
    seen.add(cur);
    const asQ = normalizeQCoin(cur);
    if (asQ) out.push(asQ);
    if (Array.isArray(cur)) { for (const it of cur) stack.push(it); continue; }
    for (const v of Object.values(cur)) stack.push(v);
  }
  const key = (c: QualifiedCoinInfo) => `${c.type}|${c.nonce}|${c.value}|${c.mt_index}`;
  return Array.from(new Map(out.map(c => [key(c), c])).values());
}

async function walletListCoins(): Promise<QualifiedCoinInfo[]> {
  const w = await requireWallet();

  if (typeof w.listCoins === "function") return (await w.listCoins()) as QualifiedCoinInfo[];
  if (typeof w.getUtxos === "function") return (await w.getUtxos()) as QualifiedCoinInfo[];
  if (typeof w.coins === "function") return (await w.coins()) as QualifiedCoinInfo[];

  // Fallback: mine from state / serializeState
  let stateObj: any = null;
  try {
    if (typeof w.serializeState === "function") {
      const s = await w.serializeState();
      try { stateObj = JSON.parse(s); } catch {}
    }
    if (!stateObj && typeof w.state === "function") {
      const st = await w.state();
      stateObj = st?.state ?? st ?? null;
    }
  } catch {}

  if (stateObj) {
    const mined = extractQualifiedCoinsFrom(stateObj);
    if (mined.length) return mined;
  }

  throw new Error("NO_COIN_ENUM");
}

async function ledgerOfferTDust(recipientCpkHex: string, recipientEpkHex: string, amount: bigint): Promise<string> {
  const coins = await walletListCoins(); // may throw NO_COIN_ENUM
  if (!coins.length) throw new Error("No spendable coins. Use faucet for tDUST.");

  const coin = coins.find(c => c.value >= amount) || coins[0];

  const dummySeed = new Uint8Array(32); // demo keys; your wallet should supply keys for real change outputs
  const sk = SecretKeys.fromSeed(dummySeed);
  let local = new LocalState();
  const [/*local2*/, unprovenInput] = local.spend(sk, coin, 0);

  const { UnprovenOutput } = await import("@midnight-ntwrk/ledger");
  const outInfo = createCoinInfo(nativeToken(), amount);
  const out = UnprovenOutput.new(outInfo, 0, recipientCpkHex, recipientEpkHex);

  let guaranteed = UnprovenOffer
    .fromInput(unprovenInput, nativeToken(), coin.value)
    .merge(UnprovenOffer.fromOutput(out, nativeToken(), outInfo.value));

  const change = coin.value - outInfo.value; // NOTE: does not subtract fees for brevity
  if (change > 0n) {
    const changeInfo = createCoinInfo(nativeToken(), change);
    const changeOut = UnprovenOutput.new(changeInfo, 1, sk.coinPublicKey, sk.encryptionPublicKey);
    guaranteed = guaranteed.merge(UnprovenOffer.fromOutput(changeOut, nativeToken(), changeInfo.value));
  }

  const utx = new UnprovenTransaction(guaranteed);
  const proofErased: ProofErasedTransaction = utx.eraseProofs();
  const bytes = proofErased.serialize(NetworkId.TestNet);

  const w = await requireWallet();
  if (typeof w.signAndSubmitTx === "function") return await w.signAndSubmitTx(bytes);
  if (typeof w.submitTransaction === "function") {
    try { return await w.submitTransaction(bytes); }
    catch { return await w.submitTransaction({ serialize: () => bytes }); }
  }
  throw new Error("Wallet lacks sign/submit (signAndSubmitTx/submitTransaction).");
}

/* -------------------------------------------------------
   UI helpers
------------------------------------------------------- */
function safeStringify(x: any): string {
  try { return JSON.stringify(x, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2); }
  catch { try { return String(x); } catch { return ""; } }
}

function deriveAddressFromState(state: any): string {
  if (!state) return "";
  return state?.addresses?.[0] || state?.address || state?.account?.address || "";
}

function deriveTDustBalanceFromState(state: any): string {
  if (!state) return "";
  if (state?.balances?.tDUST != null) return String(state.balances.tDUST);
  const arrays: any[] = [];
  if (Array.isArray(state?.assets)) arrays.push(state.assets);
  if (Array.isArray(state?.balances)) arrays.push(state.balances);
  if (Array.isArray(state?.coins)) arrays.push(state.coins);
  for (const arr of arrays) {
    const hit = arr.find((x: any) =>
      x?.asset === "tDUST" || x?.ticker === "tDUST" || x?.symbol === "tDUST" || x?.denom === "tDUST"
    );
    if (hit?.amount != null) return String(hit.amount);
    if (hit?.balance != null) return String(hit.balance);
  }
  try {
    const m = JSON.stringify(state).match(/"tDUST"\s*:\s*"?([\d.]+)"/i);
    if (m?.[1]) return m[1];
  } catch {}
  return "";
}

function MidnightDebug() {
  const [keys, setKeys] = useState<string[] | null>(null);
  useEffect(() => {
    const m = (window as any)?.midnight;
    setKeys(m ? Object.keys(m) : null);
    console.log("window.midnight =", m);
  }, []);
  return (
    <pre style={{ background: "#111", color: "#0f0", padding: 8, overflow: "auto" }}>
      midnight providers: {keys ? JSON.stringify(keys) : "(window.midnight is undefined)"}
    </pre>
  );
}

/* -------------------------------------------------------
   Component
------------------------------------------------------- */
export default function App() {
  const [api, setApi] = useState<DAppConnectorAPI | null>(null);
  const [providerName, setProviderName] = useState("");
  const [walletName, setWalletName] = useState("");
  const [apiVersion, setApiVersion] = useState("");
  const [serviceUris, setServiceUris] = useState<any>(null);

  const [addr, setAddr] = useState("");
  const [balance, setBalance] = useState<string>("");

  // Inputs for Mode A (wallet transfer)
  const [recipientAddr, setRecipientAddr] = useState("");
  // Inputs for Mode B (ledger offer)
  const [recipientCPK, setRecipientCPK] = useState("");
  const [recipientEPK, setRecipientEPK] = useState("");

  const [amount, setAmount] = useState("1");
  const [sending, setSending] = useState(false);
  const [lastTxId, setLastTxId] = useState("");

  // Which mode is available? (auto-detected)
  const [canWalletTransfer, setCanWalletTransfer] = useState<boolean | null>(null);
  const [canCoinEnum, setCanCoinEnum] = useState<boolean | null>(null);

  const [lastStateJson, setLastStateJson] = useState<string>("");

  async function handleConnect() {
    try {
      const { api, providerName, walletName, apiVersion, serviceUris, state } = await connectMidnight();
      setApi(api);
      setProviderName(providerName || "");
      setWalletName(walletName || "");
      setApiVersion(apiVersion || "");
      setServiceUris(serviceUris || null);
      setLastStateJson(JSON.stringify(state, null, 2));
      setAddr(deriveAddressFromState(state));
      setBalance(deriveTDustBalanceFromState(state));

      // detect capabilities
      const w = await requireWallet();
      setCanWalletTransfer(typeof w.balanceAndProveTransaction === "function" &&
                           typeof w.submitTransaction === "function");
      setCanCoinEnum(typeof w.listCoins === "function" ||
                     typeof w.getUtxos === "function" ||
                     typeof w.coins === "function" ||
                     typeof w.serializeState === "function" ||
                     typeof w.state === "function");
    } catch (e: any) {
      alert(e.message || String(e));
    }
  }

  async function refreshBalance() {
    try {
      const w = await requireWallet();
      if (typeof w.serializeState === "function") {
        const s = await w.serializeState();
        const parsed = JSON.parse(s);
        const root = parsed?.state ?? parsed;
        setLastStateJson(safeStringify(root));
        if (!addr) setAddr(root?.address || "");
        if (root?.balances?.TDust != null) setBalance(String(root.balances.TDust));
        else setBalance(deriveTDustBalanceFromState(root));
      } else if (typeof w.state === "function") {
        const st = await w.state();
        setLastStateJson(safeStringify(st));
        if (!addr) setAddr(deriveAddressFromState(st));
        setBalance(deriveTDustBalanceFromState(st));
      }
    } catch (e) {
      console.error("refreshBalance error:", e);
    }
  }

  async function onSendTDust() {
    setSending(true);
    setLastTxId("");
    try {
      const amt = BigInt(amount.trim());
      const w = await requireWallet();
      const supportsWalletTransfer = typeof w.balanceAndProveTransaction === "function" &&
                                     typeof w.submitTransaction === "function";

      // Prefer high-level wallet transfer if available
      if (supportsWalletTransfer) {
        if (!/^mn_/.test(recipientAddr)) {
          throw new Error("Recipient must be a Midnight shield address (mn_...) for wallet transfer mode.");
        }
        const txId = await walletTransferTDust(recipientAddr, amt);
        setLastTxId(txId);
        alert(`Submitted (wallet transfer). Tx: ${txId}`);
        return;
      }

      // Fallback to ledger-offer mode (needs CPK + EPK)
      if (!/^mn_/.test(recipientCPK) || !/^mn_/.test(recipientEPK)) {
        throw new Error("Recipient CPK/EPK required (mn_shield-cpk_..., mn_shield-epk_...) for ledger-offer mode.");
      }
      const txId = await ledgerOfferTDust(recipientCPK, recipientEPK, amt);
      setLastTxId(txId);
      alert(`Submitted (ledger offer). Tx: ${txId}`);
    } catch (e: any) {
      console.error(e);
      alert(`Send failed: ${e?.message || String(e)}`);
    } finally {
      setSending(false);
    }
  }

  useEffect(() => {
    const m = (window as any)?.midnight;
    console.log("window.midnight =", m, "keys=", m ? Object.keys(m) : []);
  }, []);

  return (
    <div style={{ padding: 24, maxWidth: 860, margin: "0 auto" }}>
      <h1>Midnight Testnet — tDUST Transfer</h1>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={handleConnect}>Connect Wallet (Midnight)</button>
        <button onClick={refreshBalance}>Refresh Balance</button>
        <button
          onClick={async () => {
            try { console.log("wallet state:", await (await requireWallet()).state?.()); }
            catch (e) { console.log("wallet state() unavailable", e); }
          }}
        >
          Dump state to console
        </button>
      </div>

      <div style={{ marginTop: 12 }}>
        <p>Provider: {providerName || "(auto-detected)"}</p>
        <p>Wallet: {walletName || "—"}</p>
        <p>API version: {apiVersion || "—"}</p>
        <p>Address (heuristic): {addr || "—"}</p>
        <p>tDUST Balance: {balance !== "" ? balance : "—"}</p>
        <p>Capabilities: walletTransfer={String(canWalletTransfer)} coinEnum={String(canCoinEnum)}</p>
      </div>

      <hr style={{ margin: "16px 0" }} />

      <h3>Send tDUST</h3>

      {/* Mode A: wallet transfer (preferred when available) */}
      <fieldset style={{ border: "1px solid #444", padding: 12, marginBottom: 12 }}>
        <legend>Mode A — Wallet Transfer (uses shield address)</legend>
        <div style={{ display: "grid", gap: 8, maxWidth: 520 }}>
          <input
            placeholder="Recipient shield address (mn_...)"
            value={recipientAddr}
            onChange={(e) => setRecipientAddr(e.target.value)}
          />
          <input
            placeholder="Amount (e.g., 5)"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <button onClick={onSendTDust} disabled={sending}>
            {sending ? "Sending…" : "Send tDUST"}
          </button>
          {lastTxId && (
            <p style={{ wordBreak: "break-all" }}>
              Last tx id/hash: <code>{lastTxId}</code>
            </p>
          )}
        </div>
        <small style={{ opacity: 0.8 }}>
          If your wallet doesn’t expose the high-level transfer API, the app will fall back to Mode B.
        </small>
      </fieldset>

      {/* Mode B: ledger offer (requires CPK+EPK) */}
      <fieldset style={{ border: "1px dashed #666", padding: 12 }}>
        <legend>Mode B — Ledger Offer (uses CPK + EPK)</legend>
        <div style={{ display: "grid", gap: 8, maxWidth: 520 }}>
          <input
            placeholder="Recipient Coin Public Key (mn_shield-cpk_...)"
            value={recipientCPK}
            onChange={(e) => setRecipientCPK(e.target.value)}
          />
          <input
            placeholder="Recipient Encryption Public Key (mn_shield-epk_...)"
            value={recipientEPK}
            onChange={(e) => setRecipientEPK(e.target.value)}
          />
        </div>
      </fieldset>

      {lastStateJson && (
        <details style={{ marginTop: 12 }}>
          <summary>Show raw wallet state</summary>
          <pre style={{ background: "#222", color: "#ddd", padding: 12, whiteSpace: "pre-wrap" }}>
            {lastStateJson}
          </pre>
        </details>
      )}

      <MidnightDebug />
    </div>
  );
}
