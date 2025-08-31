// wallet-bridge.ts
export function getInjectedMidnight(): any | null {
  const root = (window as any)?.midnight;
  if (!root || typeof root !== "object") return null;
  // Prefer explicit lace key if present
  if (root.lace) return root.lace;
  // Otherwise pick the first provider-like object
  const keys = Object.keys(root).filter(k => root[k] && typeof root[k] === "object");
  return keys.length ? root[keys[0]] : null;
}

export async function requireWallet() {
  const w = getInjectedMidnight();
  if (!w) throw new Error(`Wallet not injected. window.midnight keys=${Object.keys((window as any)?.midnight || {}).join(",") || "(none)"}`);
  if (typeof w.enable === "function") {
    try { await w.enable(); } catch {}
  }
  return w;
}
