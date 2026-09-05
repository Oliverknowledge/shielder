#!/usr/bin/env bun
/**
 * Prints the base64 32-byte Ed25519 seed of the demo risk verifier
 * (.shield/risk-verifier.json) for cre/.env — the secret the CRE enclave
 * signs with — plus the public key the vault must have pinned.
 */
import { readFileSync } from "node:fs";
import { Keypair } from "@solana/web3.js";

const path = process.argv[2] ?? `${process.env.SHIELD_STATE_DIR ?? ".shield"}/risk-verifier.json`;
const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf-8"))));
console.log(`SHIELD_VERIFIER_SEED_B64=${Buffer.from(kp.secretKey.subarray(0, 32)).toString("base64")}`);
console.log(`# verifier pubkey (vault.risk_verifier): ${kp.publicKey.toBase58()}`);
