import { useState } from "react";
import { Link } from "react-router-dom";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { useShield, API_URL, NETWORK } from "../lib/shield";
import { CapitalBar, Countdown, Dot, Field, Icon, Money, MoneyInput, Pill, Sheet, Skeleton, useToast, type Tone } from "../components/ui";
import { usd, clockTime, hoursLabel, timeOnly, spanAdjective } from "../lib/format";
import { evaluateTopUp, rollingVelocity, ProposalCategory, OwnerType, COOLDOWN_REASON, cancelProposalIx, depositIx, usdcToRaw, type ProposalState } from "../../../client/shield-client";
import { useAction } from "../lib/actions";
import { getJson } from "../lib/api";
import { describeLoosen } from "../lib/rules";
import { describeEvents } from "../lib/events";

export function Overview() {
  const { vault, balance, proposals, wallets, server, serverLoading, serverError, now, vaultAddress, signer, walletUsdc, health, refresh } = useShield();
  const { run, busy } = useAction();
  const toast = useToast();
  const [depositOpen, setDepositOpen] = useState(false);
  const [depositAmount, setDepositAmount] = useState("");
  const [faucetBusy, setFaucetBusy] = useState(false);
  if (!vault || !vaultAddress || !signer) return null;

  const deposit = async () => {
    const amt = usdcToRaw(Number(depositAmount || 0));
    if (amt <= 0n) return;
    const ata = getAssociatedTokenAddressSync(vault.usdcMint, signer.publicKey, true);
    try {
      await run(`Deposited ${usd(amt)}`, [depositIx({ depositor: signer.publicKey, vault: vaultAddress, sourceTokenAccount: ata, amount: amt })]);
      setDepositOpen(false);
      setDepositAmount("");
    } catch {
      /* toast shown */
    }
  };
  const faucet = async () => {
    setFaucetBusy(true);
    try {
      await getJson(`${API_URL}/api/demo/faucet`, { method: "POST", body: JSON.stringify({ owner: signer.publicKey.toBase58(), amountUsdc: Number(depositAmount || 10000) || 10000, mint: vault.usdcMint.toBase58() }) });
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
  const execWallets = wallets.filter((w) => w.kind === OwnerType.Execution && w.active);
  const bankroll = execWallets.reduce((a, w) => a + (w.usdc ?? 0n), 0n);
  const tradingLabel = execWallets.map((w) => w.label).join(", ") || "your trading wallet";
  const velocity = rollingVelocity(vault, BigInt(now));
  const remainingToday = vault.velocityThreshold > velocity ? vault.velocityThreshold - velocity : 0n;
  const floorShown = vault.protectedFloor < balance ? vault.protectedFloor : balance;
  const headroom = balance - floorShown;
  const total = balance + bankroll;
  const canMove = remainingToday < headroom ? remainingToday : headroom;
  const probe = evaluateTopUp(vault, balance, canMove > 0n ? canMove : 1n, BigInt(now));
  const pending = proposals.filter((p) => p.category !== ProposalCategory.TopUp);
  const topUpPending = proposals.find((p) => p.category === ProposalCategory.TopUp);
  const h24 = server?.profile.windows.h24;
  const lossToday = h24 && Number(h24.realisedLoss) > 0 ? h24.realisedLoss : null;
  const labelOf = (owner: string) => wallets.find((w) => w.owner === owner)?.label ?? `${owner.slice(0, 4)}…`;

  const status: { tone: Tone; label: string } = cooldownActive
    ? { tone: "blocked", label: byRule ? "Loss cooldown" : "Paused by you" }
    : pending.length
      ? { tone: "pending", label: "Change pending" }
      : { tone: "protect", label: "Protected" };

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
          <Link to="/top-up" className="btn">Top up</Link>
          <button className="btn btn-secondary" onClick={() => setDepositOpen(true)}>Deposit</button>
        </div>
      </section>

      {(pending.length > 0 || (topUpPending && cooldownActive)) && (
        <section className="section">
          <div className="section-head">
            <h2>Pending changes</h2>
            <span className="tiny muted hide-m">Current protection stays active until a change completes</span>
          </div>
          <div className="list">
            {pending.map((p) => (
              <PendingRow key={p.address.toBase58()} p={p} now={now} vault={vault} busy={!!busy} onCancel={() => void run("Cancelled", [cancelProposalIx({ authority: signer.publicKey, vault: vaultAddress, category: p.category })]).catch(() => null)} />
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

      <Sheet open={depositOpen} onClose={() => setDepositOpen(false)} title="Deposit into the treasury">
        <div className="stack">
          <p className="small dim">Deposits are never gated. Only what leaves the vault is governed by your rules.</p>
          <Field label="Amount" hint={`In your wallet: ${walletUsdc === null ? "…" : usd(walletUsdc)} USDC`}>
            <MoneyInput value={depositAmount} onChange={setDepositAmount} autoFocus />
          </Field>
          {NETWORK !== "mainnet-beta" && health?.demo && walletUsdc !== null && walletUsdc < usdcToRaw(Number(depositAmount || 0)) && (
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

function PendingRow({ p, now, vault, busy, onCancel }: { p: ProposalState; now: number; vault: NonNullable<ReturnType<typeof useShield>["vault"]>; busy: boolean; onCancel: () => void }) {
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
