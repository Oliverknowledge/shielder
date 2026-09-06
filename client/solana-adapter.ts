/**
 * Solana adapter: maps the Anchor program's account types into the
 * chain-agnostic views and builds instruction lists for every action.
 */
import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  OwnerType,
  ProposalCategory,
  cancelProposalIx,
  depositIx,
  executeFullExitIx,
  executeRuleChangeIx,
  executeRuleChangeWithRegistrationIx,
  executeTopUpIx,
  initializeVaultIx,
  instantColdTransferIx,
  instantTopUpIx,
  proposeColdTransferAboveCapIx,
  proposeLoosenIx,
  proposeTopUpIx,
  proposeUninstallVaultIx,
  registerOwnerIx,
  removeRegistrationIx,
  tightenIx,
  vaultPda,
  type LoosenParams,
  type ProposalState,
  type RegistryEntryState,
  type TightenParams,
  type VaultState,
} from "./shield-client";
import { OwnerKind, ProposalKind, Route, type LoosenView, type ProposalView, type RegistryView, type TightenView, type VaultView } from "./views";

const isDefault = (k: PublicKey) => k.equals(PublicKey.default);

export function toVaultView(s: VaultState): VaultView {
  return {
    chain: "solana",
    address: s.address.toBase58(),
    authority: s.authority.toBase58(),
    usdc: s.usdcMint.toBase58(),
    riskVerifier: isDefault(s.riskVerifier) ? null : s.riskVerifier.toBase58(),
    protectedFloor: s.protectedFloor,
    topUpThresholdBps: s.topUpThresholdBps,
    emergencyCap: s.emergencyCap,
    velocityThreshold: s.velocityThreshold,
    lossTriggerUsdc: s.lossTriggerUsdc,
    lossCooldownSecs: s.lossCooldownSecs,
    topUpCooldownSecs: s.topUpCooldownSecs,
    loosenCooldownSecs: s.loosenCooldownSecs,
    fullExitCooldownSecs: s.fullExitCooldownSecs,
    cooldownUntil: s.cooldownUntil,
    cooldownReason: s.cooldownReason,
    cooldownSetAt: s.cooldownSetAt,
    lastVerdictNonce: s.lastVerdictNonce,
    lastVerdictReason: s.lastVerdictReason,
    velocityBuckets: s.velocityBuckets,
    bucketStart: s.bucketStart,
    currentBucketIndex: s.currentBucketIndex,
    configVersion: s.configVersion,
    proposalNonceCounter: s.proposalNonceCounter,
    createdAt: s.createdAt,
  };
}

export function toRegistryView(r: RegistryEntryState): RegistryView {
  return { owner: r.owner.toBase58(), kind: r.kind === OwnerType.Cold ? OwnerKind.Cold : OwnerKind.Execution, route: Route.Evm, active: r.active, registeredAt: r.registeredAt, label: r.label };
}

export function toLoosenView(p: LoosenParams): LoosenView {
  const v: LoosenView = {};
  if (p.newProtectedFloor !== undefined) v.newProtectedFloor = p.newProtectedFloor;
  if (p.newTopUpThresholdBps !== undefined) v.newTopUpThresholdBps = p.newTopUpThresholdBps;
  if (p.newEmergencyCap !== undefined) v.newEmergencyCap = p.newEmergencyCap;
  if (p.newVelocityThreshold !== undefined) v.newVelocityThreshold = p.newVelocityThreshold;
  if (p.newLossTriggerUsdc !== undefined) v.newLossTriggerUsdc = p.newLossTriggerUsdc;
  if (p.newLossCooldownSecs !== undefined) v.newLossCooldownSecs = p.newLossCooldownSecs;
  if (p.newTopUpCooldownSecs !== undefined) v.newTopUpCooldownSecs = p.newTopUpCooldownSecs;
  if (p.newLoosenCooldownSecs !== undefined) v.newLoosenCooldownSecs = p.newLoosenCooldownSecs;
  if (p.newFullExitCooldownSecs !== undefined) v.newFullExitCooldownSecs = p.newFullExitCooldownSecs;
  if (p.newRiskVerifier !== undefined) v.newRiskVerifier = isDefault(p.newRiskVerifier) ? null : p.newRiskVerifier.toBase58();
  if (p.registerOwner) {
    v.registerOwner = p.registerOwner.toBase58();
    v.registerKind = p.registerKind === OwnerType.Cold ? OwnerKind.Cold : OwnerKind.Execution;
    v.registerRoute = Route.Evm;
    v.registerLabel = p.registerLabel ?? "";
  }
  return v;
}

export function toProposalView(p: ProposalState): ProposalView {
  const a = p.action;
  const action: ProposalView["action"] =
    a.kind === "loosen" ? { kind: "loosen", params: toLoosenView(a.params) }
    : a.kind === "topUp" ? { kind: "topUp", destinationOwner: a.destinationOwner.toBase58(), amount: a.amount }
    : a.kind === "uninstallVault" ? { kind: "uninstallVault", destinationOwner: a.destinationOwner.toBase58() }
    : { kind: "coldTransferAboveCap", destinationOwner: a.destinationOwner.toBase58(), amount: a.amount };
  return { id: p.address.toBase58(), category: p.category as unknown as ProposalKind, action, nonce: p.nonce, createdAt: p.createdAt, executeAfter: p.executeAfter, expiry: p.expiry, configVersionAtCreation: p.configVersionAtCreation };
}

function fromLoosenView(v: LoosenView): LoosenParams {
  const p: LoosenParams = {};
  if (v.newProtectedFloor !== undefined) p.newProtectedFloor = v.newProtectedFloor;
  if (v.newTopUpThresholdBps !== undefined) p.newTopUpThresholdBps = v.newTopUpThresholdBps;
  if (v.newEmergencyCap !== undefined) p.newEmergencyCap = v.newEmergencyCap;
  if (v.newVelocityThreshold !== undefined) p.newVelocityThreshold = v.newVelocityThreshold;
  if (v.newLossTriggerUsdc !== undefined) p.newLossTriggerUsdc = v.newLossTriggerUsdc;
  if (v.newLossCooldownSecs !== undefined) p.newLossCooldownSecs = v.newLossCooldownSecs;
  if (v.newTopUpCooldownSecs !== undefined) p.newTopUpCooldownSecs = v.newTopUpCooldownSecs;
  if (v.newLoosenCooldownSecs !== undefined) p.newLoosenCooldownSecs = v.newLoosenCooldownSecs;
  if (v.newFullExitCooldownSecs !== undefined) p.newFullExitCooldownSecs = v.newFullExitCooldownSecs;
  if (v.newRiskVerifier !== undefined) p.newRiskVerifier = v.newRiskVerifier === null ? PublicKey.default : new PublicKey(v.newRiskVerifier);
  if (v.registerOwner) {
    p.registerOwner = new PublicKey(v.registerOwner);
    p.registerKind = v.registerKind === OwnerKind.Cold ? OwnerType.Cold : OwnerType.Execution;
    p.registerLabel = v.registerLabel ?? "";
  }
  return p;
}

function fromTightenView(v: TightenView): TightenParams {
  const p: TightenParams = {};
  if (v.newProtectedFloor !== undefined) p.newProtectedFloor = v.newProtectedFloor;
  if (v.newTopUpThresholdBps !== undefined) p.newTopUpThresholdBps = v.newTopUpThresholdBps;
  if (v.newEmergencyCap !== undefined) p.newEmergencyCap = v.newEmergencyCap;
  if (v.newVelocityThreshold !== undefined) p.newVelocityThreshold = v.newVelocityThreshold;
  if (v.newLossTriggerUsdc !== undefined) p.newLossTriggerUsdc = v.newLossTriggerUsdc;
  if (v.newLossCooldownSecs !== undefined) p.newLossCooldownSecs = v.newLossCooldownSecs;
  if (v.newTopUpCooldownSecs !== undefined) p.newTopUpCooldownSecs = v.newTopUpCooldownSecs;
  if (v.newLoosenCooldownSecs !== undefined) p.newLoosenCooldownSecs = v.newLoosenCooldownSecs;
  if (v.newFullExitCooldownSecs !== undefined) p.newFullExitCooldownSecs = v.newFullExitCooldownSecs;
  if (v.pauseTopUpsUntil !== undefined) p.pauseTopUpsUntil = v.pauseTopUpsUntil;
  if (v.setRiskVerifier !== undefined) p.setRiskVerifier = new PublicKey(v.setRiskVerifier);
  return p;
}

export interface InitView {
  riskVerifier: string | null;
  protectedFloor: bigint;
  topUpThresholdBps: number;
  emergencyCap: bigint;
  velocityThreshold: bigint;
  lossTriggerUsdc: bigint;
  lossCooldownSecs: bigint;
}

export interface RegistrationInput {
  owner: string;
  kind: OwnerKind;
  route: Route;
  label: string;
}

/** Instruction builders for one authority. `usdcMint` is needed for ATA derivation. */
export function solanaActions(authority: PublicKey, usdcMint: PublicKey) {
  const [vault] = vaultPda(authority);
  const ata = (owner: PublicKey) => getAssociatedTokenAddressSync(usdcMint, owner, true);
  const ensureAta = (owner: PublicKey) => createAssociatedTokenAccountIdempotentInstruction(authority, ata(owner), owner, usdcMint);
  const kindOf = (k: OwnerKind) => (k === OwnerKind.Cold ? OwnerType.Cold : OwnerType.Execution);
  return {
    vault,
    activate: (p: InitView, regs: RegistrationInput[]): TransactionInstruction[] => {
      const ixs: TransactionInstruction[] = [
        initializeVaultIx({ authority, usdcMint, riskVerifier: p.riskVerifier ? new PublicKey(p.riskVerifier) : PublicKey.default, protectedFloor: p.protectedFloor, topUpThresholdBps: p.topUpThresholdBps, emergencyCap: p.emergencyCap, velocityThreshold: p.velocityThreshold, lossTriggerUsdc: p.lossTriggerUsdc, lossCooldownSecs: p.lossCooldownSecs }),
      ];
      for (const r of regs) {
        const owner = new PublicKey(r.owner);
        ixs.push(registerOwnerIx({ authority, vault, owner, kind: kindOf(r.kind), label: r.label }));
        if (r.kind === OwnerKind.Execution) ixs.push(ensureAta(owner));
      }
      return ixs;
    },
    deposit: (amount: bigint): TransactionInstruction[] => [depositIx({ depositor: authority, vault, sourceTokenAccount: ata(authority), amount })],
    registerOwner: (r: RegistrationInput): TransactionInstruction[] => [registerOwnerIx({ authority, vault, owner: new PublicKey(r.owner), kind: kindOf(r.kind), label: r.label })],
    removeRegistration: (owner: string): TransactionInstruction[] => [removeRegistrationIx({ authority, vault, owner: new PublicKey(owner) })],
    tighten: (t: TightenView): TransactionInstruction[] => [tightenIx({ authority, vault, ...fromTightenView(t) })],
    proposeLoosen: (l: LoosenView): TransactionInstruction[] => [proposeLoosenIx({ authority, vault, ...fromLoosenView(l) })],
    executeRuleChange: (registerOwner?: string): TransactionInstruction[] => [registerOwner ? executeRuleChangeWithRegistrationIx({ authority, vault, owner: new PublicKey(registerOwner) }) : executeRuleChangeIx({ authority, vault })],
    cancelProposal: (category: ProposalKind): TransactionInstruction[] => [cancelProposalIx({ authority, vault, category: category as unknown as ProposalCategory })],
    instantTopUp: (dest: string, amount: bigint): TransactionInstruction[] => {
      const owner = new PublicKey(dest);
      return [ensureAta(owner), instantTopUpIx({ authority, vault, destinationOwner: owner, destinationTokenAccount: ata(owner), amount })];
    },
    proposeTopUp: (dest: string, amount: bigint): TransactionInstruction[] => [proposeTopUpIx({ authority, vault, destinationOwner: new PublicKey(dest), amount })],
    executeTopUp: (dest: string): TransactionInstruction[] => {
      const owner = new PublicKey(dest);
      return [ensureAta(owner), executeTopUpIx({ authority, vault, destinationOwner: owner, destinationTokenAccount: ata(owner) })];
    },
    instantColdTransfer: (dest: string, amount: bigint): TransactionInstruction[] => {
      const owner = new PublicKey(dest);
      return [ensureAta(owner), instantColdTransferIx({ authority, vault, destinationOwner: owner, destinationTokenAccount: ata(owner), amount })];
    },
    proposeColdTransferAboveCap: (dest: string, amount: bigint): TransactionInstruction[] => [proposeColdTransferAboveCapIx({ authority, vault, destinationOwner: new PublicKey(dest), amount })],
    proposeUninstallVault: (dest: string): TransactionInstruction[] => [proposeUninstallVaultIx({ authority, vault, destinationOwner: new PublicKey(dest) })],
    executeFullExit: (dest: string): TransactionInstruction[] => {
      const owner = new PublicKey(dest);
      return [ensureAta(owner), executeFullExitIx({ authority, vault, destinationOwner: owner, destinationTokenAccount: ata(owner) })];
    },
  };
}
