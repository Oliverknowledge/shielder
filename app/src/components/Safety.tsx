/**
 * The two safety flows that must never depend on anything external:
 *  - GetMeSafe: hold 2s → an instant tighten that locks new funding until
 *    tomorrow (and, when the user picks them, stricter limits). Real on-chain
 *    transactions; nothing here can weaken anything.
 *  - ResetScreen: 90 calm seconds with the facts, then only safe options.
 *    It never unlocks protected capital.
 */
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { useShield } from "../lib/shield";
import { useAction } from "../lib/actions";
import { Icon, Sheet } from "./ui";
import { HoldButton } from "./HoldButton";
import { usd, clockTime, hoursLabel } from "../lib/format";
import { tightenIx, OwnerType, type TightenParams } from "../../../client/shield-client";

const DAY = 24 * 3600;

export function GetMeSafe({ open, onClose, context }: { open: boolean; onClose: () => void; context?: "home" | "blocked" }) {
  const { vault, balance, wallets, now, signer, vaultAddress } = useShield();
  const { run, busy } = useAction();
  const [halveLimit, setHalveLimit] = useState(false);
  const [done, setDone] = useState<{ until: number; protectedNow: bigint } | null>(null);

  useEffect(() => {
    if (!open) setDone(null);
  }, [open]);

  if (!vault || !signer || !vaultAddress) return null;
  const bankroll = wallets.filter((w) => w.kind === OwnerType.Execution && w.active).reduce((a, w) => a + (w.usdc ?? 0n), 0n);
  const until = Math.max(Number(vault.cooldownUntil), now) + DAY;
  const halved = vault.velocityThreshold / 2n;

  const go = async () => {
    const params: TightenParams = { pauseTopUpsUntil: BigInt(until) };
    if (halveLimit && halved > 0n) params.newVelocityThreshold = halved;
    try {
      await run("You're safe for tonight", [tightenIx({ authority: signer.publicKey, vault: vaultAddress, ...params })], { silent: true });
      setDone({ until, protectedNow: balance });
    } catch {
      /* toast shown by useAction */
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={done ? undefined : "Get me safe"}>
      {done ? (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="stack" style={{ textAlign: "center", padding: "8px 0 4px" }}>
          <span className="check-circle" style={{ width: 64, height: 64, margin: "0 auto" }}><Icon name="check" size={30} /></span>
          <h2 className="title-l">You're safe for tonight.</h2>
          <div className="two-up">
            <div><div className="k">Protected</div><div className="v">{usd(done.protectedNow)}</div></div>
            <div><div className="k">New funding locked until</div><div className="v">{clockTime(done.until, now)}</div></div>
          </div>
          <p className="dim">Nothing can be added to your trading wallet until then. Everything already protected stays protected. You can still trade what's in {wallets.find((w) => w.kind === OwnerType.Execution && w.active)?.label ?? "your trading wallet"}.</p>
          <button className="btn btn-block" onClick={onClose}>Done</button>
        </motion.div>
      ) : (
        <div className="stack">
          <p className="dim">One press, then everything below happens on-chain and instantly. Nothing here can be undone by tonight-you.</p>
          <div className="notice-list">
            <div className="notice"><span className="dot dot-protect" /><span><b>Lock new funding</b> until {clockTime(until, now)}. Top-ups to any trading wallet are refused until then.</span></div>
            <div className="notice"><span className="dot dot-protect" /><span><b>Keep {usd(balance)} protected.</b> It was never at risk; it stays that way.</span></div>
            {bankroll > 0n && <div className="notice"><span className="dot dot-bankroll" /><span><b>Leave {usd(bankroll)} where it is.</b> Your trading wallet is yours; Shield never touches it.</span></div>}
          </div>
          {halved > 0n && (
            <label className="trouble" style={{ cursor: "pointer" }} onClick={() => setHalveLimit((v) => !v)}>
              <span className={`box${halveLimit ? "" : ""}`} style={halveLimit ? { background: "var(--ink)", borderColor: "var(--ink)" } : undefined}>{halveLimit && <Icon name="check" size={14} />}</span>
              <span>
                <span className="t">Also halve my daily limit</span>
                <span className="b" style={{ display: "block" }}>{usd(vault.velocityThreshold)} → {usd(halved)}. Instant. Raising it again later waits {hoursLabel(vault.loosenCooldownSecs)}.</span>
              </span>
            </label>
          )}
          <HoldButton onComplete={() => void go()} disabled={!!busy} className="hold-protect">
            {busy ? "Confirming…" : "Hold to get safe"}
          </HoldButton>
          {context === "blocked" && <p className="tiny muted" style={{ textAlign: "center" }}>Getting safe is always instant, even during a cooldown.</p>}
        </div>
      )}
    </Sheet>
  );
}

export function ResetScreen({ open, onClose, attempted, onStopForTonight }: { open: boolean; onClose: () => void; attempted: bigint; onStopForTonight: () => void }) {
  const { vault, balance, wallets, server, now } = useShield();
  const [left, setLeft] = useState(90);
  useEffect(() => {
    if (!open) return;
    setLeft(90);
    const t = setInterval(() => setLeft((v) => Math.max(0, v - 1)), 1000);
    return () => clearInterval(t);
  }, [open]);
  if (!open || !vault) return null;
  const execLabel = wallets.find((w) => w.kind === OwnerType.Execution && w.active)?.label ?? "your trading wallet";
  const bankroll = wallets.filter((w) => w.kind === OwnerType.Execution && w.active).reduce((a, w) => a + (w.usdc ?? 0n), 0n);
  const h24 = server?.profile.windows.h24;
  const loss = h24 ? BigInt(h24.realisedLoss) : 0n;
  const reloads = h24?.topUpCount ?? 0;
  const pct = left / 90;
  const r = 76, c = 2 * Math.PI * r;

  return (
    <motion.div className="reset-screen" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="dialog" aria-modal="true">
      <p className="eyebrow">Ninety seconds</p>
      <h2 className="title-l" style={{ marginTop: 10, maxWidth: "18ch" }}>The trade will still exist in {left > 0 ? `${left} second${left === 1 ? "" : "s"}` : "a moment"}.</h2>
      <div className="reset-ring" aria-hidden>
        <svg width="168" height="168" viewBox="0 0 168 168">
          <circle cx="84" cy="84" r={r} fill="none" stroke="var(--line)" strokeWidth="6" />
          <circle cx="84" cy="84" r={r} fill="none" stroke="var(--protect)" strokeWidth="6" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} style={{ transition: "stroke-dashoffset 1s linear" }} />
        </svg>
        <div className="t num">{left}</div>
      </div>
      <div className="reset-facts">
        <div><div className="k">In {execLabel} right now</div><div className="v">{usd(bankroll)}</div></div>
        <div><div className="k">Lost in the last 24h</div><div className="v" style={{ color: loss > 0n ? "var(--blocked)" : undefined }}>{usd(loss)}</div></div>
        <div><div className="k">Top-ups today</div><div className="v">{reloads}</div></div>
        <div><div className="k">You just tried to add</div><div className="v">{usd(attempted)}</div></div>
        <div style={{ gridColumn: "1 / -1" }}><div className="k">Still protected</div><div className="v c-protect">{usd(balance)}</div></div>
      </div>
      <motion.div className="reset-actions" initial={{ opacity: 0.35 }} animate={{ opacity: left === 0 ? 1 : 0.35 }} transition={{ duration: 0.6 }}>
        <p className="eyebrow" style={{ textAlign: "center", marginBottom: 2 }}>{left === 0 ? "What do you want to do?" : "Options unlock when the timer ends"}</p>
        <button className="btn btn-secondary btn-lg" disabled={left > 0} onClick={onClose}>Keep trading with my existing {usd(bankroll)}</button>
        <button className="btn btn-lg" disabled={left > 0} onClick={onStopForTonight}>Stop for tonight</button>
        <p className="tiny muted" style={{ textAlign: "center" }}>There is no option to add the {usd(attempted)}. That was the point of setting the rule.</p>
      </motion.div>
      <button className="btn btn-ghost btn-sm" style={{ position: "absolute", top: 16, right: 16 }} onClick={onClose} aria-label="Close">Close</button>
    </motion.div>
  );
}
