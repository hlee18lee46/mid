// src/wallet.ts
type DAppConnectorProvider = {
  name: string;
  apiVersion: string;
  enable: () => Promise<DAppConnectorAPI>;
  isEnabled: () => Promise<boolean>;
  serviceUriConfig: () => Promise<{
    nodeUrl?: string;
    indexerUrl?: string;
    provingServerUrl?: string;
  }>;
};

export type DAppConnectorAPI = {
  state: () => Promise<any>;
  balanceAndProveTransaction: (tx: any, newCoins?: any[]) => Promise<any>;
  submitTransaction: (balancedAndProvenTx: any) => Promise<any>;
  balanceTransaction?: (tx: any) => Promise<any>; // deprecated
  proveTransaction?: (tx: any) => Promise<any>;   // deprecated
};

function pickMidnightProvider():
  | { name: string; provider: DAppConnectorProvider }
  | null {
  const m = (window as any)?.midnight;
  if (!m) return null;
  const candidates = [
    "mnLace",                // <-- your provider key
    "lace",
    "lace_preview",
    "laceMidnight",
    "laceMidnightPreview",
    "lace-midnight",
    "lace-midnight-preview",
  ];
  for (const k of candidates) if (m[k]?.enable) return { name: k, provider: m[k] };
  for (const k of Object.keys(m)) if (m[k]?.enable) return { name: k, provider: m[k] };
  return null;
}

export async function connectMidnight() {
  const picked = pickMidnightProvider();
  if (!picked) {
    const keys = Object.keys((window as any)?.midnight || {});
    throw new Error(
      `Midnight wallet not detected. Providers found: ${keys.length ? keys.join(", ") : "(none)"}.\n` +
      `Ensure Lace Midnight Preview is installed/unlocked and reload (disable Brave Shields if needed).`
    );
  }
  const api = await picked.provider.enable();
  const st = await api.state().catch(() => null);
  const svc = await picked.provider.serviceUriConfig().catch(() => ({}));
  return {
    api,
    providerName: picked.name,
    apiVersion: picked.provider.apiVersion,
    walletName: picked.provider.name,
    serviceUris: svc,
    state: st,
  };
}
