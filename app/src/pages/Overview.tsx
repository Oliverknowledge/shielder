import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useShield, API_URL, IS_MAINNET } from "../lib/shield";
import { CapitalBar, Countdown, Dot, Field, Icon, Money, MoneyInput, Pill, Sheet, Skeleton, useToast, type Tone } from "../components/ui";
import { usd, clockTime, hoursLabel, timeOnly, spanAdjective } from "../lib/format";
import { evaluateTopUp, rollingVelocity, ProposalKind, OwnerKind, COOLDOWN_REASON, usdcToRaw, type ProposalView } from "../../../client/views";
import { useAction } from "../lib/actions";
import { getJson } from "../lib/api";
import { describeLoosen } from "../lib/rules";
import { describeEvents } from "../lib/events";
import { GetMeSafe } from "../components/Safety";
import { usePrefs } from "../lib/prefs";
import { useAttempts } from "../lib/attempts";

export function Overview() {
  const { vault, balance, proposals, wallets, server, serverLoading, serverError, now, vaultKey, signer, walletUsdc, health, refresh, actions, usdc } = useShield();
  const { run, busy } = useAction();
  const toast = useToast();
  const [depositOpen, setDepositOpen] = useState(false);
  const [depositAmount, setDepositAmount] = useState("");
  const [faucetBusy, setFaucetBusy] = useState(false);
  const [safeOpen, setSafeOpen] = useState(false);
  const [prefs, setPrefs] = usePrefs(signer?.address ?? null);
  const attempts = useAttempts(vaultKey);
  const [sessionStart] = useState(() => prefs.lastSeenAt);
  useEffect(() => {
    // remember this visit so the next one can say "last night"
    if (signer) setPrefs({ lastSeenAt: now });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signer?.address]);
  if (!vault || !actions || !signer) return null;

  const deposit = async () => {
    const amt = usdcToRaw(Number(depositAmount || 0));
    if (amt <= 0n) return;
    try {
      await run(`Deposited ${usd(amt)}`, actions.deposit(amt));
      setDepositOpen(false);
      setDepositAmount("");
    } catch {
      /* toast shown */
    }
  };
  const faucet = async () => {
    setFaucetBusy(true);
    try {
      await getJson(`${API_URL}/api/demo/faucet`, { method: "POST", body: JSON.stringify({ owner: signer.address, amountUsdc: Number(depositAmount || 10000) || 10000, mint: usdc }) });
      toast.ok("Test USDC added to your wallet");
      await refresh();
    } catch (e) {
      toast.err(`Faucet failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setFaucetBusy(false);
    }
  };

  const cooldownActive = Number(vault.cooldownUntil) > now;
  const byRule = vault.cooldownReason === COOLDOWN_REASON.RISK_VERDICT;
  const execWallets = wallets.filter((w) => w.kind === OwnerKind.Execution && w.active);
  const bankroll = execWallets.reduce((a, w) => a + (w.usdc ?? 0n), 0n);
  const tradingLabel = execWallets.map((w) => w.label).join(", ") || "your trading wallet";
  const velocity = rollingVelocity(vault, BigInt(now));
  const remainingToday = vault.velocityThreshold > velocity ? vault.velocityThreshold - velocity : 0n;
  const floorShown = vault.protectedFloor < balance ? vault.protectedFloor : balance;
  const headroom = balance - floorShown;
  const total = balance + bankroll;
  const canMove = remainingToday < headroom ? remainingToday : headroom;
  const probe = evaluateTopUp(vault, balance, canMove > 0n ? canMove : 1n, BigInt(now));
  const pending = proposals.filter((p) => p.category !== ProposalKind.TopUp);
  const topUpPending = proposals.find((p) => p.category === ProposalKind.TopUp);
  const h24 = server?.profile.windows.h24;
  const lossToday = h24 && Number(h24.realisedLoss) > 0 ? h24.realisedLoss : null;
  const labelOf = (owner: string) => wallets.find((w) => w.owner === owner)?.label ?? `${owner.slice(0, 4)}…`;

  const approaching = !cooldownActive && vault.velocityThreshold > 0n && remainingToday * 4n <= vault.velocityThreshold;
  const status: { tone: Tone; label: string } = cooldownActive
    ? { tone: "blocked", label: byRule ? "Loss cooldown active" : "Paused by you" }
    : approaching
      ? { tone: "pending", label: remainingToday === 0n ? "Daily limit reached" : "Approaching your limit" }
      : { tone: "protect", label: "Within your plan" };
  const matured = proposals.filter((p) => p.category !== ProposalKind.TopUp && Number(p.executeAfter) <= now && p.configVersionAtCreation === vault.configVersion);
  const blockedSinceLastVisit = attempts.filter((a) => a.ts > sessionStart && a.ts < now - 600);
  const lastNight = blockedSinceLastVisit.length > 0 ? blockedSinceLastVisit[0] : null;

  const refill = (() => {
    if (cooldownActive) {
      return {
        tone: "blocked" as const,
        icon: "lock" as const,
        text: (
          <>
            <b>Top-ups paused</b> until {clockTime(Number(vault.cooldownUntil), now)}{byRule ? ` · your loss rule fired${lossToday ? ` after ${usd(lossToday)} in losses` : ""}` : " · by you"}.
          </>
        ),
        right: <span className="num right hide-xs" style={{ fontWeight: 600 }}><Countdown until={vault.cooldownUntil} now={now} format="compact" /></span>,
      };
    }
    if (topUpPending && topUpPending.action.kind === "topUp") {
      return {
        tone: "pending" as const,
        icon: "clock" as const,
        text: (
          <>
            <b>{usd(topUpPending.action.amount)} top-up scheduled</b> · {Number(topUpPending.executeAfter) <= now ? "ready to move" : <>moves in <Countdown until={topUpPending.executeAfter} now={now} format="compact" /></>}.
          </>
        ),
        right: <Link to="/top-up" className="btn btn-sm btn-secondary">Open</Link>,
      };
    }
    if (headroom === 0n) return { tone: "neutral" as const, icon: "lock" as const, text: <>Everything above your floor is already out. <b>{usd(vault.protectedFloor)}</b> stays put.</>, right: null };
    if (remainingToday === 0n) return { tone: "neutral" as const, icon: "clock" as const, text: <>Today's <b>{usd(vault.velocityThreshold)}</b> limit is used up. Capacity returns as the 24-hour window rolls.</>, right: null };
    return {
      tone: "protect" as const,
      icon: "check" as const,
      text: (
        <>
          You can top up <b>{usd(canMove)}</b> more today{probe.path === "gated" ? `; amounts of ${usd(probe.instantThreshold)}+ wait 30 minutes` : ` · instant below ${usd(probe.instantThreshold)}`}.
        </>
      ),
      right: null,
    };
  })();

  const allEvents = server?.events ?? [];
  const recent = describeEvents(allEvents, labelOf, now).slice(0, 4).map((v, i) => ({ e: allEvents[i], v }));

  return (
    <main className="page fade-in">
      <section className="card card-hero">
        <div className="row-between" style={{ alignItems: "flex-start" }}>
          <div style={{ minWidth: 0 }}>
            <p className="eyebrow">Protected treasury</p>
            <div style={{ marginTop: 8 }}>
              <Money raw={balance} size="xl" tween />
            </div>
            <p className="dim" style={{ marginTop: 10 }}>
              of <b className="num">{usd(total)}</b> total
            </p>
          </div>
          <Pill tone={status.tone} live={status.tone === "blocked"}>{status.label}</Pill>
        </div>

        <div style={{ marginTop: 22 }}>
          <CapitalBar floor={floorShown} room={headroom} trade={bankroll} locked={cooldownActive} />
          <div className="legend">
            <span><i style={{ background: "var(--protect)" }} />Floor <b>{usd(vault.protectedFloor)}</b></span>
            <span><i style={{ background: cooldownActive ? "var(--line-2)" : "var(--protect-2)" }} />{cooldownActive ? "Locked for now" : "Can be refilled"} <b>{usd(headroom)}</b></span>
            <span><i style={{ background: "var(--bankroll-2)" }} />Trading with {tradingLabel} <b>{usd(bankroll)}</b></span>
          </div>
        </div>

        <div className={`strip strip-${refill.tone}`} style={{ marginTop: 18 }}>
          <Icon name={refill.icon} size={18} />
          <div className="grow">{refill.text}</div>
          {refill.right}
        </div>

        <div className="row wrap" style={{ marginTop: 16, gap: 8 }}>
          <Link to="/top-up" className="btn">Add funds</Link>
          <button className="btn btn-secondary" onClick={() => setSafeOpen(true)}><Icon name="protection" size={16} /> Get me safe</button>
          <button className="btn btn-ghost" onClick={() => setDepositOpen(true)}>Deposit</button>
        </div>
      </section>

      {(matured.length > 0 || lastNight) && (
        <section className="morning" style={{ marginTop: 16 }}>
          <p className="eyebrow">{lastNight ? "Since you were last here" : "Waiting for your decision"}</p>
          {lastNight && (
            <>
              <h2 className="title-l" style={{ marginTop: 8 }}>Shield held the line.</h2>
              <div className="stat-grid" style={{ marginTop: 14 }}>
                <div className="stat"><div className="k">Blocked top-up{blockedSinceLastVisit.length === 1 ? "" : "s"}</div><div className="v">{usd(blockedSinceLastVisit.reduce((a, b) => a + BigInt(b.amount), 0n))}</div></div>
                <div className="stat"><div className="k">Stayed protected</div><div className="v">{usd(balance)}</div></div>
                {h24 && <div className="stat"><div className="k">Net flow, last 24h</div><div className="v">{usd(BigInt(h24.returned) - BigInt(h24.sent), { sign: true })}</div></div>}
                <div className="stat"><div className="k">Attempts</div><div className="v">{blockedSinceLastVisit.length}</div></div>
              </div>
            </>
          )}
          {matured.map((p) => {
            const lines = p.action.kind === "loosen" ? describeLoosen(p.action.params, vault) : [];
            const what = lines.map((l) => `${l.name.toLowerCase()}${l.from ? ` from ${l.from}` : ""} to ${l.to}`).join(", ") || (p.action.kind === "uninstallVault" ? "leave Shield" : "make a change");
            const apply = () => {
              if (p.action.kind === "loosen") {
                void run("Change applied", actions.executeRuleChange(p.action.params.registerOwner)).catch(() => null);
              }
            };
            return (
              <div key={p.id} style={{ marginTop: lastNight ? 22 : 8 }}>
                <p className="lead" style={{ color: "var(--paper)" }}>
                  On {clockTime(Number(p.createdAt), now)} you asked to {what}. <b>Still want to?</b>
                </p>
                <p className="small" style={{ opacity: 0.7, marginTop: 6 }}>Nothing changed by itself. Your current protection stays until you choose.</p>
                <div className="row wrap" style={{ marginTop: 14, gap: 8 }}>
                  <button className="btn btn-protect" disabled={!!busy} onClick={() => void run("Kept your protection", actions.cancelProposal(p.category)).catch(() => null)}>Keep my protection</button>
                  {p.action.kind === "loosen" ? (
                    <button className="btn btn-secondary" disabled={!!busy} onClick={apply}>Change it</button>
                  ) : (
                    <Link to="/protection" className="btn btn-secondary">Review in Protection</Link>
                  )}
                </div>
              </div>
            );
          })}
        </section>
      )}

      {pending.filter((p) => !matured.includes(p)).length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Pending changes</h2>
            <span className="tiny muted hide-m">Current protection stays active until a change completes</span>
          </div>
          <div className="list">
            {pending.filter((p) => !matured.includes(p)).map((p) => (
              <PendingRow key={p.id} p={p} now={now} vault={vault} busy={!!busy} onCancel={() => void run("Cancelled", actions.cancelProposal(p.category)).catch(() => null)} />
            ))}
          </div>
        </section>
      )}

      <div className="grid-main" style={{ marginTop: 8 }}>
        <section className="section">
          <div className="section-head">
            <h2>What happened recently</h2>
            <Link to="/activity">All activity</Link>
          </div>
          {lossToday && (
            <div className="strip strip-blocked" style={{ marginBottom: 12 }}>
              <div className="grow">
                You sent <b>{usd(server!.profile.windows.h24.sent)}</b> to {tradingLabel} in the last 24 hours and lost <b>{usd(lossToday)}</b> of it. <Link to="/behaviour" className="link">See what came back</Link>
              </div>
            </div>
          )}
          {!server && serverLoading && !serverError ? (
            <div className="feed" aria-busy="true">
              {[0, 1].map((i) => (
                <div key={i} className="feed-item">
                  <Dot tone="neutral" />
                  <div><Skeleton w={200} h={16} /><div style={{ marginTop: 6 }}><Skeleton w={140} h={12} /></div></div>
                  <span />
                </div>
              ))}
            </div>
          ) : recent.length === 0 ? (
            <p className="small muted">{server ? "Nothing yet. Your first top-up will show here." : "Activity needs the Shield server. Every rule still works without it."}</p>
          ) : (
            <div className="feed">
              {recent.map(({ e, v }, i) => (
                <div key={`${e.signature}-${i}`} className="feed-item">
                  <Dot tone={v.tone} />
                  <div style={{ minWidth: 0 }}>
                    <div className="t">{v.title}</div>
                    <div className="b">{v.body}</div>
                    <div className="m">{timeOnly(e.blockTime)} · {v.category}</div>
                  </div>
                  {v.amount ? <div className={`amt ${v.amount.tone === "protect" ? "c-protect" : ""}`}>{v.amount.text}</div> : <span />}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="section">
          <div className="section-head">
            <h2>Rules protecting you</h2>
            <Link to="/protection">Change</Link>
          </div>
          <div className="notice-list">
            <div className="notice"><Dot tone="protect" /><span>Never below <b className="num">{usd(vault.protectedFloor)}</b>, whatever happens.</span></div>
            <div className="notice"><Dot tone={remainingToday === 0n ? "pending" : "protect"} /><span>At most <b className="num">{usd(vault.velocityThreshold)}</b> to trading in 24 hours. <span className="muted">{usd(remainingToday)} left.</span></span></div>
            <div className="notice"><Dot tone={cooldownActive && byRule ? "blocked" : "protect"} /><span>Lose <b className="num">{usd(vault.lossTriggerUsdc)}</b> in a day and top-ups pause for <b>{hoursLabel(vault.lossCooldownSecs)}</b>.</span></div>
            <div className="notice"><Dot tone="pending" /><span>Weakening any rule waits <b>{hoursLabel(vault.loosenCooldownSecs)}</b>. Tightening is instant.</span></div>
          </div>
        </section>
      </div>

      <GetMeSafe open={safeOpen} onClose={() => setSafeOpen(false)} context="home" />

      <Sheet open={depositOpen} onClose={() => setDepositOpen(false)} title="Deposit into the treasury">
        <div className="stack">
          <p className="small dim">Deposits are never gated. Only what leaves the vault is governed by your rules.</p>
          <Field label="Amount" hint={`In your wallet: ${walletUsdc === null ? "…" : usd(walletUsdc)} USDC`}>
            <MoneyInput value={depositAmount} onChange={setDepositAmount} autoFocus />
          </Field>
          {!IS_MAINNET && health?.demo && walletUsdc !== null && walletUsdc < usdcToRaw(Number(depositAmount || 0)) && (
            <div className="warn-box row-between">
              <span>Not enough test USDC in your wallet.</span>
              <button className="btn btn-secondary btn-sm" onClick={() => void faucet()} disabled={faucetBusy}>{faucetBusy ? "Adding…" : "Get test USDC"}</button>
            </div>
          )}
          <button className="btn btn-block btn-protect" disabled={!!busy || !(Number(depositAmount) > 0) || (walletUsdc !== null && walletUsdc < usdcToRaw(Number(depositAmount || 0)))} onClick={() => void deposit()}>
            {busy ? "Confirming…" : `Deposit ${Number(depositAmount) > 0 ? usd(Number(depositAmount)) : ""}`}
          </button>
        </div>
      </Sheet>
    </main>
  );
}

function PendingRow({ p, now, vault, busy, onCancel }: { p: ProposalView; now: number; vault: NonNullable<ReturnType<typeof useShield>["vault"]>; busy: boolean; onCancel: () => void }) {
  const matured = Number(p.executeAfter) <= now;
  const stale = p.configVersionAtCreation !== vault.configVersion;
  const lines =
    p.action.kind === "loosen"
      ? describeLoosen(p.action.params, vault)
      : p.action.kind === "uninstallVault"
        ? [{ name: "Leave Shield", from: null, to: `whole balance to your cold wallet after ${spanAdjective(vault.fullExitCooldownSecs).replace("-", " ")}s` }]
        : p.action.kind === "coldTransferAboveCap"
          ? [{ name: "Withdrawal to cold wallet", from: null, to: usd(p.action.amount) }]
          : [{ name: "Top-up", from: null, to: usd(p.action.amount) }];
  return (
    <div className="list-row stack-m" style={{ alignItems: "flex-start" }}>
      <div style={{ minWidth: 0 }}>
        {lines.map((l, i) => (
          <div key={i} className="row wrap" style={{ gap: 8 }}>
            <span style={{ fontWeight: 600 }}>{l.name}</span>
            {l.from ? (
              <span className="change-pair" style={{ fontSize: 15 }}>
                <span className="from">{l.from}</span>
                <span className="arrow">→</span>
                <span>{l.to}</span>
              </span>
            ) : (
              l.to && <span className="dim">{l.to}</span>
            )}
          </div>
        ))}
        <div className="tiny muted" style={{ marginTop: 4 }}>
          {stale ? "Superseded: you tightened a rule after scheduling this, so it can no longer apply. Cancel it to clear." : matured ? "Waiting period over. Apply it from Protection." : <>Activates in <b className="num"><Countdown until={p.executeAfter} now={now} /></b> · current rule stays active</>}
        </div>
      </div>
      <div className="actions">
        <Pill tone={stale ? "neutral" : matured ? "protect" : "pending"}>{stale ? "Superseded" : matured ? "Ready" : "Waiting"}</Pill>
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
