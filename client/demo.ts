#!/usr/bin/env bun
/**
 * Shield's primary demo sequence (docs/designs/shield-treasury-vault.md,
 * Success Criteria). Run against a local validator or devnet with the
 * vault program deployed. This is the thin demo client the design doc's
 * Constraints section calls a required fourth surface -- read-only
 * queries plus the three demo actions, no polish beyond legibility.
 *
 * Usage:
 *   bun run client/demo.ts scoreboard <authorityPubkey>
 *   bun run client/demo.ts top-up <keypairPath> <executionOwnerPubkey> <amountUsdc>
 *   bun run client/demo.ts raise-limit <keypairPath> <newThresholdBps>
 *   bun run client/demo.ts remove-shield <keypairPath> <coldDestinationOwnerPubkey>
 */

import { readFileSync } from "node:fs";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  fetchVault,
  vaultPda,
  vaultTokenAccountPda,
  proposalPda,
  ProposalCategory,
  instantTopUpIx,
  proposeTopUpIx,
  proposeLoosenIx,
  proposeUninstallVaultIx,
} from "./shield-client";

const RPC_URL = process.env.SHIELD_RPC_URL ?? "http://127.0.0.1:8899";

function loadKeypair(path: string): Keypair {
  const raw = JSON.parse(readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function cmdScoreboard(connection: Connection, authority: PublicKey) {
  const [vault] = vaultPda(authority);
  const state = await fetchVault(connection, vault);
  if (!state) {
    console.log(`No Shield vault found for authority ${authority.toBase58()}`);
    return;
  }

  // The real scoreboard reads top-up/return totals, realized P&L, and
  // loss streaks from the Graph subgraph (substreams/), not from the
  // vault account itself -- the vault only knows its own enforcement
  // state, not the full behavioral history. This prints what the vault
  // itself knows; wire in a subgraph query against
  // UserBehavioralProfile(id: "<vault>") for the full scoreboard.
  const usdc = (raw: bigint) => (Number(raw) / 1_000_000).toFixed(2);

  console.log(`\nShield Vault: ${vault.toBase58()}`);
  console.log(`  Top-up threshold:     ${(state.topUpThresholdBps / 100).toFixed(2)}% of vault balance`);
  console.log(`  Emergency cap:        $${usdc(state.emergencyCap)}`);
  console.log(`  Velocity threshold:   $${usdc(state.velocityThreshold)} / 24h`);
  console.log(`  Rolling velocity now: $${usdc(state.velocityBuckets.reduce((a, b) => a + b, 0n))}`);
  const cooldownArmed = state.behavioralCooldownUntil > BigInt(Math.floor(Date.now() / 1000));
  console.log(
    `  Behavioral cooldown:  ${cooldownArmed ? `ARMED until ${new Date(Number(state.behavioralCooldownUntil) * 1000).toISOString()}` : "not armed"}`
  );
  console.log(`  Config version:       ${state.configVersion}`);
  console.log("");
}

async function cmdTopUp(connection: Connection, authorityKp: Keypair, executionOwner: PublicKey, amountUsdc: number) {
  const [vault] = vaultPda(authorityKp.publicKey);
  const [vaultTokenAccount] = vaultTokenAccountPda(vault);
  const amountRaw = BigInt(Math.round(amountUsdc * 1_000_000));

  const state = await fetchVault(connection, vault);
  if (!state) throw new Error("vault not found");

  // Mirrors the vault's own row-4 threshold logic client-side purely to
  // decide WHICH instruction to send -- the vault re-checks everything
  // itself, so this is a UX nicety, not a trust boundary.
  console.log(`Attempting $${amountUsdc.toFixed(2)} top-up to ${executionOwner.toBase58()}...`);

  try {
    const [destAta] = await import("@solana/spl-token").then((m) => [
      m.getAssociatedTokenAddressSync(state.usdcMint, executionOwner),
    ]);
    const ix = instantTopUpIx({
      authority: authorityKp.publicKey,
      vault,
      vaultTokenAccount,
      destinationOwner: executionOwner,
      destinationTokenAccount: destAta,
      amount: amountRaw,
    });
    const tx = new Transaction().add(ix);
    const sig = await sendAndConfirmTransaction(connection, tx, [authorityKp]);
    console.log(`✅ Instant top-up succeeded: ${sig}`);
  } catch (err) {
    console.log(`❌ Instant top-up rejected on-chain (expected if above threshold/velocity/cooldown):`);
    console.log(`   ${err instanceof Error ? err.message : String(err)}`);
    console.log(`   Falling back to the gated path: propose_top_up (30m+ cooldown, CRE-extendable)...`);
    const proposeIx = proposeTopUpIx({
      authority: authorityKp.publicKey,
      vault,
      destinationOwner: executionOwner,
      amount: amountRaw,
    });
    const tx = new Transaction().add(proposeIx);
    const sig = await sendAndConfirmTransaction(connection, tx, [authorityKp]);
    const [proposal] = proposalPda(vault, ProposalCategory.TopUp);
    console.log(`✅ Top-up PROPOSED (queued): ${sig}`);
    console.log(`   Proposal account: ${proposal.toBase58()} — check execute_after onchain to see the exact unlock time.`);
  }
}

async function cmdRaiseLimit(connection: Connection, authorityKp: Keypair, newThresholdBps: number) {
  const [vault] = vaultPda(authorityKp.publicKey);
  console.log(`Attempting to raise top-up threshold to ${(newThresholdBps / 100).toFixed(2)}%...`);
  const ix = proposeLoosenIx({ authority: authorityKp.publicKey, vault, newTopUpThresholdBps: newThresholdBps });
  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(connection, tx, [authorityKp]);
  const [proposal] = proposalPda(vault, ProposalCategory.RuleChange);
  console.log(`✅ Limit raise QUEUED (24h delay), not applied instantly: ${sig}`);
  console.log(`   Proposal account: ${proposal.toBase58()}`);
}

async function cmdRemoveShield(connection: Connection, authorityKp: Keypair, coldDestination: PublicKey) {
  const [vault] = vaultPda(authorityKp.publicKey);
  console.log(`Attempting to remove Shield entirely (full exit to ${coldDestination.toBase58()})...`);
  const ix = proposeUninstallVaultIx({ authority: authorityKp.publicKey, vault, destinationOwner: coldDestination });
  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(connection, tx, [authorityKp]);
  const [proposal] = proposalPda(vault, ProposalCategory.FullExit);
  console.log(`✅ Full Shield removal QUEUED (7-day delay), not instant: ${sig}`);
  console.log(`   Proposal account: ${proposal.toBase58()}`);
  console.log(`   De-risking (selling / reducing exposure) remains available instantly the entire time this is pending.`);
}

async function main() {
  const [, , cmd, ...args] = process.argv;
  const connection = new Connection(RPC_URL, "confirmed");

  switch (cmd) {
    case "scoreboard":
      await cmdScoreboard(connection, new PublicKey(args[0]));
      break;
    case "top-up":
      await cmdTopUp(connection, loadKeypair(args[0]), new PublicKey(args[1]), Number(args[2]));
      break;
    case "raise-limit":
      await cmdRaiseLimit(connection, loadKeypair(args[0]), Number(args[1]));
      break;
    case "remove-shield":
      await cmdRemoveShield(connection, loadKeypair(args[0]), new PublicKey(args[1]));
      break;
    default:
      console.log(__doc());
      process.exit(1);
  }
}

function __doc() {
  return `Usage:
  bun run client/demo.ts scoreboard <authorityPubkey>
  bun run client/demo.ts top-up <keypairPath> <executionOwnerPubkey> <amountUsdc>
  bun run client/demo.ts raise-limit <keypairPath> <newThresholdBps>
  bun run client/demo.ts remove-shield <keypairPath> <coldDestinationOwnerPubkey>`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
