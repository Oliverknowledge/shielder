/**
 * Onboarding.
 *
 * The order is deliberate: where you already trade, what your own history
 * says about you, what you're genuinely fine risking, and only then the rules.
 * Shield never asks the user to invent jargon — the venue is Hyperliquid, the
 * account they paste is both the history Shield learns from and the only place
 * released capital can go.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { useShield, API_URL, IS_MAINNET } from "../lib/shield";
import { useAction } from "../lib/actions";
import { CapitalBar, Dot, Field, Icon, MoneyInput, Stepper, useToast } from "../components/ui";
import { usd, hoursLabel, short } from "../lib/format";
import { TROUBLES, usePrefs, type Trouble } from "../lib/prefs";
import { usdcToRaw, OwnerKind, Route } from "../../../client/views";
import type { RegistrationInput } from "../../../client/solana-adapter";
import { getJson, type HlProfileJson } from "../lib/api";
import { VENUE_NAME, HL_NET } from "../lib/venue";
import { venueUrl } from "../lib/hyperliquid";

const STEPS = ["Where you trade", "You", "Your plan", "Review", "Activate"];

interface Draft {
  executionAddress: string;
  executionLabel: string;
  coldAddress: string;
  coldLabel: string;
  deposit: string;
  bankroll: string;
  daily: string;
  lossTrigger: string;
  lossCooldownHours: number;
  thresholdPct: number;
  monitor: boolean;
}

export function Setup() {
  const { signer, vault, vaultKnown, loading, health, walletUsdc, refresh, actions, engine, usdc, chain } = useShield();
  const vaultRef = useRef(vault);
  vaultRef.current = vault;
  const isPubkey = (s: string) => !!engine && engine.isValidAddress(s);
  const navigate = useNavigate();
  const toast = useToast();
  const { run, busy } = useAction();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>({
    executionAddress: "",
    executionLabel: chain === "evm" ? VENUE_NAME : "Trading wallet",
    coldAddress: "",
    coldLabel: "Safe wallet",
    deposit: "10000",
    bankroll: "1500",
    daily: "300",
    lossTrigger: "750",
    lossCooldownHours: 12,
    thresholdPct: 20,
    monitor: true,
  });
  const [activated, setActivated] = useState(false);
  const [partial, setPartial] = useState<string | null>(null);
  const [deposited, setDeposited] = useState(false);
  const [faucetBusy, setFaucetBusy] = useState(false);
  const [prefs, setPrefs] = usePrefs(signer?.address ?? null);
  const [hlBusy, setHlBusy] = useState(false);
  const [hlProfile, setHlProfile] = useState<HlProfileJson | null>(null);
  const [hlError, setHlError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const vaultExistsNow = () => !!vaultRef.current;
  const n = (s: string) => Number(s || 0);

  /**
   * One action: the address the user trades from becomes the registered
   * destination, and Shield reads that account's real history from the venue.
   * A venue with no history is fine — the rules just start from defaults.
   */
  const connectVenue = async () => {
    const addr = draft.executionAddress.trim();
    if (!isPubkey(addr)) {
      setHlError(`That doesn't look like a ${chain === "evm" ? "Hyperliquid (EVM)" : "Solana"} address.`);
      return;
    }
    setHlError(null);
    setConnected(true);
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) return; // Solana build: no venue history to read
    setHlBusy(true);
    try {
      const p = await getJson<HlProfileJson>(`${API_URL}/api/hyperliquid/${addr}?network=${HL_NET}`);
      setHlProfile(p);
      setPrefs({ hyperliquidAddress: addr });
      // One write: toggling in a loop would read the same stale prefs each time.
      const suggested = p.suggestions.map((x) => x.key).filter((k) => !prefs.troubles.includes(k));
      const troubles = suggested.length ? [...prefs.troubles, ...suggested] : prefs.troubles;
      if (suggested.length) setPrefs({ troubles });
      const size = p.typicalSessionSize && p.typicalSessionSize > 0 ? Math.round(p.typicalSessionSize) : n(draft.bankroll);
      set({ bankroll: String(size), ...recommend(size, troubles) });
    } catch (e) {
      setHlError(e instanceof Error ? e.message : String(e));
    } finally {
      setHlBusy(false);
    }
  };

  const toggleTrouble = (k: Trouble) => {
    const has = prefs.troubles.includes(k);
    const troubles = has ? prefs.troubles.filter((t) => t !== k) : [...prefs.troubles, k];
    setPrefs({ troubles });
    set(recommend(n(draft.bankroll), troubles));
  };

  /** The proposed mandate, derived from the bankroll and what the user says gets them into trouble. */
  const recommend = (bankroll: number, troubles: Trouble[]): Partial<Draft> => {
    const chasing = troubles.includes("chasing");
    const reloads = troubles.includes("reloads") || troubles.includes("allin");
    return {
      lossTrigger: String(Math.max(1, Math.round(bankroll * (chasing ? 0.4 : 0.5)))),
      lossCooldownHours: chasing ? 24 : 12,
      daily: String(Math.max(1, Math.round(bankroll * (reloads ? 0.15 : 0.2)))),
      thresholdPct: troubles.includes("rushed") ? 10 : 20,
    };
  };

  useEffect(() => {
    if (health?.executionWallet && !draft.executionAddress) setDraft((d) => ({ ...d, executionAddress: health.executionWallet! }));
  }, [health?.executionWallet]); // eslint-disable-line react-hooks/exhaustive-deps

  const valid = useMemo(() => {
    if (step === 0) return connected && isPubkey(draft.executionAddress);
    if (step === 2) return n(draft.deposit) > 0 && n(draft.bankroll) > 0 && n(draft.bankroll) <= n(draft.deposit) && n(draft.daily) > 0 && n(draft.lossTrigger) > 0 && (draft.coldAddress === "" || isPubkey(draft.coldAddress));
    return true;
  }, [step, draft, connected]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!signer) return <Navigate to="/welcome" replace />;
  if (vault && !activated) return <Navigate to="/" replace />;
  // Wait for a real answer before offering to create a vault that may exist.
  if (!vaultKnown && !activated) return <main className="page page-narrow fade-in"><p className="dim">Reading your vault…</p></main>;

  const usdcMint = usdc;
  const verifier = draft.monitor && health?.monitor.verifier ? health.monitor.verifier : null;
  // The bankroll never enters Shield: the user funds their venue account with
  // it directly. Shield holds the rest, and keeps a small reserve above the
  // floor so the daily reload has something to draw on.
  const dep = n(draft.deposit);
  // initializeVault, then one registerOwner per destination — each its own
  // transaction and its own wallet prompt.
  const activateTxCount = 1 + 1 + (draft.coldAddress ? 1 : 0);
  const bankroll = Math.min(n(draft.bankroll), dep);
  const treasury = Math.max(0, dep - bankroll);
  const reserve = Math.min(Math.round(treasury * 0.25), n(draft.daily) * 2);
  const floor = Math.max(0, treasury - reserve);

  const activate = async () => {
    if (!usdcMint || !actions) {
      toast.err("No USDC configured. Start the Shield server or set the USDC address.");
      return;
    }
    const regs: RegistrationInput[] = [{ owner: draft.executionAddress, kind: OwnerKind.Execution, route: chain === "evm" ? Route.HyperCore : Route.Evm, label: draft.executionLabel || VENUE_NAME }];
    if (draft.coldAddress) regs.push({ owner: draft.coldAddress, kind: OwnerKind.Cold, route: Route.Evm, label: draft.coldLabel || "Safe wallet" });
    const tx = actions.activate(
      {
        riskVerifier: verifier,
        protectedFloor: usdcToRaw(floor),
        topUpThresholdBps: Math.round(draft.thresholdPct * 100),
        emergencyCap: usdcToRaw(200),
        velocityThreshold: usdcToRaw(n(draft.daily)),
        lossTriggerUsdc: usdcToRaw(n(draft.lossTrigger)),
        lossCooldownSecs: BigInt(Math.round(draft.lossCooldownHours * 3600)),
      },
      regs
    );
    // Mark as activated before sending: the provider refreshes the vault as
    // soon as the transaction confirms, and the redirect guard must not fire
    // before the deposit step has been shown.
    setActivated(true);
    try {
      await run("Shield activated", tx);
      setPartial(null);
      await refresh();
    } catch (e) {
      // The batch is vault-then-destinations. If the vault landed and a
      // registration did not, going back to step one is wrong: the vault
      // exists and cannot be created twice. Say what happened instead.
      await refresh();
      if (vaultExistsNow()) {
        setPartial(e instanceof Error ? e.message : String(e));
      } else {
        setActivated(false);
      }
    }
  };

  const deposit = async () => {
    if (!usdcMint || !actions) return;
    try {
      await run(`Deposited ${usd(usdcToRaw(treasury))}`, actions.deposit(usdcToRaw(treasury)));
      setDeposited(true);
      setTimeout(() => navigate("/"), 600);
    } catch {
      /* toast shown */
    }
  };

  const faucet = async () => {
    setFaucetBusy(true);
    try {
      await getJson(`${API_URL}/api/demo/faucet`, { method: "POST", body: JSON.stringify({ owner: signer.address, amountUsdc: treasury || 10000 }) });
      toast.ok("Test USDC added to your wallet");
      await refresh();
    } catch (e) {
      toast.err(`Faucet failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setFaucetBusy(false);
    }
  };

  return (
    <main className="page page-narrow fade-in">
      <div className="row-between" style={{ marginBottom: 8 }}>
        <p className="eyebrow">Set up Shield · {STEPS[step]}</p>
        <span className="tiny muted">{step + 1} / {STEPS.length}</span>
      </div>
      <Stepper step={step + 1} total={STEPS.length} />

      <motion.div key={step} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2 }} style={{ marginTop: 24 }}>
        {step === 0 && (
          <div className="stack">
            <div className="page-head" style={{ marginBottom: 0 }}>
              <h1>Where do you trade?</h1>
              <p>Shield doesn't replace your exchange. You keep trading where you already do. Shield controls the capital you decided should stay out of it.</p>
            </div>
            <div className="card stack">
              <div className="venue-head">
                <Dot tone={connected ? "protect" : "bankroll"} />
                <span style={{ fontWeight: 600, fontSize: 17 }}>{chain === "evm" ? VENUE_NAME : "Your trading wallet"}</span>
                {chain === "evm" && <span className="tiny muted">{HL_NET}</span>}
              </div>
              <Field label={chain === "evm" ? `Your ${VENUE_NAME} account` : "Your trading wallet"} hint={chain === "evm" ? "The address you trade from. Released capital is deposited straight into this account, and nowhere else." : "The wallet you trade from."}>
                <div className="row" style={{ gap: 8 }}>
                  <input className="input mono" value={draft.executionAddress} onChange={(e) => { set({ executionAddress: e.target.value.trim() }); setConnected(false); setHlProfile(null); }} placeholder="0x…" />
                  <button className="btn btn-secondary" disabled={hlBusy || !draft.executionAddress} onClick={() => void connectVenue()}>{hlBusy ? "Reading…" : connected ? "Connected" : "Connect"}</button>
                </div>
              </Field>
              {hlError && <p className="tiny c-blocked">{hlError}</p>}
              {hlBusy && <p className="small dim">Learning how you trade…</p>}
              {connected && !hlBusy && (
                <div className="stack-s">
                  {hlProfile?.insight ? (
                    <div className="quote-box">{hlProfile.insight}</div>
                  ) : hlProfile ? (
                    <p className="small dim">{hlProfile.totals.sessions === 0 ? `No trading history for this account on ${VENUE_NAME} ${HL_NET} yet. Your rules start from sensible defaults and you can change them any time.` : "Not enough closed sessions yet to say anything you'd trust."}</p>
                  ) : (
                    <p className="small dim">Connected. Shield will read this account's history as it trades.</p>
                  )}
                  {hlProfile && hlProfile.totals.sessions > 0 && (
                    <div className="stat-grid">
                      <div className="stat"><div className="k">Sessions</div><div className="v">{hlProfile.totals.sessions}</div></div>
                      <div className="stat"><div className="k">Typical session</div><div className="v">{hlProfile.typicalSessionSize === null ? "—" : usd(hlProfile.typicalSessionSize)}</div></div>
                      <div className="stat"><div className="k">Largest losing session</div><div className="v c-blocked">{hlProfile.largestLosingSession ? usd(Math.abs(hlProfile.largestLosingSession.pnl)) : "—"}</div></div>
                      <div className="stat"><div className="k">Reloads after a loss</div><div className="v">{hlProfile.sessionsWithReloadAfterLoss}</div></div>
                    </div>
                  )}
                </div>
              )}
            </div>
            {chain === "evm" && (
              <p className="tiny muted">
                Don't have one yet? <a className="link" href={venueUrl(HL_NET)} target="_blank" rel="noreferrer">Open {VENUE_NAME} ↗</a> and come back with the address you trade from.
              </p>
            )}
          </div>
        )}

        {step === 1 && (
          <div className="stack">
            <div className="page-head" style={{ marginBottom: 0 }}>
              <h1>What do you want Shield to stop?</h1>
              <p>Pick anything that's true. Shield proposes your rules from it. Nothing here is a diagnosis; it's what you already know about yourself when you're calm.</p>
            </div>
            <div className="stack-s">
              {TROUBLES.map((t) => {
                const on = prefs.troubles.includes(t.key);
                return (
                  <button key={t.key} type="button" className={`trouble${on ? " on" : ""}`} onClick={() => toggleTrouble(t.key)} aria-pressed={on}>
                    <span className="box">{on && <Icon name="check" size={14} />}</span>
                    <span>
                      <span className="t">{t.title}</span>
                      <span className="b" style={{ display: "block" }}>{t.body}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="card stack">
              <div>
                <p style={{ fontWeight: 600 }}>What should Shield say when it blocks you?</p>
                <p className="small dim" style={{ marginTop: 2 }}>Past-you will say it, not an app. Something like: "You've already lost what you agreed to lose. Don't throw another two grand at it."</p>
              </div>
              <textarea className="input" rows={3} value={prefs.calmMessage} onChange={(e) => setPrefs({ calmMessage: e.target.value.slice(0, 280) })} placeholder="If you're seeing this…" />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="stack">
            <div className="page-head" style={{ marginBottom: 0 }}>
              <h1>How much are you genuinely okay risking?</h1>
              <p>This is your freedom zone. Shield won't interfere with anything you do inside it. Everything else stays in the treasury.</p>
            </div>
            <div className="card stack">
              <Field label="Total capital you're allocating">
                <MoneyInput value={draft.deposit} onChange={(v) => set({ deposit: v })} />
              </Field>
              <Field label="Trading bankroll" hint={`What you're fine losing. You fund this on ${draft.executionLabel} yourself; the other ${usd(treasury)} goes into Shield, with ${usd(floor)} of it a floor that can never be released to trading.`}>
                <MoneyInput value={draft.bankroll} onChange={(v) => { set({ bankroll: v, ...recommend(Number(v || 0), prefs.troubles) }); }} />
                <div className="chips" style={{ marginTop: 8 }}>
                  {[10, 15, 20, 30].map((p) => (
                    <button key={p} className={`chip ${dep > 0 && Math.round((bankroll / dep) * 100) === p ? "active" : ""}`} onClick={() => { const v = String(Math.round((dep * p) / 100)); set({ bankroll: v, ...recommend(Number(v), prefs.troubles) }); }}>
                      {p}%
                    </button>
                  ))}
                </div>
              </Field>
              {dep > 0 && (
                <div>
                  <CapitalBar floor={usdcToRaw(floor)} room={usdcToRaw(reserve)} trade={usdcToRaw(bankroll)} />
                  <div className="legend">
                    <span><i style={{ background: "var(--protect)" }} />Floor <b>{usd(floor)}</b></span>
                    <span><i style={{ background: "var(--protect-2)" }} />Reload reserve <b>{usd(reserve)}</b></span>
                    <span><i style={{ background: "var(--bankroll-2)" }} />Trading <b>{usd(bankroll)}</b></span>
                  </div>
                </div>
              )}
            </div>

            <div>
              <h2 className="title">Your rules</h2>
              <p className="dim" style={{ marginTop: 4 }}>Proposed from your bankroll{prefs.troubles.length ? " and what you told us" : ""}. Edit anything.</p>
            </div>
            <div className="card stack">
              <Field label="Chasing losses" hint={`When ${usd(n(draft.lossTrigger))} or more is lost in a day, Shield stops releasing new capital.`}>
                <MoneyInput value={draft.lossTrigger} onChange={(v) => set({ lossTrigger: v })} />
                <div className="chips" style={{ marginTop: 8 }}>
                  {[6, 12, 18, 24].map((h) => (
                    <button key={h} className={`chip ${draft.lossCooldownHours === h ? "active" : ""}`} onClick={() => set({ lossCooldownHours: h })}>{h}h pause</button>
                  ))}
                </div>
              </Field>
              <Field label="Daily reload" hint="Everything released in any rolling 24 hours, added together. Four $75 releases count as $300.">
                <MoneyInput value={draft.daily} onChange={(v) => set({ daily: v })} />
              </Field>
              <Field label="Large releases wait 30 minutes from" hint="A single release at or above this share of the treasury waits half an hour before it can move.">
                <div className="chips">
                  {[10, 20, 30, 50].map((p) => (
                    <button key={p} className={`chip ${draft.thresholdPct === p ? "active" : ""}`} onClick={() => set({ thresholdPct: p })}>{p}%</button>
                  ))}
                </div>
              </Field>
            </div>

            <div className="card stack">
              <p className="eyebrow">Safe wallet · optional now, {hoursLabel(86400n)} to add later</p>
              <Field label="Address" hint="A wallet you control and don't trade from. Small emergency amounts move there instantly; a full exit takes 7 days.">
                <input className="input mono" value={draft.coldAddress} onChange={(e) => set({ coldAddress: e.target.value.trim() })} placeholder={chain === "evm" ? "0x…" : "Solana address"} />
              </Field>
            </div>

            <div className="card">
              <div className="row-between" style={{ gap: 16 }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontWeight: 600 }}>Shield monitor</p>
                  <p className="small dim">Watches what actually comes back from your trading account. It can only ever pause new releases by your loss rule. It can't move money or loosen anything.</p>
                  {!health?.monitor.verifier && <p className="tiny c-pending" style={{ marginTop: 4 }}>Server not reachable: the monitor can be added later.</p>}
                </div>
                <button className={`switch ${draft.monitor && health?.monitor.verifier ? "on" : ""}`} onClick={() => set({ monitor: !draft.monitor })} aria-label="Toggle monitor" disabled={!health?.monitor.verifier} />
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="stack">
            <div className="page-head" style={{ marginBottom: 0 }}>
              <h1>Your rules, in plain English</h1>
              <p>The vault {chain === "evm" ? "contract" : "program"} enforces these. Read them like a contract with yourself.</p>
            </div>
            <div className="card">
              <div className="list">
                {[
                  <>Of the <b>{usd(dep)}</b> I am allocating, <b>{usd(treasury)}</b> goes into Shield and <b>{usd(floor)}</b> of that is never released.</>,
                  <>I trade <b>{usd(bankroll)}</b> on {draft.executionLabel} however I like. Shield never interferes with that.</>,
                  <>Shield releases at most <b>{usd(n(draft.daily))}</b> more in any 24 hours.</>,
                  <>After I lose <b>{usd(n(draft.lossTrigger))}</b> or more in a day, no new capital is released for <b>{hoursLabel(draft.lossCooldownHours * 3600)}</b>.</>,
                  <>Any single release worth <b>{draft.thresholdPct}%</b> of the treasury or more waits <b>30 minutes</b>.</>,
                  <>Up to <b>$200</b> can move to my safe wallet instantly. Leaving Shield takes <b>7 days</b>.</>,
                  <>Only my wallet can move funds. Shield's monitor can pause releases by rule 4, and nothing else.</>,
                ].map((s, i) => (
                  <div key={i} className="rule" style={{ padding: "12px 0" }}>
                    <div className="s">{s}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="card stack">
              <p className="eyebrow">And the rule about the rules</p>
              <div className="notice-list">
                <div className="notice"><Dot tone="protect" /><span><b>More protection takes effect immediately.</b> Anything that makes you safer never waits.</span></div>
                <div className="notice"><Dot tone="pending" /><span><b>Less protection waits 24 hours</b> — and then it still doesn't happen by itself. Shield asks you again, and the old rule stays in force until you say yes a second time.</span></div>
              </div>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="stack">
            <div className="page-head" style={{ marginBottom: 0 }}>
              <h1>{activated ? "Shield is active" : "Activate Shield"}</h1>
              {/* Each call in the batch is its own transaction and its own wallet
                  prompt, so promising "one" guarantees a surprise second and
                  sometimes third prompt at the highest-abandonment moment in the
                  product. Count them from what is actually about to be sent. */}
              <p>{activated ? "Now move capital into the treasury. Deposits are always allowed; only what leaves is governed." : `${activateTxCount === 1 ? "One transaction creates" : `${activateTxCount} transactions create`} your vault and register where money can go. Your wallet will ask you to sign each one.`}</p>
            </div>
            <div className="card">
              <p className="eyebrow">{usd(dep)}</p>
              <div style={{ marginTop: 12 }}>
                <CapitalBar floor={usdcToRaw(floor)} room={usdcToRaw(reserve)} trade={usdcToRaw(bankroll)} />
                <div className="legend">
                  <span><i style={{ background: "var(--protect)" }} />Floor <b>{usd(floor)}</b></span>
                  <span><i style={{ background: "var(--protect-2)" }} />Reload reserve <b>{usd(reserve)}</b></span>
                  <span><i style={{ background: "var(--bankroll-2)" }} />On {draft.executionLabel} <b>{usd(bankroll)}</b></span>
                </div>
              </div>
            </div>
            {partial && (
              <div className="card card-tone-pending stack-s">
                <p style={{ fontWeight: 600 }}>Your vault was created, but a destination wasn't registered.</p>
                <p className="small dim">
                  The vault itself is on-chain and yours; only the follow-up transaction failed ({partial}). Add the account under
                  Protection — while the treasury is empty that applies instantly.
                </p>
                <button className="btn btn-block" onClick={() => navigate("/protection")}>Add it in Protection</button>
              </div>
            )}
            {!activated ? (
              <div className="card stack">
                <div className="notice-list">
                  <div className="notice"><Dot tone="protect" /><span>Creates your vault, owned by <span className="mono">{short(signer.address)}</span> and nobody else.</span></div>
                  <div className="notice"><Dot tone="bankroll" /><span>Registers <b>{draft.executionLabel}</b> as the only place capital can be released to.</span></div>
                  {draft.coldAddress && <div className="notice"><Dot tone="protect" /><span>Registers <b>{draft.coldLabel}</b> as your safe wallet.</span></div>}
                  <div className="notice"><Dot tone={draft.monitor && health?.monitor.verifier ? "protect" : "neutral"} /><span>{draft.monitor && health?.monitor.verifier ? "Turns on the Shield monitor for your loss rule." : "No monitor for now. Adding one later is instant."}</span></div>
                </div>
                <button className="btn btn-lg btn-block" onClick={() => void activate()} disabled={!!busy || !usdcMint}>
                  {busy ? "Confirming…" : "Activate Shield"}
                </button>
                <p className="tiny muted">{chain === "evm" ? "Vault contract" : "Program"} {chain === "evm" ? (health?.evm?.vault ? short(health.evm.vault, 6) : "…") : health?.programId ? short(health.programId, 6) : "…"} · USDC {usdcMint ? short(usdcMint, 6) : "not configured"}</p>
              </div>
            ) : (
              <div className="card stack">
                <Field label="Deposit into the treasury" hint={`In your wallet: ${walletUsdc === null ? "…" : usd(walletUsdc)} USDC · your ${usd(bankroll)} bankroll stays on ${draft.executionLabel}`}>
                  <MoneyInput value={draft.deposit} onChange={(v) => set({ deposit: v })} />
                </Field>
                {walletUsdc !== null && walletUsdc < usdcToRaw(treasury) && !IS_MAINNET && health?.demo && (
                  <div className="warn-box row-between">
                    <span>You need test USDC first.</span>
                    <button className="btn btn-secondary btn-sm" onClick={() => void faucet()} disabled={faucetBusy}>
                      {faucetBusy ? "Adding…" : `Get ${usd(treasury || 10000)} test USDC`}
                    </button>
                  </div>
                )}
                <button className="btn btn-lg btn-block btn-protect" onClick={() => void deposit()} disabled={!!busy || deposited || (walletUsdc !== null && walletUsdc < usdcToRaw(treasury))}>
                  {deposited ? <><Icon name="check" size={18} /> Deposited</> : busy ? "Confirming…" : `Deposit ${usd(treasury)}`}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => navigate("/")}>Skip for now</button>
              </div>
            )}
          </div>
        )}
      </motion.div>

      {step < 4 && (
        <div className="row-between" style={{ marginTop: 24 }}>
          <button className="btn btn-ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
            Back
          </button>
          <button className="btn" onClick={() => setStep((s) => s + 1)} disabled={!valid || loading}>
            {step === 3 ? "Looks right" : step === 1 && prefs.troubles.length === 0 ? "Skip" : "Continue"}
          </button>
        </div>
      )}
    </main>
  );
}
