import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

// @solana/web3.js and client/shield-client.ts (shared with the CLI tools
// in ../client/) both expect a Node-like Buffer in scope -- this polyfill
// is the standard fix for that in browser bundles, used by nearly every
// Solana web dApp.
export default defineConfig({
  plugins: [react(), nodePolyfills({ include: ["buffer"] })],
  // The stack's config (chain, RPC, vault, Privy app ID) lives in the repo
  // root .env alongside the server's, so the app reads its VITE_* vars from
  // there. Explicit env on the command line (see the dev:app:* scripts) still
  // wins over the file.
  envDir: "..",
  // Pre-bundle the heavy dependencies at startup instead of letting Vite
  // discover them lazily. Discovery mid-session triggers a re-optimize, which
  // invalidates the chunk hashes an already-open tab is holding and serves it
  // 504 "Outdated Optimize Dep" until it is hard-reloaded.
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "react-router-dom",
      "motion/react",
      "viem",
      "viem/accounts",
      "@nktkas/hyperliquid",
      "@privy-io/react-auth",
      "@solana/web3.js",
      "@solana/spl-token",
      "@solana/wallet-adapter-react",
      "@solana/wallet-adapter-base",
      "borsh",
      "@noble/hashes/sha2.js",
      "vite-plugin-node-polyfills/shims/buffer",
    ],
  },
  server: {
    port: 5173,
    // client/shield-client.ts lives one level up (shared with the CLI
    // tools in ../client/) -- Vite's dev server otherwise refuses to
    // serve files outside its own root.
    fs: { allow: [".."] },
  },
});
