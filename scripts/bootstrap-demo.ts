#!/usr/bin/env bun
/**
 * One-shot demo bootstrap for a local validator OR devnet.
 *
 *   SHIELD_RPC_URL=http://127.0.0.1:8899 bun run scripts/bootstrap-demo.ts
 *   SHIELD_RPC_URL=https://api.devnet.solana.com bun run scripts/bootstrap-demo.ts
 *
 * Creates a test USDC mint (we control minting, so the demo can fund a
 * $10,000 treasury without a faucet), initializes Alex's vault with the
 * demo policy, registers the execution wallet ("Axiom") and a cold wallet
 * while the vault is still empty (instant), deposits $10,000, and writes
 * everything the app, the monitor, and the CLI need to a state file.
 *
 * Keys: the authority is ~/.config/solana/id.json by default (or
 * SHIELD_AUTHORITY_KEYPAIR). Generated demo keys (execution wallet, cold
 * wallet, risk verifier) are written to .shield/ (gitignored). The risk
 * verifier key is what the monitor / CRE workflow signs verdicts with.
 */
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  vaultPda,
  vaultTokenAccountPda,
  initializeVaultIx,
  registerOwnerIx,
  depositIx,
  fetchVault,
  OwnerType,
  usdcToRaw,
  SHIELD_PROGRAM_ID,
} from "../client/shield-client";

const RPC_URL = process.env.SHIELD_RPC_URL ?? "http://127.0.0.1:8899";
const STATE_DIR = process.env.SHIELD_STATE_DIR ?? ".shield";
const DEPOSIT_USDC = Number(process.env.SHIELD_DEPOSIT_USDC ?? 10_000);

function loadOrCreateKeypair(path: string): Keypair {
  if (existsSync(path)) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf-8"))));
  const kp = Keypair.generate();
  writeFileSync(path, JSON.stringify(Array.from(kp.secretKey)));
  return kp;
}

async function main() {
  mkdirSync(STATE_DIR, { recursive: true });
  const connection = new Connection(RPC_URL, "confirmed");
  const network = RPC_URL.includes("devnet") ? "devnet" : RPC_URL.includes("mainnet") ? "mainnet-beta" : "localnet";

  const authorityPath = process.env.SHIELD_AUTHORITY_KEYPAIR ?? `${process.env.HOME}/.config/solana/id.json`;
  const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(authorityPath, "utf-8"))));
  const execution = loadOrCreateKeypair(`${STATE_DIR}/execution-wallet.json`);
  const cold = loadOrCreateKeypair(`${STATE_DIR}/cold-wallet.json`);
  const verifier = loadOrCreateKeypair(`${STATE_DIR}/risk-verifier.json`);

  console.log(`network:            ${network} (${RPC_URL})`);
  console.log(`program:            ${SHIELD_PROGRAM_ID.toBase58()}`);
  console.log(`authority (Alex):   ${authority.publicKey.toBase58()}`);
  console.log(`execution (Axiom):  ${execution.publicKey.toBase58()}`);
  console.log(`cold (Ledger):      ${cold.publicKey.toBase58()}`);
  console.log(`risk verifier:      ${verifier.publicKey.toBase58()}`);

  const programInfo = await connection.getAccountInfo(SHIELD_PROGRAM_ID);
  if (!programInfo) throw new Error(`Shield program is not deployed at ${SHIELD_PROGRAM_ID.toBase58()} on ${RPC_URL}`);

  const balance = await connection.getBalance(authority.publicKey);
  console.log(`authority SOL:      ${(balance / 1e9).toFixed(3)}`);
  if (balance < 0.05e9) throw new Error("authority needs SOL for rent + fees (airdrop first)");

  const [vault] = vaultPda(authority.publicKey);
  const [vaultAta] = vaultTokenAccountPda(vault);
  const existing = await fetchVault(connection, vault);

  let usdcMint: PublicKey;
  if (existing) {
    usdcMint = existing.usdcMint;
    console.log(`\nvault already exists at ${vault.toBase58()} (mint ${usdcMint.toBase58()}); skipping init`);
  } else {
    console.log("\n--- creating test USDC mint (6 decimals) ---");
    usdcMint = await createMint(connection, authority, authority.publicKey, null, 6);
    console.log(`USDC mint:          ${usdcMint.toBase58()}`);

    console.log("\n--- initializing vault with the demo policy ---");
    const policy = {
      protectedFloor: usdcToRaw(6_000),
      topUpThresholdBps: 2_000, // top-ups >= 20% of the balance pause 30 minutes
      emergencyCap: usdcToRaw(200),
      velocityThreshold: usdcToRaw(2_000), // 24h top-up limit
      lossTriggerUsdc: usdcToRaw(1_000),
      lossCooldownSecs: 18n * 3600n,
    };
    console.log(policy);
    const sig = await sendAndConfirmTransaction(
      connection,
      new Transaction().add(
        initializeVaultIx({ authority: authority.publicKey, usdcMint, riskVerifier: verifier.publicKey, ...policy })
      ),
      [authority]
    );
    console.log(`initialized:        ${sig}`);

    console.log("\n--- registering destinations (instant while the vault is empty) ---");
    const regSig = await sendAndConfirmTransaction(
      connection,
      new Transaction().add(
        registerOwnerIx({ authority: authority.publicKey, vault, owner: execution.publicKey, kind: OwnerType.Execution, label: "Axiom" }),
        registerOwnerIx({ authority: authority.publicKey, vault, owner: cold.publicKey, kind: OwnerType.Cold, label: "Ledger" })
      ),
      [authority]
    );
    console.log(`registered:         ${regSig}`);
  }

  console.log("\n--- token accounts ---");
  const authorityAta = await getOrCreateAssociatedTokenAccount(connection, authority, usdcMint, authority.publicKey);
  const executionAta = await getOrCreateAssociatedTokenAccount(connection, authority, usdcMint, execution.publicKey);
  const coldAta = await getOrCreateAssociatedTokenAccount(connection, authority, usdcMint, cold.publicKey);
  console.log(`Alex's wallet ATA:  ${authorityAta.address.toBase58()}`);
  console.log(`Axiom ATA:          ${executionAta.address.toBase58()}`);
  console.log(`Ledger ATA:         ${coldAta.address.toBase58()}`);

  if (!existing && DEPOSIT_USDC > 0) {
    console.log(`\n--- minting $${DEPOSIT_USDC.toLocaleString()} test USDC to Alex and depositing into the vault ---`);
    await mintTo(connection, authority, usdcMint, authorityAta.address, authority, usdcToRaw(DEPOSIT_USDC * 2));
    const depSig = await sendAndConfirmTransaction(
      connection,
      new Transaction().add(
        depositIx({ depositor: authority.publicKey, vault, sourceTokenAccount: authorityAta.address, amount: usdcToRaw(DEPOSIT_USDC) })
      ),
      [authority]
    );
    console.log(`deposited:          ${depSig}`);
  }

  const state = {
    network,
    rpcUrl: RPC_URL,
    programId: SHIELD_PROGRAM_ID.toBase58(),
    authority: authority.publicKey.toBase58(),
    vault: vault.toBase58(),
    vaultTokenAccount: vaultAta.toBase58(),
    usdcMint: usdcMint.toBase58(),
    executionWallet: execution.publicKey.toBase58(),
    executionAta: executionAta.address.toBase58(),
    coldWallet: cold.publicKey.toBase58(),
    coldAta: coldAta.address.toBase58(),
    riskVerifier: verifier.publicKey.toBase58(),
    createdAt: new Date().toISOString(),
  };
  const statePath = `${STATE_DIR}/demo-state.${network}.json`;
  writeFileSync(statePath, JSON.stringify(state, null, 2));
  console.log(`\nstate written to ${statePath}`);
  console.log(`\nNext:\n  bun run client/demo.ts scoreboard ${authority.publicKey.toBase58()}\n  bun run dev:app`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
