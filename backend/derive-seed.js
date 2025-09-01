// derive-seed.js
import bip39 from "bip39";

const mnemonic = "detect online situate bachelor ketchup sort daring pulse sudden guess orchard silly load burden penalty screen ceiling voyage loop vanish indicate cousin piece eager"; // put your 24 words here (locally!)
if (!bip39.validateMnemonic(mnemonic)) {
  console.error("Invalid mnemonic");
  process.exit(1);
}
const entropyHex = bip39.mnemonicToEntropy(mnemonic);
console.log("SEED_HEX =", entropyHex);
