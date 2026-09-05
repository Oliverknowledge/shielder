import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { hms, duration, usd } from "../lib/format";
import { explorerUrl } from "../lib/shield";

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
    setItems((prev) => [...prev, { ...t, id }]);
    setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== id)), t.kind === "err" ? 7000 : 4500);
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

export function Pill({ tone, children }: { tone: "protect" | "pending" | "blocked" | "neutral" | "bankroll"; children: ReactNode }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

export function Money({ raw, size = "m", cents, sign }: { raw: bigint | string | number; size?: "xl" | "l" | "m" | "s"; cents?: boolean; sign?: boolean }) {
  const cls = size === "xl" ? "money-xl" : size === "l" ? "money-l" : size === "m" ? "money-m" : "num";
  return <span className={cls}>{usd(raw, { cents, sign })}</span>;
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

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="sheet-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div
            className="sheet"
            role="dialog"
            aria-modal="true"
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 16, opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            {title && (
              <div className="row-between" style={{ marginBottom: 16 }}>
                <h2 className="title">{title}</h2>
                <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
                  Close
                </button>
              </div>
            )}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
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

export function MoneyInput({ value, onChange, placeholder = "0", autoFocus }: { value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean }) {
  return (
    <div className="input-money">
      <span>$</span>
      <input
        inputMode="decimal"
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))}
        aria-label="Amount in USDC"
      />
    </div>
  );
}

export function Skeleton({ w = "100%", h = 18 }: { w?: number | string; h?: number }) {
  return <span className="skeleton" style={{ display: "inline-block", width: w, height: h }} />;
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

export function ExplorerLink({ sig, children }: { sig: string; children?: ReactNode }) {
  return (
    <a className="link tiny mono" href={explorerUrl("tx", sig)} target="_blank" rel="noreferrer">
      {children ?? `${sig.slice(0, 8)}…`}
    </a>
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

export function Icon({ name, size = 20 }: { name: "home" | "topup" | "behaviour" | "protection" | "activity" | "shield" | "arrow" | "check" | "lock" | "pause" | "x"; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
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
    case "check":
      return <svg {...common}><path d="m5 12 5 5L20 7" /></svg>;
    case "lock":
      return <svg {...common}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>;
    case "pause":
      return <svg {...common}><path d="M9 5v14" /><path d="M15 5v14" /></svg>;
    case "x":
      return <svg {...common}><path d="M6 6l12 12" /><path d="M18 6 6 18" /></svg>;
  }
}
