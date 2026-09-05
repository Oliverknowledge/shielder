#!/usr/bin/env bun
/**
 * Shield demo CLI — every action the app exposes, from the terminal, against
 * the real program. Reads the state file scripts/bootstrap-demo.ts wrote.
 *
 *   bun run client/demo.ts scoreboard
 *   bun run client/demo.ts faucet <usdc>              # DEMO: mint test USDC to the authority (via the server)
 *   bun run client/demo.ts deposit <usdc>             # deposit from the authority's wallet into the vault
 *   bun run client/demo.ts top-up <usdc>              # instant if allowed, else explains why not
 *   bun run client/demo.ts schedule-top-up <usdc>     # gated path (proposal)
 *   bun run client/demo.ts execute-top-up
 *   bun run client/demo.ts pause <hours>              # self-pause (instant tighten)
 *   bun run client/demo.ts tighten floor=<usdc> daily=<usdc> trigger=<usdc> cooldown=<hours>
 *   bun run client/demo.ts loosen floor=<usdc> daily=<usdc> trigger=<usdc> cooldown=<hours>
 *   bun run client/demo.ts cancel <rule-change|top-up|full-exit>
 *   bun run client/demo.ts cold <usdc>                # capped instant transfer to the cold wallet
 *   bun run client/demo.ts exit                       # propose leaving Shield (7d)
 *   bun run client/demo.ts return <usdc>              # DEMO: the execution wallet sends money back
 *   bun run client/demo.ts evaluate                   # ask the monitor to evaluate now
 */
import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { createTransferInstruction, getAssociatedTokenAddressSync, getAccount } from "@solana/spl-token";
import {
  ProposalCategory,
  cancelProposalIx,
  depositIx,
  evaluateTopUp,
  executeTopUpIx,
  fetchAllProposals,
  fetchRegistry,
  fetchVault,
  instantColdTransferIx,
  instantTopUpIx,
  parseShieldError,
  proposeLoosenIx,
  proposeTopUpIx,
  proposeUninstallVaultIx,
  rawToUsdc,
  tightenIx,
  usdcToRaw,
  vaultPda,
  vaultTokenAccountPda,
  OwnerType,
  COOLDOWN_REASON,
} from "./shield-client";

const RPC_URL = process.env.SHIELD_RPC_URL ?? "http://127.0.0.1:8899";
const STATE_DIR = process.env.SHIELD_STATE_DIR ?? ".shield";
const API = process.env.SHIELD_API ?? "http://localhost:8787";
const network = RPC_URL.includes("devnet") ? "devnet" : RPC_URL.includes("mainnet") ? "mainnet-beta" : "localnet";

const fmt = (raw: bigint) => `$${rawToUsdc(raw).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const when = (ts: bigint) => new Date(Number(ts) * 1000).toLocaleString();
const countdown = (until: bigint) => {
  const s = Number(until) - Math.floor(Date.now() / 1000);
  if (s <= 0) return "now";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
};

function loadKeypair(path: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf-8"))));
}

const state = JSON.parse(readFileSync(`${STATE_DIR}/demo-state.${network}.json`, "utf-8")) as Record<string, string>;
const authority = loadKeypair(process.env.SHIELD_AUTHORITY_KEYPAIR ?? `${process.env.HOME}/.config/solana/id.json`);
const connection = new Connection(RPC_URL, "confirmed");
const [vault] = vaultPda(authority.publicKey);
const [vaultAta] = vaultTokenAccountPda(vault);
const execution = new PublicKey(state.executionWallet);
const cold = new PublicKey(state.coldWallet);

async function send(label: string, ixs: Parameters<Transaction["add"]>, signers: Keypair[] = [authority]) {
  try {
    const sig = await sendAndConfirmTransaction(connection, new Transaction().add(...ixs), signers, { commitment: "confirmed" });
    console.log(`✅ ${label}: ${sig}`);
    return sig;
  } catch (e) {
    const name = parseShieldError(e);
    console.log(`❌ ${label} rejected on-chain${name ? `: ${name}` : ""}`);
    if (!name) console.log(`   ${e instanceof Error ? e.message.slice(0, 300) : String(e)}`);
    return null;
  }
}

async function scoreboard() {
  const v = await fetchVault(connection, vault);
  if (!v) throw new Error("no vault for this authority");
  const bal = (await getAccount(connection, vaultAta)).amount;
  const now = BigInt(Math.floor(Date.now() / 1000));
  const registry = await fetchRegistry(connection, vault);
  const proposals = await fetchAllProposals(connection, vault);
  console.log(`\nShield vault ${vault.toBase58()} (${network})`);
  console.log(`  Protected balance      ${fmt(bal)}  (floor ${fmt(v.protectedFloor)})`);
  console.log(`  Daily top-up limit     ${fmt(v.velocityThreshold)} / 24h`);
  console.log(`  Large top-up pause     >= ${(v.topUpThresholdBps / 100).toFixed(0)}% of balance waits ${Number(v.topUpCooldownSecs) / 60} min`);
  console.log(`  Loss rule              >= ${fmt(v.lossTriggerUsdc)} realised in 24h -> pause ${Number(v.lossCooldownSecs) / 3600}h`);
  console.log(`  Emergency cap (cold)   ${fmt(v.emergencyCap)} instant`);
  console.log(`  Rule-change delay      ${Number(v.loosenCooldownSecs) / 3600}h   Exit delay ${Number(v.fullExitCooldownSecs) / 86400}d`);
  const reason = v.cooldownReason === COOLDOWN_REASON.SELF_PAUSE ? "self-pause" : v.cooldownReason === COOLDOWN_REASON.RISK_VERDICT ? "loss rule" : "";
  console.log(`  Cooldown               ${v.cooldownUntil > now ? `ACTIVE (${reason}) until ${when(v.cooldownUntil)} — ${countdown(v.cooldownUntil)} left` : "none"}`);
  console.log(`  Config version         ${v.configVersion}   verdicts applied ${v.lastVerdictNonce}`);
  console.log(`  Destinations`);
  for (const r of registry) console.log(`    ${r.kind === OwnerType.Cold ? "cold     " : "execution"} ${r.owner.toBase58()} "${r.label}" ${r.active ? "" : "(removed)"}`);
  for (const p of proposals) {
    const cat = ["rule change", "top-up", "full exit"][p.category];
    console.log(`  Pending ${cat} #${p.nonce}: executes ${when(p.executeAfter)} (${countdown(p.executeAfter)}) — ${JSON.stringify(p.action, (_k, x) => (typeof x === "bigint" ? x.toString() : x instanceof PublicKey ? x.toBase58() : x))}`);
  }
  try {
    const res = await fetch(`${API}/api/vault/${vault.toBase58()}`);
    if (res.ok) {
      const j = (await res.json()) as { profile: { totals: Record<string, string>; windows: { h24: Record<string, string> }; lossStreak: number }; assessment: { headline: string; lines: string[] }; source: { mode: string } };
      const t = j.profile.totals;
      console.log(`\n  Behaviour (source: ${j.source.mode})`);
      console.log(`    Sent to trading wallets ${fmt(BigInt(t.sent))}, came back ${fmt(BigInt(t.returned))}, net ${fmt(BigInt(t.net))}`);
      console.log(`    Realised loss (24h)     ${fmt(BigInt(j.profile.windows.h24.realisedLoss))}   loss streak ${j.profile.lossStreak}`);
      console.log(`    ${j.assessment.headline}`);
      for (const l of j.assessment.lines) console.log(`      - ${l}`);
    }
  } catch {
    console.log(`\n  (server at ${API} not reachable; behavioural data unavailable)`);
  }
  console.log("");
}

async function topUp(amountUsdc: number) {
  const v = (await fetchVault(connection, vault))!;
  const bal = (await getAccount(connection, vaultAta)).amount;
  const amount = usdcToRaw(amountUsdc);
  const d = evaluateTopUp(v, bal, amount, BigInt(Math.floor(Date.now() / 1000)));
  console.log(`Top-up ${fmt(amount)} to ${execution.toBase58()}: expected path = ${d.path}${d.reason ? ` (${d.reason})` : ""}`);
  const ata = getAssociatedTokenAddressSync(v.usdcMint, execution);
  await send("instant top-up", [instantTopUpIx({ authority: authority.publicKey, vault, destinationOwner: execution, destinationTokenAccount: ata, amount })]);
}

async function scheduleTopUp(amountUsdc: number) {
  await send("top-up proposed (gated path)", [proposeTopUpIx({ authority: authority.publicKey, vault, destinationOwner: execution, amount: usdcToRaw(amountUsdc) })]);
}

async function executeTopUp() {
  const v = (await fetchVault(connection, vault))!;
  const ata = getAssociatedTokenAddressSync(v.usdcMint, execution);
  await send("execute top-up", [executeTopUpIx({ authority: authority.publicKey, vault, destinationOwner: execution, destinationTokenAccount: ata })]);
}

function parseKv(args: string[]) {
  const out: Record<string, number> = {};
  for (const a of args) {
    const [k, val] = a.split("=");
    if (k && val !== undefined) out[k] = Number(val);
  }
  return out;
}

async function tighten(args: string[]) {
  const kv = parseKv(args);
  await send("tighten (instant)", [
    tightenIx({
      authority: authority.publicKey,
      vault,
      newProtectedFloor: kv.floor !== undefined ? usdcToRaw(kv.floor) : undefined,
      newVelocityThreshold: kv.daily !== undefined ? usdcToRaw(kv.daily) : undefined,
      newLossTriggerUsdc: kv.trigger !== undefined ? usdcToRaw(kv.trigger) : undefined,
      newLossCooldownSecs: kv.cooldown !== undefined ? BigInt(Math.round(kv.cooldown * 3600)) : undefined,
      newEmergencyCap: kv.cap !== undefined ? usdcToRaw(kv.cap) : undefined,
    }),
  ]);
}

async function loosen(args: string[]) {
  const kv = parseKv(args);
  await send("loosen proposed (24h)", [
    proposeLoosenIx({
      authority: authority.publicKey,
      vault,
      newProtectedFloor: kv.floor !== undefined ? usdcToRaw(kv.floor) : undefined,
      newVelocityThreshold: kv.daily !== undefined ? usdcToRaw(kv.daily) : undefined,
      newLossTriggerUsdc: kv.trigger !== undefined ? usdcToRaw(kv.trigger) : undefined,
      newLossCooldownSecs: kv.cooldown !== undefined ? BigInt(Math.round(kv.cooldown * 3600)) : undefined,
      newEmergencyCap: kv.cap !== undefined ? usdcToRaw(kv.cap) : undefined,
    }),
  ]);
}

async function pause(hoursN: number) {
  const until = BigInt(Math.floor(Date.now() / 1000) + Math.round(hoursN * 3600));
  await send(`pause top-ups for ${hoursN}h (instant)`, [tightenIx({ authority: authority.publicKey, vault, pauseTopUpsUntil: until })]);
}

async function cancel(cat: string) {
  const category = { "rule-change": ProposalCategory.RuleChange, "top-up": ProposalCategory.TopUp, "full-exit": ProposalCategory.FullExit }[cat];
  if (category === undefined) throw new Error("category must be rule-change | top-up | full-exit");
  await send(`cancel ${cat}`, [cancelProposalIx({ authority: authority.publicKey, vault, category })]);
}

async function coldTransfer(amountUsdc: number) {
  const v = (await fetchVault(connection, vault))!;
  const ata = getAssociatedTokenAddressSync(v.usdcMint, cold);
  await send("cold transfer (instant, capped)", [
    instantColdTransferIx({ authority: authority.publicKey, vault, destinationOwner: cold, destinationTokenAccount: ata, amount: usdcToRaw(amountUsdc) }),
  ]);
}

async function exitShield() {
  await send("leave Shield proposed (7d)", [proposeUninstallVaultIx({ authority: authority.publicKey, vault, destinationOwner: cold })]);
}

async function demoReturn(amountUsdc: number) {
  // The execution wallet stand-in sends money back: a plain SPL transfer,
  // exactly what a real trading venue would do (it never calls Shield).
  const exec = loadKeypair(`${STATE_DIR}/execution-wallet.json`);
  const v = (await fetchVault(connection, vault))!;
  const from = getAssociatedTokenAddressSync(v.usdcMint, exec.publicKey);
  const bal = await connection.getBalance(exec.publicKey);
  if (bal < 0.005e9) {
    try {
      const s = await connection.requestAirdrop(exec.publicKey, 1e9);
      await connection.confirmTransaction(s, "confirmed");
    } catch {
      console.log("(airdrop for the execution wallet failed; fund it with a little SOL for fees)");
    }
  }
  await send(`execution wallet returns ${fmt(usdcToRaw(amountUsdc))} to the vault`, [createTransferInstruction(from, vaultAta, exec.publicKey, usdcToRaw(amountUsdc))], [exec]);
}

async function faucet(amountUsdc: number) {
  const res = await fetch(`${API}/api/demo/faucet`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ owner: authority.publicKey.toBase58(), amountUsdc, mint: state.usdcMint }) });
  console.log(res.ok ? `✅ minted ${fmt(usdcToRaw(amountUsdc))} test USDC: ${((await res.json()) as { signature: string }).signature}` : `❌ faucet: ${await res.text()}`);
}

async function deposit(amountUsdc: number) {
  const v = (await fetchVault(connection, vault))!;
  const ata = getAssociatedTokenAddressSync(v.usdcMint, authority.publicKey);
  await send(`deposited ${fmt(usdcToRaw(amountUsdc))}`, [depositIx({ depositor: authority.publicKey, vault, sourceTokenAccount: ata, amount: usdcToRaw(amountUsdc) })]);
}

async function evaluate() {
  const res = await fetch(`${API}/api/vault/${vault.toBase58()}/evaluate`, { method: "POST" });
  const j = (await res.json()) as { assessment: { headline: string; lines: string[]; triggered: boolean; actionable: boolean }; verdict: { relayed: boolean; signature: string | null; error: string | null } | null };
  console.log(j.assessment.headline);
  for (const l of j.assessment.lines) console.log(`  - ${l}`);
  if (j.verdict) console.log(j.verdict.relayed ? `✅ verdict relayed on-chain: ${j.verdict.signature}` : `verdict not relayed: ${j.verdict.error}`);
  else console.log(j.assessment.triggered ? "(rule met, but nothing new to act on)" : "(rule not met; no verdict)");
}

async function main() {
  const [, , cmd, ...args] = process.argv;
  switch (cmd) {
    case "scoreboard": return scoreboard();
    case "faucet": return faucet(Number(args[0] ?? 10000));
    case "deposit": return deposit(Number(args[0]));
    case "top-up": return topUp(Number(args[0]));
    case "schedule-top-up": return scheduleTopUp(Number(args[0]));
    case "execute-top-up": return executeTopUp();
    case "pause": return pause(Number(args[0]));
    case "tighten": return tighten(args);
    case "loosen": return loosen(args);
    case "cancel": return cancel(args[0]);
    case "cold": return coldTransfer(Number(args[0]));
    case "exit": return exitShield();
    case "return": return demoReturn(Number(args[0]));
    case "evaluate": return evaluate();
    default:
      console.log(readFileSync(new URL(import.meta.url).pathname, "utf-8").split("*/")[0].split("\n").filter((l) => l.includes("bun run")).join("\n"));
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
