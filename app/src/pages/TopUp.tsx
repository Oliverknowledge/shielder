import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PublicKey } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { AnimatePresence, motion } from "motion/react";
import { useShield, ShieldTxError } from "../lib/shield";
import { useAction, describeError } from "../lib/actions";
import { Countdown, Dot, ExplorerLink, Icon, MoneyInput } from "../components/ui";
import { FlowScene } from "../components/FlowScene";
import { usd, usdInput, clockTime, spanAdjective, hoursLabel } from "../lib/format";
import { recordAttempt } from "../lib/attempts";
import {
  evaluateTopUp,
  rollingVelocity,
  instantTopUpIx,
  proposeTopUpIx,
  executeTopUpIx,
  cancelProposalIx,
  tightenIx,
  usdcToRaw,
  rawToUsdc,
  ProposalCategory,
  OwnerType,
  COOLDOWN_REASON,
  type ShieldErrorName,
} from "../../../client/shield-client";

type Phase = "idle" | "moving" | "done" | "blocked";

const card = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
  transition: { duration: 0.22, ease: [0.2, 0.8, 0.2, 1] as const },
};

export function TopUp() {
  const { vault, balance, wallets, proposals, server, now, signer, vaultAddress } = useShield();
  const { run, busy } = useAction();
  const executionWallets = wallets.filter((w) => w.kind === OwnerType.Execution && w.active);
  const [dest, setDest] = useState<string>(executionWallets[0]?.owner ?? "");
  const [amount, setAmount] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [blocked, setBlocked] = useState<{ reason: ShieldErrorName | null; sig: string | null; amount: bigint } | null>(null);
  const [scheduled, setScheduled] = useState(false);
  const [sent, setSent] = useState<bigint>(0n);

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
  const byRule = vault.cooldownReason === COOLDOWN_REASON.RISK_VERDICT;
  const destWallet = executionWallets.find((w) => w.owner === dest);
  const destLabel = destWallet?.label ?? "your trading wallet";

  const chips = [100, 250, 500, 1000, 2000].filter((c) => usdcToRaw(c) <= balance);

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
      setSent(amountRaw);
      setPhase("done");
    } catch (e) {
      const d = describeError(e);
      if (e instanceof ShieldTxError && e.shieldError === "AmountRequiresGatedTopUp") {
        try {
          await run(`Top-up of ${usd(amountRaw)} scheduled`, [proposeTopUpIx({ authority: signer.publicKey, vault: vaultAddress, destinationOwner: owner, amount: amountRaw })], { silent: true });
          setScheduled(true);
          setPhase("idle");
          return;
        } catch {
          /* fall through */
        }
      }
      recordAttempt(vaultAddress.toBase58(), { ts: now, amount: amountRaw.toString(), reason: d.name, sig: d.sig, destinationLabel: destWallet.label });
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
      setSent(pendingTopUp.action.amount);
      setPhase("done");
    } catch (e) {
      const d = describeError(e);
      setBlocked({ reason: d.name, sig: d.sig, amount: pendingTopUp.action.amount });
      setPhase("blocked");
    }
  };

  const extendPause = async (hours: number) => {
    const base = Math.max(Number(vault.cooldownUntil), now);
    await run(`Pause extended by ${hours} hours`, [tightenIx({ authority: signer.publicKey, vault: vaultAddress, pauseTopUpsUntil: BigInt(base + hours * 3600) })]).catch(() => null);
  };

  const preview = (() => {
    if (amountRaw <= 0n) {
      if (cooldownActive) return { tone: "blocked", icon: "lock" as const, text: <>Top-ups are paused until <b>{clockTime(Number(vault.cooldownUntil), now)}</b>{byRule ? " by your loss rule" : " by you"}.</> };
      const can = remainingToday < headroom ? remainingToday : headroom;
      if (can === 0n) return { tone: "neutral", icon: "clock" as const, text: <>Nothing can move right now: {remainingToday === 0n ? "today's limit is used up" : "everything above your floor is out"}.</> };
      return { tone: "neutral", icon: "check" as const, text: <><b>{usd(can)}</b> available today · instant below {usd(decision.instantThreshold)}.</> };
    }
    if (decision.path === "instant") return { tone: "protect", icon: "check" as const, text: <>Moves instantly. <span className="muted">{usd(remainingToday - amountRaw)} of today's limit left after this.</span></> };
    if (decision.path === "gated") return { tone: "pending", icon: "clock" as const, text: <>Large top-up: waits <b>30 minutes</b> before it can move. Your treasury stays protected until then.</> };
    if (decision.reason === "CooldownActive") return { tone: "blocked", icon: "lock" as const, text: <>Will be blocked: top-ups are paused until <b>{clockTime(Number(vault.cooldownUntil), now)}</b>.</> };
    if (decision.reason === "VelocityThresholdExceeded") return { tone: "blocked", icon: "lock" as const, text: <>Over today's limit: only <b>{usd(remainingToday)}</b> of your {usd(vault.velocityThreshold)} is left.</> };
    if (decision.reason === "ProtectedFloorBreached") return { tone: "blocked", icon: "lock" as const, text: <>Would breach your floor: only <b>{usd(headroom)}</b> sits above {usd(vault.protectedFloor)}.</> };
    return { tone: "blocked", icon: "lock" as const, text: <>Will be blocked.</> };
  })();

  return (
    <main className="page page-narrow fade-in">
      <div className="page-head">
        <p className="eyebrow">Top up</p>
        <h1>Refill {destLabel}</h1>
      </div>

      <section className="card">
        <FlowScene treasury={balance} bankroll={destWallet?.usdc ?? null} amount={blocked?.amount ?? (phase === "done" ? sent : amountRaw)} phase={phase} bankrollLabel={destWallet?.label ?? "Trading wallet"} />
      </section>

      <AnimatePresence mode="wait">
        {blocked ? (
          <motion.section key="blocked" className="card card-tone-blocked" style={{ marginTop: 16 }} {...card}>
            <div className="row" style={{ gap: 8 }}>
              <Dot tone="blocked" />
              <span className="eyebrow c-blocked">Top-up blocked</span>
            </div>
            <h2 className="title-l" style={{ marginTop: 10 }}>{usd(blocked.amount)} stays protected.</h2>
            <BlockedReason reason={blocked.reason} amount={blocked.amount} />
            <div className="two-up" style={{ marginTop: 18 }}>
              <div>
                <div className="k">Still in the treasury</div>
                <div className="v">{usd(balance)}</div>
              </div>
              {blocked.reason === "CooldownActive" ? (
                <div>
                  <div className="k">Top up again in</div>
                  <div className="v"><Countdown until={vault.cooldownUntil} now={now} /></div>
                </div>
              ) : blocked.reason === "VelocityThresholdExceeded" ? (
                <div>
                  <div className="k">Left of today's limit</div>
                  <div className="v">{usd(remainingToday)}</div>
                </div>
              ) : (
                <div>
                  <div className="k">Protected floor</div>
                  <div className="v">{usd(vault.protectedFloor)}</div>
                </div>
              )}
            </div>
            <LossEvidence />
            <p className="small dim" style={{ marginTop: 14 }}>This is the rule you set while calm, doing exactly what you asked. Nothing was lost: the money never left.</p>
            <div className="row wrap" style={{ marginTop: 16, gap: 8 }}>
              <Link to="/behaviour" className="btn btn-secondary">See what happened</Link>
              {blocked.reason === "CooldownActive" && (
                <button className="btn btn-secondary" disabled={!!busy} onClick={() => void extendPause(24)}>
                  <Icon name="bolt" size={16} /> Extend the pause 24h
                </button>
              )}
              <button className="btn btn-ghost" onClick={() => { setBlocked(null); setPhase("idle"); }}>Back</button>
            </div>
            {blocked.sig && (
              <p className="tiny muted" style={{ marginTop: 12 }}>
                Rejected by the vault program on-chain · <ExplorerLink sig={blocked.sig} />
              </p>
            )}
          </motion.section>
        ) : scheduled && pendingTopUp && pendingTopUp.action.kind === "topUp" ? (
          <motion.section key="scheduled" className="card card-tone-pending" style={{ marginTop: 16 }} {...card}>
            <div className="row" style={{ gap: 8 }}>
              <Dot tone="pending" />
              <span className="eyebrow c-pending">Scheduled</span>
            </div>
            <h2 className="title-l" style={{ marginTop: 10 }}>{usd(pendingTopUp.action.amount)} moves in <Countdown until={pendingTopUp.executeAfter} now={now} />.</h2>
            <p className="dim" style={{ marginTop: 8 }}>Large top-ups wait 30 minutes. Your treasury stays protected until then, and you can cancel any time.</p>
            <div className="row" style={{ marginTop: 16 }}>
              <button className="btn btn-ghost" disabled={!!busy} onClick={() => void run("Top-up cancelled", [cancelProposalIx({ authority: signer.publicKey, vault: vaultAddress, category: ProposalCategory.TopUp })]).then(() => setScheduled(false)).catch(() => null)}>
                Cancel it
              </button>
            </div>
          </motion.section>
        ) : phase === "done" ? (
          <motion.section key="done" className="card card-tone-protect" style={{ marginTop: 16 }} {...card}>
            <div className="row" style={{ gap: 14 }}>
              <span className="check-circle"><Icon name="check" size={22} /></span>
              <div>
                <h2 className="title">Sent {usd(sent)} to {destLabel}</h2>
                <p className="dim" style={{ marginTop: 2 }}>{usd(remainingToday)} of today's limit left. Trade well.</p>
              </div>
            </div>
            <button className="btn btn-ghost" style={{ marginTop: 14 }} onClick={() => { setPhase("idle"); setAmount(""); }}>Top up again</button>
          </motion.section>
        ) : (
          <motion.section key="form" className="card" style={{ marginTop: 16 }} {...card}>
            <div className="stack">
              {executionWallets.length > 1 && (
                <div className="chips" style={{ justifyContent: "center" }}>
                  {executionWallets.map((w) => (
                    <button key={w.owner} className={`chip ${dest === w.owner ? "active" : ""}`} onClick={() => setDest(w.owner)}>{w.label}</button>
                  ))}
                </div>
              )}
              <MoneyInput variant="hero" value={amount} onChange={setAmount} autoFocus />
              <div className="chips" style={{ justifyContent: "center" }}>
                {chips.map((c) => (
                  <button key={c} className={`chip ${Number(amount) === c ? "active" : ""}`} onClick={() => setAmount(String(c))}>{usd(c)}</button>
                ))}
                {maxInstant > 0n && !cooldownActive && <button className="chip" onClick={() => setAmount(usdInput(rawToUsdc(maxInstant)).replace(/,/g, ""))}>Max instant {usd(maxInstant)}</button>}
              </div>
              <div className={`strip strip-${preview.tone}`}>
                <Icon name={preview.icon} size={18} />
                <div className="grow">{preview.text}</div>
              </div>
              <button className="btn btn-lg btn-block" disabled={!!busy || amountRaw <= 0n || !destWallet || (!!pendingTopUp && decision.path === "gated")} onClick={() => void submit()}>
                {busy ? "Confirming…" : amountRaw > 0n ? (decision.path === "gated" ? `Schedule ${usd(amountRaw)}` : `Top up ${usd(amountRaw)}`) : "Top up"}
              </button>
              {pendingTopUp && decision.path === "gated" && <p className="tiny muted" style={{ textAlign: "center" }}>One scheduled top-up at a time. Cancel the pending one first.</p>}
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {pendingTopUp && pendingTopUp.action.kind === "topUp" && !scheduled && !blocked && (
        <section className="panel" style={{ marginTop: 16 }}>
          <div className="row-between wrap">
            <div style={{ minWidth: 0 }}>
              <div className="row" style={{ gap: 8 }}>
                <Dot tone="pending" />
                <span style={{ fontWeight: 600 }}>{usd(pendingTopUp.action.amount)} scheduled</span>
              </div>
              <p className="small dim" style={{ marginTop: 2 }}>
                {Number(pendingTopUp.executeAfter) <= now && !cooldownActive ? "Ready to move." : <>Moves in <b className="num"><Countdown until={cooldownActive && vault.cooldownUntil > pendingTopUp.executeAfter ? vault.cooldownUntil : pendingTopUp.executeAfter} now={now} format="compact" /></b></>}
              </p>
            </div>
            <div className="actions">
              <button className="btn btn-sm" disabled={!!busy || Number(pendingTopUp.executeAfter) > now || cooldownActive} onClick={() => void executePending()}>Move it</button>
              <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => void run("Top-up cancelled", [cancelProposalIx({ authority: signer.publicKey, vault: vaultAddress, category: ProposalCategory.TopUp })]).catch(() => null)}>Cancel</button>
            </div>
          </div>
        </section>
      )}

      {!blocked && phase !== "done" && (
        <p className="tiny muted" style={{ marginTop: 14, textAlign: "center" }}>
          {usd(remainingToday)} of today's {usd(vault.velocityThreshold)} left · {usd(headroom)} above your floor
          {server && Number(server.profile.windows.h24.realisedLoss) > 0 ? ` · ${usd(server.profile.windows.h24.realisedLoss)} lost in the last 24h (trigger ${usd(vault.lossTriggerUsdc)})` : ""}
        </p>
      )}
    </main>
  );
}

function hoursSince(ts: number, now: number): string {
  const h = Math.max(1, Math.ceil((now - ts) / 3600));
  return h === 1 ? "the last hour" : `the last ${h} hours`;
}

function BlockedReason({ reason, amount }: { reason: ShieldErrorName | null; amount: bigint }) {
  const { vault, server, now } = useShield();
  if (!vault) return null;
  const h24 = server?.profile.windows.h24;
  const loss = h24 && Number(h24.realisedLoss) > 0 ? h24.realisedLoss : null;
  const firstLoss = server?.profile.sessions.filter((s) => s.realised && s.isLoss && s.lastActivityAt >= now - 86400).sort((a, b) => a.openedAt - b.openedAt)[0];
  const lead = (text: React.ReactNode) => <p className="lead" style={{ marginTop: 8, color: "var(--ink)" }}>{text}</p>;
  if (reason === "CooldownActive") {
    if (vault.cooldownReason === COOLDOWN_REASON.RISK_VERDICT) {
      return lead(
        <>
          {loss ? <>You've realised <b className="num">{usd(loss)}</b> in losses in {firstLoss ? hoursSince(firstLoss.openedAt, now) : "the last 24 hours"}.</> : <>Your trading wallet sent back less than you sent it.</>} Your {spanAdjective(vault.lossCooldownSecs)} cooldown is active until {clockTime(Number(vault.cooldownUntil), now)}.
        </>
      );
    }
    return lead(<>You paused top-ups yourself until {clockTime(Number(vault.cooldownUntil), now)}. Pauses only end by time.</>);
  }
  if (reason === "VelocityThresholdExceeded") {
    const velocity = rollingVelocity(vault, BigInt(now));
    return lead(<>You've already sent <b className="num">{usd(velocity)}</b> to trading in the last 24 hours. Your limit is {usd(vault.velocityThreshold)}, however it's split.</>);
  }
  if (reason === "ProtectedFloorBreached") {
    return lead(<>{usd(amount)} would take your treasury below the <b className="num">{usd(vault.protectedFloor)}</b> you chose to protect. Lowering the floor waits {hoursLabel(vault.loosenCooldownSecs)}.</>);
  }
  return lead(reason ? `The vault rejected this: ${reason}.` : "The transaction failed.");
}

function LossEvidence() {
  const { server, wallets, now } = useShield();
  if (!server) return null;
  const sessions = server.profile.sessions.filter((s) => s.realised && s.isLoss && s.lastActivityAt >= now - 86400).sort((a, b) => b.lastActivityAt - a.lastActivityAt).slice(0, 2);
  const verdict = server.verdicts[0];
  if (sessions.length === 0 && !verdict) return null;
  const labelOf = (owner: string) => wallets.find((w) => w.owner === owner)?.label ?? `${owner.slice(0, 4)}…`;
  return (
    <div className="notice-list" style={{ marginTop: 16 }}>
      {sessions.map((s, i) => (
        <div key={i} className="notice small">
          <Dot tone="blocked" />
          <span>
            Sent <b className="num">{usd(s.sent)}</b> to {labelOf(s.wallet)}, <b className="num">{usd(s.returned)}</b> came back · {s.signatures[s.signatures.length - 1] && <ExplorerLink sig={s.signatures[s.signatures.length - 1]} />}
          </span>
        </div>
      ))}
      {verdict && (
        <div className="notice small">
          <Dot tone="neutral" />
          <span>
            Verdict #{verdict.verdict.nonce} from {verdict.source === "cre" ? "the Chainlink CRE enclave" : "the Shield monitor"} attested {usd(verdict.verdict.realizedLossUsdc)} · {verdict.signature && <ExplorerLink sig={verdict.signature} />}
          </span>
        </div>
      )}
    </div>
  );
}
