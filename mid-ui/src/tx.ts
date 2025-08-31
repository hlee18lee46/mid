// src/tx.ts
export async function buildTDustTransferTx(params: { to: string; amount: string }) {
  const WalletSdk: any = await import("@midnight-ntwrk/wallet"); // dynamic import!

  console.log("Wallet SDK exports:", Object.keys(WalletSdk));
  const build =
    WalletSdk.createTransferTransaction ||
    WalletSdk.buildTransfer ||
    WalletSdk.transfer;

  if (!build) {
    throw new Error(
      "No transfer builder found in @midnight-ntwrk/wallet. Check the names printed above and switch to the correct one."
    );
  }

  return await build({
    network: "testnet",
    asset: "tDUST",
    to: params.to,
    amount: params.amount, // string if SDK expects big-int string
  });
}
