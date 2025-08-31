import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import { nodePolyfills } from "vite-plugin-node-polyfills"; 
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [
    react(),
    wasm(),
    topLevelAwait(),
    nodePolyfills({ protocolImports: true }), // 👈 polyfill `node:*`
  ],
  resolve: {
    alias: {
      // shim node-domexception if you added that earlier
      "node-domexception": fileURLToPath(
        new URL("./src/shims/node-domexception.ts", import.meta.url)
      ),

      // Map Node built-ins to browser shims
      "node:stream": "stream-browserify",
      "node:buffer": "buffer",
      "node:util": "util",
      "node:events": "events",
      "node:process": "process/browser",

      // Some deps don’t use the `node:` protocol
      stream: "stream-browserify",
      buffer: "buffer",
      util: "util",
      events: "events",
      process: "process/browser",
    },
  },
  optimizeDeps: {
    // Make sure these shims are pre-bundled
    include: ["buffer", "process", "util", "events", "stream-browserify"],

    // Keep Midnight packages out of pre-bundling so their WASM loads correctly
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
  // server: { hmr: { overlay: false } }, // optional
});
