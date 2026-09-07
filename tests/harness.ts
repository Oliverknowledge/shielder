import { describe } from "bun:test";
/**
 * LiteSVM test harness: runs the real compiled program (target/deploy/
 * shield_vault.so) in-process with a controllable clock, so every delay
 * in the state machine (30m, 24h, 7d, cooldowns) can be tested exactly.
 */
import { LiteSVM, FailedTransactionMetadata } from "litesvm";
import { address, getTransactionDecoder, lamports } from "@solana/kit";
import { Keypair, PublicKey, SystemProgram, Transaction, type TransactionInstruction } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  MINT_SIZE,
  AccountLayout,
  createInitializeMint2Instruction,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import nacl from "tweetnacl";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  SHIELD_PROGRAM_ID,
  OwnerType,
  ProposalCategory,
  type RiskVerdict,
  type VaultState,
  type ProposalState,
  type RegistryEntryState,
  vaultPda,
  vaultTokenAccountPda,
  proposalPda,
  registryEntryPda,
  decodeVault,
  decodeProposal,
  decodeRegistryEntry,
  initializeVaultIx,
  depositIx,
  registerOwnerIx,
  verdictMessage,
  parseShieldError,
  usdcToRaw,
} from "../client/shield-client";

import { existsSync } from "node:fs";

export const PROGRAM_SO = new URL("../target/deploy/shield_vault.so", import.meta.url).pathname;

/**
 * These 46 tests run the real compiled Solana program, which needs the Solana
 * toolchain and `bun run build:program`. That program is v0: the shipped product
 * is `contracts/ShieldVault.sol` on HyperEVM. Without the binary the suite used
 * to fail 45 of 65 tests on a fresh clone, so anyone running `bun test` before
 * reading the README met a wall of red for a component the README itself calls
 * history. Skipped and explained is the honest result; the EVM suite still runs.
 */
export const PROGRAM_BUILT = existsSync(PROGRAM_SO);
export const solanaSuite = PROGRAM_BUILT
  ? describe
  : describe.skip;
if (!PROGRAM_BUILT) {
  console.warn(
    `\n  Skipping the Solana program suite: ${PROGRAM_SO} is not built.` +
      `\n  It is v0; the shipped product is contracts/ShieldVault.sol (cd contracts && forge test).` +
      `\n  To run it: bun run build:program  (needs the Solana toolchain)\n`
  );
}
export const GENESIS_TS = 1_800_000_000n; // a realistic unix time so the 0 sentinels never collide

export interface TxResult {
  ok: boolean;
  logs: string[];
  error: string | null;
  shieldError: string | null;
}

export class Chain {
  svm: LiteSVM;

  constructor() {
    this.svm = new LiteSVM();
    this.svm.addProgramFromFile(address(SHIELD_PROGRAM_ID.toBase58()), PROGRAM_SO);
    const clock = this.svm.getClock();
    clock.unixTimestamp = GENESIS_TS;
    clock.slot = 1_000n;
    this.svm.setClock(clock);
  }

  now(): bigint {
    return this.svm.getClock().unixTimestamp;
  }

  /** Advance the chain clock by `secs` (and slots, so blockhashes differ). */
  warp(secs: bigint | number): void {
    const c = this.svm.getClock();
    c.unixTimestamp = c.unixTimestamp + BigInt(secs);
    c.slot = c.slot + BigInt(secs) * 2n + 1n;
    this.svm.setClock(c);
    this.svm.expireBlockhash();
  }

  airdrop(pk: PublicKey, sol = 100): void {
    this.svm.airdrop(address(pk.toBase58()), lamports(BigInt(sol) * 1_000_000_000n));
  }

  send(ixs: TransactionInstruction[], signers: Keypair[]): TxResult {
    this.svm.expireBlockhash();
    const tx = new Transaction({ feePayer: signers[0].publicKey, recentBlockhash: this.svm.latestBlockhash() });
    tx.add(...ixs);
    tx.sign(...signers);
    const res = this.svm.sendTransaction(getTransactionDecoder().decode(tx.serialize()));
    if (res instanceof FailedTransactionMetadata) {
      const logs = res.meta().logs();
      const error = res.err().toString();
      return { ok: false, logs, error, shieldError: parseShieldError(`${error}\n${logs.join("\n")}`) };
    }
    return { ok: true, logs: res.logs(), error: null, shieldError: null };
  }

  mustSend(ixs: TransactionInstruction[], signers: Keypair[]): TxResult {
    const r = this.send(ixs, signers);
    if (!r.ok) throw new Error(`transaction failed: ${r.error}\n${r.logs.join("\n")}`);
    return r;
  }

  accountData(pk: PublicKey): Uint8Array | null {
    const acc = this.svm.getAccount(address(pk.toBase58()));
    if (!acc || !acc.exists) return null;
    return new Uint8Array(acc.data);
  }

  tokenBalance(ata: PublicKey): bigint {
    const data = this.accountData(ata);
    if (!data) return 0n;
    return AccountLayout.decode(data).amount;
  }

  vault(addr: PublicKey): VaultState {
    const data = this.accountData(addr);
    if (!data) throw new Error("vault missing");
    return decodeVault(addr, data);
  }

  proposal(vault: PublicKey, category: ProposalCategory): ProposalState | null {
    const [addr] = proposalPda(vault, category);
    const data = this.accountData(addr);
    return data ? decodeProposal(addr, data) : null;
  }

  registry(vault: PublicKey, owner: PublicKey): RegistryEntryState | null {
    const [addr] = registryEntryPda(vault, owner);
    const data = this.accountData(addr);
    return data ? decodeRegistryEntry(addr, data) : null;
  }

  createMint(payer: Keypair, decimals = 6): PublicKey {
    const mint = Keypair.generate();
    const lamports = Number(this.svm.minimumBalanceForRentExemption(BigInt(MINT_SIZE)));
    this.mustSend(
      [
        SystemProgram.createAccount({
          fromPubkey: payer.publicKey,
          newAccountPubkey: mint.publicKey,
          space: MINT_SIZE,
          lamports,
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMint2Instruction(mint.publicKey, decimals, payer.publicKey, null),
      ],
      [payer, mint]
    );
    return mint.publicKey;
  }

  createAta(payer: Keypair, mint: PublicKey, owner: PublicKey): PublicKey {
    const ata = getAssociatedTokenAddressSync(mint, owner, true);
    if (!this.accountData(ata)) {
      this.mustSend([createAssociatedTokenAccountInstruction(payer.publicKey, ata, owner, mint)], [payer]);
    }
    return ata;
  }

  mintTo(payer: Keypair, mint: PublicKey, dest: PublicKey, amount: bigint): void {
    this.mustSend([createMintToInstruction(mint, dest, payer.publicKey, amount)], [payer]);
  }
}

export interface VaultParams {
  protectedFloor: bigint;
  topUpThresholdBps: number;
  emergencyCap: bigint;
  velocityThreshold: bigint;
  lossTriggerUsdc: bigint;
  lossCooldownSecs: bigint;
}

export const DEFAULT_PARAMS: VaultParams = {
  protectedFloor: usdcToRaw(6_000),
  topUpThresholdBps: 2_000, // 20% of balance
  emergencyCap: usdcToRaw(200),
  velocityThreshold: usdcToRaw(1_600),
  lossTriggerUsdc: usdcToRaw(1_000),
  lossCooldownSecs: 18n * 3600n,
};

export interface Fixture {
  chain: Chain;
  authority: Keypair;
  stranger: Keypair;
  verifier: Keypair;
  mint: PublicKey;
  authorityAta: PublicKey;
  vault: PublicKey;
  vaultAta: PublicKey;
  execution: Keypair;
  executionAta: PublicKey;
  cold: Keypair;
  coldAta: PublicKey;
  params: VaultParams;
}

/** A funded $10,000 vault with one execution wallet and one cold wallet. */
export function setupVault(overrides: Partial<VaultParams> = {}, opts: { deposit?: bigint; verifier?: boolean } = {}): Fixture {
  const chain = new Chain();
  const params = { ...DEFAULT_PARAMS, ...overrides };
  const authority = Keypair.generate();
  const stranger = Keypair.generate();
  const verifier = Keypair.generate();
  chain.airdrop(authority.publicKey);
  chain.airdrop(stranger.publicKey);

  const mint = chain.createMint(authority);
  const authorityAta = chain.createAta(authority, mint, authority.publicKey);
  chain.mintTo(authority, mint, authorityAta, usdcToRaw(50_000));

  const [vault] = vaultPda(authority.publicKey);
  const [vaultAta] = vaultTokenAccountPda(vault);
  chain.mustSend(
    [
      initializeVaultIx({
        authority: authority.publicKey,
        usdcMint: mint,
        riskVerifier: opts.verifier === false ? PublicKey.default : verifier.publicKey,
        ...params,
      }),
    ],
    [authority]
  );

  const execution = Keypair.generate();
  const cold = Keypair.generate();
  const executionAta = chain.createAta(authority, mint, execution.publicKey);
  const coldAta = chain.createAta(authority, mint, cold.publicKey);
  chain.mustSend(
    [
      registerOwnerIx({ authority: authority.publicKey, vault, owner: execution.publicKey, kind: OwnerType.Execution, label: "Axiom" }),
      registerOwnerIx({ authority: authority.publicKey, vault, owner: cold.publicKey, kind: OwnerType.Cold, label: "Ledger" }),
    ],
    [authority]
  );

  const depositAmount = opts.deposit ?? usdcToRaw(10_000);
  if (depositAmount > 0n) {
    chain.mustSend([depositIx({ depositor: authority.publicKey, vault, sourceTokenAccount: authorityAta, amount: depositAmount })], [authority]);
  }

  return { chain, authority, stranger, verifier, mint, authorityAta, vault, vaultAta, execution, executionAta, cold, coldAta, params };
}

/** Sign a verdict the way the CRE workflow / monitor does. */
export function signVerdict(f: Fixture, v: Omit<RiskVerdict, "signature" | "vault" | "programId"> & { vault?: PublicKey; programId?: PublicKey }, signer?: Keypair): RiskVerdict {
  const unsigned = {
    vault: v.vault ?? f.vault,
    programId: v.programId ?? SHIELD_PROGRAM_ID,
    nonce: v.nonce,
    issuedAt: v.issuedAt,
    expiry: v.expiry,
    reasonCode: v.reasonCode,
    realizedLossUsdc: v.realizedLossUsdc,
    evidenceHash: v.evidenceHash,
  };
  const msg = verdictMessage(unsigned);
  const key = (signer ?? f.verifier).secretKey;
  const signature = nacl.sign.detached(msg, key);
  return { ...unsigned, signature };
}

export function evidenceHash(text: string): Uint8Array {
  return sha256(new TextEncoder().encode(text));
}

export const H = 3600n;
export const D = 24n * H;
