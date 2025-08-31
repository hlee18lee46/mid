export async function buildTDustTransferTx({ to, amount }: { to: string; amount: string }) {
  const WalletSdk: any = await import("@midnight-ntwrk/wallet");
  console.log("Wallet SDK exports:", Object.keys(WalletSdk));
  const build =
    WalletSdk.createTransferTransaction ||
    WalletSdk.buildTransfer ||
    WalletSdk.transfer;
  if (!build) throw new Error("No transfer builder found in @midnight-ntwrk/wallet.");
  return await build({ network: "testnet", asset: "tDUST", to, amount });
}
