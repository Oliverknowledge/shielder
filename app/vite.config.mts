import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

// @solana/web3.js and client/shield-client.ts (shared with the CLI tools
// in ../client/) both expect a Node-like Buffer in scope -- this polyfill
// is the standard fix for that in browser bundles, used by nearly every
// Solana web dApp.
export default defineConfig({
  plugins: [react(), nodePolyfills({ include: ["buffer"] })],
  server: {
    port: 5173,
    // client/shield-client.ts lives one level up (shared with the CLI
    // tools in ../client/) -- Vite's dev server otherwise refuses to
    // serve files outside its own root.
    fs: { allow: [".."] },
  },
});
