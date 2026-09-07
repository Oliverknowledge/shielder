import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { GetMeSafe, ResetScreen } from "../components/Safety";
import { WhatHappened } from "../components/WhatHappened";
import { useVenue } from "../lib/venue";
import { usePrefs } from "../lib/prefs";
import { useAttempts } from "../lib/attempts";
import { useShield, ShieldTxError } from "../lib/shield";
import { useAction, describeError } from "../lib/actions";
import { Countdown, Dot, ExplorerLink, Icon, MoneyInput, Sheet } from "../components/ui";
import type { TightenView } from "../../../client/views";
import { FlowScene } from "../components/FlowScene";
import { usd, usdInput, clockTime, spanAdjective, hoursLabel } from "../lib/format";
import { recordAttempt } from "../lib/attempts";
import { evaluateTopUp, rollingVelocity, usdcToRaw, rawToUsdc, ProposalKind, OwnerKind, COOLDOWN_REASON, type ShieldErrorName } from "../../../client/views";

type Phase = "idle" | "moving" | "done" | "blocked";

const card = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
  transition: { duration: 0.22, ease: [0.2, 0.8, 0.2, 1] as const },
};

export function AddFunds() {
  const { vault, balance, wallets, proposals, server, now, signer, vaultKey, actions, chain } = useShield();
  const venue = useVenue();
  const { run, busy } = useAction();
  const executionWallets = wallets.filter((w) => w.kind === OwnerKind.Execution && w.active);
  const [dest, setDest] = useState<string>(executionWallets[0]?.owner ?? "");
  const [amount, setAmount] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [blocked, setBlocked] = useState<{ reason: ShieldErrorName | null; sig: string | null; amount: bigint } | null>(null);
  const [scheduled, setScheduled] = useState(false);
  const [sent, setSent] = useState<bigint>(0n);
  const [safeOpen, setSafeOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [whatOpen, setWhatOpen] = useState(false);
  const [prefs] = usePrefs(signer?.address ?? null);
  const attempts = useAttempts(vaultKey);

  useEffect(() => {
    if (!dest && executionWallets[0]) setDest(executionWallets[0].owner);
  }, [executionWallets, dest]);

  if (!vault || !signer || !actions || !vaultKey) return null;

  const amountRaw = usdcToRaw(Number(amount || 0));
  const decision = useMemo(() => evaluateTopUp(vault, balance, amountRaw, BigInt(now)), [vault, balance, amountRaw, now]);
  const velocity = rollingVelocity(vault, BigInt(now));
  const remainingToday = vault.velocityThreshold > velocity ? vault.velocityThreshold - velocity : 0n;
  const headroom = balance > vault.protectedFloor ? balance - vault.protectedFloor : 0n;
  const maxInstant = [decision.instantThreshold > 0n ? decision.instantThreshold - 1n : 0n, remainingToday, headroom].reduce((a, b) => (a < b ? a : b));
  const pendingTopUp = proposals.find((p) => p.category === ProposalKind.TopUp);
  const cooldownActive = Number(vault.cooldownUntil) > now;
  const byRule = vault.cooldownReason === COOLDOWN_REASON.RISK_VERDICT;
  const destWallet = executionWallets.find((w) => w.owner === dest);
  const destLabel = destWallet?.label ?? "your trading wallet";

  const chips = [100, 250, 500, 1000, 2000].filter((c) => usdcToRaw(c) <= balance);

  // While the loss rule is holding, this screen leads with the block rather
  // than an amount field the vault would refuse. It is the current on-chain
  // state, not a replayed rejection: the signature only shows for a real one.
  const lastAttempt = attempts.find((a) => a.ts >= now - 86400) ?? null;
  const shown = blocked ?? (cooldownActive && byRule ? { reason: "CooldownActive" as ShieldErrorName, sig: lastAttempt?.sig ?? null, amount: lastAttempt ? BigInt(lastAttempt.amount) : 0n } : null);

  const submit = async () => {
    if (!destWallet || amountRaw <= 0n) return;
    setBlocked(null);
    setScheduled(false);
    setPhase("moving");
    try {
      if (decision.path === "gated") {
        await run(`Top-up of ${usd(amountRaw)} scheduled`, actions.proposeTopUp(destWallet.owner, amountRaw), { silent: true });
        setScheduled(true);
        setPhase("idle");
        return;
      }
      await run(`Sent ${usd(amountRaw)} to ${destWallet.label}`, actions.instantTopUp(destWallet.owner, amountRaw), {
        silent: true,
        recordRejection: true,
      });
      setSent(amountRaw);
      setPhase("done");
    } catch (e) {
      const d = describeError(e);
      if (e instanceof ShieldTxError && e.shieldError === "AmountRequiresGatedTopUp") {
        try {
          await run(`Top-up of ${usd(amountRaw)} scheduled`, actions.proposeTopUp(destWallet.owner, amountRaw), { silent: true });
          setScheduled(true);
          setPhase("idle");
          return;
        } catch {
          /* fall through */
        }
      }
      recordAttempt(vaultKey, { ts: now, amount: amountRaw.toString(), reason: d.name, sig: d.sig, destinationLabel: destWallet.label });
      setBlocked({ reason: d.name, sig: d.sig, amount: amountRaw });
      setPhase("blocked");
    }
  };

  const executePending = async () => {
    if (!pendingTopUp || pendingTopUp.action.kind !== "topUp") return;
    setPhase("moving");
    try {
      await run(`Sent ${usd(pendingTopUp.action.amount)}`, actions.executeTopUp(pendingTopUp.action.destinationOwner));
      setSent(pendingTopUp.action.amount);
      setPhase("done");
    } catch (e) {
      const d = describeError(e);
      setBlocked({ reason: d.name, sig: d.sig, amount: pendingTopUp.action.amount });
      setPhase("blocked");
    }
  };

  const preview = (() => {
    if (amountRaw <= 0n) {
      if (cooldownActive) return { tone: "blocked", icon: "lock" as const, text: <>New capital is paused until <b>{clockTime(Number(vault.cooldownUntil), now)}</b>{byRule ? " by your loss rule" : " by you"}.</> };
      const can = remainingToday < headroom ? remainingToday : headroom;
      if (can === 0n) return { tone: "neutral", icon: "clock" as const, text: <>Nothing can move right now: {remainingToday === 0n ? "today's limit is used up" : "everything above your floor is out"}.</> };
      return { tone: "neutral", icon: "check" as const, text: <><b>{usd(can)}</b> available today · instant below {usd(decision.instantThreshold)}.</> };
    }
    if (decision.path === "instant") return { tone: "protect", icon: "check" as const, text: <>Moves instantly. <span className="muted">{usd(remainingToday - amountRaw)} of today's limit left after this.</span></> };
    if (decision.path === "gated") return { tone: "pending", icon: "clock" as const, text: <>Large release: waits <b>30 minutes</b> before it can move. Your treasury stays protected until then.</> };
    if (decision.reason === "CooldownActive") return { tone: "blocked", icon: "lock" as const, text: <>Will be blocked: new capital is paused until <b>{clockTime(Number(vault.cooldownUntil), now)}</b>.</> };
    if (decision.reason === "VelocityThresholdExceeded") return { tone: "blocked", icon: "lock" as const, text: <>Over today's limit: only <b>{usd(remainingToday)}</b> of your {usd(vault.velocityThreshold)} is left.</> };
    if (decision.reason === "ProtectedFloorBreached") return { tone: "blocked", icon: "lock" as const, text: <>Would breach your floor: only <b>{usd(headroom)}</b> sits above {usd(vault.protectedFloor)}.</> };
    return { tone: "blocked", icon: "lock" as const, text: <>Will be blocked.</> };
  })();

  if (executionWallets.length === 0) {
    return (
      <main className="page page-narrow fade-in">
        <div className="page-head">
          <p className="eyebrow">Add trading funds</p>
          <h1>No trading account yet</h1>
          <p>Shield can only release to accounts you've registered. Add your Hyperliquid account under Protection; it becomes usable after the {hoursLabel(vault.loosenCooldownSecs)} wait.</p>
        </div>
        <Link to="/protection" className="btn">Go to Protection</Link>
      </main>
    );
  }

  return (
    <main className="page page-narrow fade-in">
      <div className="page-head">
        <p className="eyebrow">Add trading funds</p>
        <h1>Release capital to {destLabel}</h1>
      </div>

      {/* The card goes with the animation: hidden on a phone it left an empty
          rounded box eating the top of the fold. */}
      <section className="card flow-card">
        <FlowScene treasury={balance} bankroll={destWallet?.usdc ?? null} amount={blocked?.amount ?? (phase === "done" ? sent : amountRaw)} phase={phase} bankrollLabel={destWallet?.label ?? "Trading wallet"} />
      </section>

      <AnimatePresence mode="wait">
        {shown ? (
          <motion.section key="blocked" className="card card-tone-blocked" style={{ marginTop: 16 }} {...card}>
            <div className="row" style={{ gap: 8 }}>
              <Dot tone="blocked" />
              <span className="eyebrow c-blocked">Release blocked</span>
            </div>
            {shown.reason === "CooldownActive" && byRule ? (
              <>
                <h2 className="not-tonight" style={{ marginTop: 12 }}>Not tonight.</h2>
                <p className="lead" style={{ marginTop: 10, color: "var(--ink)" }}>You decided this before you started trading.</p>
              </>
            ) : (
              <h2 className="title-l" style={{ marginTop: 10 }}>{usd(shown.amount)} stays protected.</h2>
            )}
            <BlockedReason reason={shown.reason} amount={shown.amount} />
            <YourRule reason={shown.reason} />
            <p className="title-l" style={{ marginTop: 18 }}>
              {usd(vault.protectedFloor)} can never be released{balance > vault.protectedFloor ? <>, and the other {usd(balance - vault.protectedFloor)} is locked until then</> : null}.
            </p>
            {shown.reason === "CooldownActive" && (
              <div style={{ marginTop: 18 }}>
                <p className="eyebrow" style={{ marginBottom: 4 }}>Available again in</p>
                <div className="not-tonight" style={{ fontSize: "clamp(34px, 10vw, 52px)" }}><Countdown until={vault.cooldownUntil} now={now} /></div>
              </div>
            )}
            {/* Actions before the evidence: on a phone the evidence pushed every
                choice below the fold at exactly the moment a choice was needed. */}
            <div className="row wrap" style={{ marginTop: 18, gap: 8 }}>
              <button className="btn" onClick={() => setSafeOpen(true)}>Move money to safety</button>
              <button className="btn btn-secondary" onClick={() => setWhatOpen(true)}>See what happened</button>
            </div>
            <div className="row wrap" style={{ marginTop: 10, gap: 8 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setResetOpen(true)}>I still really want to trade</button>
              <button className="btn btn-ghost btn-sm" onClick={() => { setBlocked(null); setPhase("idle"); }}>Back</button>
            </div>
            <SessionFacts amount={shown.amount} reason={shown.reason} attemptsToday={attempts.filter((a) => a.ts >= now - 86400).length} />
            {prefs.calmMessage && (
              <div style={{ marginTop: 18 }}>
                <p className="eyebrow" style={{ marginBottom: 8 }}>You left yourself this</p>
                <div className="quote-box">{prefs.calmMessage}</div>
              </div>
            )}
            <LossEvidence />
            <p className="tiny muted" style={{ marginTop: 12 }}>
              <button className="link" style={{ background: "none", border: 0, padding: 0, cursor: "pointer", font: "inherit", color: "inherit", textDecoration: "underline" }} onClick={() => setMoreOpen(true)}>Protect me more</button>
            </p>
            {shown.sig && (
              <p className="tiny muted" style={{ marginTop: 12 }}>
                Rejected on-chain by the vault {chain === "evm" ? "contract" : "program"} · <ExplorerLink sig={shown.sig} />
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
              <button className="btn btn-ghost" disabled={!!busy} onClick={() => void run("Top-up cancelled", actions.cancelProposal(ProposalKind.TopUp)).then(() => setScheduled(false)).catch(() => null)}>
                Cancel it
              </button>
            </div>
          </motion.section>
        ) : phase === "done" ? (
          <motion.section key="done" className="card card-tone-protect" style={{ marginTop: 16 }} {...card}>
            <div className="row" style={{ gap: 14 }}>
              <span className="check-circle"><Icon name="check" size={22} /></span>
              <div>
                <h2 className="title">Released {usd(sent)} to {destLabel}</h2>
                <p className="dim" style={{ marginTop: 2 }}>{usd(remainingToday)} of today's limit left. Trade well.</p>
              </div>
            </div>
            <div className="row wrap" style={{ marginTop: 14, gap: 8 }}>
              <a className="btn btn-secondary" href={venue.url} target="_blank" rel="noreferrer">Open {venue.label} <Icon name="external" size={16} /></a>
              <button className="btn btn-ghost" onClick={() => { setPhase("idle"); setAmount(""); }}>Add more</button>
            </div>
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
                {busy ? "Confirming…" : amountRaw > 0n ? (decision.path === "gated" ? `Schedule ${usd(amountRaw)}` : `Release ${usd(amountRaw)}`) : "Add funds"}
              </button>
              {pendingTopUp && decision.path === "gated" && <p className="tiny muted" style={{ textAlign: "center" }}>One scheduled top-up at a time. Cancel the pending one first.</p>}
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {pendingTopUp && pendingTopUp.action.kind === "topUp" && !scheduled && !shown && (
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
              <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => void run("Top-up cancelled", actions.cancelProposal(ProposalKind.TopUp)).catch(() => null)}>Cancel</button>
            </div>
          </div>
        </section>
      )}

      <GetMeSafe open={safeOpen} onClose={() => setSafeOpen(false)} context="blocked" />
      <WhatHappened open={whatOpen} onClose={() => setWhatOpen(false)} />
      <ProtectMore open={moreOpen} onClose={() => setMoreOpen(false)} />
      <AnimatePresence>{resetOpen && <ResetScreen open={resetOpen} onClose={() => setResetOpen(false)} attempted={shown?.amount ?? amountRaw} onStopForTonight={() => { setResetOpen(false); setSafeOpen(true); }} />}</AnimatePresence>

      {!shown && phase !== "done" && (
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
  // The number the rule acts on, not the raw shortfall. And the window is
  // measured from when the loss was realised (lastActivityAt), not from when the
  // money was released — the old form counted the whole session as elapsed time.
  const loss = server && Number(server.assessment.realizedLossUsdc) > 0 ? server.assessment.realizedLossUsdc : null;
  const firstLoss = server?.profile.sessions.filter((s) => s.realised && s.isLoss && s.lastActivityAt >= now - 86400).sort((a, b) => a.lastActivityAt - b.lastActivityAt)[0];
  const lead = (text: React.ReactNode) => <p className="lead" style={{ marginTop: 8, color: "var(--ink)" }}>{text}</p>;
  if (reason === "CooldownActive") {
    if (vault.cooldownReason === COOLDOWN_REASON.RISK_VERDICT) {
      return lead(
        <>
          {loss ? <>You've realised <b className="num">{usd(loss)}</b> in losses in {firstLoss ? hoursSince(firstLoss.lastActivityAt, now) : "the last 24 hours"}.</> : <>Your loss rule fired earlier and the pause runs its full length, whatever has happened since.</>} Your {spanAdjective(vault.lossCooldownSecs)} cooldown is active until {clockTime(Number(vault.cooldownUntil), now)}.
        </>
      );
    }
    return lead(<>You paused top-ups yourself until {clockTime(Number(vault.cooldownUntil), now)}. Pauses only end by time.</>);
  }
  if (reason === "VelocityThresholdExceeded") {
    const velocity = rollingVelocity(vault, BigInt(now));
    if (velocity === 0n) return lead(<>Your daily reload is <b className="num">{usd(vault.velocityThreshold)}</b>. You asked for {usd(amount)}, which is more than that in one go.</>);
    return lead(<>You've already released <b className="num">{usd(velocity)}</b> to trading in the last 24 hours. Your limit is {usd(vault.velocityThreshold)}, however it's split.</>);
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

/** The rule in the user's own terms, so the block reads as their decision rather than the app's. */
function YourRule({ reason }: { reason: ShieldErrorName | null }) {
  const { vault } = useShield();
  if (!vault) return null;
  const text =
    reason === "CooldownActive" && vault.cooldownReason === COOLDOWN_REASON.RISK_VERDICT
      ? `After ${usd(vault.lossTriggerUsdc)} of losses, don't release additional trading capital for ${hoursLabel(vault.lossCooldownSecs)}.`
      : reason === "CooldownActive"
        ? "When I pause funding, it ends by time and nothing else."
        : reason === "VelocityThresholdExceeded"
          ? `Release at most ${usd(vault.velocityThreshold)} in any 24 hours, however I split it.`
          : reason === "ProtectedFloorBreached"
            ? `Never let the treasury go below ${usd(vault.protectedFloor)}.`
            : null;
  if (!text) return null;
  return (
    <div style={{ marginTop: 18 }}>
      <p className="eyebrow" style={{ marginBottom: 8 }}>Your rule</p>
      <div className="quote-box">{text}</div>
    </div>
  );
}

function SessionFacts({ amount, reason, attemptsToday }: { amount: bigint; reason: ShieldErrorName | null; attemptsToday: number }) {
  const { vault, balance, server, now } = useShield();
  const venue = useVenue();
  if (!vault) return null;
  const equity = venue.bankroll;
  const h24 = server?.profile.windows.h24;
  const sent = h24 ? BigInt(h24.sent) : 0n;
  const back = h24 ? BigInt(h24.returned) : 0n;
  const net = back - sent;
  return (
    <div className="fact-grid" style={{ marginTop: 18 }}>
      {sent > 0n && <div><div className="k">Released today</div><div className="v">{usd(sent)}</div></div>}
      {sent > 0n && <div><div className="k">Came back</div><div className="v">{usd(back)}</div></div>}
      <div><div className="k">In {venue.label}</div><div className="v">{equity === null ? "—" : usd(equity)}</div></div>
      <div><div className="k">Still protected</div><div className="v c-protect">{usd(balance)}</div></div>
      {attemptsToday > 1 && <div style={{ gridColumn: "1 / -1" }}><div className="k">Blocked attempts today</div><div className="v">{attemptsToday}, including this {usd(amount)}</div></div>}
      {/* The venue's own settled number, named as the venue's, so it can never
          be read as contradicting Shield's. They measure different things. */}
      {venue.state === "live" && venue.session && (
        <p className="tiny muted" style={{ gridColumn: "1 / -1", margin: 0 }}>
          {venue.label} settled {usd(venue.session.closedPnl, { sign: true })} on your trades today. Shield watches something else: how much of what it released has come back.
        </p>
      )}
    </div>
  );
}

function ProtectMore({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { vault, signer, actions, now } = useShield();
  const { run, busy } = useAction();
  if (!vault || !signer || !actions) return null;
  const until = Math.max(Number(vault.cooldownUntil), now) + 86400;
  const halved = vault.velocityThreshold / 2n;
  const longer = vault.lossCooldownSecs + 6n * 3600n;
  const act = (label: string, params: TightenView) => run(label, actions.tighten(params)).then(onClose).catch(() => null);
  const base = {};
  return (
    <Sheet open={open} onClose={onClose} title="Protect me more">
      <div className="stack">
        <p className="dim">Each of these is a tightening: instant, on-chain, and it can't be undone tonight. Loosening any of them later waits {hoursLabel(vault.loosenCooldownSecs)}.</p>
        <div className="list">
          <div className="list-row">
            <div style={{ minWidth: 0 }}><div style={{ fontWeight: 600 }}>Freeze new funding until tomorrow</div><div className="small dim">No top-ups until {clockTime(until, now)}, whatever happens.</div></div>
            <button className="btn btn-sm btn-protect" disabled={!!busy} onClick={() => void act("New funding frozen until tomorrow", { ...base, pauseTopUpsUntil: BigInt(until) })}>Freeze</button>
          </div>
          {halved > 0n && (
            <div className="list-row">
              <div style={{ minWidth: 0 }}><div style={{ fontWeight: 600 }}>Halve my daily limit</div><div className="small dim">{usd(vault.velocityThreshold)} → {usd(halved)} in any 24 hours.</div></div>
              <button className="btn btn-sm btn-protect" disabled={!!busy} onClick={() => void act(`Daily limit lowered to ${usd(halved)}`, { ...base, newVelocityThreshold: halved })}>Halve</button>
            </div>
          )}
          <div className="list-row">
            <div style={{ minWidth: 0 }}><div style={{ fontWeight: 600 }}>Longer pause after losses</div><div className="small dim">{hoursLabel(vault.lossCooldownSecs)} → {hoursLabel(longer)} the next time your loss rule fires.</div></div>
            <button className="btn btn-sm btn-protect" disabled={!!busy} onClick={() => void act(`Loss pause raised to ${hoursLabel(longer)}`, { ...base, newLossCooldownSecs: longer })}>Extend</button>
          </div>
          <div className="list-row">
            <div style={{ minWidth: 0 }}><div style={{ fontWeight: 600 }}>Raise my protected floor</div><div className="small dim">{usd(vault.protectedFloor)} → {usd(vault.protectedFloor + 1_000_000_000n)}. More capital a top-up can never touch.</div></div>
            <button className="btn btn-sm btn-protect" disabled={!!busy} onClick={() => void act(`Floor raised to ${usd(vault.protectedFloor + 1_000_000_000n)}`, { ...base, newProtectedFloor: vault.protectedFloor + 1_000_000_000n })}>Raise</button>
          </div>
        </div>
      </div>
    </Sheet>
  );
}
