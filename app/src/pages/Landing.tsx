import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion, useAnimationFrame, useMotionValue, useMotionValueEvent, useReducedMotion, useScroll, useSpring, useTransform, type MotionValue } from "motion/react";
import { Icon } from "../components/ui";
import "../landing.css";

const fmt = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** Render a MotionValue<number> as formatted money text. */
function MoneyText({ value, className }: { value: MotionValue<number>; className?: string }) {
  const [text, setText] = useState(fmt(value.get()));
  useMotionValueEvent(value, "change", (v) => setText(fmt(v)));
  return <span className={className}>{text}</span>;
}

export function Landing() {
  const reduce = useReducedMotion();
  return (
    <div className="landing">
      <nav className="l-nav">
        <Link to="/" className="brand" aria-label="Shield">
          <Icon name="shield" size={22} />
          <span>Shield</span>
        </Link>
        <Link to="/welcome" className="cta">Open Shield</Link>
      </nav>

      <Hero />
      <Allocation reduce={!!reduce} />
      <Session reduce={!!reduce} />
      <Reach reduce={!!reduce} />
      <Principles />
      <Modes />
      <Product />
      <Final />
    </div>
  );
}

function Hero() {
  return (
    <section className="l-hero">
      <div className="l-aurora" aria-hidden>
        <i className="a1" />
        <i className="a2" />
        <i className="a3" />
      </div>
      <div className="l-wrap">
        <motion.p className="l-eyebrow" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2, duration: 0.8 }}>
          A financial control layer for people who trade
        </motion.p>
        <motion.h1 className="l-h1" style={{ marginTop: 18, maxWidth: "12ch" }} initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, ease: [0.2, 0.8, 0.2, 1] }}>
          Crypto gives you freedom.
        </motion.h1>
        <motion.p className="l-h2 l-serif sub" style={{ fontStyle: "italic", color: "var(--fg-2)" }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.1, duration: 1 }}>
          Sometimes too much.
        </motion.p>
        <motion.p className="l-lead" style={{ marginTop: 28 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.6, duration: 0.8 }}>
          The version of you making the decision changes. The permissions your wallet gives you don't. Shield separates the money you want to trade from the money you'll want to trade after you start losing.
        </motion.p>
      </div>
      <div className="l-scrollhint">
        Scroll
        <i />
      </div>
    </section>
  );
}

function Allocation({ reduce }: { reduce: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const p = useSpring(scrollYProgress, { stiffness: 120, damping: 30, mass: 0.4 });
  // 0 → 0.35: the total sits whole; 0.35 → 0.75: it splits.
  const protW = useTransform(p, [0.3, 0.75], reduce ? [85, 85] : [100, 85]);
  const tradeW = useTransform(p, [0.3, 0.75], reduce ? [15, 15] : [0, 15]);
  const protWpct = useTransform(protW, (v) => `${v}%`);
  const tradeWpct = useTransform(tradeW, (v) => `${v}%`);
  const tradeText = useTransform(tradeW, [0, 9], [0, 1]);
  const shieldLeft = useTransform(protW, (v) => `${v}%`);
  const shieldOpacity = useTransform(p, [0.6, 0.8], reduce ? [1, 1] : [0, 1]);
  const captionOpacity = useTransform(p, [0.75, 0.9], reduce ? [1, 1] : [0, 1]);
  const protAmt = useTransform(p, [0.3, 0.75], reduce ? [8500, 8500] : [10000, 8500]);
  const tradeAmt = useTransform(p, [0.3, 0.75], reduce ? [1500, 1500] : [0, 1500]);
  const labelMv = useTransform(p, (v) => (v < 0.5 ? "Total" : "Protected"));
  const [label, setLabel] = useState(reduce ? "Protected" : "Total");
  useMotionValueEvent(labelMv, "change", setLabel);

  return (
    <section className="l-scene l-scene-300" ref={ref}>
      <div className="l-sticky">
        <div className="l-wrap">
          <p className="l-eyebrow">Say you have $10,000</p>
          <h2 className="l-h2" style={{ marginTop: 14, maxWidth: "14ch" }}>
            Calm you knows <span className="l-serif" style={{ fontStyle: "italic" }}>your limits.</span>
          </h2>
          <div className="l-split">
            <div className="l-bar">
              <motion.div className="prot" style={{ width: protWpct }}>
                <MoneyText value={protAmt} className="amt l-num" />
                <span className="lbl">{label}</span>
              </motion.div>
              <motion.div className="trade" style={{ width: tradeWpct }}>
                <motion.span style={{ opacity: tradeText, display: "inline-flex", alignItems: "center" }}>
                  <span className="lbl" style={{ marginLeft: 0, marginRight: 12 }}>Trading</span>
                  <MoneyText value={tradeAmt} className="amt l-num" />
                </motion.span>
              </motion.div>
              <motion.div className="shield" style={{ left: shieldLeft, opacity: shieldOpacity }} />
            </div>
            <motion.div className="l-bar-legend" style={{ opacity: shieldOpacity }}>
              <span><i style={{ background: "#2f8a62" }} />Protected <b className="l-num"><MoneyText value={protAmt} /></b></span>
              <span><i style={{ background: "#3d64ad" }} />Trading <b className="l-num"><MoneyText value={tradeAmt} /></b></span>
            </motion.div>
          </div>
          <motion.p className="l-lead" style={{ marginTop: 22, opacity: captionOpacity }}>
            $8,500 is not trading money. $1,500 is. You decided that while you were calm, and Shield remembers it when you aren't.
          </motion.p>
        </div>
      </div>
    </section>
  );
}

function Session({ reduce }: { reduce: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const p = useSpring(scrollYProgress, { stiffness: 120, damping: 30, mass: 0.4 });
  const bankroll = useTransform(p, [0, 0.18, 0.4, 0.62, 0.85], reduce ? [420, 420, 420, 420, 420] : [1500, 1830, 1250, 820, 420]);
  const hue = useTransform(p, [0.18, 0.85], ["#9fe1bf", "#ff6b57"]);
  const shake = useTransform(p, [0.5, 0.85], reduce ? [0, 0] : [0, 6]);
  const t1 = useTransform(p, [0.42, 0.5], reduce ? [1, 1] : [0, 1]);
  const t2 = useTransform(p, [0.62, 0.7], reduce ? [1, 1] : [0, 1]);
  const t3 = useTransform(p, [0.82, 0.9], reduce ? [1, 1] : [0, 1]);
  const jitterX = useMotionValue(0);
  useAnimationFrame((t) => {
    const s = shake.get();
    jitterX.set(s > 0 ? Math.sin(t / 70) * s : 0);
  });
  const eyebrow = useTransform(p, (v) => (v < 0.18 ? "Tonight's session" : v < 0.4 ? "This is working" : v < 0.62 ? "Reference point moved" : "Chasing"));
  const [eyebrowText, setEyebrowText] = useState("Tonight's session");
  useMotionValueEvent(eyebrow, "change", setEyebrowText);

  return (
    <section className="l-scene l-scene-300" ref={ref}>
      <div className="l-sticky">
        <div className="l-wrap l-session">
          <div>
            <div className="l-bankroll">
              <div className="lab">{eyebrowText}</div>
              <motion.div style={{ color: hue, x: jitterX }}>
                <MoneyText value={bankroll} className="l-num" />
              </motion.div>
            </div>
          </div>
          <div className="l-thoughts" aria-hidden>
            <motion.div className="l-thought t1" style={{ opacity: t1, scale: t1 }}>"I can make it back."</motion.div>
            <motion.div className="l-thought t2" style={{ opacity: t2, scale: t2 }}>"One more."</motion.div>
            <motion.div className="l-thought t3" style={{ opacity: t3, scale: t3 }}>"Just add another $1,500."</motion.div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Reach({ reduce }: { reduce: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const p = useSpring(scrollYProgress, { stiffness: 140, damping: 28, mass: 0.4 });
  // coin travels from the vault (left) toward the venue (right), hits the wall at ~52%
  const coinLeft = useTransform(p, [0.1, 0.45, 0.5, 0.58], reduce ? ["44%", "44%", "44%", "44%"] : ["12%", "49%", "47%", "44%"]);
  const coinOpacity = useTransform(p, [0.05, 0.12, 0.62, 0.7], reduce ? [1, 1, 1, 1] : [0, 1, 1, 0]);
  const coinScale = useTransform(p, [0.44, 0.47, 0.5], reduce ? [1, 1, 1] : [1, 1.25, 0.9]);
  const wallScale = useTransform(p, [0.44, 0.47, 0.5], reduce ? [1, 1, 1] : [1, 1.6, 1]);
  const wallGlow = useTransform(p, [0.44, 0.47, 0.6], reduce ? [1, 1, 1] : [0.5, 1, 0.7]);
  const word = useTransform(p, [0.46, 0.5, 0.62, 0.7], reduce ? [1, 1, 1, 1] : [0, 1, 1, 0]);
  const wordScale = useTransform(p, [0.46, 0.5], reduce ? [1, 1] : [1.3, 1]);
  const calm = useTransform(p, [0.66, 0.8], reduce ? [1, 1] : [0, 1]);
  const bgTint = useTransform(p, [0.4, 0.5, 0.75], reduce ? ["rgba(0,0,0,0)", "rgba(0,0,0,0)", "rgba(0,0,0,0)"] : ["rgba(255,107,87,0)", "rgba(255,107,87,0.12)", "rgba(159,225,191,0.04)"]);
  const [phase, setPhase] = useState<"before" | "hit" | "after">("before");
  useMotionValueEvent(p, "change", (v) => setPhase(v < 0.46 ? "before" : v < 0.66 ? "hit" : "after"));

  return (
    <section className="l-scene l-scene-300" ref={ref}>
      <motion.div className="l-sticky" style={{ background: bgTint }}>
        <div className="l-wrap">
          <p className="l-eyebrow">{phase === "before" ? "Tilted you reaches for the other $8,500" : phase === "hit" ? "Shield" : "Everything calms"}</p>
          <div className="l-reach">
            <div className="l-vault">
              <div className="lab">Protected</div>
              <div className="amt l-num">$8,500</div>
            </div>
            <div className="l-venue">
              <div className="lab">Trading</div>
              <div className="amt l-num">$420</div>
            </div>
            <motion.div className="l-wall" style={{ scaleX: wallScale, opacity: wallGlow }} />
            <motion.div className="l-coin" style={{ left: coinLeft, opacity: coinOpacity, scale: coinScale }}>$1.5k</motion.div>
            <motion.div className="l-blocked-word" style={{ opacity: word, scale: wordScale }}>BLOCKED</motion.div>
          </div>
          <motion.div style={{ opacity: calm, marginTop: 36 }}>
            <h2 className="l-h2" style={{ maxWidth: "16ch" }}>
              Calm you sets the limits. <span className="l-serif" style={{ fontStyle: "italic", color: "var(--sage)" }}>Tilted you can't instantly undo them.</span>
            </h2>
            <p className="l-lead" style={{ marginTop: 20 }}>$8,500 stays exactly where calm you put it. Not a warning, not a nudge: the money cannot move.</p>
          </motion.div>
        </div>
      </motion.div>
    </section>
  );
}

function Principles() {
  return (
    <section className="l-section">
      <div className="l-wrap">
        <p className="l-eyebrow">How it feels</p>
        <h2 className="l-h2" style={{ marginTop: 14, maxWidth: "18ch" }}>Freedom inside your plan. Friction when expanding it.</h2>
        <div className="l-cols">
          {[
            ["Toward safety", "Instant", "Close a position, move idle capital back, pause funding, tighten a rule. Anything that makes you safer applies the moment you ask. Shield never traps you in risk."],
            ["Within your plan", "Invisible", "Trade the bankroll you allocated as fast as you like. No confirmations, no warnings, no nagging. A quiet \"within your plan\" and nothing else."],
            ["Expanding the plan", "Slow", "More capital after losses, a lower floor, a removed cooldown. Weaker changes wait 24 hours, and tomorrow-you has to say yes again."],
          ].map(([k, t, b]) => (
            <motion.div key={k} className="l-col" initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-10%" }} transition={{ duration: 0.6 }}>
              <div className="k">{k}</div>
              <div className="t">{t}</div>
              <div className="b">{b}</div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Modes() {
  return (
    <section className="l-section" style={{ paddingTop: 0 }}>
      <div className="l-wrap">
        <p className="l-eyebrow">One thesis, many nights</p>
        <h2 className="l-h3" style={{ marginTop: 14, maxWidth: "30ch" }}>The version of you making the decision changed. Your wallet's permissions didn't.</h2>
        <div className="l-modes">
          {[
            ["\"I'll make it back.\"", "Revenge trading"],
            ["\"Once I've started, I keep adding.\"", "Repeated top-ups"],
            ["\"Send it now, the window closes.\"", "Rushed transfers"],
            ["\"Move it to this recovery address.\"", "Scam urgency"],
          ].map(([q, k]) => (
            <motion.div key={k} className="l-mode" initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-10%" }} transition={{ duration: 0.5 }}>
              <div className="q">{q}</div>
              <div className="k">{k}</div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Product() {
  return (
    <section className="l-section" style={{ paddingTop: 0 }}>
      <div className="l-wrap l-product">
        <div>
          <p className="l-eyebrow">The moment it matters</p>
          <h2 className="l-h2" style={{ marginTop: 14 }}>Not tonight.</h2>
          <p className="l-lead" style={{ marginTop: 20 }}>
            When you reach for capital you decided not to risk, Shield doesn't lecture. It shows what happened, what's still protected, and when you can decide again. Every block is enforced on-chain, with the rejection there for anyone to verify.
          </p>
          <div className="l-insights">
            <div className="l-insight warn"><i /><span>You've realised $1,420 in losses in the last hour. Your 18-hour cooldown is active until 6:02 PM.</span></div>
            <div className="l-insight"><i /><span>You sent $1,500 to Axiom. $80 came back. Shield remembers the real numbers, from the chain, not your memory of them.</span></div>
            <div className="l-insight"><i /><span>Yesterday at 22:13 you asked to remove your loss protection. Still want to?</span></div>
          </div>
        </div>
        <motion.div className="l-phone" initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-10%" }} transition={{ duration: 0.7 }}>
          <div className="screen">
            <div className="row" style={{ gap: 8 }}>
              <span className="dot dot-blocked" />
              <span className="eyebrow c-blocked">Top-up blocked</span>
            </div>
            <div className="title-l" style={{ marginTop: 10 }}>$1,500 stays protected.</div>
            <p className="dim" style={{ marginTop: 8, fontSize: 15 }}>You've realised $1,080 in losses in the last 3 hours. Your 12-hour cooldown is active.</p>
            <div className="two-up" style={{ marginTop: 16 }}>
              <div><div className="k">Still in the treasury</div><div className="v">$8,500</div></div>
              <div><div className="k">Top up again in</div><div className="v">10:42:07</div></div>
            </div>
            <p className="small dim" style={{ marginTop: 14 }}>This is the rule you set while calm, doing exactly what you asked. Nothing was lost: the money never left.</p>
            <div className="row wrap" style={{ marginTop: 14, gap: 8 }}>
              <span className="btn btn-secondary btn-sm">See what happened</span>
              <span className="btn btn-sm">Get me safe</span>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

function Final() {
  return (
    <>
      <section className="l-final">
        <div className="l-wrap">
          <p className="l-eyebrow">Trade freely</p>
          <h2 className="l-h2" style={{ marginTop: 16 }}>
            Protect the money you <span className="l-serif" style={{ fontStyle: "italic" }}>didn't mean to risk.</span>
          </h2>
          <Link to="/welcome" className="btn btn-lg">Open Shield</Link>
          <p className="l-lead" style={{ margin: "26px auto 0", maxWidth: "44ch", fontSize: 15 }}>
            Self-custodial. Enforced by an immutable on-chain program. Remembered by The Graph. Judged inside a Chainlink confidential enclave that can only ever make you safer.
          </p>
        </div>
      </section>
      <footer className="l-wrap l-foot">
        <span>Shield · built for ETHGlobal ETHOnline 2026</span>
        <span>
          <a href="https://github.com/Oliverknowledge/shiedler" target="_blank" rel="noreferrer">Source</a>
        </span>
      </footer>
    </>
  );
}
