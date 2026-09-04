/**
 * Shared, low-level client for the Shield vault program. Builds
 * instructions by hand (Anchor's sighash discriminator scheme + Borsh
 * encoding via the `borsh` package) rather than through an IDL-driven
 * `@coral-xyz/anchor` `Program` object -- this repo's `anchor build`
 * can't run in the dev sandbox that produced it (see
 * programs/shield-vault/README.md), so there's no generated IDL to trust.
 * Every discriminator and account order here is copied directly from
 * `programs/shield-vault/src/lib.rs`'s `#[program]` module and each
 * instruction's `Accounts` struct -- keep both in sync by hand until CI
 * has a working `anchor build` and can generate + verify a real IDL.
 *
 * Both `client/demo.ts` and `client/recovery-cli.ts` import from here.
 * `recovery-cli.ts` in particular exists to prove Invariant 10 (recovery
 * doesn't depend on Shield existing): it talks to this module and Solana
 * RPC directly, nothing else.
 */

import {
  Connection,
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
  Keypair,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as borsh from "borsh";
import { sha256 } from "@noble/hashes/sha2.js";

// This module is isomorphic on purpose (Node CLI scripts AND the browser
// dashboard in app/ both import it) -- @noble/hashes works in both
// environments, `node:crypto` does not. One source of truth for
// instruction encoding, not two copies that can silently drift apart.

export const SHIELD_PROGRAM_ID = new PublicKey("4Z46Kz8ygX5Efw22ABbQ2LTf329N3nD2J81Z3CAY5Hyx");

// ---------------------------------------------------------------------
// Discriminators — Anchor's scheme: first 8 bytes of
// sha256("global:<snake_case_instruction_name>"). Computed here so this
// file can never drift from the actual instruction names without a
// visible diff, same rationale as substreams/src/constants.rs's sighash().
// ---------------------------------------------------------------------

export function sighash(name: string): Uint8Array {
  return sha256(new TextEncoder().encode(`global:${name}`)).subarray(0, 8);
}

// ---------------------------------------------------------------------
// PDAs — seeds copied verbatim from programs/shield-vault/src/state.rs
// and the #[derive(Accounts)] structs in lib.rs.
// ---------------------------------------------------------------------

export function vaultPda(authority: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("vault"), authority.toBuffer()], SHIELD_PROGRAM_ID);
}

export function vaultTokenAccountPda(vault: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault-token"), vault.toBuffer()],
    SHIELD_PROGRAM_ID
  );
}

export function registryEntryPda(vault: PublicKey, owner: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("registry"), vault.toBuffer(), owner.toBuffer()],
    SHIELD_PROGRAM_ID
  );
}

export enum ProposalCategory {
  RuleChange = 0,
  TopUp = 1,
  FullExit = 2,
}

export function proposalPda(vault: PublicKey, category: ProposalCategory): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("proposal"), vault.toBuffer(), Buffer.from([category])],
    SHIELD_PROGRAM_ID
  );
}

// ---------------------------------------------------------------------
// Borsh schemas for instruction args (Anchor encodes ix args as a flat
// Borsh-serialized tuple immediately after the 8-byte discriminator).
// ---------------------------------------------------------------------

const u64 = "u64";
const i64 = "i64";
const u16 = "u16";
const pubkey = { array: { type: "u8", len: 32 } } as const;
const optionU16 = { option: u16 } as const;
const optionU64 = { option: u64 } as const;
const optionI64 = { option: i64 } as const;
const optionPubkey = { option: pubkey } as const;

function ixData(name: string, schema: borsh.Schema, value: Record<string, unknown>): Buffer {
  const body = borsh.serialize(schema, value);
  return Buffer.concat([sighash(name), Buffer.from(body)]);
}

// ---------------------------------------------------------------------
// Instruction builders. Each mirrors one #[derive(Accounts)] struct in
// programs/shield-vault/src/lib.rs exactly, in account order.
// ---------------------------------------------------------------------

export function initializeVaultIx(params: {
  authority: PublicKey;
  usdcMint: PublicKey;
  creVerifier: PublicKey;
  topUpThresholdBps: number;
  emergencyCap: bigint;
  velocityThreshold: bigint;
}): TransactionInstruction {
  const [vault] = vaultPda(params.authority);
  const [vaultTokenAccount] = vaultTokenAccountPda(vault);

  const data = ixData(
    "initialize_vault",
    {
      struct: {
        creVerifier: pubkey,
        topUpThresholdBps: u16,
        emergencyCap: u64,
        velocityThreshold: u64,
      },
    },
    {
      creVerifier: params.creVerifier.toBytes(),
      topUpThresholdBps: params.topUpThresholdBps,
      emergencyCap: params.emergencyCap,
      velocityThreshold: params.velocityThreshold,
    }
  );

  return new TransactionInstruction({
    programId: SHIELD_PROGRAM_ID,
    keys: [
      { pubkey: params.authority, isSigner: true, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: params.usdcMint, isSigner: false, isWritable: false },
      { pubkey: vaultTokenAccount, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export function registerExecutionIx(authority: PublicKey, vault: PublicKey, owner: PublicKey): TransactionInstruction {
  const [registryEntry] = registryEntryPda(vault, owner);
  const data = ixData("register_execution", { struct: { owner: pubkey } }, { owner: owner.toBytes() });
  return new TransactionInstruction({
    programId: SHIELD_PROGRAM_ID,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: false },
      { pubkey: registryEntry, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export function instantTopUpIx(params: {
  authority: PublicKey;
  vault: PublicKey;
  vaultTokenAccount: PublicKey;
  destinationOwner: PublicKey;
  destinationTokenAccount: PublicKey;
  amount: bigint;
}): TransactionInstruction {
  const [registryEntry] = registryEntryPda(params.vault, params.destinationOwner);
  const data = ixData("instant_top_up", { struct: { amount: u64 } }, { amount: params.amount });
  return new TransactionInstruction({
    programId: SHIELD_PROGRAM_ID,
    keys: [
      { pubkey: params.authority, isSigner: true, isWritable: false },
      { pubkey: params.vault, isSigner: false, isWritable: true },
      { pubkey: params.vaultTokenAccount, isSigner: false, isWritable: true },
      { pubkey: registryEntry, isSigner: false, isWritable: false },
      { pubkey: params.destinationTokenAccount, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export function proposeTopUpIx(params: {
  authority: PublicKey;
  vault: PublicKey;
  destinationOwner: PublicKey;
  amount: bigint;
}): TransactionInstruction {
  const [registryEntry] = registryEntryPda(params.vault, params.destinationOwner);
  const [proposal] = proposalPda(params.vault, ProposalCategory.TopUp);
  const data = ixData(
    "propose_top_up",
    { struct: { destinationOwner: pubkey, amount: u64 } },
    { destinationOwner: params.destinationOwner.toBytes(), amount: params.amount }
  );
  return new TransactionInstruction({
    programId: SHIELD_PROGRAM_ID,
    keys: [
      { pubkey: params.authority, isSigner: true, isWritable: true },
      { pubkey: params.vault, isSigner: false, isWritable: true },
      { pubkey: registryEntry, isSigner: false, isWritable: false },
      { pubkey: proposal, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export function executeTopUpIx(params: {
  executor: PublicKey;
  vault: PublicKey;
  vaultTokenAccount: PublicKey;
  destinationOwner: PublicKey;
  destinationTokenAccount: PublicKey;
}): TransactionInstruction {
  const [registryEntry] = registryEntryPda(params.vault, params.destinationOwner);
  const [proposal] = proposalPda(params.vault, ProposalCategory.TopUp);
  const data = ixData("execute_top_up", { struct: {} }, {});
  return new TransactionInstruction({
    programId: SHIELD_PROGRAM_ID,
    keys: [
      { pubkey: params.executor, isSigner: true, isWritable: true },
      { pubkey: params.vault, isSigner: false, isWritable: false },
      { pubkey: params.vaultTokenAccount, isSigner: false, isWritable: true },
      { pubkey: proposal, isSigner: false, isWritable: true },
      { pubkey: registryEntry, isSigner: false, isWritable: false },
      { pubkey: params.destinationTokenAccount, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export function tightenIx(params: {
  authority: PublicKey;
  vault: PublicKey;
  newTopUpThresholdBps?: number;
  newEmergencyCap?: bigint;
  newVelocityThreshold?: bigint;
  newTopUpCooldownSecs?: bigint;
  newLoosenCooldownSecs?: bigint;
  newFullExitCooldownSecs?: bigint;
}): TransactionInstruction {
  const data = ixData(
    "tighten",
    {
      struct: {
        newTopUpThresholdBps: optionU16,
        newEmergencyCap: optionU64,
        newVelocityThreshold: optionU64,
        newTopUpCooldownSecs: optionI64,
        newLoosenCooldownSecs: optionI64,
        newFullExitCooldownSecs: optionI64,
      },
    },
    {
      newTopUpThresholdBps: params.newTopUpThresholdBps ?? null,
      newEmergencyCap: params.newEmergencyCap ?? null,
      newVelocityThreshold: params.newVelocityThreshold ?? null,
      newTopUpCooldownSecs: params.newTopUpCooldownSecs ?? null,
      newLoosenCooldownSecs: params.newLoosenCooldownSecs ?? null,
      newFullExitCooldownSecs: params.newFullExitCooldownSecs ?? null,
    }
  );
  return new TransactionInstruction({
    programId: SHIELD_PROGRAM_ID,
    keys: [
      { pubkey: params.authority, isSigner: true, isWritable: false },
      { pubkey: params.vault, isSigner: false, isWritable: true },
    ],
    data,
  });
}

export function proposeLoosenIx(params: {
  authority: PublicKey;
  vault: PublicKey;
  newTopUpThresholdBps?: number;
  newEmergencyCap?: bigint;
  newVelocityThreshold?: bigint;
  newTopUpCooldownSecs?: bigint;
  newLoosenCooldownSecs?: bigint;
  newFullExitCooldownSecs?: bigint;
  registerColdOwner?: PublicKey;
}): TransactionInstruction {
  const [proposal] = proposalPda(params.vault, ProposalCategory.RuleChange);
  const data = ixData(
    "propose_loosen",
    {
      struct: {
        newTopUpThresholdBps: optionU16,
        newEmergencyCap: optionU64,
        newVelocityThreshold: optionU64,
        newTopUpCooldownSecs: optionI64,
        newLoosenCooldownSecs: optionI64,
        newFullExitCooldownSecs: optionI64,
        registerColdOwner: optionPubkey,
      },
    },
    {
      newTopUpThresholdBps: params.newTopUpThresholdBps ?? null,
      newEmergencyCap: params.newEmergencyCap ?? null,
      newVelocityThreshold: params.newVelocityThreshold ?? null,
      newTopUpCooldownSecs: params.newTopUpCooldownSecs ?? null,
      newLoosenCooldownSecs: params.newLoosenCooldownSecs ?? null,
      newFullExitCooldownSecs: params.newFullExitCooldownSecs ?? null,
      registerColdOwner: params.registerColdOwner ? params.registerColdOwner.toBytes() : null,
    }
  );
  return new TransactionInstruction({
    programId: SHIELD_PROGRAM_ID,
    keys: [
      { pubkey: params.authority, isSigner: true, isWritable: true },
      { pubkey: params.vault, isSigner: false, isWritable: true },
      { pubkey: proposal, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export function proposeUninstallVaultIx(params: {
  authority: PublicKey;
  vault: PublicKey;
  destinationOwner: PublicKey;
}): TransactionInstruction {
  const [registryEntry] = registryEntryPda(params.vault, params.destinationOwner);
  const [proposal] = proposalPda(params.vault, ProposalCategory.FullExit);
  const data = ixData(
    "propose_uninstall_vault",
    { struct: { destinationOwner: pubkey } },
    { destinationOwner: params.destinationOwner.toBytes() }
  );
  return new TransactionInstruction({
    programId: SHIELD_PROGRAM_ID,
    keys: [
      { pubkey: params.authority, isSigner: true, isWritable: true },
      { pubkey: params.vault, isSigner: false, isWritable: true },
      { pubkey: registryEntry, isSigner: false, isWritable: false },
      { pubkey: proposal, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/** Row 5/6 recovery paths, and row-2/3 rule-change execution -- the
 * instructions the standalone recovery CLI relies on. No Shield-operated
 * infrastructure is in the call path for any of these; they're plain
 * Solana RPC + a signing keypair. */
export function cancelProposalIx(params: {
  authority: PublicKey;
  vault: PublicKey;
  proposal: PublicKey;
}): TransactionInstruction {
  const data = ixData("cancel_proposal", { struct: {} }, {});
  return new TransactionInstruction({
    programId: SHIELD_PROGRAM_ID,
    keys: [
      { pubkey: params.authority, isSigner: true, isWritable: true },
      { pubkey: params.vault, isSigner: false, isWritable: true },
      { pubkey: params.proposal, isSigner: false, isWritable: true },
    ],
    data,
  });
}

export function executeFullExitIx(params: {
  executor: PublicKey;
  vault: PublicKey;
  vaultTokenAccount: PublicKey;
  destinationTokenAccount: PublicKey;
}): TransactionInstruction {
  const [proposal] = proposalPda(params.vault, ProposalCategory.FullExit);
  const data = ixData("execute_full_exit", { struct: {} }, {});
  return new TransactionInstruction({
    programId: SHIELD_PROGRAM_ID,
    keys: [
      { pubkey: params.executor, isSigner: true, isWritable: true },
      { pubkey: params.vault, isSigner: false, isWritable: false },
      { pubkey: params.vaultTokenAccount, isSigner: false, isWritable: true },
      { pubkey: proposal, isSigner: false, isWritable: true },
      { pubkey: params.destinationTokenAccount, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export function executeRuleChangeIx(params: {
  executor: PublicKey;
  vault: PublicKey;
  registryEntryOwnerHint: PublicKey;
}): TransactionInstruction {
  const [proposal] = proposalPda(params.vault, ProposalCategory.RuleChange);
  const [registryEntry] = registryEntryPda(params.vault, params.registryEntryOwnerHint);
  const data = ixData("execute_rule_change", { struct: {} }, {});
  return new TransactionInstruction({
    programId: SHIELD_PROGRAM_ID,
    keys: [
      { pubkey: params.executor, isSigner: true, isWritable: true },
      { pubkey: params.vault, isSigner: false, isWritable: true },
      { pubkey: proposal, isSigner: false, isWritable: true },
      { pubkey: registryEntry, isSigner: false, isWritable: true },
      { pubkey: params.registryEntryOwnerHint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

// ---------------------------------------------------------------------
// Account decoding (read-only, no IDL needed for the fixed-size Vault
// struct we control). Field order and sizes copied from
// programs/shield-vault/src/state.rs's Vault::SIZE breakdown.
// ---------------------------------------------------------------------

export interface DecodedVault {
  authority: PublicKey;
  usdcMint: PublicKey;
  vaultTokenAccount: PublicKey;
  creVerifier: PublicKey;
  topUpThresholdBps: number;
  emergencyCap: bigint;
  velocityThreshold: bigint;
  topUpCooldownSecs: bigint;
  loosenCooldownSecs: bigint;
  fullExitCooldownSecs: bigint;
  behavioralCooldownUntil: bigint;
  velocityBuckets: bigint[];
  bucketStart: bigint;
  currentBucketIndex: number;
  configVersion: bigint;
  proposalNonceCounter: bigint;
}

export function decodeVault(data: Buffer): DecodedVault {
  let o = 8; // discriminator
  const readPubkey = () => {
    const pk = new PublicKey(data.subarray(o, o + 32));
    o += 32;
    return pk;
  };
  const readU16 = () => {
    const v = data.readUInt16LE(o);
    o += 2;
    return v;
  };
  const readU64 = () => {
    const v = data.readBigUInt64LE(o);
    o += 8;
    return v;
  };
  const readI64 = () => {
    const v = data.readBigInt64LE(o);
    o += 8;
    return v;
  };
  const readU8 = () => data.readUInt8(o++);

  const authority = readPubkey();
  const usdcMint = readPubkey();
  const vaultTokenAccount = readPubkey();
  const creVerifier = readPubkey();
  const topUpThresholdBps = readU16();
  const emergencyCap = readU64();
  const velocityThreshold = readU64();
  const topUpCooldownSecs = readI64();
  const loosenCooldownSecs = readI64();
  const fullExitCooldownSecs = readI64();
  const behavioralCooldownUntil = readI64();
  const velocityBuckets = Array.from({ length: 6 }, () => readU64());
  const bucketStart = readI64();
  const currentBucketIndex = readU8();
  const configVersion = readU64();
  const proposalNonceCounter = readU64();

  return {
    authority,
    usdcMint,
    vaultTokenAccount,
    creVerifier,
    topUpThresholdBps,
    emergencyCap,
    velocityThreshold,
    topUpCooldownSecs,
    loosenCooldownSecs,
    fullExitCooldownSecs,
    behavioralCooldownUntil,
    velocityBuckets,
    bucketStart,
    currentBucketIndex,
    configVersion,
    proposalNonceCounter,
  };
}

export async function fetchVault(connection: Connection, vault: PublicKey): Promise<DecodedVault | null> {
  const info = await connection.getAccountInfo(vault);
  if (!info) return null;
  return decodeVault(info.data as Buffer);
}

// ---------------------------------------------------------------------
// Proposal decoding. Layout copied from
// programs/shield-vault/src/state.rs's Proposal + ProposalAction: after
// the 8-byte discriminator, `vault` (32) + `category` (1-byte enum tag) +
// `action` (1-byte variant tag, then variant-specific fields) + `nonce`
// (8) + `created_at` (8) + `execute_after` (8) + `expiry` (8) +
// `config_version_at_creation` (8) + `bump` (1).
//
// This is what makes the recovery CLI genuinely standalone (Invariant
// 10): without this, a caller would need to already know a proposal's
// destination owner out-of-band, which defeats the point of a recovery
// tool that's supposed to work with nothing but the chain itself.
// ---------------------------------------------------------------------

export type DecodedProposalAction =
  | { kind: "loosen" }
  | { kind: "topUp"; destinationOwner: PublicKey; amount: bigint }
  | { kind: "uninstallVault"; destinationOwner: PublicKey }
  | { kind: "coldTransferAboveCap"; destinationOwner: PublicKey; amount: bigint };

export interface DecodedProposal {
  vault: PublicKey;
  category: ProposalCategory;
  action: DecodedProposalAction;
  nonce: bigint;
  createdAt: bigint;
  executeAfter: bigint;
  expiry: bigint;
  configVersionAtCreation: bigint;
}

export function decodeProposal(data: Buffer): DecodedProposal {
  let o = 8; // discriminator
  const vault = new PublicKey(data.subarray(o, o + 32));
  o += 32;
  const category = data.readUInt8(o) as ProposalCategory;
  o += 1;

  const actionTag = data.readUInt8(o);
  o += 1;
  let action: DecodedProposalAction;
  if (actionTag === 0) {
    // Loosen { 6x Option<T>, Option<Pubkey> } -- variable length; not
    // needed for recovery (rule-change proposals don't move funds), so
    // we don't walk its fields, only record that this is what it is.
    action = { kind: "loosen" };
    // NOTE: since we don't advance `o` through Loosen's variable-length
    // fields, the trailing nonce/timestamps below would be misread for a
    // RuleChange proposal. Recovery for that category doesn't need this
    // decoder at all (see recovery-cli.ts), so this is scoped to
    // TopUp/FullExit proposals only, matching how the CLI actually calls it.
  } else if (actionTag === 1) {
    const destinationOwner = new PublicKey(data.subarray(o, o + 32));
    o += 32;
    const amount = data.readBigUInt64LE(o);
    o += 8;
    o += 1; // reserved_bucket_index: u8
    action = { kind: "topUp", destinationOwner, amount };
  } else if (actionTag === 2) {
    const destinationOwner = new PublicKey(data.subarray(o, o + 32));
    o += 32;
    action = { kind: "uninstallVault", destinationOwner };
  } else if (actionTag === 3) {
    const destinationOwner = new PublicKey(data.subarray(o, o + 32));
    o += 32;
    const amount = data.readBigUInt64LE(o);
    o += 8;
    action = { kind: "coldTransferAboveCap", destinationOwner, amount };
  } else {
    throw new Error(`unknown ProposalAction tag: ${actionTag}`);
  }

  const nonce = data.readBigUInt64LE(o);
  o += 8;
  const createdAt = data.readBigInt64LE(o);
  o += 8;
  const executeAfter = data.readBigInt64LE(o);
  o += 8;
  const expiry = data.readBigInt64LE(o);
  o += 8;
  const configVersionAtCreation = data.readBigUInt64LE(o);
  o += 8;

  return { vault, category, action, nonce, createdAt, executeAfter, expiry, configVersionAtCreation };
}

export async function fetchProposal(connection: Connection, proposal: PublicKey): Promise<DecodedProposal | null> {
  const info = await connection.getAccountInfo(proposal);
  if (!info) return null;
  return decodeProposal(info.data as Buffer);
}

export { Connection, PublicKey, Keypair, SYSVAR_INSTRUCTIONS_PUBKEY };
