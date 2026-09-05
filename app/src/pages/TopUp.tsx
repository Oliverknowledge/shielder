import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PublicKey } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { AnimatePresence, motion } from "motion/react";
import { useShield, ShieldTxError } from "../lib/shield";
import { useAction, describeError } from "../lib/actions";
import { Countdown, MoneyInput, Pill, ExplorerLink } from "../components/ui";
import { FlowScene } from "../components/FlowScene";
import { usd, duration, hoursLabel, usdInput } from "../lib/format";
import {
  evaluateTopUp,
  rollingVelocity,
  instantTopUpIx,
  proposeTopUpIx,
  executeTopUpIx,
  cancelProposalIx,
  usdcToRaw,
  rawToUsdc,
  ProposalCategory,
  OwnerType,
  COOLDOWN_REASON,
  type ShieldErrorName,
} from "../../../client/shield-client";

type Phase = "idle" | "moving" | "done" | "blocked";

export function TopUp() {
  const { vault, balance, wallets, proposals, server, now, signer, vaultAddress } = useShield();
  const { run, busy } = useAction();
  const executionWallets = wallets.filter((w) => w.kind === OwnerType.Execution && w.active);
  const [dest, setDest] = useState<string>(executionWallets[0]?.owner ?? "");
  const [amount, setAmount] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [blocked, setBlocked] = useState<{ reason: ShieldErrorName | null; sig: string | null; amount: bigint } | null>(null);
  const [scheduled, setScheduled] = useState(false);

  useEffect(() => {
    if (!dest && executionWallets[0]) setDest(executionWallets[0].owner);
  }, [executionWallets, dest]);

  if (!vault || !signer || !vaultAddress) return null;

  const amountRaw = usdcToRaw(Number(amount || 0));
  const decision = useMemo(() => evaluateTopUp(vault, balance, amountRaw, BigInt(now)), [vault, balance, amountRaw, now]);
  const velocity = rollingVelocity(vault, BigInt(now));
  const remainingToday = vault.velocityThreshold > velocity ? vault.velocityThreshold - velocity : 0n;
  const headroom = balance > vault.protectedFloor ? balance - vault.protectedFloor : 0n;
  const maxInstant = [decision.instantThreshold > 0n ? decision.instantThreshold - 1n : 0n, remainingToday, headroom].reduce((a, b) => (a < b ? a : b));
  const pendingTopUp = proposals.find((p) => p.category === ProposalCategory.TopUp);
  const cooldownActive = Number(vault.cooldownUntil) > now;
  const destWallet = executionWallets.find((w) => w.owner === dest);
  const h24 = server?.profile.windows.h24;

  const chips = [100, 250, 500, 1000, 2000, 3800].filter((c) => usdcToRaw(c) <= balance);

  const submit = async () => {
    if (!destWallet || amountRaw <= 0n) return;
    const owner = new PublicKey(destWallet.owner);
    const ata = getAssociatedTokenAddressSync(vault.usdcMint, owner, true);
    const ensureAta = createAssociatedTokenAccountIdempotentInstruction(signer.publicKey, ata, owner, vault.usdcMint);
    setBlocked(null);
    setScheduled(false);
    setPhase("moving");
    try {
      if (decision.path === "gated") {
        await run(`Top-up of ${usd(amountRaw)} scheduled`, [proposeTopUpIx({ authority: signer.publicKey, vault: vaultAddress, destinationOwner: owner, amount: amountRaw })], { silent: true });
        setScheduled(true);
        setPhase("idle");
        return;
      }
      await run(`Sent ${usd(amountRaw)} to ${destWallet.label}`, [ensureAta, instantTopUpIx({ authority: signer.publicKey, vault: vaultAddress, destinationOwner: owner, destinationTokenAccount: ata, amount: amountRaw })], {
        silent: true,
        recordRejection: true,
      });
      setPhase("done");
    } catch (e) {
      const d = describeError(e);
      if (e instanceof ShieldTxError && e.shieldError === "AmountRequiresGatedTopUp") {
        // the chain disagrees with the local preview (balance moved): route to the gated path
        try {
          await run(`Top-up of ${usd(amountRaw)} scheduled`, [proposeTopUpIx({ authority: signer.publicKey, vault: vaultAddress, destinationOwner: owner, amount: amountRaw })], { silent: true });
          setScheduled(true);
          setPhase("idle");
          return;
        } catch {
          /* fall through */
        }
      }
      setBlocked({ reason: d.name, sig: d.sig, amount: amountRaw });
      setPhase("blocked");
    }
  };

  const executePending = async () => {
    if (!pendingTopUp || pendingTopUp.action.kind !== "topUp") return;
    const owner = pendingTopUp.action.destinationOwner;
    const ata = getAssociatedTokenAddressSync(vault.usdcMint, owner, true);
    setPhase("moving");
    try {
      await run(`Sent ${usd(pendingTopUp.action.amount)}`, [
        createAssociatedTokenAccountIdempotentInstruction(signer.publicKey, ata, owner, vault.usdcMint),
        executeTopUpIx({ authority: signer.publicKey, vault: vaultAddress, destinationOwner: owner, destinationTokenAccount: ata }),
      ]);
      setPhase("done");
    } catch (e) {
      const d = describeError(e);
      setBlocked({ reason: d.name, sig: d.sig, amount: pendingTopUp.action.amount });
      setPhase("blocked");
    }
  };

  const previewLabel = (() => {
    if (amountRaw <= 0n) return null;
    if (decision.path === "instant") return { tone: "protect" as const, text: "Moves instantly" };
    if (decision.path === "gated") return { tone: "pending" as const, text: `Large top-up: waits ${duration(Number(vault.topUpCooldownSecs))}` };
    const map: Record<string, string> = {
      CooldownActive: "Blocked: cooldown active",
      VelocityThresholdExceeded: "Blocked: over your daily limit",
      ProtectedFloorBreached: "Blocked: below your protected floor",
    };
    return { tone: "blocked" as const, text: map[decision.reason ?? ""] ?? "Blocked" };
  })();

  return (
    <main className="page page-narrow fade-in">
      <div style={{ marginBottom: 18 }}>
        <p className="eyebrow">Top up</p>
        <h1 className="title" style={{ marginTop: 4 }}>Move capital to your trading wallet</h1>
      </div>

      <div className="card">
        <FlowScene treasury={balance} bankroll={destWallet?.usdc ?? null} amount={blocked?.amount ?? amountRaw} phase={phase} bankrollLabel={destWallet?.label ?? "Trading bankroll"} />
      </div>

      <AnimatePresence mode="wait">
        {blocked ? (
          <motion.section key="blocked" className="card" style={{ marginTop: 16, borderColor: "#efc9c5" }} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <p className="eyebrow" style={{ color: "var(--blocked)" }}>Top-up blocked</p>
            <BlockedCopy reason={blocked.reason} amount={blocked.amount} />
            <div className="row" style={{ marginTop: 18, flexWrap: "wrap" }}>
              <Link to="/behaviour" className="btn btn-secondary btn-sm">See what happened</Link>
              <Link to="/protection" className="btn btn-sm">Tighten protection</Link>
              <button className="btn btn-ghost btn-sm" onClick={() => { setBlocked(null); setPhase("idle"); }}>Back</button>
            </div>
            {blocked.sig && (
              <p className="tiny muted" style={{ marginTop: 12 }}>
                The vault program rejected this on-chain: <ExplorerLink sig={blocked.sig} />
              </p>
            )}
          </motion.section>
        ) : scheduled && pendingTopUp && pendingTopUp.action.kind === "topUp" ? (
          <motion.section key="scheduled" className="card" style={{ marginTop: 16 }} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <p className="eyebrow" style={{ color: "var(--pending)" }}>Top-up scheduled</p>
            <div className="money-l" style={{ marginTop: 6 }}>{usd(pendingTopUp.action.amount)}</div>
            <p className="dim" style={{ marginTop: 6 }}>Large top-ups wait. This one can move in <b className="num"><Countdown until={pendingTopUp.executeAfter} now={now} /></b>. Your treasury stays protected until then.</p>
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => void run("Top-up cancelled", [cancelProposalIx({ authority: signer.publicKey, vault: vaultAddress, category: ProposalCategory.TopUp })]).then(() => setScheduled(false)).catch(() => null)}>
                Cancel it
              </button>
            </div>
          </motion.section>
        ) : phase === "done" ? (
          <motion.section key="done" className="card" style={{ marginTop: 16, borderColor: "#c4dfd2" }} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <p className="eyebrow" style={{ color: "var(--protect)" }}>Sent</p>
            <p className="dim" style={{ marginTop: 6 }}>Your bankroll is topped up. {usd(remainingToday)} of today’s limit remains.</p>
            <button className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => { setPhase("idle"); setAmount(""); }}>Another</button>
          </motion.section>
        ) : null}
      </AnimatePresence>

      {pendingTopUp && pendingTopUp.action.kind === "topUp" && !scheduled && (
        <section className="card" style={{ marginTop: 16 }}>
          <div className="row-between">
            <div>
              <p className="eyebrow">Scheduled top-up</p>
              <div className="money-m" style={{ marginTop: 4 }}>{usd(pendingTopUp.action.amount)}</div>
              <p className="small dim">{Number(pendingTopUp.executeAfter) <= now && !cooldownActive ? "Ready to move." : <>Can move in <Countdown until={cooldownActive && vault.cooldownUntil > pendingTopUp.executeAfter ? vault.cooldownUntil : pendingTopUp.executeAfter} now={now} format="compact" /></>}</p>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <button className="btn btn-sm" disabled={!!busy || Number(pendingTopUp.executeAfter) > now || cooldownActive} onClick={() => void executePending()}>Move it</button>
              <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => void run("Top-up cancelled", [cancelProposalIx({ authority: signer.publicKey, vault: vaultAddress, category: ProposalCategory.TopUp })]).catch(() => null)}>Cancel</button>
            </div>
          </div>
        </section>
      )}

      {!blocked && (
        <section className="card" style={{ marginTop: 16 }}>
          <div className="stack">
            {executionWallets.length > 1 && (
              <div className="chips">
                {executionWallets.map((w) => (
                  <button key={w.owner} className={`chip ${dest === w.owner ? "active" : ""}`} onClick={() => setDest(w.owner)}>{w.label}</button>
                ))}
              </div>
            )}
            <MoneyInput value={amount} onChange={setAmount} autoFocus />
            <div className="chips">
              {chips.map((c) => (
                <button key={c} className={`chip ${Number(amount) === c ? "active" : ""}`} onClick={() => setAmount(String(c))}>{usd(c)}</button>
              ))}
              {maxInstant > 0n && <button className="chip" onClick={() => setAmount(usdInput(rawToUsdc(maxInstant)).replace(/,/g, ""))}>Max instant {usd(maxInstant)}</button>}
            </div>
            <div className="row-between">
              <div className="small dim">
                {cooldownActive ? (
                  <>Cooldown ends in <b className="num"><Countdown until={vault.cooldownUntil} now={now} format="compact" /></b></>
                ) : (
                  <>{usd(remainingToday)} left today · instant below {usd(decision.instantThreshold)} · {usd(headroom)} above the floor</>
                )}
              </div>
              {previewLabel && <Pill tone={previewLabel.tone}>{previewLabel.text}</Pill>}
            </div>
            <button className="btn btn-lg btn-block" disabled={!!busy || amountRaw <= 0n || !destWallet || !!pendingTopUp && decision.path === "gated"} onClick={() => void submit()}>
              {busy ? "Confirming…" : amountRaw > 0n ? (decision.path === "gated" ? `Schedule ${usd(amountRaw)}` : `Top up ${usd(amountRaw)}`) : "Top up"}
            </button>
            {pendingTopUp && decision.path === "gated" && <p className="tiny muted">One scheduled top-up at a time. Cancel the pending one first.</p>}
          </div>
        </section>
      )}

      {h24 && Number(h24.realisedLoss) > 0 && !blocked && (
        <p className="tiny muted" style={{ marginTop: 14 }}>
          {usd(h24.realisedLoss)} realised in losses in the last 24 hours. Your loss trigger is {usd(vault.lossTriggerUsdc)}; pause length {hoursLabel(vault.lossCooldownSecs)}.
        </p>
      )}
    </main>
  );
}

function BlockedCopy({ reason, amount }: { reason: ShieldErrorName | null; amount: bigint }) {
  const { vault, balance, server, now } = useShield();
  if (!vault) return null;
  const h24 = server?.profile.windows.h24;
  const lossText = h24 && Number(h24.realisedLoss) > 0 ? `You realised ${usd(h24.realisedLoss)} in losses in the last 24 hours.` : null;
  if (reason === "CooldownActive") {
    const byRule = vault.cooldownReason === COOLDOWN_REASON.RISK_VERDICT;
    return (
      <div className="stack-s" style={{ marginTop: 6 }}>
        <p className="lead" style={{ color: "var(--ink)" }}>
          {byRule ? `${lossText ?? "Your trading wallet sent back less than you sent it."} Your Shield rule pauses top-ups for ${hoursLabel(vault.lossCooldownSecs)}.` : `You paused top-ups yourself.`}
        </p>
        <p className="dim"><b className="num">{usd(balance)}</b> remains protected. This isn’t an alert. The money cannot move.</p>
        <p className="dim">You can top up again in <b className="num"><Countdown until={vault.cooldownUntil} now={now} /></b>.</p>
      </div>
    );
  }
  if (reason === "VelocityThresholdExceeded") {
    const velocity = rollingVelocity(vault, BigInt(now));
    return (
      <div className="stack-s" style={{ marginTop: 6 }}>
        <p className="lead" style={{ color: "var(--ink)" }}>You’ve already moved {usd(velocity)} to trading in the last 24 hours. Your limit is {usd(vault.velocityThreshold)}.</p>
        <p className="dim">{usd(amount)} would take you over it, however it’s split. Capacity comes back as the 24-hour window rolls.</p>
      </div>
    );
  }
  if (reason === "ProtectedFloorBreached") {
    return (
      <div className="stack-s" style={{ marginTop: 6 }}>
        <p className="lead" style={{ color: "var(--ink)" }}>{usd(amount)} would take your treasury below the {usd(vault.protectedFloor)} you chose to protect.</p>
        <p className="dim">Lowering the floor is a weakening change: it waits {hoursLabel(vault.loosenCooldownSecs)}.</p>
      </div>
    );
  }
  return <p className="lead" style={{ marginTop: 6 }}>{reason ? `The vault rejected this: ${reason}.` : "The transaction failed."}</p>;
}
