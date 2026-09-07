/**
 * "Your bad-session plan": three rungs the trader writes while calm.
 *
 *   NORMAL   release up to the daily limit
 *   REDUCED  after a drawdown only they and the enclave know, a smaller budget
 *   LOCKED   after the public loss trigger, no new capital (the cooldown)
 *
 * The verifier can only move the vault down; the user can drop a rung now and
 * climb back only after the delay with a reconfirmation. Shield can only cut
 * funding: the trading itself stays the trader's.
 */
import { useState } from "react";
import { useShield } from "../lib/shield";
import { useAction } from "../lib/actions";
import { Countdown, Dot, Field, MoneyInput, Sheet, useToast } from "./ui";
import { usd, hoursLabel, clockTime } from "../lib/format";
import { usdcToRaw } from "../../../client/views";
import { tierInForce, TIER_REDUCED, type Ladder } from "../../../client/ladder";
import { useLadder, ladderHashOf, ladderToJson, randomSalt } from "../lib/ladder-store";

const DAY = 86_400n;

export function useRung() {
  const { vault, now } = useShield();
  if (!vault) return { tier: 0, allowance: 0n, until: 0 };
  const tier = tierInForce(vault, now);
  const allowance = tier === TIER_REDUCED && vault.reducedVelocityThreshold < vault.velocityThreshold ? vault.reducedVelocityThreshold : vault.velocityThreshold;
  return { tier, allowance, until: tier === TIER_REDUCED ? Number(vault.tierUntil) : Number(vault.cooldownUntil) };
}

export function BadSessionPlan() {
  const { vault, signer, actions, chain, now, refresh, server, ladderProposal: lp } = useShield();
  const { run, busy } = useAction();
  const toast = useToast();
  const [ladder, setLadder] = useLadder(signer?.address ?? null);
  const [open, setOpen] = useState(false);
  const [d1, setD1] = useState("");
  const [allowance, setAllowance] = useState("");
  if (!vault || !signer || !actions || chain !== "evm") return null;

  const rung = tierInForce(vault, now);
  const committed = !!vault.ladderHash;
  const matches = committed && ladder && ladderHashOf(ladder).toLowerCase() === vault.ladderHash!.toLowerCase();
  const loosenWait = hoursLabel(vault.loosenCooldownSecs);
  const typical = (server as unknown as { hl?: { typicalSessionSize?: number } } | null)?.hl?.typicalSessionSize ?? null;

  const openBuilder = () => {
    const base = ladder ?? null;
    setD1(base ? String(Number(base.reducedAtUsdc) / 1e6) : typical ? String(Math.max(1, Math.round(typical * 0.1))) : "");
    setAllowance(base ? String(Number(base.reducedVelocityThreshold) / 1e6) : String(Math.max(1, Math.round(Number(vault.velocityThreshold) / 2e6))));
    setOpen(true);
  };

  const commit = async () => {
    const at = usdcToRaw(Number(d1)), allow = usdcToRaw(Number(allowance));
    if (at <= 0n || allow <= 0n || allow > vault.velocityThreshold) return toast.err("Drawdown must be above $0 and the reduced budget at or below your daily limit.");
    const next: Ladder = { v: 1, reducedAtUsdc: at, reducedVelocityThreshold: allow, tierResetSecs: DAY, salt: ladder?.salt ?? randomSalt() };
    const hash = ladderHashOf(next);
    const tightening = !committed || (hash.toLowerCase() === vault.ladderHash!.toLowerCase() && allow <= vault.reducedVelocityThreshold);
    try {
      if (tightening) await run(committed ? "Plan tightened" : "Bad-session plan committed", actions.commitLadder(hash, allow, DAY));
      else await run(`Plan change scheduled: applies in ${loosenWait} if you confirm it`, actions.proposeLadderChange(hash, allow, DAY, false));
      setLadder(next);
      setOpen(false);
      await refresh();
    } catch { /* toast shown */ }
  };

  const copySecret = async () => {
    if (!ladder) return;
    await navigator.clipboard.writeText(ladderToJson(ladder));
    toast.ok("Copied. Paste it into the monitor's secret store; the chain only ever holds its hash.");
  };

  return (
    <section className="section">
      <div className="section-head">
        <h2>Your bad-session plan</h2>
        <span className="tiny muted">Shield can only cut funding. The trading stays yours.</span>
      </div>
      <div className="list">
        <Rung name="NORMAL" active={rung === 0} line={<>Release up to <b>{usd(vault.velocityThreshold)}</b> a day.</>} />
        <Rung
          name="REDUCED"
          active={rung === 1}
          line={
            committed ? (
              <>After I'm down <b>{matches ? usd(ladder!.reducedAtUsdc) : "a drawdown only I know"}</b> in a session: <b>{usd(vault.reducedVelocityThreshold)}</b> a day, resets next session.</>
            ) : (
              <span className="dim">Not written yet. After a drawdown you choose, a smaller daily budget.</span>
            )
          }
          right={rung === 1 ? <span className="tiny">until {clockTime(Number(vault.tierUntil), now)}</span> : null}
        />
        <Rung name="LOCKED" active={rung === 2} line={<>After <b>{usd(vault.lossTriggerUsdc)}</b> realised in a day: no new capital for <b>{hoursLabel(vault.lossCooldownSecs)}</b>.</>} right={rung === 2 ? <span className="tiny"><Countdown until={vault.cooldownUntil} now={now} format="compact" /></span> : null} />
      </div>
      <p className="small dim" style={{ marginTop: 10 }}>
        {committed ? <>The drawdown that moves you to REDUCED is a salted hash on chain and a secret in the monitor's enclave; the budget it applies is public. </> : null}
        Moving down is instant. Moving back up early waits {loosenWait} and asks you again.
      </p>
      <div className="row wrap" style={{ marginTop: 12, gap: 8 }}>
        <button className="btn btn-secondary btn-sm" disabled={!!busy} onClick={openBuilder}>{committed ? "Change the plan" : "Write my plan"}</button>
        {committed && ladder && <button className="btn btn-ghost btn-sm" onClick={() => void copySecret()}>Copy secret for the monitor</button>}
        {committed && rung === 0 && (
          <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => void run("Dropped to REDUCED", actions.setReducedTier()).then(() => refresh()).catch(() => null)}>Drop to REDUCED now</button>
        )}
      </div>
      {lp && (
        <div className="panel" style={{ marginTop: 12 }}>
          <div className="row-between wrap">
            <div>
              <div className="s"><b>{lp.resetTier ? "Back to NORMAL early" : `New plan: ${usd(lp.reducedVelocityThreshold)} a day when REDUCED`}</b></div>
              <div className="tiny dim">
                {lp.configVersionAtCreation !== vault.configVersion ? "Superseded: you tightened something since." : Number(lp.executeAfter) <= now ? "Ready. Nothing applies until you confirm." : <>Review in <Countdown until={lp.executeAfter} now={now} format="compact" /></>}
              </div>
            </div>
            <div className="row" style={{ gap: 6 }}>
              {Number(lp.executeAfter) <= now && lp.configVersionAtCreation === vault.configVersion && (
                <button className="btn btn-sm" disabled={!!busy} onClick={() => void run("Plan change applied", actions.executeLadderChange()).then(() => refresh()).catch(() => null)}>Confirm</button>
              )}
              <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => void run("Plan change cancelled", actions.cancelLadderChange()).then(() => refresh()).catch(() => null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      <Sheet open={open} onClose={() => setOpen(false)} title="Your bad-session plan">
        {typical ? <p className="small dim">Your typical session deploys about {usd(usdcToRaw(typical))}.</p> : null}
        <Field label="Down this much in a session, and I'm REDUCED" hint="Realised, trailing from the session's peak. Never on chain: only its hash.">
          <MoneyInput value={d1} onChange={setD1} />
        </Field>
        <Field label="While REDUCED, release at most this per day" hint={`Today's limit is ${usd(vault.velocityThreshold)}. This number is public on chain.`}>
          <MoneyInput value={allowance} onChange={setAllowance} />
        </Field>
        <p className="small dim">REDUCED resets next session (24h). LOCKED stays your loss rule: {usd(vault.lossTriggerUsdc)} realised in a day pauses new capital for {hoursLabel(vault.lossCooldownSecs)}.</p>
        <button className="btn btn-lg btn-block btn-protect" disabled={!!busy} onClick={() => void commit()}>{committed ? "Update plan" : "Commit plan"}</button>
        {committed && <p className="tiny dim" style={{ marginTop: 8 }}>Widening the budget or changing the drawdown waits {loosenWait} and needs your confirmation. Shrinking the budget applies now.</p>}
      </Sheet>
    </section>
  );
}

function Rung({ name, active, line, right }: { name: string; active: boolean; line: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="rule" style={active ? { borderColor: "var(--ink)" } : undefined}>
      <div style={{ minWidth: 0 }}>
        <div className="row" style={{ gap: 8 }}>
          <Dot tone={active ? (name === "NORMAL" ? "protect" : name === "REDUCED" ? "pending" : "blocked") : "neutral"} />
          <span className="eyebrow">{name}{active ? " · now" : ""}</span>
        </div>
        <div className="s" style={{ marginTop: 4 }}>{line}</div>
      </div>
      {right ?? null}
    </div>
  );
}
