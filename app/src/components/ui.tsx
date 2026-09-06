import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { hms, duration, usd } from "../lib/format";
import { explorerUrl, RPC_URL } from "../lib/shield";

// ---------------- toasts ----------------

interface Toast {
  id: number;
  text: string;
  kind: "ok" | "err" | "info";
  link?: { href: string; label: string };
}

const ToastCtx = createContext<{ push: (t: Omit<Toast, "id">) => void }>({ push: () => {} });

export function ToastHost({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev.slice(-2), { ...t, id }]);
    setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== id)), t.kind === "err" ? 7000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="toasts" aria-live="polite">
        <AnimatePresence>
          {items.map((t) => (
            <motion.div
              key={t.id}
              className={`toast ${t.kind === "info" ? "" : t.kind}`}
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: 0.22 }}
            >
              <span>{t.text}</span>
              {t.link && (
                <a href={t.link.href} target="_blank" rel="noreferrer">
                  {t.link.label}
                </a>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const { push } = useContext(ToastCtx);
  return {
    ok: (text: string, sig?: string | null) => push({ text, kind: "ok", link: sig ? { href: explorerUrl("tx", sig), label: "View" } : undefined }),
    err: (text: string, sig?: string | null) => push({ text, kind: "err", link: sig ? { href: explorerUrl("tx", sig), label: "View" } : undefined }),
    info: (text: string) => push({ text, kind: "info" }),
  };
}

// ---------------- primitives ----------------

export type Tone = "protect" | "pending" | "blocked" | "neutral" | "bankroll";

export function Pill({ tone, live, children }: { tone: Tone; live?: boolean; children: ReactNode }) {
  return <span className={`pill pill-${tone}${live ? " pill-live" : ""}`}>{children}</span>;
}

export function Dot({ tone }: { tone: Tone }) {
  return <span className={`dot dot-${tone}`} aria-hidden />;
}

/** Tween a number toward its target (respects reduced motion). */
export function useTween(target: number, ms = 650): number {
  const [v, setV] = useState(target);
  const cur = useRef(target);
  useEffect(() => {
    const from = cur.current;
    const to = target;
    if (from === to) return;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      cur.current = to;
      setV(to);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      const e = 1 - Math.pow(1 - p, 3);
      cur.current = from + (to - from) * e;
      setV(cur.current);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

export function Money({ raw, size = "m", cents, sign, tween, className = "" }: { raw: bigint | string | number; size?: "xl" | "l" | "m" | "s"; cents?: boolean; sign?: boolean; tween?: boolean; className?: string }) {
  const cls = size === "xl" ? "money-xl" : size === "l" ? "money-l" : size === "m" ? "money-m" : "num";
  const target = typeof raw === "number" ? raw : Number(raw) / 1_000_000;
  const shown = useTween(tween ? target : target, tween ? 650 : 0);
  return <span className={`${cls} ${className}`}>{usd(tween ? shown : target, { cents, sign })}</span>;
}

/** Live countdown to a unix timestamp. */
export function Countdown({ until, now, format = "hms", done = "now" }: { until: number | bigint; now: number; format?: "hms" | "words" | "compact"; done?: string }) {
  const left = Number(until) - now;
  if (left <= 0) return <span className="num">{done}</span>;
  return <span className="num">{format === "hms" ? hms(left) : duration(left, { compact: format === "compact" })}</span>;
}

export function Progress({ value, max, tone = "" }: { value: number; max: number; tone?: "" | "protect" | "blocked" | "pending" }) {
  const pct = max <= 0 ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={`progress ${tone}`}>
      <i style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Floor | refillable | trading, proportional to total capital. */
export function CapitalBar({ floor, room, trade, locked }: { floor: bigint; room: bigint; trade: bigint; locked?: boolean }) {
  const total = Number(floor + room + trade) || 1;
  const w = (x: bigint) => `${(Number(x) / total) * 100}%`;
  return (
    <div className="capital" role="img" aria-label={`Floor ${usd(floor)}, refillable ${usd(room)}, trading ${usd(trade)}`}>
      {floor > 0n && <i className="seg-floor" style={{ flexBasis: w(floor) }} />}
      {room > 0n && <i className={`seg-room${locked ? " locked" : ""}`} style={{ flexBasis: w(room) }} />}
      {trade > 0n && <i className="seg-trade" style={{ flexBasis: w(trade) }} />}
    </div>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  // Portal to <body>: the sheet must sit in the root stacking context so it
  // covers the fixed tab bar and topbar on every page.
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="sheet-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} onClick={onClose}>
          <motion.div
            className="sheet"
            role="dialog"
            aria-modal="true"
            initial={{ y: 28, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sheet-grab" />
            {title && (
              <div className="row-between" style={{ marginBottom: 16 }}>
                <h2 className="title">{title}</h2>
                <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
                  <Icon name="x" size={18} />
                </button>
              </div>
            )}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function MoneyInput({ value, onChange, placeholder = "0", autoFocus, variant = "inline" }: { value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean; variant?: "hero" | "inline" | "small" }) {
  const ref = useRef<HTMLInputElement>(null);
  const width = Math.max(1, (value || placeholder).length);
  return (
    <div className={`amount ${variant === "inline" ? "inline" : variant === "small" ? "small" : ""}${value === "" ? " empty" : ""}`} onClick={() => ref.current?.focus()}>
      <span>$</span>
      <input
        ref={ref}
        inputMode="decimal"
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={value}
        size={width}
        style={variant === "inline" ? undefined : { width: `${width + 0.4}ch` }}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, "").replace(/^0+(?=\d)/, ""))}
        aria-label="Amount in USDC"
      />
    </div>
  );
}

export function Skeleton({ w = "100%", h = 18, style }: { w?: number | string; h?: number; style?: React.CSSProperties }) {
  return <span className="skeleton" style={{ display: "inline-block", width: w, height: h, ...style }} />;
}

export function Stepper({ step, total }: { step: number; total: number }) {
  return (
    <div className="stepper" aria-label={`Step ${step} of ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <i key={i} className={i < step ? "done" : ""} />
      ))}
    </div>
  );
}

/**
 * A transaction hash, linked where an explorer exists and copyable where none
 * does. HyperEVM testnet has no public explorer that indexes this contract, and
 * a link that lands on "unable to locate this transaction hash" is worse than no
 * link: it makes the whole verifiability claim look false.
 */
export function ExplorerLink({ sig, children }: { sig: string; children?: ReactNode }) {
  const href = explorerUrl("tx", sig);
  const label = children ?? `${sig.slice(0, 8)}…`;
  if (href) {
    return (
      <a className="link tiny mono" href={href} target="_blank" rel="noreferrer">
        {label}
      </a>
    );
  }
  return (
    <button
      type="button"
      className="link tiny mono"
      title={`Copy ${sig}\n\nThis network has no public explorer that indexes Shield. Verify it yourself:\ncast tx ${sig} --rpc-url ${RPC_URL}`}
      onClick={() => void navigator.clipboard?.writeText(sig)}
    >
      {label}
    </button>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="state-screen">
      <h2 className="title">{title}</h2>
      {body && <p className="lead" style={{ maxWidth: 440 }}>{body}</p>}
      {action}
    </div>
  );
}

export type IconName = "home" | "topup" | "behaviour" | "protection" | "activity" | "shield" | "arrow" | "check" | "lock" | "pause" | "x" | "clock" | "bolt" | "external" | "back" | "trade";

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (name) {
    case "home":
      return <svg {...common}><path d="M3 11.5 12 4l9 7.5" /><path d="M5 10v10h14V10" /></svg>;
    case "topup":
      return <svg {...common}><path d="M12 19V5" /><path d="m6 11 6-6 6 6" /></svg>;
    case "behaviour":
      return <svg {...common}><path d="M3 17l5-6 4 4 5-8 4 5" /></svg>;
    case "protection":
      return <svg {...common}><path d="M12 3 4 6v6c0 5 3.4 8.6 8 10 4.6-1.4 8-5 8-10V6l-8-3z" /></svg>;
    case "activity":
      return <svg {...common}><path d="M4 12h4l2-6 4 12 2-6h4" /></svg>;
    case "shield":
      return <svg {...common} strokeWidth={0} fill="currentColor"><path d="M12 2 4 5v6c0 5.5 3.6 9.7 8 11 4.4-1.3 8-5.5 8-11V5l-8-3z" /><path d="M12 7v9" stroke="var(--paper)" strokeWidth={2} strokeLinecap="round" /></svg>;
    case "arrow":
      return <svg {...common}><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></svg>;
    case "back":
      return <svg {...common}><path d="M19 12H5" /><path d="m11 18-6-6 6-6" /></svg>;
    case "check":
      return <svg {...common}><path d="m5 12 5 5L20 7" /></svg>;
    case "lock":
      return <svg {...common}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>;
    case "pause":
      return <svg {...common}><path d="M9 5v14" /><path d="M15 5v14" /></svg>;
    case "x":
      return <svg {...common}><path d="M6 6l12 12" /><path d="M18 6 6 18" /></svg>;
    case "clock":
      return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
    case "bolt":
      return <svg {...common}><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" /></svg>;
    case "external":
      return <svg {...common}><path d="M14 4h6v6" /><path d="M20 4 10 14" /><path d="M18 13v6H5V6h6" /></svg>;
    case "trade":
      return <svg {...common}><path d="M4 19V5" /><path d="M4 19h16" /><path d="M8 15v-4" /><path d="M12 15V8" /><path d="M16 15v-6" /></svg>;
  }
}
