import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion } from "motion/react";

/**
 * A button you hold for `ms` milliseconds. Deliberate, tactile, hard to do
 * by accident, impossible to do by rage-click. Keyboard: hold Space/Enter.
 */
export function HoldButton({ ms = 2000, onComplete, children, className = "", disabled }: { ms?: number; onComplete: () => void; children: ReactNode; className?: string; disabled?: boolean }) {
  const [progress, setProgress] = useState(0);
  const [holding, setHolding] = useState(false);
  const start = useRef<number | null>(null);
  const raf = useRef(0);
  const done = useRef(false);

  const stop = () => {
    setHolding(false);
    start.current = null;
    cancelAnimationFrame(raf.current);
    if (!done.current) setProgress(0);
  };

  const tick = (t: number) => {
    if (start.current === null) return;
    const p = Math.min(1, (t - start.current) / ms);
    setProgress(p);
    if (p >= 1) {
      if (!done.current) {
        done.current = true;
        onComplete();
      }
      return;
    }
    raf.current = requestAnimationFrame(tick);
  };

  const begin = () => {
    if (disabled || done.current) return;
    setHolding(true);
    start.current = performance.now();
    raf.current = requestAnimationFrame(tick);
  };

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  return (
    <button
      className={`hold ${className}${holding ? " holding" : ""}`}
      disabled={disabled}
      onPointerDown={(e) => { e.preventDefault(); begin(); }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onKeyDown={(e) => { if ((e.key === " " || e.key === "Enter") && !holding) begin(); }}
      onKeyUp={stop}
      aria-label="Press and hold to confirm"
    >
      <motion.i className="hold-fill" style={{ scaleX: progress }} />
      <span className="hold-label">{children}</span>
      <span className="hold-hint">{progress >= 1 ? "" : holding ? "keep holding…" : `hold ${Math.round(ms / 1000)}s`}</span>
    </button>
  );
}
