import type { TokenType } from "@midnight-ntwrk/wallet-api";

// small helper constant for type-safety
const TDUST = "TDust" as TokenType;

export async function buildTDustTransferTx({
  to,
  amount,
}: {
  to: string;
  amount: string;
}) {
  const transfers = [
    {
      amount: BigInt(amount),    // bigint, must be integer
      receiverAddress: to,       // "mn_shield-addr_..."
      type: TDUST,               // ✅ use our constant, not TokenType.TDust
    },
  ];

  // ⚠️ don’t call Transaction.transfer — not exported in wallet-api
  // Instead, just return the array, since the wallet API accepts it:
  return transfers;
}
