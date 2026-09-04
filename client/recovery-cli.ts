#!/usr/bin/env bun
/**
 * Shield's standalone recovery CLI — Invariant 10:
 * "Recovery does not depend on Shield existing." With the legitimate
 * authority key and enough time, this file is a complete, self-contained
 * proof that a user can recover their assets even if Graph, CRE, the
 * Shield frontend, the Shield backend, and Shield the company all
 * disappear at once. It imports nothing from a Shield-operated service --
 * only `@solana/web3.js`, `shield-client.ts` (pure instruction-encoding
 * logic, no network calls of its own), and a plain Solana RPC URL the
 * user supplies.
 *
 * Usage:
 *   bun run client/recovery-cli.ts cancel <keypairPath> <category: rule-change|top-up|full-exit>
 *   bun run client/recovery-cli.ts execute-matured <keypairPath> <category> [destinationTokenAccount]
 *   bun run client/recovery-cli.ts status <authorityPubkey>
 */

import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import {
  vaultPda,
  vaultTokenAccountPda,
  proposalPda,
  ProposalCategory,
  cancelProposalIx,
  executeFullExitIx,
  executeTopUpIx,
  executeRuleChangeIx,
  fetchProposal,
  SHIELD_PROGRAM_ID,
} from "./shield-client";

const RPC_URL = process.env.SHIELD_RPC_URL ?? "http://127.0.0.1:8899";

function loadKeypair(path: string): Keypair {
  const raw = JSON.parse(readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function parseCategory(s: string): ProposalCategory {
  switch (s) {
    case "rule-change":
      return ProposalCategory.RuleChange;
    case "top-up":
      return ProposalCategory.TopUp;
    case "full-exit":
      return ProposalCategory.FullExit;
    default:
      throw new Error(`unknown category "${s}" — expected rule-change | top-up | full-exit`);
  }
}

async function cmdStatus(connection: Connection, authority: PublicKey) {
  const [vault] = vaultPda(authority);
  const info = await connection.getAccountInfo(vault);
  if (!info) {
    console.log(`No vault found for ${authority.toBase58()} on ${RPC_URL}`);
    return;
  }
  console.log(`Vault: ${vault.toBase58()} (owner check: ${info.owner.equals(SHIELD_PROGRAM_ID) ? "OK, owned by Shield program" : "MISMATCH — do not trust this account"})`);

  for (const [name, category] of [
    ["rule-change", ProposalCategory.RuleChange],
    ["top-up", ProposalCategory.TopUp],
    ["full-exit", ProposalCategory.FullExit],
  ] as const) {
    const [proposal] = proposalPda(vault, category);
    const pInfo = await connection.getAccountInfo(proposal);
    console.log(`  ${name} proposal (${proposal.toBase58()}): ${pInfo ? `PENDING, ${pInfo.data.length} bytes` : "none"}`);
  }
}

async function cmdCancel(connection: Connection, authorityKp: Keypair, category: ProposalCategory) {
  const [vault] = vaultPda(authorityKp.publicKey);
  const [proposal] = proposalPda(vault, category);
  const ix = cancelProposalIx({ authority: authorityKp.publicKey, vault, proposal });
  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(connection, tx, [authorityKp]);
  console.log(`Cancelled. Signature: ${sig}`);
}

async function cmdExecuteMatured(
  connection: Connection,
  authorityKp: Keypair,
  category: ProposalCategory,
  destinationTokenAccount?: PublicKey
) {
  const [vault] = vaultPda(authorityKp.publicKey);
  const [vaultTokenAccount] = vaultTokenAccountPda(vault);

  if (category === ProposalCategory.FullExit) {
    if (!destinationTokenAccount) throw new Error("full-exit execution requires a destination token account");
    const ix = executeFullExitIx({
      executor: authorityKp.publicKey,
      vault,
      vaultTokenAccount,
      destinationTokenAccount,
    });
    const tx = new Transaction().add(ix);
    const sig = await sendAndConfirmTransaction(connection, tx, [authorityKp]);
    console.log(`Full exit executed. Signature: ${sig}`);
    return;
  }

  if (category === ProposalCategory.TopUp) {
    if (!destinationTokenAccount) throw new Error("top-up execution requires a destination token account");
    // The destination OWNER is read directly off the pending proposal --
    // this is the fix that makes standalone recovery actually standalone
    // (Invariant 10): earlier, this command required the caller to
    // already know the destination owner out-of-band, which defeats the
    // point of a recovery tool. Now it only needs a destination token
    // account (any correctly-owned SPL account works; the program itself
    // verifies ownership against the registry).
    const [proposal] = proposalPda(vault, ProposalCategory.TopUp);
    const decoded = await fetchProposal(connection, proposal);
    if (!decoded || decoded.action.kind !== "topUp") throw new Error("no pending top-up proposal found");
    const ix = executeTopUpIx({
      executor: authorityKp.publicKey,
      vault,
      vaultTokenAccount,
      destinationOwner: decoded.action.destinationOwner,
      destinationTokenAccount,
    });
    const tx = new Transaction().add(ix);
    const sig = await sendAndConfirmTransaction(connection, tx, [authorityKp]);
    console.log(`Top-up executed. Signature: ${sig}`);
    return;
  }

  // rule-change
  const ix = executeRuleChangeIx({
    executor: authorityKp.publicKey,
    vault,
    registryEntryOwnerHint: authorityKp.publicKey, // unused unless the proposal registers a cold owner
  });
  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(connection, tx, [authorityKp]);
  console.log(`Rule change executed. Signature: ${sig}`);
}

async function main() {
  const [, , cmd, ...args] = process.argv;
  const connection = new Connection(RPC_URL, "confirmed");

  switch (cmd) {
    case "status":
      await cmdStatus(connection, new PublicKey(args[0]));
      break;
    case "cancel":
      await cmdCancel(connection, loadKeypair(args[0]), parseCategory(args[1]));
      break;
    case "execute-matured":
      await cmdExecuteMatured(
        connection,
        loadKeypair(args[0]),
        parseCategory(args[1]),
        args[2] ? new PublicKey(args[2]) : undefined
      );
      break;
    default:
      console.log(
        `Usage:\n  bun run client/recovery-cli.ts status <authorityPubkey>\n  bun run client/recovery-cli.ts cancel <keypairPath> <rule-change|top-up|full-exit>\n  bun run client/recovery-cli.ts execute-matured <keypairPath> <category> [destinationTokenAccount]`
      );
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
