// sendWithLocalWallet.ts
import { nativeToken } from "@midnight-ntwrk/zswap";
import { buildLocalWallet } from "./walletLocal";

export async function sendTDustWithLocalWallet(recipientShieldAddr: string, amount: bigint) {
  const wallet = await buildLocalWallet();

  // 1) Build recipe (balances, inputs, change, fees handled for you)
  const recipe = await wallet.transferTransaction([
    { amount, type: nativeToken(), receiverAddress: recipientShieldAddr }
  ]);

  // 2) Prove using your local proof server
  const proven = await wallet.proveTransaction(recipe);

  // 3) Submit to Testnet-02
  const txId = await wallet.submitTransaction(proven);
  return String(txId);
}
