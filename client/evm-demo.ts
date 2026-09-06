/**
 * Shield EVM demo driver (Anvil / HyperEVM testnet with the mock CoreDepositWallet).
 *
 *   bun run client/evm-demo.ts scoreboard
 *   bun run client/evm-demo.ts top-up <usd>        # vault → the registered venue account (through the vault rules)
 *   bun run client/evm-demo.ts loss <usd>          # DEMO (Anvil only): the venue account loses <usd> on HyperCore
 *   bun run client/evm-demo.ts return <usd>        # DEMO (Anvil only): <usd> comes back Core→EVM to the vault
 *   bun run client/evm-demo.ts pause <hours>       # self-pause (tighten)
 *   bun run client/evm-demo.ts loosen daily=3000   # weakening change (waits 24h)
 *   bun run client/evm-demo.ts cancel <rule-change|top-up|full-exit>
 *
 * Reads .shield/demo-state.evm.<network>.json written by scripts/anvil-demo.ts
 * or scripts/hyperevm-bootstrap.ts.
 */
import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { SHIELD_VAULT_ABI } from "./abi/ShieldVault";
import { MOCK_USDC_ABI } from "./abi/MockUSDC";
import { MOCK_CORE_DEPOSIT_ABI } from "./abi/MockCoreDepositWallet";
import { evmCalls, readProposals, readRegistry, readVault, shieldErrorFromRevert, viemChain, type EvmConfig } from "./evm";
import { evaluateTopUp, rollingVelocity, usdcToRaw } from "./views";
import { evmNetworkName, readEvmState } from "./evm-state";

const network = evmNetworkName(Number(process.env.EVM_CHAIN_ID || 31337));
const state = readEvmState(".shield", network) as unknown as { rpcUrl: string; chainId: number; vault: Address; usdc: Address; coreDeposit: Address | null; authority: Address; executionWallet: Address; coldWallet: Address };
if (!state.vault) throw new Error(`no Shield state for ${network}: run bootstrap:evm (Anvil) or bootstrap:hyperevm first`);
const KEYS = {
  alex: (process.env.EVM_DEMO_KEY || "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80") as Hex,
  venue: (process.env.EVM_EXECUTION_KEY || "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d") as Hex,
};
const cfg: EvmConfig = { rpcUrl: state.rpcUrl, chainId: state.chainId, vault: state.vault, usdc: state.usdc };
const chain = viemChain(cfg);
const pub = createPublicClient({ chain, transport: http(cfg.rpcUrl) });
const fmt = (raw: bigint) => `$${(Number(raw) / 1e6).toLocaleString("en-US")}`;

async function send(label: string, key: Hex, to: Address, data: Hex) {
  const account = privateKeyToAccount(key);
  const wc = createWalletClient({ account, chain, transport: http(cfg.rpcUrl) });
  try {
    await pub.call({ account: account.address, to, data });
  } catch (e) {
    const name = shieldErrorFromRevert(e);
    console.log(`❌ ${label}: rejected by the vault${name ? ` (${name})` : ""}`);
    return null;
  }
  const hash = await wc.sendTransaction({ account, chain, to, data });
  const rcpt = await pub.waitForTransactionReceipt({ hash });
  console.log(`${rcpt.status === "success" ? "✅" : "❌"} ${label}: ${hash}`);
  return hash;
}

async function scoreboard() {
  const r = await readVault(pub, cfg, state.authority);
  if (!r) return console.log("no vault");
  const v = r.vault;
  const now = BigInt(Math.floor(Date.now() / 1000));
  const reg = await readRegistry(pub, cfg, state.authority);
  const props = await readProposals(pub, cfg, state.authority);
  const core = state.coreDeposit ? ((await pub.readContract({ address: state.coreDeposit, abi: MOCK_CORE_DEPOSIT_ABI, functionName: "coreBalance", args: [state.executionWallet] })) as bigint) : null;
  console.log(`\nShield vault ${state.vault} (${chain.name}) · authority ${state.authority}`);
  console.log(`  Protected balance      ${fmt(r.balance)}  (floor ${fmt(v.protectedFloor)})`);
  console.log(`  Daily top-up limit     ${fmt(v.velocityThreshold)} / 24h · used ${fmt(rollingVelocity(v, now))}`);
  console.log(`  Large top-up pause     >= ${v.topUpThresholdBps / 100}% of balance waits ${Number(v.topUpCooldownSecs) / 60} min`);
  console.log(`  Loss rule              >= ${fmt(v.lossTriggerUsdc)} realised in 24h -> pause ${Number(v.lossCooldownSecs) / 3600}h`);
  console.log(`  Cooldown               ${now < v.cooldownUntil ? `ACTIVE (${v.cooldownReason === 2 ? "loss rule" : "self-pause"}) until ${new Date(Number(v.cooldownUntil) * 1000).toLocaleString()}` : "none"}`);
  console.log(`  Config version         ${v.configVersion}   verdicts applied ${v.lastVerdictNonce}`);
  console.log(`  Venue account          ${core === null ? "real HyperCore (read it on app.hyperliquid.xyz)" : `${fmt(core)} (mock CoreDepositWallet)`}`);
  for (const e of reg) console.log(`    ${e.kind === 1 ? "cold     " : "execution"} ${e.owner} "${e.label}" route=${e.route === 1 ? "hypercore" : "evm"}${e.active ? "" : " (removed)"}`);
  for (const p of props) console.log(`  Pending ${["rule change", "top-up", "full exit"][p.category]} #${p.nonce}: executes ${new Date(Number(p.executeAfter) * 1000).toLocaleString()} — ${JSON.stringify(p.action, (_k, x) => (typeof x === "bigint" ? x.toString() : x))}`);
}

async function topUp(usd: number) {
  const r = await readVault(pub, cfg, state.authority);
  if (!r) throw new Error("no vault");
  const amount = usdcToRaw(usd);
  const d = evaluateTopUp(r.vault, r.balance, amount, BigInt(Math.floor(Date.now() / 1000)));
  console.log(`Top-up ${fmt(amount)} to ${state.executionWallet}: expected path = ${d.path}${d.reason ? ` (${d.reason})` : ""}`);
  const call = d.path === "gated" ? evmCalls.proposeTopUp(cfg, state.executionWallet, amount) : evmCalls.instantTopUp(cfg, state.executionWallet, amount);
  await send(d.path === "gated" ? "top-up proposed (gated path)" : "instant top-up → HyperCore", KEYS.alex, call.to, call.data);
}

/** The mock CoreDepositWallet only exists on Anvil: on a real network the loss is real. */
function requireMockCore(cmd: string): Address {
  if (!state.coreDeposit) throw new Error(`\`${cmd}\` simulates a HyperCore settlement through the mock deposit wallet, which only exists on Anvil.\nOn ${network} the loss is real: trade the venue account down, then send USDC back to the vault from it.`);
  return state.coreDeposit;
}

async function loss(usd: number) {
  const core = requireMockCore("loss");
  const { encodeFunctionData } = await import("viem");
  await send(`the venue account loses ${fmt(usdcToRaw(usd))} (mock settle)`, KEYS.venue, core, encodeFunctionData({ abi: MOCK_CORE_DEPOSIT_ABI, functionName: "settleLoss", args: [state.executionWallet, usdcToRaw(usd)] }));
}

async function ret(usd: number) {
  const core = requireMockCore("return");
  const { encodeFunctionData } = await import("viem");
  const amount = usdcToRaw(usd);
  await send(`venue account withdraws ${fmt(amount)} HyperCore → EVM`, KEYS.venue, core, encodeFunctionData({ abi: MOCK_CORE_DEPOSIT_ABI, functionName: "withdrawToEvm", args: [amount] }));
  await send(`${fmt(amount)} returned to the vault`, KEYS.venue, state.usdc, encodeFunctionData({ abi: MOCK_USDC_ABI, functionName: "transfer", args: [state.vault, amount] }));
}

async function pause(hours: number) {
  const r = await readVault(pub, cfg, state.authority);
  if (!r) throw new Error("no vault");
  const until = BigInt(Math.max(Number(r.vault.cooldownUntil), Math.floor(Date.now() / 1000)) + hours * 3600);
  const call = evmCalls.tighten(cfg, { pauseTopUpsUntil: until });
  await send(`self-pause ${hours}h`, KEYS.alex, call.to, call.data);
}

async function loosen(args: string[]) {
  const l: Parameters<typeof evmCalls.proposeLoosen>[1] = {};
  for (const a of args) {
    const [k, v] = a.split("=");
    if (k === "daily") l.newVelocityThreshold = usdcToRaw(Number(v));
    if (k === "floor") l.newProtectedFloor = usdcToRaw(Number(v));
    if (k === "trigger") l.newLossTriggerUsdc = usdcToRaw(Number(v));
    if (k === "cooldown") l.newLossCooldownSecs = BigInt(Number(v) * 3600);
  }
  const call = evmCalls.proposeLoosen(cfg, l);
  await send(`loosen ${args.join(" ")} (waits)`, KEYS.alex, call.to, call.data);
}

async function cancel(which: string) {
  const cat = ({ "rule-change": 0, "top-up": 1, "full-exit": 2 } as Record<string, number>)[which];
  if (cat === undefined) throw new Error("cancel <rule-change|top-up|full-exit>");
  const call = evmCalls.cancelProposal(cfg, cat);
  await send(`cancel ${which}`, KEYS.alex, call.to, call.data);
}

const [cmd, ...args] = process.argv.slice(2);
(async () => {
  switch (cmd) {
    case "scoreboard": return scoreboard();
    case "top-up": return topUp(Number(args[0]));
    case "loss": return loss(Number(args[0]));
    case "return": return ret(Number(args[0]));
    case "pause": return pause(Number(args[0] ?? 24));
    case "loosen": return loosen(args);
    case "cancel": return cancel(args[0]);
    default: console.log("commands: scoreboard | top-up <usd> | loss <usd> | return <usd> | pause <h> | loosen k=v | cancel <cat>");
  }
})().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
