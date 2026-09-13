/**
 * First use, as one story:
 *   connect → Shield understands me → proves where it would have helped →
 *   recommends protection → I accept → active.
 * Every number on these screens comes from the trader's own Hyperliquid
 * history. Nothing here predicts an outcome; the counterfactual only says what
 * Shield would have kept out of a session that already happened.
 */
import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useShield, API_URL } from "../lib/shield";
import { getJson, type HlProfileJson } from "../lib/api";
import { useAction } from "../lib/actions";
import { Field, MoneyInput, Sheet, useToast } from "../components/ui";
import { Replay } from "../components/Replay";
import { usePrefs } from "../lib/prefs";
import { ladderHashOf, randomSalt, writeLadder } from "../lib/ladder-store";
import { usdcToRaw, OwnerKind, Route } from "../../../client/views";
import type { RegistrationInput } from "../../../client/solana-adapter";
import "../onboard.css";

type Step = "entry" | "analysing" | "reveal" | "replay" | "counterfactual" | "recommend" | "save" | "protect" | "activating" | "active";
/**
 * A public Hyperliquid mainnet account, picked because its worst session states
 * the whole thesis in three numbers a stranger can read in four seconds: down
 * $1,302, added $13,894, finished at -$117,089 fifty-seven minutes later. The
 * ladder Shield proposes from this trader's own history would have released
 * $3,750 of that addition, not $13,894.
 *
 * The previous example reloaded $300 and finished $848 down, which is true and
 * forgettable. Chosen by scanning the $5k-$150k band of Hyperliquid's public
 * leaderboard for sessions with a real drawdown at the moment of the reload —
 * an account barely down when it reloads is not the behaviour Shield is about.
 * All of it is public on-chain history; nothing here needs credentials.
 */
const EXAMPLE = "0x92a7bc9b107bdd35e3db97dc171d5a8c1ee33fea";
const isAddr = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s.trim());
const usd0 = (n: number) => `$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
const dayTime = (ms: number) => new Date(ms).toLocaleString("en-US", { weekday: "long", hour: "numeric", minute: "2-digit" });

interface Plan { normal: number; reduced: number; reducedAt: number; lockAt: number }

export function Onboard() {
  const { signer, vault, vaultKnown, privy, connectDemo, actions, health, usdc, refresh, chain } = useShield();
  const { run, busy } = useAction();
  const toast = useToast();
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const [step, setStep] = useState<Step>(() => (sessionStorage.getItem("shield.onboard.step") as Step) || "entry");
  const [addr, setAddr] = useState(() => sessionStorage.getItem("shield.onboard.addr") ?? "");
  const [extra, setExtra] = useState<string[]>(() => { const raw = sessionStorage.getItem("shield.onboard.extra"); return raw ? (JSON.parse(raw) as string[]) : []; });
  const [extraDraft, setExtraDraft] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [baseSession, setBaseSession] = useState("");
  const [baseBad, setBaseBad] = useState("");
  const [net, setNet] = useState<"mainnet" | "testnet">("mainnet");
  const [profile, setProfile] = useState<HlProfileJson | null>(() => { const raw = sessionStorage.getItem("shield.onboard.profile"); return raw ? (JSON.parse(raw) as HlProfileJson) : null; });
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan | null>(() => { const raw = sessionStorage.getItem("shield.onboard.plan"); return raw ? (JSON.parse(raw) as Plan) : null; });
  const [adjust, setAdjust] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [calcOpen, setCalcOpen] = useState(false);
  const [protect, setProtect] = useState<number>(250);
  const [custom, setCustom] = useState("");
  const [demoOpen, setDemoOpen] = useState(false);
  const [demoKey, setDemoKey] = useState("");
  const [activeStage, setActiveStage] = useState(0);
  const [, setPrefs] = usePrefs(signer?.address ?? null);

  // Deep link: /start?a=0x…[,0x…][&net=testnet] analyses on arrival, so a link can
  // carry the evidence instead of asking the reader to go and find it. Only fires
  // on a first visit — a returning session already has its own state to restore,
  // and re-running the analysis would throw away where they had got to.
  const deepLinked = useRef(false);
  useEffect(() => {
    if (deepLinked.current) return;
    deepLinked.current = true;
    const q = new URLSearchParams(window.location.search);
    const a = (q.get("a") ?? q.get("address") ?? "").trim();
    if (!a || sessionStorage.getItem("shield.onboard.profile")) return;
    const wallets = a.split(",").map((w) => w.trim()).filter((w) => /^0x[0-9a-fA-F]{40}$/.test(w));
    if (wallets.length === 0) return;
    if (q.get("net") === "testnet") setNet("testnet");
    setAddr(wallets[0]);
    setExtra(wallets.slice(1));
    void analyse(wallets[0], wallets.slice(1), q.get("net") === "testnet" ? "testnet" : "mainnet");
  }, []);

  useEffect(() => { sessionStorage.setItem("shield.onboard.step", step); }, [step]);
  useEffect(() => { sessionStorage.setItem("shield.onboard.addr", addr); }, [addr]);
  useEffect(() => { sessionStorage.setItem("shield.onboard.extra", JSON.stringify(extra)); }, [extra]);
  useEffect(() => { if (profile) sessionStorage.setItem("shield.onboard.profile", JSON.stringify(profile)); }, [profile]);
  useEffect(() => { if (plan) sessionStorage.setItem("shield.onboard.plan", JSON.stringify(plan)); }, [plan]);
  // A returning user with a vault does not need this.
  useEffect(() => { if (signer && vaultKnown && vault && step !== "active" && step !== "activating") navigate("/", { replace: true }); }, [signer, vaultKnown, vault, step, navigate]);
  // Signing in during "save" advances by itself.
  useEffect(() => { if (step === "save" && signer) setStep("protect"); }, [step, signer]);

  const replay = profile?.replay ?? null;
  const rec = profile?.recommendation ?? null;

  /** `others`/`network` let the deep link analyse before its setState has landed. */
  const analyse = async (a: string, others?: string[], network?: "mainnet" | "testnet") => {
    setError(null);
    setStep("analysing");
    const started = Date.now();
    try {
      const rest = others ?? extra;
      const all = [a.trim(), ...rest.filter((e) => isAddr(e) && e.toLowerCase() !== a.trim().toLowerCase())];
      const p = await getJson<HlProfileJson>(`${API_URL}/api/hyperliquid/${all.join(",")}?network=${network ?? net}`);
      const wait = Math.max(0, 3200 - (Date.now() - started));
      await new Promise((r) => setTimeout(r, wait));
      setProfile(p);
      if (p.recommendation) setPlan({ normal: p.recommendation.normalDailyUsd, reduced: p.recommendation.reducedDailyUsd, reducedAt: p.recommendation.reducedAtUsd, lockAt: p.recommendation.lockAtUsd });
      else setPlan({ normal: 150, reduced: 25, reducedAt: 50, lockAt: 100 });
      setStep("reveal");
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setError(/fetch|network|refused|load/i.test(m) ? "Couldn't reach Shield's history service. Check your connection and try again." : /502|hyperliquid/i.test(m) ? "Hyperliquid didn't answer for that address. Check it and try again." : m);
      setStep("entry");
    }
  };
  const walletCount = 1 + extra.filter(isAddr).length;

  const activate = async () => {
    if (!actions || !usdc || !plan || !signer) return;
    setStep("activating");
    try {
      const amount = protect;
      // The daily allowance never exceeds 60% of what is protected, so a floor always remains.
      const normal = Math.max(5, Math.min(plan.normal, Math.round(amount * 0.6)));
      const floor = Math.max(0, amount - normal);
      const regs: RegistrationInput[] = [addr.trim(), ...extra.filter(isAddr)].map((owner, i) => ({ owner, kind: OwnerKind.Execution, route: chain === "evm" ? Route.HyperCore : Route.Evm, label: i === 0 ? "Hyperliquid" : `Hyperliquid ${i + 1}` }));
      const verifier = health?.monitor.verifier ?? null;
      await run("Shield created", actions.activate({
        riskVerifier: verifier,
        protectedFloor: usdcToRaw(floor),
        topUpThresholdBps: 10_000,
        emergencyCap: usdcToRaw(Math.min(200, amount)),
        velocityThreshold: usdcToRaw(normal),
        lossTriggerUsdc: usdcToRaw(plan.lockAt),
        lossCooldownSecs: 12n * 3600n,
      }, regs), { silent: true });
      setActiveStage(1);
      // Private half stays here; only the hash goes on chain.
      const ladder = { v: 1 as const, reducedAtUsdc: usdcToRaw(plan.reducedAt), reducedVelocityThreshold: usdcToRaw(Math.min(plan.reduced, normal)), tierResetSecs: 86_400n, salt: randomSalt() };
      writeLadder(signer.address, ladder);
      if (chain === "evm") await run("Bad-session plan committed", actions.commitLadder(ladderHashOf(ladder), ladder.reducedVelocityThreshold, ladder.tierResetSecs), { silent: true });
      setActiveStage(2);
      setPrefs({ hyperliquidAddress: addr.trim() });
      // Funding: on a demo network mint test USDC first; on a live one the wallet must hold it.
      if (health?.demo) {
        await getJson(`${API_URL}/api/demo/faucet`, { method: "POST", body: JSON.stringify({ owner: signer.address, amountUsdc: amount, mint: usdc }) }).catch(() => null);
        await refresh();
      }
      try {
        await run(`Protected ${usd0(amount)}`, actions.deposit(usdcToRaw(amount)), { silent: true });
        setActiveStage(3);
      } catch {
        toast.err(`Your Shield exists, but the deposit did not go through. Send USDC to ${signer.address.slice(0, 6)}… and deposit from Home.`);
        setActiveStage(3);
      }
      await refresh();
      setStep("active");
    } catch (e) {
      toast.err(e instanceof Error ? e.message : String(e));
      setStep("protect");
    }
  };

  const useDemo = () => {
    const hex = demoKey.trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) return toast.err("Paste a 0x-prefixed 32-byte key.");
    connectDemo(hex);
    setDemoOpen(false);
  };

  const finish = () => { sessionStorage.removeItem("shield.onboard.step"); navigate("/", { replace: true }); };

  const fade = reduce ? {} : { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -8 }, transition: { duration: 0.35 } };

  return (
    <main className="ob">
      <AnimatePresence mode="wait">
        {step === "entry" && (
          <motion.section key="entry" className="ob-stage ob-entry" {...fade}>
            <div className="ob-brand">Shield</div>
            <h1 className="ob-display">Set your limits while calm.</h1>
            <p className="ob-lead">Connect your Hyperliquid account and Shield will look for the moments where adding capital made a losing session worse.</p>
            <div className="ob-entry-form">
              <input className="ob-input" value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="Your Hyperliquid address (0x…)" spellCheck={false} autoComplete="off" inputMode="text" />
              <button className="btn btn-lg ob-cta" disabled={!isAddr(addr)} onClick={() => void analyse(addr)}>Analyse my trading</button>
            </div>
            <div className="ob-wallets">
              {extra.filter(isAddr).map((w) => (
                <div key={w} className="ob-wallet"><span className="mono">{w.slice(0, 6)}…{w.slice(-4)}</span><button className="linkish" onClick={() => setExtra((xs) => xs.filter((x) => x !== w))}>remove</button></div>
              ))}
              <button className="linkish" onClick={() => setAddOpen(true)}>+ Add trading wallet</button>
            </div>
            <div className="ob-entry-alt">
              <button className="linkish" onClick={() => { setAddr(EXAMPLE); void analyse(EXAMPLE); }}>Try with an example account</button>
              <span className="ob-sep">·</span>
              <button className="linkish" onClick={() => setNet((n) => (n === "mainnet" ? "testnet" : "mainnet"))}>History from {net}</button>
            </div>
            {error && <p className="small" style={{ color: "var(--blocked)" }}>{error}</p>}
            <p className="ob-reassure">No funds moved · Uses your trading history</p>
            <p className="ob-foot"><button className="linkish" onClick={() => navigate("/landing")}>What is Shield?</button>{signer ? null : <> · <button className="linkish" onClick={() => navigate("/welcome")}>Already have a Shield</button></>}</p>
          </motion.section>
        )}

        {step === "analysing" && (
          <motion.section key="analysing" className="ob-stage ob-analysing" {...fade}>
            <Analysing profile={profile} />
          </motion.section>
        )}

        {step === "reveal" && profile && (
          <motion.section key="reveal" className="ob-stage" {...fade}>
            {replay ? (
              <>
                <p className="ob-eyebrow">What Shield found</p>
                <h1 className="ob-display-s">We found {profile.sessionsWithReloadAfterLoss} session{profile.sessionsWithReloadAfterLoss === 1 ? "" : "s"} where you added capital while already down.</h1>
                <div className="ob-reveal">
                  <p className="ob-eyebrow">Your most expensive reload session</p>
                  <p className="ob-reveal-line">You were down <b>{usd0(replay.pnlAtReload)}</b> when you added another <b>{usd0(replay.reloadAmount)}</b>.</p>
                  <p className="ob-reveal-line dim">
                    {replay.pnlAfter <= replay.pnlAtReload * 1.5 ? <>{replay.minutesAfter} minute{replay.minutesAfter === 1 ? "" : "s"} later your realised session loss had grown to {usd0(replay.pnlAfter)}. </> : null}
                    The session finished at <b className="neg">−{usd0(replay.finalPnl)}</b>.
                  </p>
                  <p className="ob-reveal-when">{dayTime(replay.timeline[replay.reloadIndex].time)}</p>
                </div>
                <button className="btn btn-lg ob-cta" onClick={() => setStep("replay")}>Replay what happened</button>
              </>
            ) : (
              <>
                <p className="ob-eyebrow">What Shield found</p>
                <h1 className="ob-display-s">Your history doesn't show a strong reload-after-loss pattern yet.</h1>
                <p className="ob-lead">{profile.insight ?? `${profile.totals.sessions} session${profile.totals.sessions === 1 ? "" : "s"} read.`} We can still create a simple baseline Shield from two numbers.</p>
                <div className="ob-two">
                  <Field label="How much do you usually put into a session?"><MoneyInput value={baseSession} onChange={setBaseSession} placeholder={String(profile.typicalSessionSize ? Math.round(profile.typicalSessionSize) : 500)} /></Field>
                  <Field label="In a bad session, how much should still be addable per day?"><MoneyInput value={baseBad} onChange={setBaseBad} placeholder={String(Math.max(5, Math.round((Number(baseSession) || profile.typicalSessionSize || 500) * 0.15)))} /></Field>
                </div>
                <button className="btn btn-lg ob-cta" onClick={() => {
                  const session = Number(baseSession) || profile.typicalSessionSize || 500;
                  const bad = Number(baseBad) || Math.max(5, Math.round(session * 0.15));
                  setPlan({ normal: Math.round(session), reduced: Math.round(bad), reducedAt: Math.max(10, Math.round(session * 0.2)), lockAt: Math.max(20, Math.round(session * 0.6)) });
                  setStep("recommend");
                }}>Build my baseline</button>
              </>
            )}
            <p className="ob-foot"><button className="linkish" onClick={() => setStep("entry")}>Use a different address</button></p>
          </motion.section>
        )}

        {step === "replay" && replay && (
          <motion.section key="replay" className="ob-stage ob-wide" {...fade}>
            <p className="ob-eyebrow">{dayTime(replay.openedAt)} · your session, as it happened</p>
            <Boundary fallback={(m) => <p className="small" style={{ color: "var(--blocked)" }}>The replay could not render ({m}). The numbers above are still from your history.</p>}><Replay replay={replay} mode="play" /></Boundary>
            <div className="ob-actions">
              <button className="btn btn-lg ob-cta" onClick={() => setStep("counterfactual")}>Show where Shield steps in</button>
            </div>
            <p className="ob-note">Realised PnL from your closes, minus fees, and every capital addition, from Hyperliquid's own records.</p>
          </motion.section>
        )}

        {step === "counterfactual" && replay && rec?.counterfactual && (
          <motion.section key="cf" className="ob-stage ob-wide" {...fade}>
            <p className="ob-eyebrow">The same session, with Shield</p>
            <Boundary fallback={(m) => <p className="small" style={{ color: "var(--blocked)" }}>The replay could not render ({m}).</p>}><Replay replay={replay} mode="counterfactual" availableAmount={rec.counterfactual.available} protectedAmount={rec.counterfactual.protected} /></Boundary>
            <div className="ob-cf-copy">
              <p className="ob-reveal-line">Shield couldn't undo the loss.</p>
              <p className="ob-reveal-line">It could have kept <b>{usd0(rec.counterfactual.protected)}</b> of protected capital out of this session.</p>
            </div>
            <div className="ob-actions">
              <button className="btn btn-lg ob-cta btn-protect" onClick={() => setStep("recommend")}>Protect me from this</button>
              <button className="linkish" onClick={() => setCalcOpen(true)}>See how this was calculated</button>
            </div>
          </motion.section>
        )}

        {step === "recommend" && plan && (
          <motion.section key="rec" className="ob-stage" {...fade}>
            <p className="ob-eyebrow">Based on what we just saw</p>
            <h1 className="ob-display-s">Your Shield</h1>
            <div className="ob-plan">
              <div className="ob-plan-row"><span>Normally</span><b>Up to {usd0(plan.normal)} / day</b></div>
              <div className="ob-plan-row"><span>Bad session</span><b>Available capital drops to {usd0(plan.reduced)}</b></div>
              <div className="ob-plan-row"><span>Severe loss</span><b>Pause additional funding</b></div>
            </div>
            <p className="ob-note">{rec?.basis ?? "A simple baseline; adjust anything later in Protection."}</p>
            <div className="ob-private">
              <span className="ob-lock" aria-hidden>🔒</span>
              <div>
                <b>Private trigger</b>
                <p className="small dim">Your exact loss level stays private. Shield reveals only the resulting protection level. <button className="linkish" onClick={() => setPrivacyOpen(true)}>How privacy works</button></p>
              </div>
            </div>
            <div className="ob-actions">
              <button className="btn btn-lg ob-cta btn-protect" onClick={() => setStep(signer ? "protect" : "save")}>Use this protection</button>
              <button className="linkish" onClick={() => setAdjust(true)}>Adjust</button>
            </div>
          </motion.section>
        )}

        {step === "save" && (
          <motion.section key="save" className="ob-stage" {...fade}>
            <p className="ob-eyebrow">Almost there</p>
            <h1 className="ob-display-s">Save your Shield.</h1>
            <p className="ob-lead">A wallet is created for you behind the scenes. No seed phrase, nothing to install.</p>
            <div className="ob-actions">
              {privy.available ? (
                <button className="btn btn-lg ob-cta" disabled={!privy.ready} onClick={() => privy.login()}>{privy.ready ? "Continue with email" : "Loading…"}</button>
              ) : (
                <button className="btn btn-lg ob-cta" onClick={() => setDemoOpen(true)}>Continue with a local key</button>
              )}
              {privy.available && <button className="linkish" onClick={() => setDemoOpen(true)}>Use a local key instead</button>}
            </div>
          </motion.section>
        )}

        {step === "protect" && plan && (
          <motion.section key="protect" className="ob-stage" {...fade}>
            <p className="ob-eyebrow">One decision</p>
            <h1 className="ob-display-s">How much capital do you want Shield to protect?</h1>
            <div className="ob-amounts">
              {[100, 250, 500].map((a) => <button key={a} className={`ob-amount ${protect === a && !custom ? "on" : ""}`} onClick={() => { setProtect(a); setCustom(""); }}>${a}</button>)}
              <div className={`ob-amount ob-amount-custom ${custom ? "on" : ""}`}><MoneyInput value={custom} onChange={(v) => { setCustom(v); if (Number(v) > 0) setProtect(Number(v)); }} placeholder="Custom" variant="inline" /></div>
            </div>
            <p className="ob-note">This is the capital Shield can enforce limits over. Your trading account is not touched.</p>
            <div className="ob-actions">
              <button className="btn btn-lg ob-cta btn-protect" disabled={!!busy || !(protect > 0) || !actions} onClick={() => void activate()}>Protect {usd0(protect)}</button>
            </div>
            {!health?.demo && <p className="ob-note">Your wallet ({signer?.address.slice(0, 6)}…) needs {usd0(protect)} USDC on {chain === "evm" ? "HyperEVM" : "Solana"} first.</p>}
          </motion.section>
        )}

        {(step === "activating" || step === "active") && plan && (
          <motion.section key="active" className="ob-stage ob-active" {...fade}>
            <Activation stage={step === "active" ? 3 : activeStage} normal={Math.max(5, Math.min(plan.normal, Math.round(protect * 0.6)))} done={step === "active"} onGo={finish} wallets={walletCount} />
          </motion.section>
        )}
      </AnimatePresence>

      <Sheet open={adjust} onClose={() => setAdjust(false)} title="Adjust your Shield">
        {plan && (
          <>
            <Field label="Normally, release up to (per day)"><MoneyInput value={String(plan.normal)} onChange={(v) => setPlan({ ...plan, normal: Number(v) || 0 })} /></Field>
            <Field label="In a bad session, drop to (per day)"><MoneyInput value={String(plan.reduced)} onChange={(v) => setPlan({ ...plan, reduced: Number(v) || 0 })} /></Field>
            <Field label="A bad session means being down (private)" hint="Realised, within one session. Never goes on chain."><MoneyInput value={String(plan.reducedAt)} onChange={(v) => setPlan({ ...plan, reducedAt: Number(v) || 0 })} /></Field>
            <Field label="Pause additional funding after losing (per day)" hint="This one is public: it is what the vault checks."><MoneyInput value={String(plan.lockAt)} onChange={(v) => setPlan({ ...plan, lockAt: Number(v) || 0 })} /></Field>
            <button className="btn btn-block btn-lg" onClick={() => setAdjust(false)}>Done</button>
          </>
        )}
      </Sheet>
      <Sheet open={privacyOpen} onClose={() => setPrivacyOpen(false)} title="How privacy works">
        <p className="small">The level of loss at which your available capital drops is stored on chain only as a salted hash. The number itself lives on your device and in a Chainlink confidential workflow that runs inside a hardware enclave. When it decides you have crossed it, it signs only the resulting protection level; the vault checks that signature against the hash you committed and lowers your available capital. What is public: which level you are on and the budget each level applies. What is not: the loss figure that got you there.</p>
      </Sheet>
      <Sheet open={calcOpen} onClose={() => setCalcOpen(false)} title="How this was calculated">
        {replay && rec?.counterfactual && (
          <div className="small">
            <p>Your realised session PnL was {usd0(replay.pnlAtReload)} below zero when you added {usd0(replay.reloadAmount)}. With the plan Shield recommends, a bad session lowers the amount you can add to {usd0(rec.counterfactual.available)} a day, so {usd0(rec.counterfactual.protected)} of that addition would have stayed protected.</p>
            <p>What happened afterwards is history: the session finished at −{usd0(replay.finalPnl)}. Shield cannot say what your trades would have done with less capital, and does not.</p>
            <p className="dim">{rec.basis}</p>
          </div>
        )}
      </Sheet>
      <Sheet open={addOpen} onClose={() => setAddOpen(false)} title="Trading from another wallet?">
        <p className="small dim">Add it so Shield can build a more complete picture of your sessions.</p>
        <ul className="ob-benefits"><li>More complete session P&amp;L</li><li>Better reload detection</li><li>Better protection recommendations</li></ul>
        <input className="ob-input" value={extraDraft} onChange={(e) => setExtraDraft(e.target.value)} placeholder="0x…" spellCheck={false} />
        <button className="btn btn-block btn-lg" style={{ marginTop: 10 }} disabled={!isAddr(extraDraft)} onClick={() => { setExtra((xs) => [...xs, extraDraft.trim()]); setExtraDraft(""); setAddOpen(false); }}>+ Add trading wallet</button>
        <p className="tiny dim" style={{ marginTop: 10 }}>One wallet is enough for Shield to work. More wallets help it understand you better.</p>
      </Sheet>
      <Sheet open={demoOpen} onClose={() => setDemoOpen(false)} title="Use a local key">
        <p className="small dim">A 0x-prefixed private key for this network. Testnet only.</p>
        <input className="ob-input" value={demoKey} onChange={(e) => setDemoKey(e.target.value)} placeholder="0x…" spellCheck={false} />
        <button className="btn btn-block btn-lg" style={{ marginTop: 10 }} disabled={!demoKey.trim()} onClick={useDemo}>Continue</button>
      </Sheet>
    </main>
  );
}

/** The replay must never take the whole flow down with it. */
class Boundary extends Component<{ children: ReactNode; fallback: (msg: string) => ReactNode }, { msg: string | null }> {
  state = { msg: null as string | null };
  static getDerivedStateFromError(e: unknown) { console.error("Replay failed", e); return { msg: e instanceof Error ? e.message : String(e) }; }
  render() { return this.state.msg ? this.props.fallback(this.state.msg) : this.props.children; }
}

function Analysing({ profile }: { profile: HlProfileJson | null }) {
  const [tick, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 900); return () => clearInterval(t); }, []);
  const sessions = profile?.totals.sessions ?? null;
  const adds = profile ? profile.sessions.reduce((a, s) => a + s.reloads + (s.deployed > 0 ? 1 : 0), 0) : null;
  const rows = [
    { label: "Reading your Hyperliquid history…", done: tick >= 1 },
    { label: sessions !== null ? `Reconstructed ${sessions} trading session${sessions === 1 ? "" : "s"}` : "Reconstructing sessions…", done: tick >= 2 && sessions !== null },
    { label: adds !== null ? `Found ${adds} capital addition${adds === 1 ? "" : "s"}` : "Counting capital additions…", done: tick >= 3 && adds !== null },
  ];
  const found = profile ? profile.sessionsWithReloadAfterLoss : null;
  return (
    <div className="ob-steps">
      {rows.map((r, i) => (
        <motion.div key={i} className={`ob-step ${r.done ? "done" : ""}`} initial={{ opacity: 0, x: -6 }} animate={{ opacity: i <= tick ? 1 : 0.25, x: 0 }} transition={{ delay: i * 0.1 }}>
          <span className="ob-check" aria-hidden>{r.done ? "✓" : "•"}</span>{r.label}
        </motion.div>
      ))}
      {found !== null && tick >= 3 && (
        <motion.div className="ob-step ob-step-key" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
          Found {found} reload{found === 1 ? "" : "s"} while you were already down
        </motion.div>
      )}
    </div>
  );
}

function Activation({ stage, normal, done, onGo, wallets }: { stage: number; normal: number; done: boolean; onGo: () => void; wallets: number }) {
  const reduce = useReducedMotion();
  const [showState, setShowState] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => { if (done) { timer.current = window.setTimeout(() => setShowState(true), reduce ? 0 : 1400); return () => { if (timer.current) clearTimeout(timer.current); }; } }, [done, reduce]);
  const rungs = ["NORMAL", "REDUCED", "LOCKED"];
  return (
    <div className="ob-activation">
      {!showState ? (
        <>
          <p className="ob-eyebrow">{done ? "Protection online" : "Bringing your protection online"}</p>
          <div className="ob-rungs">
            {rungs.map((r, i) => <motion.div key={r} className="ob-rung" initial={{ opacity: 0.2 }} animate={{ opacity: stage > i || done ? 1 : 0.25 }} transition={{ delay: i * 0.15 }}>{r}</motion.div>)}
          </div>
          <p className="small dim">{["Creating your vault…", "Committing your plan…", "Protecting your capital…", "Done"][Math.min(3, stage)]}</p>
        </>
      ) : (
        <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}>
          <p className="ob-eyebrow ob-active-label">Shield active</p>
          <div className="ob-active-amount">{`$${normal.toLocaleString("en-US")}`}</div>
          <p className="ob-active-sub">available today</p>
          <p className="ob-lead">Trade normally. Shield will reduce additional capital access only if your pre-set conditions are reached.</p>
          <div className="ob-actions"><button className="btn btn-lg ob-cta" onClick={onGo}>Go to Shield</button></div>
          <p className="ob-reassure">{wallets} trading wallet{wallets === 1 ? "" : "s"} monitored · <a href="/protection">+ Add wallet</a></p>
        </motion.div>
      )}
    </div>
  );
}
