#!/usr/bin/env bun
/**
 * Runs the confidential evaluation locally, with plain `fetch` standing in
 * for the enclave's HTTP capability and cre/.env standing in for the Vault
 * DON. Same `evaluateVault` function, same inputs, same signed output —
 * useful for tests and for demos where a Chainlink account isn't at hand.
 *
 *   bun run cre/shield-risk/dryrun.ts <vault> [--no-deliver]
 */
import { readFileSync, existsSync } from "node:fs";
import { evaluateVault, type EnclaveIO } from "./evaluate";

const evm = process.argv.includes("--evm");
const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const vault = positional[0] ?? (evm ? JSON.parse(readFileSync(".shield/demo-state.evm.json", "utf-8")).authority : JSON.parse(readFileSync(".shield/demo-state.localnet.json", "utf-8")).vault);
const deliver = !process.argv.includes("--no-deliver");
const config = JSON.parse(readFileSync(new URL(evm ? "./config.evm.json" : "./config.staging.json", import.meta.url), "utf-8")) as {
  shieldApiUrl: string;
  programId: string;
  secretId: string;
  deliver: boolean;
  chain?: "solana" | "evm";
  chainId?: number;
};
if (evm) {
  // point at the local Anvil deployment written by scripts/anvil-demo.ts
  const st = JSON.parse(readFileSync(".shield/demo-state.evm.json", "utf-8")) as { vault: string; chainId: number };
  config.programId = st.vault;
  config.chainId = st.chainId;
}

// cre/.env → secrets (mirrors what the CLI simulator does)
const envPath = new URL("../.env", import.meta.url).pathname;
const env: Record<string, string> = {};
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
}

// synchronous HTTP for a synchronous evaluation: Bun's fetch is async, so
// run requests through a tiny sync bridge (spawnSync curl) — good enough for a dry run.
function syncHttp(method: "GET" | "POST", url: string, body?: string): { status: number; body: string } {
  const args = ["-s", "-o", "-", "-w", "\n%{http_code}", "-X", method, url];
  if (body) args.push("-H", "content-type: application/json", "--data-binary", body);
  const out = Bun.spawnSync(["curl", ...args]);
  const textOut = new TextDecoder().decode(out.stdout);
  const idx = textOut.lastIndexOf("\n");
  return { status: Number(textOut.slice(idx + 1)), body: textOut.slice(0, idx) };
}

const io: EnclaveIO = {
  getSecret: (id) => {
    const v = process.env[id] ?? env[id];
    if (!v) throw new Error(`secret ${id} missing (cre/.env)`);
    return v;
  },
  get: (url) => syncHttp("GET", url),
  postJson: (url, body) => syncHttp("POST", url, body),
  now: () => Math.floor(Date.now() / 1000),
  log: (msg) => console.log(`[USER LOG] ${msg}`),
};

const result = evaluateVault(io, { ...config, deliver }, vault);
console.log("Workflow dry-run result:");
console.log(JSON.stringify(result, null, 2));
