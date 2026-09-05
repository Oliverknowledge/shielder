import { useState } from "react";
import { Link } from "react-router-dom";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { useShield, API_URL, NETWORK } from "../lib/shield";
import { Countdown, Field, Money, MoneyInput, Pill, Progress, Sheet, useToast } from "../components/ui";
import { usd, duration, hoursLabel } from "../lib/format";
import { evaluateTopUp, rollingVelocity, ProposalCategory, OwnerType, COOLDOWN_REASON, cancelProposalIx, depositIx, usdcToRaw } from "../../../client/shield-client";
import { useAction } from "../lib/actions";
import { getJson } from "../lib/api";

export function Overview() {
  const { vault, balance, proposals, wallets, server, now, vaultAddress, signer, walletUsdc, health, refresh } = useShield();
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
      toast.ok("Test USDC minted to your wallet");
      await refresh();
    } catch (e) {
      toast.err(`Faucet failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setFaucetBusy(false);
    }
  };

  const cooldownActive = Number(vault.cooldownUntil) > now;
  const bankroll = wallets.filter((w) => w.kind === OwnerType.Execution && w.active).reduce((a, w) => a + (w.usdc ?? 0n), 0n);
  const velocity = rollingVelocity(vault, BigInt(now));
  const remainingToday = vault.velocityThreshold > velocity ? vault.velocityThreshold - velocity : 0n;
  const probe = evaluateTopUp(vault, balance, remainingToday > 0n ? (remainingToday < 100_000_000n ? remainingToday : 100_000_000n) : 1n, BigInt(now));
  const headroom = balance > vault.protectedFloor ? balance - vault.protectedFloor : 0n;
  const pending = proposals.filter((p) => p.category !== ProposalCategory.TopUp);
  const topUpPending = proposals.find((p) => p.category === ProposalCategory.TopUp);
  const totals = server?.profile.totals;
  const h24 = server?.profile.windows.h24;

  const status = cooldownActive
    ? { tone: "blocked" as const, label: vault.cooldownReason === COOLDOWN_REASON.SELF_PAUSE ? "Paused by you" : "Loss cooldown" }
    : pending.length
      ? { tone: "pending" as const, label: "Change pending" }
      : { tone: "protect" as const, label: "Protected" };

  return (
    <main className="page fade-in">
      <section className="card" style={{ padding: "28px 26px" }}>
        <div className="row-between" style={{ alignItems: "flex-start" }}>
          <div>
            <p className="eyebrow">Protected treasury</p>
            <div style={{ marginTop: 6 }}>
              <Money raw={balance} size="xl" />
            </div>
            <p className="small dim" style={{ marginTop: 10 }}>
              {usd(vault.protectedFloor)} floor · {usd(headroom)} available for top-ups under your rules
            </p>
          </div>
          <div className="row" style={{ gap: 8, flexDirection: "column", alignItems: "flex-end" }}>
            <Pill tone={status.tone}>{status.label}</Pill>
            <button className="btn btn-secondary btn-sm" onClick={() => setDepositOpen(true)}>Deposit</button>
          </div>
        </div>
        <div style={{ marginTop: 18 }}>
          <Progress value={Number(vault.protectedFloor)} max={Number(balance) || 1} tone="protect" />
          <div className="row-between tiny muted" style={{ marginTop: 6 }}>
            <span>Floor {usd(vault.protectedFloor)}</span>
            <span>Balance {usd(balance)}</span>
          </div>
        </div>
      </section>

      <div className="grid-2" style={{ marginTop: 16 }}>
        <section className="card">
          <div className="row-between">
            <p className="eyebrow">Trading bankroll</p>
            <Pill tone="bankroll">Free to trade</Pill>
          </div>
          <div style={{ marginTop: 6 }}>
            <Money raw={bankroll} size="l" />
          </div>
          <p className="small dim" style={{ marginTop: 6 }}>
            {wallets.filter((w) => w.kind === OwnerType.Execution && w.active).map((w) => w.label).join(", ") || "No trading wallet"} · Shield never gates trades, only refills.
          </p>
        </section>

        <section className="card">
          <p className="eyebrow">Can I top up right now?</p>
          {cooldownActive ? (
            <>
              <div className="money-l" style={{ marginTop: 6, color: "var(--blocked)" }}>No</div>
              <p className="small dim" style={{ marginTop: 6 }}>
                {vault.cooldownReason === COOLDOWN_REASON.RISK_VERDICT
                  ? `Your loss rule paused top-ups. Back in `
                  : `You paused top-ups. Back in `}
                <b className="num">
                  <Countdown until={vault.cooldownUntil} now={now} format="compact" />
                </b>
                .
              </p>
            </>
          ) : remainingToday === 0n || headroom === 0n ? (
            <>
              <div className="money-l" style={{ marginTop: 6, color: "var(--blocked)" }}>Not today</div>
              <p className="small dim" style={{ marginTop: 6 }}>{remainingToday === 0n ? `You've used your ${usd(vault.velocityThreshold)} daily limit.` : "Everything above the floor has been used."}</p>
            </>
          ) : (
            <>
              <div className="money-l" style={{ marginTop: 6, color: "var(--protect)" }}>Yes</div>
              <p className="small dim" style={{ marginTop: 6 }}>
                Up to <b>{usd(remainingToday < headroom ? remainingToday : headroom)}</b> more today.{" "}
                {probe.path === "gated" ? `Large amounts wait ${duration(Number(vault.topUpCooldownSecs))}.` : `Instant below ${usd(probe.instantThreshold)}.`}
              </p>
            </>
          )}
          <div className="row" style={{ marginTop: 14 }}>
            <Link to="/top-up" className="btn btn-sm">
              Top up
            </Link>
            <Link to="/protection" className="btn btn-ghost btn-sm">
              Tighten
            </Link>
          </div>
        </section>
      </div>

      <div className="grid-2" style={{ marginTop: 16 }}>
        <section className="card">
          <div className="row-between">
            <p className="eyebrow">Your trading, from the chain</p>
            {server && <span className="tiny muted">{server.source.mode === "substreams" ? "The Graph" : "RPC"}</span>}
          </div>
          {totals ? (
            <div className="stack-s" style={{ marginTop: 8 }}>
              <div className="row-between">
                <span className="dim">Sent to trading wallets</span>
                <b className="num">{usd(totals.sent)}</b>
              </div>
              <div className="row-between">
                <span className="dim">Came back</span>
                <b className="num">{usd(totals.returned)}</b>
              </div>
              <div className="divider" style={{ margin: "4px 0" }} />
              <div className="row-between">
                <span className="dim">Net realised flow</span>
                <b className="num" style={{ color: Number(totals.net) < 0 ? "var(--blocked)" : "var(--protect)" }}>{usd(totals.net, { sign: true })}</b>
              </div>
              {h24 && Number(h24.realisedLoss) > 0 && (
                <p className="small" style={{ color: "var(--blocked)" }}>
                  {usd(h24.realisedLoss)} lost in the last 24 hours across {h24.lossSessions} session{h24.lossSessions === 1 ? "" : "s"}.
                </p>
              )}
              <Link to="/behaviour" className="link small" style={{ marginTop: 4 }}>
                See what happened
              </Link>
            </div>
          ) : (
            <p className="small muted" style={{ marginTop: 8 }}>Behavioural data unavailable (server offline). Every rule still works.</p>
          )}
        </section>

        <section className="card">
          <p className="eyebrow">Rules protecting you</p>
          <div className="list" style={{ marginTop: 8 }}>
            <div className="list-row"><span className="dim">Daily top-up limit</span><b className="num">{usd(vault.velocityThreshold)}</b></div>
            <div className="list-row"><span className="dim">Used in the last 24h</span><b className="num">{usd(velocity)}</b></div>
            <div className="list-row"><span className="dim">Loss rule</span><b className="num small">{usd(vault.lossTriggerUsdc)} → pause {hoursLabel(vault.lossCooldownSecs)}</b></div>
            <div className="list-row"><span className="dim">Weakening a rule waits</span><b className="num">{hoursLabel(vault.loosenCooldownSecs)}</b></div>
          </div>
        </section>
      </div>

      {(pending.length > 0 || topUpPending) && (
        <section className="card" style={{ marginTop: 16 }}>
          <p className="eyebrow">Pending</p>
          <div className="list" style={{ marginTop: 8 }}>
            {[...(topUpPending ? [topUpPending] : []), ...pending].map((p) => {
              const label =
                p.action.kind === "loosen"
                  ? "Weakening change"
                  : p.action.kind === "topUp"
                    ? `Top-up ${usd(p.action.amount)}`
                    : p.action.kind === "uninstallVault"
                      ? "Leave Shield"
                      : `Withdraw ${usd(p.action.amount)} to cold wallet`;
              const matured = Number(p.executeAfter) <= now;
              return (
                <div key={p.address.toBase58()} className="list-row">
                  <div>
                    <div style={{ fontWeight: 600 }}>{label}</div>
                    <div className="tiny muted">{matured ? "Ready to execute" : <>Activates in <Countdown until={p.executeAfter} now={now} format="compact" /></>}</div>
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    <Pill tone={matured ? "protect" : "pending"}>{matured ? "Ready" : "Waiting"}</Pill>
                    <button
                      className="btn btn-ghost btn-sm"
                      disabled={!!busy}
                      onClick={() => void run("Cancelled", [cancelProposalIx({ authority: signer.publicKey, vault: vaultAddress, category: p.category })]).catch(() => null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="tiny muted" style={{ marginTop: 10 }}>Your current protection stays fully in force until a change activates. Cancelling is always instant.</p>
        </section>
      )}

      <Sheet open={depositOpen} onClose={() => setDepositOpen(false)} title="Deposit into the treasury">
        <div className="stack">
          <p className="small dim">Deposits are never gated. Only what leaves the vault is governed by your rules.</p>
          <Field label="Amount" hint={`In your wallet: ${walletUsdc === null ? "…" : usd(walletUsdc)} USDC`}>
            <MoneyInput value={depositAmount} onChange={setDepositAmount} autoFocus />
          </Field>
          {NETWORK !== "mainnet-beta" && health?.demo && walletUsdc !== null && walletUsdc < usdcToRaw(Number(depositAmount || 0)) && (
            <div className="warn-box row-between">
              <span>Not enough test USDC in your wallet.</span>
              <button className="btn btn-secondary btn-sm" onClick={() => void faucet()} disabled={faucetBusy}>{faucetBusy ? "Minting…" : "Mint test USDC"}</button>
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
