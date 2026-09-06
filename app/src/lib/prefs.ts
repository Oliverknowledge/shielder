/**
 * Per-vault preferences that live with the user, not on-chain: what usually
 * gets them into trouble (from onboarding), the message calm-you leaves for
 * tilted-you, and when they last opened the app (for the morning-after view).
 */
import { useCallback, useEffect, useState } from "react";

export type Trouble = "chasing" | "allin" | "reloads" | "latenight" | "rushed" | "savings";

export const TROUBLES: { key: Trouble; title: string; body: string }[] = [
  { key: "chasing", title: "Chasing losses", body: "I add more money when I'm down." },
  { key: "allin", title: "Going all-in", body: "I risk more than I planned." },
  { key: "reloads", title: "Repeated top-ups", body: "Once I've started, I keep adding more." },
  { key: "latenight", title: "Late-night trading", body: "My worst decisions happen when I'm tired." },
  { key: "rushed", title: "Rushed transfers", body: "I don't always stop to check where money is going." },
  { key: "savings", title: "Touching savings", body: "I move money I previously said I wouldn't use." },
];

export interface Prefs {
  troubles: Trouble[];
  calmMessage: string;
  lastSeenAt: number; // unix seconds
  hyperliquidAddress?: string;
}

const DEFAULTS: Prefs = { troubles: [], calmMessage: "", lastSeenAt: 0 };
const key = (owner: string) => `shield.prefs.${owner}`;
const EVT = "shield:prefs";

export function readPrefs(owner: string): Prefs {
  try {
    const raw = localStorage.getItem(key(owner));
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Prefs>) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writePrefs(owner: string, patch: Partial<Prefs>): Prefs {
  const next = { ...readPrefs(owner), ...patch };
  localStorage.setItem(key(owner), JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(EVT));
  return next;
}

export function usePrefs(owner: string | null): [Prefs, (patch: Partial<Prefs>) => void] {
  const [prefs, setPrefs] = useState<Prefs>(() => (owner ? readPrefs(owner) : { ...DEFAULTS }));
  const reload = useCallback(() => setPrefs(owner ? readPrefs(owner) : { ...DEFAULTS }), [owner]);
  useEffect(() => {
    reload();
    window.addEventListener(EVT, reload);
    window.addEventListener("storage", reload);
    return () => {
      window.removeEventListener(EVT, reload);
      window.removeEventListener("storage", reload);
    };
  }, [reload]);
  const update = useCallback((patch: Partial<Prefs>) => { if (owner) writePrefs(owner, patch); }, [owner]);
  return [prefs, update];
}
