import { useCallback, useState } from "react";
import type { TransactionInstruction } from "@solana/web3.js";
import { ShieldTxError, useShield } from "./shield";
import { useToast } from "../components/ui";
import type { ShieldErrorName } from "../../../client/shield-client";

export const ERROR_COPY: Record<ShieldErrorName, string> = {
  Unauthorized: "Only the vault owner can do this.",
  ZeroAmount: "Enter an amount.",
  InvalidParameter: "That value is outside the allowed range.",
  AlreadyRegisteredDifferentType: "That address already has a permanent type and can't be re-registered differently.",
  VaultFundedUseDelayedPath: "Your vault is funded, so adding a destination is a weakening change and waits.",
  DestinationNotExecution: "That destination isn't an active trading wallet.",
  DestinationNotCold: "That destination isn't an active cold wallet.",
  AmountExceedsEmergencyCap: "Above the instant cold-transfer cap. Larger amounts take the exit path.",
  VelocityThresholdExceeded: "This would exceed your 24-hour top-up limit.",
  CooldownActive: "A cooldown is active. No top-up can move until it ends.",
  ProtectedFloorBreached: "This would take the treasury below your protected floor.",
  AmountRequiresGatedTopUp: "Large top-up: it has to wait the pause you set.",
  ProposalNotMatured: "Not yet. The waiting period hasn't finished.",
  ProposalExpired: "This change expired. Propose it again.",
  ProposalStale: "You tightened something since proposing this, so it no longer applies. Propose it again if you still want it.",
  NoPendingProposal: "There's nothing pending here.",
  ProposalRequiresRegistrationPath: "This change registers a destination; use the registration action.",
  ProposalHasNoRegistration: "This change has no destination to register.",
  NoRiskVerifier: "No monitor is configured.",
  InvalidVerifier: "The verdict wasn't signed by your pinned monitor.",
  VerdictExpired: "That verdict has expired.",
  VerdictNotYetValid: "That verdict is dated in the future.",
  VerdictWrongBinding: "That verdict is for a different vault.",
  VerdictReplayed: "That verdict was already used.",
  VerdictBelowLossTrigger: "The attested loss is below your trigger, so the vault rejected it.",
  NotATightening: "That change would weaken protection, so it can't apply instantly.",
  NotALoosening: "That change strengthens protection; apply it instantly instead.",
  PauseTooLong: "Pauses are capped at 30 days.",
  MathOverflow: "Arithmetic overflow.",
  WrongMint: "Wrong token for this vault.",
  TokenAccountOwnerMismatch: "That token account isn't owned by the registered address.",
  CannotDowngradeExecutionToCold: "A trading wallet can never become a cold wallet.",
  FullExitDestinationNotRegisteredCold: "Exits can only go to a registered cold wallet.",
};

export function describeError(e: unknown): { text: string; name: ShieldErrorName | null; sig: string | null } {
  if (e instanceof ShieldTxError) {
    return { text: e.shieldError ? ERROR_COPY[e.shieldError] : e.message, name: e.shieldError, sig: e.signature };
  }
  const msg = e instanceof Error ? e.message : String(e);
  if (/user rejected|rejected the request/i.test(msg)) return { text: "Signature cancelled in your wallet.", name: null, sig: null };
  return { text: msg.length > 160 ? `${msg.slice(0, 160)}…` : msg, name: null, sig: null };
}

/** Run a transaction with busy state + toasts. Returns the signature or null. */
export function useAction() {
  const { sendTx } = useShield();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const run = useCallback(
    async (label: string, ixs: TransactionInstruction[], opts: { silent?: boolean; recordRejection?: boolean } = {}): Promise<string | null> => {
      setBusy(label);
      try {
        const sig = await sendTx(ixs, { recordRejection: opts.recordRejection });
        if (!opts.silent) toast.ok(label, sig);
        return sig;
      } catch (e) {
        const d = describeError(e);
        if (!opts.silent) toast.err(d.text, d.sig);
        throw e;
      } finally {
        setBusy(null);
      }
    },
    [sendTx, toast]
  );

  return { run, busy };
}
