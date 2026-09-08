/**
 * Session replay: the trader's own realised-PnL line, drawn in order, with the
 * reload-while-down as the moment everything hinges on. Real data only; the
 * counterfactual mode never redraws history, it dims what came after and shows
 * what Shield would have kept out of the session.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { ReplayJson, TimelineEventJson } from "../lib/api";

export type ReplayMode = "play" | "counterfactual";

interface Point { i: number; t: number; y: number; ev: TimelineEventJson }

const fmt = (n: number) => `${n < 0 ? "−" : n > 0 ? "+" : ""}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const clock = (ms: number) => new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/** Keep every capital event and the reload; thin long runs of small closes so the line stays legible. */
function compress(tl: TimelineEventJson[], keep: number, max = 140): { pts: Point[]; reloadAt: number } {
  const closes = tl.filter((e) => e.kind === "close").length;
  const stride = Math.max(1, Math.ceil(closes / max));
  const pts: Point[] = [];
  let acc = 0, reloadAt = 0, n = 0;
  tl.forEach((ev, i) => {
    const isKey = i === keep || ev.kind !== "close";
    if (ev.kind === "close") n++;
    if (isKey || n % stride === 0 || i === tl.length - 1) {
      pts.push({ i: pts.length, t: ev.time, y: ev.running, ev });
      if (i === keep) reloadAt = pts.length - 1;
      acc = 0;
    } else acc += ev.amount;
  });
  return { pts, reloadAt };
}

export function Replay({ replay, mode, onReachedReload, onFinished, protectedAmount, availableAmount }: {
  replay: ReplayJson;
  mode: ReplayMode;
  onReachedReload?: () => void;
  onFinished?: () => void;
  protectedAmount?: number;
  availableAmount?: number;
}) {
  const reduce = useReducedMotion();
  const { pts, reloadAt } = useMemo(() => compress(replay.timeline ?? [], replay.reloadIndex), [replay]);
  const last = Math.max(0, pts.length - 1);
  const [pos, setPosRaw] = useState(reduce ? last : 0); // index of the last drawn point
  const clampPos = (v: number) => (Number.isFinite(v) ? Math.min(last, Math.max(0, v)) : 0);
  const setPos = (v: number | ((p: number) => number)) => setPosRaw((p) => clampPos(typeof v === "function" ? v(p) : v));
  const [playing, setPlaying] = useState(!reduce);
  const [held, setHeld] = useState(false); // paused on the reload
  const raf = useRef<number | null>(null);
  const firedReload = useRef(false);
  const firedEnd = useRef(false);

  // Counterfactual: park on the reload.
  useEffect(() => {
    if (mode === "counterfactual") { setPlaying(false); setPos(reloadAt); }
  }, [mode, reloadAt]);

  useEffect(() => {
    if (!playing || mode !== "play") return;
    let last = performance.now();
    const step = (now: number) => {
      const dt = now - last; last = now;
      setPos((p) => {
        const next = Math.min(pts.length - 1, p + dt / (p < reloadAt ? 90 : 140)); // ~11 points/s before the reload, slower after
        if (!firedReload.current && next >= reloadAt && p < reloadAt) {
          firedReload.current = true; setHeld(true); onReachedReload?.();
          setTimeout(() => { setHeld(false); }, 1800);
          return reloadAt;
        }
        return next;
      });
      raf.current = requestAnimationFrame(step);
    };
    if (!held) raf.current = requestAnimationFrame(step);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [playing, held, mode, pts.length, reloadAt, onReachedReload]);

  useEffect(() => {
    if (pos >= pts.length - 1 && !firedEnd.current && mode === "play") { firedEnd.current = true; setPlaying(false); onFinished?.(); }
  }, [pos, pts.length, mode, onFinished]);

  // Geometry: a squarer, larger-type canvas on phones so the chart stays legible when the SVG scales down.
  const [compact, setCompact] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const on = () => setCompact(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const W = compact ? 400 : 720, H = compact ? 330 : 300, PAD = { l: 12, r: 12, t: 30, b: 34 };
  const ys = pts.map((p) => p.y);
  const minY = Math.min(0, ...ys), maxY = Math.max(0, ...ys);
  const span = Math.max(1, maxY - minY);
  const x = (i: number) => PAD.l + (i / Math.max(1, pts.length - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + ((maxY - v) / span) * (H - PAD.t - PAD.b);
  const safePos = clampPos(pos);
  const shown = Math.floor(safePos);
  const frac = safePos - shown;
  const cur = pts[Math.min(last, shown)] ?? pts[0];
  const nxt = pts[Math.min(last, shown + 1)] ?? cur;
  const curY = cur.y + (nxt.y - cur.y) * frac;
  const path = (upTo: number) => pts.slice(0, upTo + 1).map((p, k) => `${k === 0 ? "M" : "L"}${x(p.i).toFixed(1)},${y(p.y).toFixed(1)}`).join(" ");
  const headX = x(shown) + (x(shown + 1) - x(shown)) * frac;
  const headY = y(curY);
  const reloadPt = pts[reloadAt] ?? cur;
  const inCf = mode === "counterfactual";
  if (pts.length === 0 || !cur) return <div className="replay"><p className="small" style={{ color: "#cfcbc2" }}>This session has no closes to draw.</p></div>;
  const reloads = pts.filter((p) => p.ev.kind === "in" && p.i > 0);
  const label = inCf ? replay.pnlAtReload : curY;

  return (
    <div className={`replay ${inCf ? "replay-cf" : ""}`}>
      <div className="replay-head">
        <div>
          <div className="replay-eyebrow">{inCf ? "SHIELD WOULD STEP IN HERE" : shown >= pts.length - 1 ? "SESSION FINISHED" : shown < reloadAt ? "SESSION" : "AFTER THE RELOAD"}</div>
          <div className="replay-time">{clock(cur.t)}</div>
        </div>
        <div className={`replay-pnl ${label < 0 ? "neg" : label > 0 ? "pos" : ""}`}>{fmt(label)}</div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className={`replay-svg ${compact ? "replay-svg-compact" : ""}`} role="img" aria-label="Realised session PnL over time">
        <defs>
          <linearGradient id="lossFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#e5484d" stopOpacity="0.02" /><stop offset="1" stopColor="#e5484d" stopOpacity="0.28" /></linearGradient>
        </defs>
        <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} className="replay-zero" />
        {/* dimmed future (counterfactual) or full faint line for orientation */}
        {inCf && <path d={path(pts.length - 1)} className="replay-line replay-line-dim" />}
        {/* drawn history */}
        <path d={`${path(shown)} L${headX.toFixed(1)},${headY.toFixed(1)}`} className="replay-line" />
        <path d={`${path(shown)} L${headX.toFixed(1)},${headY.toFixed(1)} L${headX.toFixed(1)},${y(0)} L${x(0)},${y(0)} Z`} fill="url(#lossFill)" stroke="none" />
        {reloads.filter((p) => p.i <= shown || inCf).map((p, k) => {
          const key = p.i === reloadAt;
          const nearKey = !key && Math.abs(x(p.i) - x(reloadAt)) < 72;
          return (
            <g key={p.i} className={`replay-mark ${key ? "replay-mark-key" : ""}`}>
              <line x1={x(p.i)} x2={x(p.i)} y1={PAD.t - 8} y2={H - PAD.b} />
              {!nearKey && <text x={x(p.i) + 6} y={key ? PAD.t - 12 : H - PAD.b + 16 + (k % 2) * 11}>+${Math.round(p.ev.amount)} {key ? "RELOAD" : "added"}</text>}
            </g>
          );
        })}
        {!inCf && <circle cx={headX} cy={headY} r={5} className={`replay-dot ${held ? "replay-dot-hold" : ""}`} />}
        {inCf && <circle cx={x(reloadAt)} cy={y(reloadPt.y)} r={6} className="replay-dot" />}
      </svg>
      {inCf && protectedAmount !== undefined && availableAmount !== undefined && (
        <div className="replay-split">
          <motion.div className="split-source" initial={{ opacity: 1 }} animate={{ opacity: 0.35 }} transition={{ delay: 0.9, duration: 0.5 }}>
            <span className="eyebrow">Requested</span><b>${Math.round(replay.reloadAmount)}</b>
          </motion.div>
          <div className="split-arrow" aria-hidden>→</div>
          <motion.div className="split-part split-avail" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.0, duration: 0.5 }}>
            <span className="eyebrow">Available</span><b>${Math.round(availableAmount)}</b>
          </motion.div>
          <motion.div className="split-part split-prot" initial={{ opacity: 0, x: 0 }} animate={{ opacity: 1, x: 18 }} transition={{ delay: 1.3, duration: 0.7 }}>
            <span className="eyebrow">Protected</span><b>${Math.round(protectedAmount)}</b>
          </motion.div>
        </div>
      )}
      {!inCf && (
        <div className="replay-controls">
          <button className="btn btn-ghost btn-sm" onClick={() => { if (pos >= pts.length - 1) { firedEnd.current = false; firedReload.current = false; setPos(0); } setPlaying((v) => !v); }}>{playing ? "Pause" : pos >= pts.length - 1 ? "Replay" : "Play"}</button>
          <input type="range" min={0} max={pts.length - 1} step={0.01} value={pos} onChange={(e) => { setPlaying(false); setPos(Number(e.target.value)); }} aria-label="Scrub the session" />
          <span className="tiny muted num">{Math.min(shown + 1, pts.length)}/{pts.length}</span>
        </div>
      )}
    </div>
  );
}
