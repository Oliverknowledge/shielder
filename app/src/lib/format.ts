export const usd = (raw: bigint | string | number, opts: { cents?: boolean; sign?: boolean } = {}): string => {
  const n = typeof raw === "bigint" ? Number(raw) / 1_000_000 : typeof raw === "string" ? Number(raw) / 1_000_000 : raw;
  const abs = Math.abs(n);
  const body = abs.toLocaleString("en-US", {
    minimumFractionDigits: opts.cents ? 2 : 0,
    maximumFractionDigits: opts.cents ? 2 : abs < 100 && abs % 1 !== 0 ? 2 : 0,
  });
  const sign = n < 0 ? "−" : opts.sign && n > 0 ? "+" : "";
  return `${sign}$${body}`;
};

export const usdInput = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

export function short(addr: string, n = 4): string {
  return addr.length > n * 2 + 3 ? `${addr.slice(0, n)}…${addr.slice(-n)}` : addr;
}

export function duration(secs: number, opts: { compact?: boolean } = {}): string {
  const s = Math.max(0, Math.floor(secs));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (opts.compact) {
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m ${sec.toString().padStart(2, "0")}s`;
  }
  if (d > 0) return `${d} day${d === 1 ? "" : "s"}${h ? ` ${h}h` : ""}`;
  if (h > 0) return `${h} hour${h === 1 ? "" : "s"}${m ? ` ${m} min` : ""}`;
  if (m > 0) return `${m} min`;
  return `${sec}s`;
}

export function hms(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}

export function ago(ts: number, now = Date.now() / 1000): string {
  const s = Math.max(0, now - ts);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function dateTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit", day: "numeric", month: "short" });
}

export const nowSec = () => Math.floor(Date.now() / 1000);

export function hoursLabel(secs: bigint | number): string {
  const h = Number(secs) / 3600;
  if (h >= 48) return `${Math.round(h / 24)} days`;
  if (h >= 1) return `${Math.round(h * 10) / 10} hours`;
  return `${Math.round(h * 60)} minutes`;
}
