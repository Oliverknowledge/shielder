import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { PublicKey } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { motion } from "motion/react";
import { useShield, API_URL, NETWORK } from "../lib/shield";
import { useAction } from "../lib/actions";
import { CapitalBar, Dot, Field, Icon, MoneyInput, Stepper, useToast } from "../components/ui";
import { usd, hoursLabel, short } from "../lib/format";
import { TROUBLES, usePrefs, type Trouble } from "../lib/prefs";
import { depositIx, initializeVaultIx, registerOwnerIx, usdcToRaw, vaultPda, OwnerType } from "../../../client/shield-client";
import { getJson, type HlProfileJson } from "../lib/api";

const STEPS = ["You", "Wallets", "Protection", "Review", "Activate"];

interface Draft {
  executionAddress: string;
  executionLabel: string;
  coldAddress: string;
  coldLabel: string;
  deposit: string;
  floor: string;
  daily: string;
  lossTrigger: string;
  lossCooldownHours: number;
  thresholdPct: number;
  monitor: boolean;
}

function isPubkey(s: string): boolean {
  try {
    new PublicKey(s);
    return s.length >= 32;
  } catch {
    return false;
  }
}

export function Setup() {
  const { signer, vault, loading, health, walletUsdc, refresh, vaultAddress } = useShield();
  const navigate = useNavigate();
  const toast = useToast();
  const { run, busy } = useAction();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>({
    executionAddress: "",
    executionLabel: "Axiom",
    coldAddress: "",
    coldLabel: "Ledger",
    deposit: "10000",
    floor: "6000",
    daily: "2000",
    lossTrigger: "1000",
    lossCooldownHours: 18,
    thresholdPct: 20,
    monitor: true,
  });
  const [activated, setActivated] = useState(false);
  const [deposited, setDeposited] = useState(false);
  const [faucetBusy, setFaucetBusy] = useState(false);
  const [prefs, setPrefs] = usePrefs(signer?.publicKey.toBase58() ?? null);
  const [hlAddress, setHlAddress] = useState("");
  const [hlBusy, setHlBusy] = useState(false);
  const [hlProfile, setHlProfile] = useState<HlProfileJson | null>(null);
  const [hlError, setHlError] = useState<string | null>(null);
  const analyseHl = async () => {
    const addr = hlAddress.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) { setHlError("That doesn't look like a Hyperliquid (EVM) address."); return; }
    setHlBusy(true); setHlError(null);
    try {
      const p = await getJson<HlProfileJson>(`${API_URL}/api/hyperliquid/${addr}?network=mainnet`);
      setHlProfile(p);
      setPrefs({ hyperliquidAddress: addr });
      // let the data pre-tick the troubles it supports
      const add = p.suggestions.map((x) => x.key).filter((k) => !prefs.troubles.includes(k));
      add.forEach((k) => toggleTrouble(k));
    } catch (e) {
      setHlError(e instanceof Error ? e.message : String(e));
    } finally { setHlBusy(false); }
  };
  const toggleTrouble = (k: Trouble) => {
    const has = prefs.troubles.includes(k);
    const troubles = has ? prefs.troubles.filter((t) => t !== k) : [...prefs.troubles, k];
    setPrefs({ troubles });
    // Personalise the proposed mandate from what the user says gets them into trouble.
    const dep = n(draft.deposit) || 10000;
    const patch: Partial<Draft> = {};
    if (troubles.includes("chasing")) { patch.lossTrigger = String(Math.round(dep * 0.075)); patch.lossCooldownHours = 24; }
    if (troubles.includes("reloads") || troubles.includes("allin")) patch.daily = String(Math.round(dep * 0.15));
    if (troubles.includes("savings")) patch.floor = String(Math.round(dep * 0.8));
    if (troubles.includes("rushed")) patch.thresholdPct = 10;
    if (Object.keys(patch).length) set(patch);
  };

  useEffect(() => {
    if (health?.executionWallet && !draft.executionAddress) setDraft((d) => ({ ...d, executionAddress: health.executionWallet! }));
  }, [health?.executionWallet]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const n = (s: string) => Number(s || 0);

  const valid = useMemo(() => {
    if (step === 1) return isPubkey(draft.executionAddress) && (draft.coldAddress === "" || isPubkey(draft.coldAddress));
    if (step === 2) return n(draft.floor) >= 0 && n(draft.daily) > 0 && n(draft.lossTrigger) > 0 && draft.thresholdPct > 0 && draft.thresholdPct <= 100;
    return true;
  }, [step, draft]);

  if (!signer) return <Navigate to="/welcome" replace />;
  if (vault && !activated) return <Navigate to="/" replace />;

  const usdcMint = health?.usdcMint ?? (import.meta.env.VITE_USDC_MINT as string | undefined) ?? null;
  const verifier = draft.monitor && health?.monitor.verifier ? new PublicKey(health.monitor.verifier) : PublicKey.default;

  const activate = async () => {
    if (!usdcMint) {
      toast.err("No USDC mint configured. Start the Shield server or set VITE_USDC_MINT.");
      return;
    }
    const mint = new PublicKey(usdcMint);
    const [vaultPk] = vaultPda(signer.publicKey);
    const ixs = [
      initializeVaultIx({
        authority: signer.publicKey,
        usdcMint: mint,
        riskVerifier: verifier,
        protectedFloor: usdcToRaw(n(draft.floor)),
        topUpThresholdBps: Math.round(draft.thresholdPct * 100),
        emergencyCap: usdcToRaw(200),
        velocityThreshold: usdcToRaw(n(draft.daily)),
        lossTriggerUsdc: usdcToRaw(n(draft.lossTrigger)),
        lossCooldownSecs: BigInt(Math.round(draft.lossCooldownHours * 3600)),
      }),
      registerOwnerIx({ authority: signer.publicKey, vault: vaultPk, owner: new PublicKey(draft.executionAddress), kind: OwnerType.Execution, label: draft.executionLabel || "Trading" }),
    ];
    if (draft.coldAddress) {
      ixs.push(registerOwnerIx({ authority: signer.publicKey, vault: vaultPk, owner: new PublicKey(draft.coldAddress), kind: OwnerType.Cold, label: draft.coldLabel || "Cold" }));
    }
    const execAta = getAssociatedTokenAddressSync(mint, new PublicKey(draft.executionAddress), true);
    ixs.push(createAssociatedTokenAccountIdempotentInstruction(signer.publicKey, execAta, new PublicKey(draft.executionAddress), mint));
    // Mark as activated before sending: the provider refreshes the vault as
    // soon as the transaction confirms, and the redirect guard must not fire
    // before the deposit step has been shown.
    setActivated(true);
    try {
      await run("Shield activated", ixs);
      await refresh();
    } catch {
      setActivated(false);
    }
  };

  const deposit = async () => {
    if (!usdcMint || !vaultAddress) return;
    const mint = new PublicKey(usdcMint);
    const ata = getAssociatedTokenAddressSync(mint, signer.publicKey, true);
    try {
      await run(`Deposited ${usd(usdcToRaw(n(draft.deposit)))}`, [depositIx({ depositor: signer.publicKey, vault: vaultAddress, sourceTokenAccount: ata, amount: usdcToRaw(n(draft.deposit)) })]);
      setDeposited(true);
      setTimeout(() => navigate("/"), 600);
    } catch {
      /* toast shown */
    }
  };

  const faucet = async () => {
    setFaucetBusy(true);
    try {
      await getJson(`${API_URL}/api/demo/faucet`, { method: "POST", body: JSON.stringify({ owner: signer.publicKey.toBase58(), amountUsdc: n(draft.deposit) || 10000 }) });
      toast.ok("Test USDC added to your wallet");
      await refresh();
    } catch (e) {
      toast.err(`Faucet failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setFaucetBusy(false);
    }
  };

  const dep = n(draft.deposit);
  const floor = Math.min(n(draft.floor), dep);
  const floorPct = dep > 0 ? Math.min(100, Math.round((n(draft.floor) / dep) * 100)) : 0;

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
              <h1>Let Shield learn how you actually trade</h1>
              <p>Paste your Hyperliquid address and Shield reads your real history from the venue: sessions, reloads, what came back. Nothing is uploaded anywhere but the public API you already trade on.</p>
            </div>
            <div className="card stack">
              <Field label="Hyperliquid address" hint="Your account (master) address. Mainnet history, read-only.">
                <div className="row" style={{ gap: 8 }}>
                  <input className="input mono" value={hlAddress} onChange={(e) => setHlAddress(e.target.value.trim())} placeholder="0x…" />
                  <button className="btn btn-secondary" disabled={hlBusy || !hlAddress} onClick={() => void analyseHl()}>{hlBusy ? "Reading…" : "Analyse"}</button>
                </div>
              </Field>
              {hlError && <p className="tiny c-blocked">{hlError}</p>}
              {hlProfile && (
                <div className="stack-s">
                  {hlProfile.insight ? (
                    <div className="quote-box">{hlProfile.insight}</div>
                  ) : (
                    <p className="small dim">{hlProfile.totals.sessions === 0 ? "No deposits or trades found for this address on mainnet yet." : "Not enough closed sessions to say anything you'd trust yet."}</p>
                  )}
                  <div className="stat-grid">
                    <div className="stat"><div className="k">Sessions</div><div className="v">{hlProfile.totals.sessions}</div></div>
                    <div className="stat"><div className="k">Typical session</div><div className="v">{hlProfile.typicalSessionSize === null ? "—" : usd(hlProfile.typicalSessionSize)}</div></div>
                    <div className="stat"><div className="k">Largest losing session</div><div className="v c-blocked">{hlProfile.largestLosingSession ? usd(Math.abs(hlProfile.largestLosingSession.pnl)) : "—"}</div></div>
                    <div className="stat"><div className="k">Reloads after a loss</div><div className="v">{hlProfile.sessionsWithReloadAfterLoss}</div></div>
                  </div>
                  {hlProfile.suggestions.length > 0 && <p className="small dim">Shield pre-selected the patterns below that your history supports. Untick anything you disagree with.</p>}
                </div>
              )}
            </div>
            <div>
              <h2 className="title">What usually gets you into trouble?</h2>
              <p className="dim" style={{ marginTop: 4 }}>Pick anything that's true. Shield proposes your rules from it. Nothing here is a diagnosis; it's what you already know about yourself when you're calm.</p>
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
                <p style={{ fontWeight: 600 }}>What should Shield remind you when it blocks you?</p>
                <p className="small dim" style={{ marginTop: 2 }}>Past-you will say it, not an app. Something like: "You've already lost what you agreed to lose. Don't add another $1,500."</p>
              </div>
              <textarea className="input" rows={3} value={prefs.calmMessage} onChange={(e) => setPrefs({ calmMessage: e.target.value.slice(0, 280) })} placeholder="If you're seeing this…" />
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="stack">
            <div className="page-head" style={{ marginBottom: 0 }}>
              <h1>Where does your money go?</h1>
              <p>Shield can only send to wallets you register now. Your trading wallet gets top-ups under your rules. A cold wallet is where you exit to.</p>
            </div>
            <div className="card stack">
              <p className="eyebrow">Trading wallet</p>
              <Field label="Address" hint="Axiom, a Telegram bot, an exchange deposit address: wherever you actually trade from.">
                <input className="input mono" value={draft.executionAddress} onChange={(e) => set({ executionAddress: e.target.value.trim() })} placeholder="Solana address" />
              </Field>
              <Field label="Name">
                <input className="input" value={draft.executionLabel} onChange={(e) => set({ executionLabel: e.target.value.slice(0, 24) })} />
              </Field>
            </div>
            <div className="card stack">
              <p className="eyebrow">Cold wallet · optional now, 24h to add later</p>
              <Field label="Address" hint="A wallet you control and don't trade from. Small emergency amounts can move here instantly; a full exit takes 7 days.">
                <input className="input mono" value={draft.coldAddress} onChange={(e) => set({ coldAddress: e.target.value.trim() })} placeholder="Solana address" />
              </Field>
              <Field label="Name">
                <input className="input" value={draft.coldLabel} onChange={(e) => set({ coldLabel: e.target.value.slice(0, 24) })} />
              </Field>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="stack">
            <div className="page-head" style={{ marginBottom: 0 }}>
              <h1>Choose your protection</h1>
              <p>{prefs.troubles.length ? `Proposed from what you told us${prefs.troubles.includes("chasing") ? ": a tighter loss trigger and a full-day pause" : ""}${prefs.troubles.includes("reloads") || prefs.troubles.includes("allin") ? ", a smaller daily limit" : ""}${prefs.troubles.includes("savings") ? ", a higher floor" : ""}. Edit anything.` : "Set these while you're calm."} Tightening any of them later is instant. Loosening waits 24 hours.</p>
            </div>
            <div className="card stack">
              <Field label="Capital you'll deposit">
                <MoneyInput value={draft.deposit} onChange={(v) => set({ deposit: v })} />
              </Field>
              <Field label="Protected floor" hint={`Top-ups can never take the treasury below this. ${floorPct}% of your deposit stays untouchable.`}>
                <MoneyInput value={draft.floor} onChange={(v) => set({ floor: v })} />
                <div className="chips" style={{ marginTop: 8 }}>
                  {[50, 60, 70, 80].map((p) => (
                    <button key={p} className={`chip ${floorPct === p ? "active" : ""}`} onClick={() => set({ floor: String(Math.round((dep * p) / 100)) })}>
                      {p}%
                    </button>
                  ))}
                </div>
              </Field>
              {dep > 0 && (
                <div>
                  <CapitalBar floor={usdcToRaw(floor)} room={usdcToRaw(Math.max(0, dep - floor))} trade={0n} />
                  <div className="legend">
                    <span><i style={{ background: "var(--protect)" }} />Never touched <b>{usd(floor)}</b></span>
                    <span><i style={{ background: "var(--protect-2)" }} />Refillable by rule <b>{usd(Math.max(0, dep - floor))}</b></span>
                  </div>
                </div>
              )}
              <Field label="Daily top-up limit" hint="Everything that leaves for trading in any rolling 24 hours, added together. Four $500 top-ups count as $2,000.">
                <MoneyInput value={draft.daily} onChange={(v) => set({ daily: v })} />
              </Field>
            </div>
            <div className="card stack">
              <p className="eyebrow">After losses</p>
              <Field label="Loss trigger" hint="When what comes back from your trading wallet is this much short of what you sent, within 24 hours, Shield pauses top-ups.">
                <MoneyInput value={draft.lossTrigger} onChange={(v) => set({ lossTrigger: v })} />
              </Field>
              <Field label="Pause length">
                <div className="chips">
                  {[6, 12, 18, 24, 48].map((h) => (
                    <button key={h} className={`chip ${draft.lossCooldownHours === h ? "active" : ""}`} onClick={() => set({ lossCooldownHours: h })}>
                      {h}h
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Large top-ups wait 30 minutes from" hint="A single top-up at or above this share of the treasury waits half an hour before it can move.">
                <div className="chips">
                  {[10, 20, 30, 50].map((p) => (
                    <button key={p} className={`chip ${draft.thresholdPct === p ? "active" : ""}`} onClick={() => set({ thresholdPct: p })}>
                      {p}%
                    </button>
                  ))}
                </div>
              </Field>
            </div>
            <div className="card">
              <div className="row-between" style={{ gap: 16 }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontWeight: 600 }}>Shield monitor</p>
                  <p className="small dim">Watches your trading wallet's real on-chain flows. It can only ever pause top-ups by your loss rule. It can't move money or loosen anything.</p>
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
              <p>The vault program enforces these. Read them like a contract with yourself.</p>
            </div>
            <div className="card">
              <div className="list">
                {[
                  <>Of the <b>{usd(dep)}</b> I deposit, <b>{usd(n(draft.floor))}</b> is never touched by a top-up.</>,
                  <>I can send at most <b>{usd(n(draft.daily))}</b> to my trading wallet in any 24 hours, however I split it.</>,
                  <>After I lose <b>{usd(n(draft.lossTrigger))}</b> or more in a day, top-ups are blocked for <b>{hoursLabel(draft.lossCooldownHours * 3600)}</b>.</>,
                  <>Any single top-up worth <b>{draft.thresholdPct}%</b> of the treasury or more waits <b>30 minutes</b>.</>,
                  <>Making any rule stricter is instant. Making any rule weaker waits <b>24 hours</b>, and I can cancel it any time.</>,
                  <>Up to <b>$200</b> can move to my cold wallet instantly. Leaving Shield takes <b>7 days</b>.</>,
                  <>Only my wallet can move funds. Shield's monitor can pause top-ups by rule 3, and nothing else.</>,
                ].map((s, i) => (
                  <div key={i} className="rule" style={{ padding: "12px 0" }}>
                    <div className="s">{s}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="stack">
            <div className="page-head" style={{ marginBottom: 0 }}>
              <h1>{activated ? "Shield is active" : "Activate Shield"}</h1>
              <p>{activated ? "Now move capital into the treasury. Deposits are always allowed; only what leaves is governed." : "One transaction creates your vault and registers your wallets."}</p>
            </div>
            {!activated ? (
              <div className="card stack">
                <div className="notice-list">
                  <div className="notice"><Dot tone="protect" /><span>Creates your vault, owned by <span className="mono">{short(signer.publicKey.toBase58())}</span> and nobody else.</span></div>
                  <div className="notice"><Dot tone="bankroll" /><span>Registers <b>{draft.executionLabel || "Trading"}</b> as your trading wallet.</span></div>
                  {draft.coldAddress && <div className="notice"><Dot tone="protect" /><span>Registers <b>{draft.coldLabel || "Cold"}</b> as your cold wallet.</span></div>}
                  <div className="notice"><Dot tone={draft.monitor && health?.monitor.verifier ? "protect" : "neutral"} /><span>{draft.monitor && health?.monitor.verifier ? "Turns on the Shield monitor for your loss rule." : "No monitor for now. Adding one later is instant."}</span></div>
                </div>
                <button className="btn btn-lg btn-block" onClick={() => void activate()} disabled={!!busy || !usdcMint}>
                  {busy ? "Confirming…" : "Create my vault"}
                </button>
                <p className="tiny muted">Program {health?.programId ? short(health.programId, 6) : "…"} · USDC {usdcMint ? short(usdcMint, 6) : "not configured"}</p>
              </div>
            ) : (
              <div className="card stack">
                <Field label="Deposit into the treasury" hint={`In your wallet: ${walletUsdc === null ? "…" : usd(walletUsdc)} USDC`}>
                  <MoneyInput value={draft.deposit} onChange={(v) => set({ deposit: v })} />
                </Field>
                {walletUsdc !== null && walletUsdc < usdcToRaw(n(draft.deposit)) && NETWORK !== "mainnet-beta" && health?.demo && (
                  <div className="warn-box row-between">
                    <span>You need test USDC first.</span>
                    <button className="btn btn-secondary btn-sm" onClick={() => void faucet()} disabled={faucetBusy}>
                      {faucetBusy ? "Adding…" : `Get ${usd(n(draft.deposit) || 10000)} test USDC`}
                    </button>
                  </div>
                )}
                <button className="btn btn-lg btn-block btn-protect" onClick={() => void deposit()} disabled={!!busy || deposited || (walletUsdc !== null && walletUsdc < usdcToRaw(n(draft.deposit)))}>
                  {deposited ? <><Icon name="check" size={18} /> Deposited</> : busy ? "Confirming…" : `Deposit ${usd(n(draft.deposit))}`}
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
            {step === 3 ? "Looks right" : step === 0 && prefs.troubles.length === 0 ? "Skip" : "Continue"}
          </button>
        </div>
      )}
    </main>
  );
}
