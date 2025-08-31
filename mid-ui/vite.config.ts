import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

export default defineConfig({
  plugins: [react(), wasm(), topLevelAwait()],
  optimizeDeps: {
    // prevent pre-bundling of the wallet packages (lets them load their own wasm)
    exclude: [
      "@midnight-ntwrk/wallet",
      "@midnight-ntwrk/wallet-api",
      "@midnight-ntwrk/wallet-sdk-capabilities",
      "@midnight-ntwrk/wallet-sdk-address-format",
      "@midnight-ntwrk/dapp-connector-api",
    ],
  },
  build: { target: "esnext", sourcemap: false },
  worker: { format: "es" },
  // optional to avoid full-screen overlay during dev:
  // server: { hmr: { overlay: false } },
});
