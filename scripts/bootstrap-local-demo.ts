#!/usr/bin/env bun
/**
 * One-shot local-validator bootstrap: creates a test USDC mint,
 * initializes a Shield vault, registers Axiom (a fake execution wallet
 * keypair standing in for the real thing), funds the vault with $10,000,
 * and prints everything a human needs to run the demo sequence by hand
 * afterward. Not part of the product — a dev convenience script to make
 * "see it running" fast and repeatable.
 */
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  SystemProgram,
} from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { readFileSync, writeFileSync } from "node:fs";
import {
  vaultPda,
  vaultTokenAccountPda,
  initializeVaultIx,
  registerExecutionIx,
} from "../client/shield-client";

const RPC_URL = process.env.SHIELD_RPC_URL ?? "http://127.0.0.1:8899";

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");

  const authorityRaw = JSON.parse(readFileSync(`${process.env.HOME}/.config/solana/id.json`, "utf-8"));
  const authority = Keypair.fromSecretKey(Uint8Array.from(authorityRaw));
  console.log(`Alex's authority key: ${authority.publicKey.toBase58()}`);

  // Axiom stand-in: a fresh keypair representing the execution wallet.
  const axiom = Keypair.generate();
  console.log(`Axiom (execution wallet) stand-in: ${axiom.publicKey.toBase58()}`);

  // The verifier key CRE would sign with -- unused for this local demo
  // since no CRE simulation is running, but the vault needs a pinned
  // value at init time regardless.
  const creVerifier = Keypair.generate();

  console.log("\n--- Creating test USDC mint (6 decimals) ---");
  const usdcMint = await createMint(connection, authority, authority.publicKey, null, 6);
  console.log(`USDC mint: ${usdcMint.toBase58()}`);

  const [vault] = vaultPda(authority.publicKey);
  const [vaultTokenAccount] = vaultTokenAccountPda(vault);
  console.log(`\nVault PDA: ${vault.toBase58()}`);
  console.log(`Vault token account: ${vaultTokenAccount.toBase58()}`);

  console.log("\n--- Initializing vault ---");
  console.log("  top-up threshold: 20% of vault balance ($2,000 on a $10k vault)");
  console.log("  emergency cap:    $200");
  console.log("  velocity threshold: $6,000 / 24h (separate from the per-tx threshold above)");
  const initIx = initializeVaultIx({
    authority: authority.publicKey,
    usdcMint,
    creVerifier: creVerifier.publicKey,
    topUpThresholdBps: 2000,
    emergencyCap: 200_000_000n,
    velocityThreshold: 6_000_000_000n,
  });
  const initSig = await sendAndConfirmTransaction(connection, new Transaction().add(initIx), [authority]);
  console.log(`✅ Vault initialized: ${initSig}`);

  console.log("\n--- Registering Axiom as an execution wallet (instant, row 1) ---");
  const regIx = registerExecutionIx(authority.publicKey, vault, axiom.publicKey);
  const regSig = await sendAndConfirmTransaction(connection, new Transaction().add(regIx), [authority]);
  console.log(`✅ Registered: ${regSig}`);

  console.log("\n--- Funding the vault with $10,000 USDC (deposit = plain SPL transfer, always unrestricted) ---");
  await getOrCreateAssociatedTokenAccount(connection, authority, usdcMint, vault, true);
  await mintTo(connection, authority, usdcMint, vaultTokenAccount, authority, 10_000_000_000n);
  console.log(`✅ Vault funded with $10,000.00 USDC`);

  const axiomAta = await getOrCreateAssociatedTokenAccount(connection, authority, usdcMint, axiom.publicKey);
  console.log(`Axiom's own USDC ATA (created, empty): ${axiomAta.address.toBase58()}`);

  writeFileSync(
    "/tmp/shield-demo-state.json",
    JSON.stringify(
      {
        rpcUrl: RPC_URL,
        authority: authority.publicKey.toBase58(),
        vault: vault.toBase58(),
        usdcMint: usdcMint.toBase58(),
        axiomExecutionWallet: axiom.publicKey.toBase58(),
        axiomAta: axiomAta.address.toBase58(),
      },
      null,
      2
    )
  );
  console.log(`\nState written to /tmp/shield-demo-state.json`);
  console.log(`\nReady. Run:\n  bun run client/demo.ts scoreboard ${authority.publicKey.toBase58()}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
