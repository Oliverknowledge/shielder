#!/usr/bin/env bun
/**
 * Shield standalone recovery CLI — the proof that recovery does not depend
 * on Shield existing. It talks to a Solana RPC URL you supply and nothing
 * else: no Shield server, no Graph, no Chainlink. With the vault authority
 * key and enough time, every exit path in the program is reachable here.
 *
 *   SHIELD_RPC_URL=https://api.devnet.solana.com bun run client/recovery-cli.ts status <authorityPubkey>
 *   bun run client/recovery-cli.ts cancel <keypair.json> <rule-change|top-up|full-exit>
 *   bun run client/recovery-cli.ts cold-transfer <keypair.json> <coldOwnerPubkey> <usdc>      # instant, capped
 *   bun run client/recovery-cli.ts propose-exit <keypair.json> <coldOwnerPubkey>              # whole balance, after the exit delay
 *   bun run client/recovery-cli.ts execute <keypair.json> <rule-change|top-up|full-exit>      # execute a matured proposal
 */
import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";
import {
  ProposalCategory,
  SHIELD_PROGRAM_ID,
  cancelProposalIx,
  executeFullExitIx,
  executeRuleChangeIx,
  executeRuleChangeWithRegistrationIx,
  executeTopUpIx,
  fetchAllProposals,
  fetchRegistry,
  fetchVault,
  instantColdTransferIx,
  parseShieldError,
  proposeUninstallVaultIx,
  rawToUsdc,
  usdcToRaw,
  vaultPda,
  OwnerType,
} from "./shield-client";

const RPC_URL = process.env.SHIELD_RPC_URL ?? "http://127.0.0.1:8899";
const connection = new Connection(RPC_URL, "confirmed");
const fmt = (raw: bigint) => `$${rawToUsdc(raw).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const when = (ts: bigint) => new Date(Number(ts) * 1000).toISOString();

const loadKeypair = (p: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, "utf-8"))));
const parseCategory = (s: string) => {
  const c = { "rule-change": ProposalCategory.RuleChange, "top-up": ProposalCategory.TopUp, "full-exit": ProposalCategory.FullExit }[s];
  if (c === undefined) throw new Error(`unknown category "${s}"`);
  return c;
};

async function send(label: string, ixs: Parameters<Transaction["add"]>, signers: Keypair[]) {
  try {
    const sig = await sendAndConfirmTransaction(connection, new Transaction().add(...ixs), signers, { commitment: "confirmed" });
    console.log(`${label}: ${sig}`);
  } catch (e) {
    const name = parseShieldError(e);
    console.log(`${label} REJECTED${name ? `: ${name}` : ""}`);
    if (!name) console.log(e instanceof Error ? e.message.slice(0, 400) : String(e));
    process.exitCode = 1;
  }
}

async function status(authority: PublicKey) {
  const [vault] = vaultPda(authority);
  const info = await connection.getAccountInfo(vault);
  if (!info) return console.log(`No vault for ${authority.toBase58()} on ${RPC_URL}`);
  console.log(`Vault ${vault.toBase58()} — owner ${info.owner.equals(SHIELD_PROGRAM_ID) ? "OK (Shield program)" : "MISMATCH, do not trust"}`);
  const v = (await fetchVault(connection, vault))!;
  console.log(`  floor ${fmt(v.protectedFloor)} | daily ${fmt(v.velocityThreshold)} | cap ${fmt(v.emergencyCap)} | exit delay ${Number(v.fullExitCooldownSecs) / 86400}d | cooldown until ${v.cooldownUntil > 0n ? when(v.cooldownUntil) : "-"}`);
  for (const r of await fetchRegistry(connection, vault)) console.log(`  ${r.kind === OwnerType.Cold ? "cold     " : "execution"} ${r.owner.toBase58()} "${r.label}"${r.active ? "" : " (removed)"}`);
  for (const p of await fetchAllProposals(connection, vault)) {
    console.log(`  pending ${["rule-change", "top-up", "full-exit"][p.category]} #${p.nonce} executes after ${when(p.executeAfter)} expires ${when(p.expiry)} ${p.action.kind}`);
  }
}

async function main() {
  const [, , cmd, ...args] = process.argv;
  switch (cmd) {
    case "status":
      return status(new PublicKey(args[0]));
    case "cancel": {
      const kp = loadKeypair(args[0]);
      const [vault] = vaultPda(kp.publicKey);
      return send("cancelled", [cancelProposalIx({ authority: kp.publicKey, vault, category: parseCategory(args[1]) })], [kp]);
    }
    case "cold-transfer": {
      const kp = loadKeypair(args[0]);
      const [vault] = vaultPda(kp.publicKey);
      const owner = new PublicKey(args[1]);
      const v = (await fetchVault(connection, vault))!;
      const ata = getAssociatedTokenAddressSync(v.usdcMint, owner);
      return send("cold transfer", [
        createAssociatedTokenAccountIdempotentInstruction(kp.publicKey, ata, owner, v.usdcMint),
        instantColdTransferIx({ authority: kp.publicKey, vault, destinationOwner: owner, destinationTokenAccount: ata, amount: usdcToRaw(Number(args[2])) }),
      ], [kp]);
    }
    case "propose-exit": {
      const kp = loadKeypair(args[0]);
      const [vault] = vaultPda(kp.publicKey);
      return send("exit proposed", [proposeUninstallVaultIx({ authority: kp.publicKey, vault, destinationOwner: new PublicKey(args[1]) })], [kp]);
    }
    case "execute": {
      const kp = loadKeypair(args[0]);
      const [vault] = vaultPda(kp.publicKey);
      const category = parseCategory(args[1]);
      const v = (await fetchVault(connection, vault))!;
      const proposals = await fetchAllProposals(connection, vault);
      const p = proposals.find((x) => x.category === category);
      if (!p) return console.log("no pending proposal in that category");
      if (p.action.kind === "loosen") {
        const owner = p.action.params.registerOwner;
        return owner
          ? send("rule change executed", [executeRuleChangeWithRegistrationIx({ authority: kp.publicKey, vault, owner })], [kp])
          : send("rule change executed", [executeRuleChangeIx({ authority: kp.publicKey, vault })], [kp]);
      }
      const owner = p.action.destinationOwner;
      const ata = getAssociatedTokenAddressSync(v.usdcMint, owner);
      const create = createAssociatedTokenAccountIdempotentInstruction(kp.publicKey, ata, owner, v.usdcMint);
      if (p.action.kind === "topUp") {
        return send("top-up executed", [create, executeTopUpIx({ authority: kp.publicKey, vault, destinationOwner: owner, destinationTokenAccount: ata })], [kp]);
      }
      return send("exit executed", [create, executeFullExitIx({ authority: kp.publicKey, vault, destinationOwner: owner, destinationTokenAccount: ata })], [kp]);
    }
    default:
      console.log(readFileSync(new URL(import.meta.url).pathname, "utf-8").split("*/")[0].split("\n").filter((l) => l.includes("recovery-cli.ts")).join("\n"));
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
