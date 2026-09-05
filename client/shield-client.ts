/**
 * Shield vault client — one isomorphic module shared by the web app, the
 * CLI tools, the recovery CLI, the monitor/relayer, and the test suite.
 *
 * Builds instructions by hand (Anchor's sighash discriminators + Borsh via
 * the `borsh` package) so nothing here depends on a generated IDL. Every
 * layout mirrors programs/shield-vault/src/{state,lib,events}.rs exactly;
 * if the program changes, this file changes with it.
 *
 * Runs in the browser and in Bun: only `@noble/hashes` for SHA-256, no
 * `node:crypto`. Amounts are raw USDC units (6 decimals) as bigint.
 */

import {
  Connection,
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
  Ed25519Program,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as borsh from "borsh";
import { sha256 } from "@noble/hashes/sha2.js";
import { RISK_VERDICT_SCHEMA, encodeVerdictMessage } from "./verdict";

export const SHIELD_PROGRAM_ID = new PublicKey("4Z46Kz8ygX5Efw22ABbQ2LTf329N3nD2J81Z3CAY5Hyx");

export const USDC_DECIMALS = 6;
export const LABEL_LEN = 24;
export const NUM_VELOCITY_BUCKETS = 6;
export const BUCKET_LEN_SECS = 4 * 60 * 60;

export const COOLDOWN_REASON = { NONE: 0, SELF_PAUSE: 1, RISK_VERDICT: 2 } as const;

/** Reason codes a monitor may attach to a verdict (informational). */
export const VERDICT_REASON = {
  REALIZED_LOSS: 1,
  LOSS_STREAK: 2,
  RELOAD_AFTER_LOSS: 3,
  VELOCITY_ANOMALY: 4,
} as const;

// ---------------------------------------------------------------------
// Discriminators
// ---------------------------------------------------------------------

function sighashOf(prefix: string, name: string): Uint8Array {
  return sha256(new TextEncoder().encode(`${prefix}:${name}`)).subarray(0, 8);
}
export const ixDiscriminator = (name: string) => sighashOf("global", name);
export const accountDiscriminator = (name: string) => sighashOf("account", name);
export const eventDiscriminator = (name: string) => sighashOf("event", name);

// ---------------------------------------------------------------------
// PDAs
// ---------------------------------------------------------------------

const enc = (s: string) => new TextEncoder().encode(s);

export function vaultPda(authority: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([enc("vault"), authority.toBytes()], SHIELD_PROGRAM_ID);
}
export function vaultTokenAccountPda(vault: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([enc("vault-token"), vault.toBytes()], SHIELD_PROGRAM_ID);
}
export function registryEntryPda(vault: PublicKey, owner: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([enc("registry"), vault.toBytes(), owner.toBytes()], SHIELD_PROGRAM_ID);
}
export enum ProposalCategory {
  RuleChange = 0,
  TopUp = 1,
  FullExit = 2,
}
export function proposalPda(vault: PublicKey, category: ProposalCategory): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [enc("proposal"), vault.toBytes(), Uint8Array.from([category])],
    SHIELD_PROGRAM_ID
  );
}

export enum OwnerType {
  Execution = 0,
  Cold = 1,
}

// ---------------------------------------------------------------------
// Borsh schemas
// ---------------------------------------------------------------------

const u8 = "u8", u16 = "u16", u32 = "u32", u64 = "u64", i64 = "i64", bool = "bool";
const bytes = (len: number) => ({ array: { type: "u8", len } }) as const;
const pubkey = bytes(32);
const label = bytes(LABEL_LEN);
const opt = (t: borsh.Schema) => ({ option: t }) as const;

export const INITIALIZE_PARAMS_SCHEMA: borsh.Schema = {
  struct: {
    riskVerifier: pubkey,
    protectedFloor: u64,
    topUpThresholdBps: u16,
    emergencyCap: u64,
    velocityThreshold: u64,
    lossTriggerUsdc: u64,
    lossCooldownSecs: i64,
  },
};

export const TIGHTEN_PARAMS_SCHEMA: borsh.Schema = {
  struct: {
    newProtectedFloor: opt(u64),
    newTopUpThresholdBps: opt(u16),
    newEmergencyCap: opt(u64),
    newVelocityThreshold: opt(u64),
    newLossTriggerUsdc: opt(u64),
    newLossCooldownSecs: opt(i64),
    newTopUpCooldownSecs: opt(i64),
    newLoosenCooldownSecs: opt(i64),
    newFullExitCooldownSecs: opt(i64),
    pauseTopUpsUntil: opt(i64),
    setRiskVerifier: opt(pubkey),
  },
};

export const LOOSEN_PARAMS_SCHEMA: borsh.Schema = {
  struct: {
    newProtectedFloor: opt(u64),
    newTopUpThresholdBps: opt(u16),
    newEmergencyCap: opt(u64),
    newVelocityThreshold: opt(u64),
    newLossTriggerUsdc: opt(u64),
    newLossCooldownSecs: opt(i64),
    newTopUpCooldownSecs: opt(i64),
    newLoosenCooldownSecs: opt(i64),
    newFullExitCooldownSecs: opt(i64),
    newRiskVerifier: opt(pubkey),
    registerOwner: opt(pubkey),
    registerKind: u8,
    registerLabel: label,
  },
};

export { RISK_VERDICT_SCHEMA } from "./verdict";

const VAULT_SCHEMA: borsh.Schema = {
  struct: {
    authority: pubkey,
    usdcMint: pubkey,
    vaultTokenAccount: pubkey,
    riskVerifier: pubkey,
    protectedFloor: u64,
    topUpThresholdBps: u16,
    emergencyCap: u64,
    velocityThreshold: u64,
    lossTriggerUsdc: u64,
    lossCooldownSecs: i64,
    topUpCooldownSecs: i64,
    loosenCooldownSecs: i64,
    fullExitCooldownSecs: i64,
    cooldownUntil: i64,
    cooldownReason: u8,
    cooldownSetAt: i64,
    lastVerdictNonce: u64,
    lastVerdictReason: u8,
    lastVerdictEvidence: bytes(32),
    velocityBuckets: { array: { type: u64, len: NUM_VELOCITY_BUCKETS } },
    bucketStart: i64,
    currentBucketIndex: u8,
    configVersion: u64,
    proposalNonceCounter: u64,
    createdAt: i64,
    bump: u8,
    vaultTokenAccountBump: u8,
  },
};

const OWNER_TYPE_SCHEMA: borsh.Schema = { enum: [{ struct: { Execution: { struct: {} } } }, { struct: { Cold: { struct: {} } } }] };

const REGISTRY_SCHEMA: borsh.Schema = {
  struct: {
    vault: pubkey,
    owner: pubkey,
    kind: OWNER_TYPE_SCHEMA,
    active: bool,
    registeredAt: i64,
    label,
    bump: u8,
  },
};

const PROPOSAL_ACTION_SCHEMA: borsh.Schema = {
  enum: [
    { struct: { Loosen: LOOSEN_PARAMS_SCHEMA } },
    { struct: { TopUp: { struct: { destinationOwner: pubkey, amount: u64, reservedBucketIndex: u8 } } } },
    { struct: { UninstallVault: { struct: { destinationOwner: pubkey } } } },
    { struct: { ColdTransferAboveCap: { struct: { destinationOwner: pubkey, amount: u64 } } } },
  ],
};

const PROPOSAL_SCHEMA: borsh.Schema = {
  struct: {
    vault: pubkey,
    category: u8,
    action: PROPOSAL_ACTION_SCHEMA,
    nonce: u64,
    createdAt: i64,
    executeAfter: i64,
    expiry: i64,
    configVersionAtCreation: u64,
    bump: u8,
  },
};

// ---------------------------------------------------------------------
// Decoded types
// ---------------------------------------------------------------------

export interface VaultState {
  address: PublicKey;
  authority: PublicKey;
  usdcMint: PublicKey;
  vaultTokenAccount: PublicKey;
  riskVerifier: PublicKey;
  protectedFloor: bigint;
  topUpThresholdBps: number;
  emergencyCap: bigint;
  velocityThreshold: bigint;
  lossTriggerUsdc: bigint;
  lossCooldownSecs: bigint;
  topUpCooldownSecs: bigint;
  loosenCooldownSecs: bigint;
  fullExitCooldownSecs: bigint;
  cooldownUntil: bigint;
  cooldownReason: number;
  cooldownSetAt: bigint;
  lastVerdictNonce: bigint;
  lastVerdictReason: number;
  lastVerdictEvidence: Uint8Array;
  velocityBuckets: bigint[];
  bucketStart: bigint;
  currentBucketIndex: number;
  configVersion: bigint;
  proposalNonceCounter: bigint;
  createdAt: bigint;
}

export interface RegistryEntryState {
  address: PublicKey;
  vault: PublicKey;
  owner: PublicKey;
  kind: OwnerType;
  active: boolean;
  registeredAt: bigint;
  label: string;
}

export interface LoosenParams {
  newProtectedFloor?: bigint;
  newTopUpThresholdBps?: number;
  newEmergencyCap?: bigint;
  newVelocityThreshold?: bigint;
  newLossTriggerUsdc?: bigint;
  newLossCooldownSecs?: bigint;
  newTopUpCooldownSecs?: bigint;
  newLoosenCooldownSecs?: bigint;
  newFullExitCooldownSecs?: bigint;
  newRiskVerifier?: PublicKey;
  registerOwner?: PublicKey;
  registerKind?: OwnerType;
  registerLabel?: string;
}

export interface TightenParams {
  newProtectedFloor?: bigint;
  newTopUpThresholdBps?: number;
  newEmergencyCap?: bigint;
  newVelocityThreshold?: bigint;
  newLossTriggerUsdc?: bigint;
  newLossCooldownSecs?: bigint;
  newTopUpCooldownSecs?: bigint;
  newLoosenCooldownSecs?: bigint;
  newFullExitCooldownSecs?: bigint;
  pauseTopUpsUntil?: bigint;
  setRiskVerifier?: PublicKey;
}

export type ProposalAction =
  | { kind: "loosen"; params: LoosenParams }
  | { kind: "topUp"; destinationOwner: PublicKey; amount: bigint; reservedBucketIndex: number }
  | { kind: "uninstallVault"; destinationOwner: PublicKey }
  | { kind: "coldTransferAboveCap"; destinationOwner: PublicKey; amount: bigint };

export interface ProposalState {
  address: PublicKey;
  vault: PublicKey;
  category: ProposalCategory;
  action: ProposalAction;
  nonce: bigint;
  createdAt: bigint;
  executeAfter: bigint;
  expiry: bigint;
  configVersionAtCreation: bigint;
}

export interface RiskVerdict {
  vault: PublicKey;
  programId: PublicKey;
  nonce: bigint;
  issuedAt: bigint;
  expiry: bigint;
  reasonCode: number;
  realizedLossUsdc: bigint;
  evidenceHash: Uint8Array;
  signature: Uint8Array;
}

// ---------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------

export function encodeLabel(text: string): Uint8Array {
  const out = new Uint8Array(LABEL_LEN);
  out.set(new TextEncoder().encode(text).subarray(0, LABEL_LEN));
  return out;
}
export function decodeLabel(raw: Uint8Array): string {
  let end = raw.length;
  while (end > 0 && raw[end - 1] === 0) end--;
  return new TextDecoder().decode(raw.subarray(0, end));
}

const optOrNull = <T>(v: T | undefined) => (v === undefined ? null : v);
const pk = (p: PublicKey | undefined) => (p ? p.toBytes() : null);

function loosenParamsValue(p: LoosenParams) {
  return {
    newProtectedFloor: optOrNull(p.newProtectedFloor),
    newTopUpThresholdBps: optOrNull(p.newTopUpThresholdBps),
    newEmergencyCap: optOrNull(p.newEmergencyCap),
    newVelocityThreshold: optOrNull(p.newVelocityThreshold),
    newLossTriggerUsdc: optOrNull(p.newLossTriggerUsdc),
    newLossCooldownSecs: optOrNull(p.newLossCooldownSecs),
    newTopUpCooldownSecs: optOrNull(p.newTopUpCooldownSecs),
    newLoosenCooldownSecs: optOrNull(p.newLoosenCooldownSecs),
    newFullExitCooldownSecs: optOrNull(p.newFullExitCooldownSecs),
    newRiskVerifier: pk(p.newRiskVerifier),
    registerOwner: pk(p.registerOwner),
    registerKind: p.registerKind ?? OwnerType.Execution,
    registerLabel: encodeLabel(p.registerLabel ?? ""),
  };
}

function ixData(name: string, schema: borsh.Schema | null, value: unknown): Buffer {
  const disc = ixDiscriminator(name);
  if (!schema) return Buffer.from(disc);
  const body = borsh.serialize(schema, value);
  const out = new Uint8Array(disc.length + body.length);
  out.set(disc, 0);
  out.set(body, disc.length);
  return Buffer.from(out);
}

const meta = (pubkey: PublicKey, isSigner: boolean, isWritable: boolean) => ({ pubkey, isSigner, isWritable });

// ---------------------------------------------------------------------
// Instruction builders — account order mirrors each #[derive(Accounts)]
// ---------------------------------------------------------------------

export interface InitializeVaultParams {
  authority: PublicKey;
  usdcMint: PublicKey;
  riskVerifier: PublicKey;
  protectedFloor: bigint;
  topUpThresholdBps: number;
  emergencyCap: bigint;
  velocityThreshold: bigint;
  lossTriggerUsdc: bigint;
  lossCooldownSecs: bigint;
}

export function initializeVaultIx(p: InitializeVaultParams): TransactionInstruction {
  const [vault] = vaultPda(p.authority);
  const [vaultTokenAccount] = vaultTokenAccountPda(vault);
  const data = ixData("initialize_vault", { struct: { params: INITIALIZE_PARAMS_SCHEMA } }, {
    params: {
      riskVerifier: p.riskVerifier.toBytes(),
      protectedFloor: p.protectedFloor,
      topUpThresholdBps: p.topUpThresholdBps,
      emergencyCap: p.emergencyCap,
      velocityThreshold: p.velocityThreshold,
      lossTriggerUsdc: p.lossTriggerUsdc,
      lossCooldownSecs: p.lossCooldownSecs,
    },
  });
  return new TransactionInstruction({
    programId: SHIELD_PROGRAM_ID,
    keys: [
      meta(p.authority, true, true),
      meta(vault, false, true),
      meta(p.usdcMint, false, false),
      meta(vaultTokenAccount, false, true),
      meta(TOKEN_PROGRAM_ID, false, false),
      meta(SystemProgram.programId, false, false),
      meta(SYSVAR_RENT_PUBKEY, false, false),
    ],
    data,
  });
}

export function depositIx(p: {
  depositor: PublicKey;
  vault: PublicKey;
  sourceTokenAccount: PublicKey;
  amount: bigint;
}): TransactionInstruction {
  const [vaultTokenAccount] = vaultTokenAccountPda(p.vault);
  const data = ixData("deposit", { struct: { amount: u64 } }, { amount: p.amount });
  return new TransactionInstruction({
    programId: SHIELD_PROGRAM_ID,
    keys: [
      meta(p.depositor, true, false),
      meta(p.vault, false, false),
      meta(vaultTokenAccount, false, true),
      meta(p.sourceTokenAccount, false, true),
      meta(TOKEN_PROGRAM_ID, false, false),
    ],
    data,
  });
}

export function registerOwnerIx(p: {
  authority: PublicKey;
  vault: PublicKey;
  owner: PublicKey;
  kind: OwnerType;
  label: string;
}): TransactionInstruction {
  const [vaultTokenAccount] = vaultTokenAccountPda(p.vault);
  const [registryEntry] = registryEntryPda(p.vault, p.owner);
  const data = ixData(
    "register_owner",
    { struct: { owner: pubkey, kind: u8, label } },
    { owner: p.owner.toBytes(), kind: p.kind, label: encodeLabel(p.label) }
  );
  return new TransactionInstruction({
    programId: SHIELD_PROGRAM_ID,
    keys: [
      meta(p.authority, true, true),
      meta(p.vault, false, false),
      meta(vaultTokenAccount, false, false),
      meta(registryEntry, false, true),
      meta(SystemProgram.programId, false, false),
    ],
    data,
  });
}

export function removeRegistrationIx(p: { authority: PublicKey; vault: PublicKey; owner: PublicKey }): TransactionInstruction {
  const [registryEntry] = registryEntryPda(p.vault, p.owner);
  return new TransactionInstruction({
    programId: SHIELD_PROGRAM_ID,
    keys: [meta(p.authority, true, false), meta(p.vault, false, true), meta(registryEntry, false, true)],
    data: ixData("remove_registration", null, null),
  });
}

export function tightenIx(p: { authority: PublicKey; vault: PublicKey } & TightenParams): TransactionInstruction {
  const data = ixData("tighten", { struct: { params: TIGHTEN_PARAMS_SCHEMA } }, {
    params: {
      newProtectedFloor: optOrNull(p.newProtectedFloor),
      newTopUpThresholdBps: optOrNull(p.newTopUpThresholdBps),
      newEmergencyCap: optOrNull(p.newEmergencyCap),
      newVelocityThreshold: optOrNull(p.newVelocityThreshold),
      newLossTriggerUsdc: optOrNull(p.newLossTriggerUsdc),
      newLossCooldownSecs: optOrNull(p.newLossCooldownSecs),
      newTopUpCooldownSecs: optOrNull(p.newTopUpCooldownSecs),
      newLoosenCooldownSecs: optOrNull(p.newLoosenCooldownSecs),
      newFullExitCooldownSecs: optOrNull(p.newFullExitCooldownSecs),
      pauseTopUpsUntil: optOrNull(p.pauseTopUpsUntil),
      setRiskVerifier: pk(p.setRiskVerifier),
    },
  });
  return new TransactionInstruction({
    programId: SHIELD_PROGRAM_ID,
    keys: [meta(p.authority, true, false), meta(p.vault, false, true)],
    data,
  });
}

export function proposeLoosenIx(p: { authority: PublicKey; vault: PublicKey } & LoosenParams): TransactionInstruction {
  const [proposal] = proposalPda(p.vault, ProposalCategory.RuleChange);
  const data = ixData("propose_loosen", { struct: { params: LOOSEN_PARAMS_SCHEMA } }, { params: loosenParamsValue(p) });
  return new TransactionInstruction({
    programId: SHIELD_PROGRAM_ID,
    keys: [
      meta(p.authority, true, true),
      meta(p.vault, false, true),
      meta(proposal, false, true),
      meta(SystemProgram.programId, false, false),
    ],
    data,
  });
}

export function executeRuleChangeIx(p: { authority: PublicKey; vault: PublicKey }): TransactionInstruction {
  const [proposal] = proposalPda(p.vault, ProposalCategory.RuleChange);
  return new TransactionInstruction({
    programId: SHIELD_PROGRAM_ID,
    keys: [meta(p.authority, true, true), meta(p.vault, false, true), meta(proposal, false, true)],
    data: ixData("execute_rule_change", null, null),
  });
}

export function executeRuleChangeWithRegistrationIx(p: {
  authority: PublicKey;
  vault: PublicKey;
  owner: PublicKey;
}): TransactionInstruction {
  const [proposal] = proposalPda(p.vault, ProposalCategory.RuleChange);
  const [registryEntry] = registryEntryPda(p.vault, p.owner);
  const data = ixData("execute_rule_change_with_registration", { struct: { owner: pubkey } }, { owner: p.owner.toBytes() });
  return new TransactionInstruction({
    programId: SHIELD_PROGRAM_ID,
    keys: [
      meta(p.authority, true, true),
      meta(p.vault, false, true),
      meta(proposal, false, true),
      meta(registryEntry, false, true),
      meta(SystemProgram.programId, false, false),
    ],
    data,
  });
}

export function cancelProposalIx(p: { authority: PublicKey; vault: PublicKey; category: ProposalCategory }): TransactionInstruction {
  const [proposal] = proposalPda(p.vault, p.category);
  return new TransactionInstruction({
    programId: SHIELD_PROGRAM_ID,
    keys: [meta(p.authority, true, true), meta(p.vault, false, true), meta(proposal, false, true)],
    data: ixData("cancel_proposal", null, null),
  });
}

export function instantTopUpIx(p: {
  authority: PublicKey;
  vault: PublicKey;
  destinationOwner: PublicKey;
  destinationTokenAccount: PublicKey;
  amount: bigint;
}): TransactionInstruction {
  const [vaultTokenAccount] = vaultTokenAccountPda(p.vault);
  const [registryEntry] = registryEntryPda(p.vault, p.destinationOwner);
  const data = ixData("instant_top_up", { struct: { amount: u64 } }, { amount: p.amount });
  return new TransactionInstruction({
    programId: SHIELD_PROGRAM_ID,
    keys: [
      meta(p.authority, true, false),
      meta(p.vault, false, true),
      meta(vaultTokenAccount, false, true),
      meta(registryEntry, false, false),
      meta(p.destinationTokenAccount, false, true),
      meta(TOKEN_PROGRAM_ID, false, false),
    ],
    data,
  });
}

export function proposeTopUpIx(p: {
  authority: PublicKey;
  vault: PublicKey;
  destinationOwner: PublicKey;
  amount: bigint;
}): TransactionInstruction {
  const [vaultTokenAccount] = vaultTokenAccountPda(p.vault);
  const [registryEntry] = registryEntryPda(p.vault, p.destinationOwner);
  const [proposal] = proposalPda(p.vault, ProposalCategory.TopUp);
  const data = ixData(
    "propose_top_up",
    { struct: { destinationOwner: pubkey, amount: u64 } },
    { destinationOwner: p.destinationOwner.toBytes(), amount: p.amount }
  );
  return new TransactionInstruction({
    programId: SHIELD_PROGRAM_ID,
    keys: [
      meta(p.authority, true, true),
      meta(p.vault, false, true),
      meta(vaultTokenAccount, false, false),
      meta(registryEntry, false, false),
      meta(proposal, false, true),
      meta(SystemProgram.programId, false, false),
    ],
    data,
  });
}

export function executeTopUpIx(p: {
  authority: PublicKey;
  vault: PublicKey;
  destinationOwner: PublicKey;
  destinationTokenAccount: PublicKey;
}): TransactionInstruction {
  const [vaultTokenAccount] = vaultTokenAccountPda(p.vault);
  const [registryEntry] = registryEntryPda(p.vault, p.destinationOwner);
  const [proposal] = proposalPda(p.vault, ProposalCategory.TopUp);
  return new TransactionInstruction({
    programId: SHIELD_PROGRAM_ID,
    keys: [
      meta(p.authority, true, true),
      meta(p.vault, false, false),
      meta(vaultTokenAccount, false, true),
      meta(proposal, false, true),
      meta(registryEntry, false, false),
      meta(p.destinationTokenAccount, false, true),
      meta(TOKEN_PROGRAM_ID, false, false),
    ],
    data: ixData("execute_top_up", null, null),
  });
}

/** Serialize the verdict with the signature zeroed: the exact bytes the
 * program reconstructs and the verifier must have signed. */
export function verdictMessage(v: Omit<RiskVerdict, "signature">): Uint8Array {
  return encodeVerdictMessage({
    vault: v.vault.toBytes(),
    programId: v.programId.toBytes(),
    nonce: v.nonce,
    issuedAt: v.issuedAt,
    expiry: v.expiry,
    reasonCode: v.reasonCode,
    realizedLossUsdc: v.realizedLossUsdc,
    evidenceHash: v.evidenceHash,
  });
}

/** Both instructions must be in the same transaction, in this order. */
export function applyRiskVerdictIxs(p: {
  relayer: PublicKey;
  vault: PublicKey;
  verifier: PublicKey;
  verdict: RiskVerdict;
}): TransactionInstruction[] {
  const message = verdictMessage(p.verdict);
  const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
    publicKey: p.verifier.toBytes(),
    message,
    signature: p.verdict.signature,
  });
  const data = ixData("apply_risk_verdict", { struct: { verdict: RISK_VERDICT_SCHEMA } }, {
    verdict: {
      vault: p.verdict.vault.toBytes(),
      programId: p.verdict.programId.toBytes(),
      nonce: p.verdict.nonce,
      issuedAt: p.verdict.issuedAt,
      expiry: p.verdict.expiry,
      reasonCode: p.verdict.reasonCode,
      realizedLossUsdc: p.verdict.realizedLossUsdc,
      evidenceHash: p.verdict.evidenceHash,
      signature: p.verdict.signature,
    },
  });
  const applyIx = new TransactionInstruction({
    programId: SHIELD_PROGRAM_ID,
    keys: [meta(p.relayer, true, false), meta(p.vault, false, true), meta(SYSVAR_INSTRUCTIONS_PUBKEY, false, false)],
    data,
  });
  return [ed25519Ix, applyIx];
}

export function instantColdTransferIx(p: {
  authority: PublicKey;
  vault: PublicKey;
  destinationOwner: PublicKey;
  destinationTokenAccount: PublicKey;
  amount: bigint;
}): TransactionInstruction {
  const [vaultTokenAccount] = vaultTokenAccountPda(p.vault);
  const [registryEntry] = registryEntryPda(p.vault, p.destinationOwner);
  const data = ixData("instant_cold_transfer", { struct: { amount: u64 } }, { amount: p.amount });
  return new TransactionInstruction({
    programId: SHIELD_PROGRAM_ID,
    keys: [
      meta(p.authority, true, false),
      meta(p.vault, false, true),
      meta(vaultTokenAccount, false, true),
      meta(registryEntry, false, false),
      meta(p.destinationTokenAccount, false, true),
      meta(TOKEN_PROGRAM_ID, false, false),
    ],
    data,
  });
}

export function proposeColdTransferAboveCapIx(p: {
  authority: PublicKey;
  vault: PublicKey;
  destinationOwner: PublicKey;
  amount: bigint;
}): TransactionInstruction {
  const [registryEntry] = registryEntryPda(p.vault, p.destinationOwner);
  const [proposal] = proposalPda(p.vault, ProposalCategory.FullExit);
  const data = ixData(
    "propose_cold_transfer_above_cap",
    { struct: { destinationOwner: pubkey, amount: u64 } },
    { destinationOwner: p.destinationOwner.toBytes(), amount: p.amount }
  );
  return new TransactionInstruction({
    programId: SHIELD_PROGRAM_ID,
    keys: [
      meta(p.authority, true, true),
      meta(p.vault, false, true),
      meta(registryEntry, false, false),
      meta(proposal, false, true),
      meta(SystemProgram.programId, false, false),
    ],
    data,
  });
}

export function proposeUninstallVaultIx(p: {
  authority: PublicKey;
  vault: PublicKey;
  destinationOwner: PublicKey;
}): TransactionInstruction {
  const [registryEntry] = registryEntryPda(p.vault, p.destinationOwner);
  const [proposal] = proposalPda(p.vault, ProposalCategory.FullExit);
  const data = ixData("propose_uninstall_vault", { struct: { destinationOwner: pubkey } }, { destinationOwner: p.destinationOwner.toBytes() });
  return new TransactionInstruction({
    programId: SHIELD_PROGRAM_ID,
    keys: [
      meta(p.authority, true, true),
      meta(p.vault, false, true),
      meta(registryEntry, false, false),
      meta(proposal, false, true),
      meta(SystemProgram.programId, false, false),
    ],
    data,
  });
}

export function executeFullExitIx(p: {
  authority: PublicKey;
  vault: PublicKey;
  destinationOwner: PublicKey;
  destinationTokenAccount: PublicKey;
}): TransactionInstruction {
  const [vaultTokenAccount] = vaultTokenAccountPda(p.vault);
  const [registryEntry] = registryEntryPda(p.vault, p.destinationOwner);
  const [proposal] = proposalPda(p.vault, ProposalCategory.FullExit);
  return new TransactionInstruction({
    programId: SHIELD_PROGRAM_ID,
    keys: [
      meta(p.authority, true, true),
      meta(p.vault, false, false),
      meta(vaultTokenAccount, false, true),
      meta(proposal, false, true),
      meta(registryEntry, false, false),
      meta(p.destinationTokenAccount, false, true),
      meta(TOKEN_PROGRAM_ID, false, false),
    ],
    data: ixData("execute_full_exit", null, null),
  });
}

// ---------------------------------------------------------------------
// Account decoding
// ---------------------------------------------------------------------

function assertDiscriminator(data: Uint8Array, name: string) {
  const expected = accountDiscriminator(name);
  for (let i = 0; i < 8; i++) {
    if (data[i] !== expected[i]) throw new Error(`account is not a Shield ${name}`);
  }
}

const toPk = (b: unknown) => new PublicKey(Uint8Array.from(b as ArrayLike<number>));
const toBig = (v: unknown) => BigInt(v as bigint | number | string);

export function decodeVault(address: PublicKey, data: Uint8Array): VaultState {
  assertDiscriminator(data, "Vault");
  const v = borsh.deserialize(VAULT_SCHEMA, data.subarray(8)) as Record<string, unknown>;
  return {
    address,
    authority: toPk(v.authority),
    usdcMint: toPk(v.usdcMint),
    vaultTokenAccount: toPk(v.vaultTokenAccount),
    riskVerifier: toPk(v.riskVerifier),
    protectedFloor: toBig(v.protectedFloor),
    topUpThresholdBps: Number(v.topUpThresholdBps),
    emergencyCap: toBig(v.emergencyCap),
    velocityThreshold: toBig(v.velocityThreshold),
    lossTriggerUsdc: toBig(v.lossTriggerUsdc),
    lossCooldownSecs: toBig(v.lossCooldownSecs),
    topUpCooldownSecs: toBig(v.topUpCooldownSecs),
    loosenCooldownSecs: toBig(v.loosenCooldownSecs),
    fullExitCooldownSecs: toBig(v.fullExitCooldownSecs),
    cooldownUntil: toBig(v.cooldownUntil),
    cooldownReason: Number(v.cooldownReason),
    cooldownSetAt: toBig(v.cooldownSetAt),
    lastVerdictNonce: toBig(v.lastVerdictNonce),
    lastVerdictReason: Number(v.lastVerdictReason),
    lastVerdictEvidence: Uint8Array.from(v.lastVerdictEvidence as ArrayLike<number>),
    velocityBuckets: (v.velocityBuckets as unknown[]).map(toBig),
    bucketStart: toBig(v.bucketStart),
    currentBucketIndex: Number(v.currentBucketIndex),
    configVersion: toBig(v.configVersion),
    proposalNonceCounter: toBig(v.proposalNonceCounter),
    createdAt: toBig(v.createdAt),
  };
}

export function decodeRegistryEntry(address: PublicKey, data: Uint8Array): RegistryEntryState {
  assertDiscriminator(data, "RegistryEntry");
  const v = borsh.deserialize(REGISTRY_SCHEMA, data.subarray(8)) as Record<string, unknown>;
  const kindObj = v.kind as Record<string, unknown>;
  return {
    address,
    vault: toPk(v.vault),
    owner: toPk(v.owner),
    kind: "Cold" in kindObj ? OwnerType.Cold : OwnerType.Execution,
    active: Boolean(v.active),
    registeredAt: toBig(v.registeredAt),
    label: decodeLabel(Uint8Array.from(v.label as ArrayLike<number>)),
  };
}

function decodeLoosenParams(raw: Record<string, unknown>): LoosenParams {
  const big = (k: string) => (raw[k] === null || raw[k] === undefined ? undefined : toBig(raw[k]));
  const num = (k: string) => (raw[k] === null || raw[k] === undefined ? undefined : Number(raw[k]));
  const key = (k: string) => (raw[k] === null || raw[k] === undefined ? undefined : toPk(raw[k]));
  return {
    newProtectedFloor: big("newProtectedFloor"),
    newTopUpThresholdBps: num("newTopUpThresholdBps"),
    newEmergencyCap: big("newEmergencyCap"),
    newVelocityThreshold: big("newVelocityThreshold"),
    newLossTriggerUsdc: big("newLossTriggerUsdc"),
    newLossCooldownSecs: big("newLossCooldownSecs"),
    newTopUpCooldownSecs: big("newTopUpCooldownSecs"),
    newLoosenCooldownSecs: big("newLoosenCooldownSecs"),
    newFullExitCooldownSecs: big("newFullExitCooldownSecs"),
    newRiskVerifier: key("newRiskVerifier"),
    registerOwner: key("registerOwner"),
    registerKind: Number(raw.registerKind) as OwnerType,
    registerLabel: decodeLabel(Uint8Array.from(raw.registerLabel as ArrayLike<number>)),
  };
}

export function decodeProposal(address: PublicKey, data: Uint8Array): ProposalState {
  assertDiscriminator(data, "Proposal");
  const v = borsh.deserialize(PROPOSAL_SCHEMA, data.subarray(8)) as Record<string, unknown>;
  const actionObj = v.action as Record<string, Record<string, unknown>>;
  let action: ProposalAction;
  if ("Loosen" in actionObj) {
    action = { kind: "loosen", params: decodeLoosenParams(actionObj.Loosen) };
  } else if ("TopUp" in actionObj) {
    const a = actionObj.TopUp;
    action = {
      kind: "topUp",
      destinationOwner: toPk(a.destinationOwner),
      amount: toBig(a.amount),
      reservedBucketIndex: Number(a.reservedBucketIndex),
    };
  } else if ("UninstallVault" in actionObj) {
    action = { kind: "uninstallVault", destinationOwner: toPk(actionObj.UninstallVault.destinationOwner) };
  } else {
    const a = actionObj.ColdTransferAboveCap;
    action = { kind: "coldTransferAboveCap", destinationOwner: toPk(a.destinationOwner), amount: toBig(a.amount) };
  }
  return {
    address,
    vault: toPk(v.vault),
    category: Number(v.category) as ProposalCategory,
    action,
    nonce: toBig(v.nonce),
    createdAt: toBig(v.createdAt),
    executeAfter: toBig(v.executeAfter),
    expiry: toBig(v.expiry),
    configVersionAtCreation: toBig(v.configVersionAtCreation),
  };
}

// ---------------------------------------------------------------------
// RPC fetchers
// ---------------------------------------------------------------------

export async function fetchVault(connection: Connection, vault: PublicKey): Promise<VaultState | null> {
  const info = await connection.getAccountInfo(vault, "confirmed");
  if (!info) return null;
  return decodeVault(vault, new Uint8Array(info.data));
}

export async function fetchProposal(connection: Connection, vault: PublicKey, category: ProposalCategory): Promise<ProposalState | null> {
  const [addr] = proposalPda(vault, category);
  const info = await connection.getAccountInfo(addr, "confirmed");
  if (!info) return null;
  return decodeProposal(addr, new Uint8Array(info.data));
}

export async function fetchAllProposals(connection: Connection, vault: PublicKey): Promise<ProposalState[]> {
  const addrs = [ProposalCategory.RuleChange, ProposalCategory.TopUp, ProposalCategory.FullExit].map((c) => proposalPda(vault, c)[0]);
  const infos = await connection.getMultipleAccountsInfo(addrs, "confirmed");
  const out: ProposalState[] = [];
  infos.forEach((info, i) => {
    if (info) out.push(decodeProposal(addrs[i], new Uint8Array(info.data)));
  });
  return out;
}

/** All registry entries for a vault via a memcmp on the `vault` field. */
export async function fetchRegistry(connection: Connection, vault: PublicKey): Promise<RegistryEntryState[]> {
  const accounts = await connection.getProgramAccounts(SHIELD_PROGRAM_ID, {
    commitment: "confirmed",
    filters: [
      { memcmp: { offset: 0, bytes: bs58Encode(accountDiscriminator("RegistryEntry")) } },
      { memcmp: { offset: 8, bytes: vault.toBase58() } },
    ],
  });
  return accounts.map((a) => decodeRegistryEntry(a.pubkey, new Uint8Array(a.account.data)));
}

export async function fetchRegistryEntry(connection: Connection, vault: PublicKey, owner: PublicKey): Promise<RegistryEntryState | null> {
  const [addr] = registryEntryPda(vault, owner);
  const info = await connection.getAccountInfo(addr, "confirmed");
  if (!info) return null;
  return decodeRegistryEntry(addr, new Uint8Array(info.data));
}

// ---------------------------------------------------------------------
// Events ("Program data:" logs)
// ---------------------------------------------------------------------

export const EVENT_SCHEMAS: Record<string, borsh.Schema> = {
  VaultInitialized: { struct: { vault: pubkey, authority: pubkey, usdcMint: pubkey, protectedFloor: u64, velocityThreshold: u64 } },
  Deposited: { struct: { vault: pubkey, depositor: pubkey, amount: u64, newBalance: u64 } },
  RegistrationChanged: { struct: { vault: pubkey, owner: pubkey, kind: u8, active: bool, label } },
  PolicyTightened: {
    struct: {
      vault: pubkey,
      configVersion: u64,
      cooldownUntil: i64,
      protectedFloor: u64,
      velocityThreshold: u64,
      topUpThresholdBps: u16,
      lossTriggerUsdc: u64,
      lossCooldownSecs: i64,
    },
  },
  LoosenProposed: { struct: { vault: pubkey, nonce: u64, executeAfter: i64 } },
  LoosenExecuted: { struct: { vault: pubkey, nonce: u64 } },
  ProposalCancelled: { struct: { vault: pubkey, category: u8, nonce: u64 } },
  TopUpExecuted: {
    struct: { vault: pubkey, destinationOwner: pubkey, amount: u64, instant: bool, nonce: u64, velocityAfter: u64, balanceAfter: u64 },
  },
  TopUpProposed: { struct: { vault: pubkey, destinationOwner: pubkey, amount: u64, nonce: u64, executeAfter: i64 } },
  ColdTransferExecuted: { struct: { vault: pubkey, destinationOwner: pubkey, amount: u64, instant: bool } },
  FullExitProposed: { struct: { vault: pubkey, destinationOwner: pubkey, nonce: u64, executeAfter: i64, uninstall: bool, amount: u64 } },
  FullExitExecuted: { struct: { vault: pubkey, destinationOwner: pubkey, amount: u64 } },
  RiskVerdictApplied: {
    struct: { vault: pubkey, nonce: u64, reasonCode: u8, realizedLossUsdc: u64, cooldownUntil: i64, extended: bool, evidenceHash: bytes(32) },
  },
};

const EVENT_DISCRIMINATORS: Array<[string, Uint8Array]> = Object.keys(EVENT_SCHEMAS).map((n) => [n, eventDiscriminator(n)]);

export interface ShieldEvent {
  name: string;
  data: Record<string, unknown>;
}

function normalizeEvent(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (Array.isArray(v) && v.length === 32 && k !== "evidenceHash") out[k] = toPk(v).toBase58();
    else if (Array.isArray(v) && k === "label") out[k] = decodeLabel(Uint8Array.from(v as number[]));
    else if (Array.isArray(v)) out[k] = Buffer.from(Uint8Array.from(v as number[])).toString("hex");
    else if (typeof v === "bigint") out[k] = v.toString();
    else out[k] = v;
  }
  return out;
}

export function decodeEventData(bytesIn: Uint8Array): ShieldEvent | null {
  if (bytesIn.length < 8) return null;
  for (const [name, disc] of EVENT_DISCRIMINATORS) {
    let match = true;
    for (let i = 0; i < 8; i++) if (bytesIn[i] !== disc[i]) { match = false; break; }
    if (!match) continue;
    const decoded = borsh.deserialize(EVENT_SCHEMAS[name], bytesIn.subarray(8)) as Record<string, unknown>;
    return { name, data: normalizeEvent(decoded) };
  }
  return null;
}

export function decodeEventsFromLogs(logs: string[]): ShieldEvent[] {
  const out: ShieldEvent[] = [];
  for (const line of logs) {
    const m = line.match(/^Program data: (.+)$/);
    if (!m) continue;
    try {
      const ev = decodeEventData(new Uint8Array(Buffer.from(m[1], "base64")));
      if (ev) out.push(ev);
    } catch {
      /* not one of ours */
    }
  }
  return out;
}

// ---------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------

/** Order mirrors `ShieldError` in errors.rs; Anchor numbers them from 6000. */
export const SHIELD_ERROR_NAMES = [
  "Unauthorized",
  "ZeroAmount",
  "InvalidParameter",
  "AlreadyRegisteredDifferentType",
  "VaultFundedUseDelayedPath",
  "DestinationNotExecution",
  "DestinationNotCold",
  "AmountExceedsEmergencyCap",
  "VelocityThresholdExceeded",
  "CooldownActive",
  "ProtectedFloorBreached",
  "AmountRequiresGatedTopUp",
  "ProposalNotMatured",
  "ProposalExpired",
  "ProposalStale",
  "NoPendingProposal",
  "ProposalRequiresRegistrationPath",
  "ProposalHasNoRegistration",
  "NoRiskVerifier",
  "InvalidVerifier",
  "VerdictExpired",
  "VerdictNotYetValid",
  "VerdictWrongBinding",
  "VerdictReplayed",
  "VerdictBelowLossTrigger",
  "NotATightening",
  "NotALoosening",
  "PauseTooLong",
  "MathOverflow",
  "WrongMint",
  "TokenAccountOwnerMismatch",
  "CannotDowngradeExecutionToCold",
  "FullExitDestinationNotRegisteredCold",
] as const;

export type ShieldErrorName = (typeof SHIELD_ERROR_NAMES)[number];

/** Extract a Shield error name from an RPC/simulation error or its logs. */
export function parseShieldError(input: unknown): ShieldErrorName | null {
  const text =
    typeof input === "string"
      ? input
      : input instanceof Error
        ? `${input.message}\n${(input as { logs?: string[] }).logs?.join("\n") ?? ""}`
        : Array.isArray(input)
          ? input.join("\n")
          : JSON.stringify(input);
  const byName = text.match(/Error Code: ([A-Za-z]+)/);
  if (byName && (SHIELD_ERROR_NAMES as readonly string[]).includes(byName[1])) return byName[1] as ShieldErrorName;
  const byHex = text.match(/custom program error: 0x([0-9a-f]+)/i);
  if (byHex) {
    const code = parseInt(byHex[1], 16) - 6000;
    if (code >= 0 && code < SHIELD_ERROR_NAMES.length) return SHIELD_ERROR_NAMES[code];
  }
  return null;
}

// ---------------------------------------------------------------------
// Pure policy evaluation (mirrors the program's checks, for UI previews)
// ---------------------------------------------------------------------

export interface TopUpDecision {
  path: "instant" | "gated" | "blocked";
  reason: ShieldErrorName | null;
  executeAfter?: bigint;
  velocityRemaining: bigint;
  instantThreshold: bigint;
  floorHeadroom: bigint;
}

export function rollingVelocity(v: VaultState, now: bigint): bigint {
  if (v.bucketStart === 0n) return 0n;
  const elapsed = now - v.bucketStart;
  if (elapsed < 0n) return v.velocityBuckets.reduce((a, b) => a + b, 0n);
  const bucketsElapsed = elapsed / BigInt(BUCKET_LEN_SECS);
  if (bucketsElapsed >= BigInt(NUM_VELOCITY_BUCKETS)) return 0n;
  let sum = 0n;
  for (let i = 0; i < NUM_VELOCITY_BUCKETS; i++) {
    // buckets that will be zeroed by the roll: the next `bucketsElapsed` after current
    let stale = false;
    for (let k = 1n; k <= bucketsElapsed; k++) {
      if ((BigInt(v.currentBucketIndex) + k) % BigInt(NUM_VELOCITY_BUCKETS) === BigInt(i)) stale = true;
    }
    if (!stale) sum += v.velocityBuckets[i];
  }
  return sum;
}

export function evaluateTopUp(v: VaultState, balance: bigint, amount: bigint, now: bigint): TopUpDecision {
  const velocity = rollingVelocity(v, now);
  const velocityRemaining = v.velocityThreshold > velocity ? v.velocityThreshold - velocity : 0n;
  const instantThreshold = (balance * BigInt(v.topUpThresholdBps)) / 10_000n;
  const floorHeadroom = balance > v.protectedFloor ? balance - v.protectedFloor : 0n;
  const base = { velocityRemaining, instantThreshold, floorHeadroom };

  if (amount <= 0n) return { path: "blocked", reason: "ZeroAmount", ...base };
  if (amount > floorHeadroom) return { path: "blocked", reason: "ProtectedFloorBreached", ...base };
  if (amount > velocityRemaining) return { path: "blocked", reason: "VelocityThresholdExceeded", ...base };
  const cooldownActive = now < v.cooldownUntil;
  if (cooldownActive) {
    return {
      path: "blocked",
      reason: "CooldownActive",
      executeAfter: v.cooldownUntil,
      ...base,
    };
  }
  if (amount >= instantThreshold) {
    return { path: "gated", reason: "AmountRequiresGatedTopUp", executeAfter: now + v.topUpCooldownSecs, ...base };
  }
  return { path: "instant", reason: null, ...base };
}

// ---------------------------------------------------------------------
// Small utils
// ---------------------------------------------------------------------

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function bs58Encode(bytesIn: Uint8Array): string {
  let x = 0n;
  for (const b of bytesIn) x = (x << 8n) | BigInt(b);
  let out = "";
  while (x > 0n) {
    out = B58[Number(x % 58n)] + out;
    x /= 58n;
  }
  for (const b of bytesIn) {
    if (b === 0) out = "1" + out;
    else break;
  }
  return out;
}

export const usdcToRaw = (usd: number | string): bigint => {
  const n = typeof usd === "string" ? Number(usd.replace(/[^0-9.]/g, "")) : usd;
  return BigInt(Math.round(n * 1_000_000));
};
export const rawToUsdc = (raw: bigint): number => Number(raw) / 1_000_000;

export { Connection, PublicKey, SYSVAR_INSTRUCTIONS_PUBKEY };
