/**
 * Lower a vault's loss trigger. Lowering it is a TIGHTENING
 * (`ShieldVault.sol`: `tighten` reverts if the new trigger is higher), so it
 * takes effect in the block it lands in — no 24-hour wait, no confirmation.
 *
 *   bun run scripts/tighten-loss-trigger.ts <authority> <usd>
 *   bun run scripts/tighten-loss-trigger.ts 0x751D1e26… 1
 *
 * Written for the demo: the loss beat needs the rule to actually fire, and the
 * trading account holds a few dollars rather than a few hundred, so the trigger
 * comes down to meet the loss instead of the loss going up to meet the trigger.
 * It is one-way for 24 hours in the sense that raising it back is a loosening.
 *
 * Signs with `.shield/hyperevm-keys.json` -> `authority`, or SHIELD_AUTHORITY_KEY.
 */
import { createWalletClient, getAddress, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";
import { publicClientFor, readVault, evmCalls, viemChain, type EvmConfig } from "../client/evm";
import { evmNetworkName, readEvmState } from "../client/evm-state";

const STATE_DIR = process.env.SHIELD_STATE_DIR ?? ".shield";
const CHAIN_ID = Number(process.env.EVM_CHAIN_ID || 998);
if (CHAIN_ID === 999 || CHAIN_ID === 1) throw new Error("refusing: this changes a rule on a mainnet vault");
const state = readEvmState(STATE_DIR, evmNetworkName(CHAIN_ID)) as Record<string, string>;

const authorityArg = process.argv[2];
const usd = Number(process.argv[3]);
if (!authorityArg || !Number.isFinite(usd) || usd <= 0) {
  console.error("usage: bun run scripts/tighten-loss-trigger.ts <authority 0x…> <usd>");
  process.exit(2);
}
const authority = getAddress(authorityArg) as Address;
const target = BigInt(Math.round(usd * 1e6));

const cfg: EvmConfig = {
  rpcUrl: process.env.EVM_RPC_URL || state.rpcUrl || "https://rpc.hyperliquid-testnet.xyz/evm",
  chainId: CHAIN_ID,
  vault: getAddress(process.env.SHIELD_VAULT_ADDRESS || state.vault) as Address,
  usdc: getAddress(process.env.USDC_ADDRESS || state.usdc) as Address,
};

const keyFromFile = () => {
  const keys = JSON.parse(readFileSync(`${STATE_DIR}/hyperevm-keys.json`, "utf8")) as Record<string, Hex>;
  // The demo vaults are owned by different generated keys; pick the one whose
  // address matches the authority being tightened rather than guessing.
  for (const [name, k] of Object.entries(keys)) {
    try {
      if (privateKeyToAccount(k).address.toLowerCase() === authority.toLowerCase()) return { name, key: k };
    } catch {
      /* not a key field */
    }
  }
  throw new Error(`no key in ${STATE_DIR}/hyperevm-keys.json owns ${authority}`);
};
const { name, key } = process.env.SHIELD_AUTHORITY_KEY
  ? { name: "SHIELD_AUTHORITY_KEY", key: process.env.SHIELD_AUTHORITY_KEY as Hex }
  : keyFromFile();
const signer = privateKeyToAccount(key);
if (signer.address.toLowerCase() !== authority.toLowerCase()) throw new Error(`${name} is ${signer.address}, not ${authority}`);

const pub = publicClientFor(cfg);
const before = await readVault(pub, cfg, authority);
if (!before) throw new Error(`no vault for ${authority} on ${cfg.vault}`);
const cur = (before.vault as unknown as { lossTriggerUsdc: bigint; configVersion: bigint }).lossTriggerUsdc;

console.log(`vault        ${cfg.vault} (chain ${cfg.chainId})`);
console.log(`authority    ${authority}  (key: ${name})`);
console.log(`lossTrigger  $${(Number(cur) / 1e6).toFixed(2)} -> $${usd.toFixed(2)}`);
if (target > cur) throw new Error("that is a LOOSENING: raising a trigger waits 24h and needs proposeLoosen");
if (target === cur) { console.log("already there; nothing to do"); process.exit(0); }

const call = evmCalls.tighten(cfg, { newLossTriggerUsdc: target });
const wallet = createWalletClient({ account: signer, chain: viemChain(cfg), transport: http(cfg.rpcUrl) });
const hash = await wallet.sendTransaction({ to: call.to, data: call.data });
const receipt = await pub.waitForTransactionReceipt({ hash });
const after = await readVault(pub, cfg, authority);
const v = after!.vault as unknown as { lossTriggerUsdc: bigint; configVersion: bigint };
console.log(`${receipt.status === "success" ? "✅" : "❌"} ${hash} (block ${receipt.blockNumber})`);
console.log(`lossTrigger  now $${(Number(v.lossTriggerUsdc) / 1e6).toFixed(2)}   configVersion ${(before.vault as unknown as { configVersion: bigint }).configVersion} -> ${v.configVersion}`);
console.log(`\nAny pending loosening on this vault is now stale, by design.`);
