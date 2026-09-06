/**
 * Blocked top-up attempts the app itself observed. A rejected transaction
 * emits no event, so the indexer can't see it; the app remembers the
 * rejections it made (with the on-chain signature when the demo key
 * recorded one) so Activity can show them as proof.
 */
import { useCallback, useEffect, useState } from "react";
import type { ShieldErrorName } from "../../../client/views";

export interface BlockedAttempt {
  ts: number; // unix seconds
  amount: string; // raw usdc as string
  reason: ShieldErrorName | null;
  sig: string | null;
  destinationLabel: string;
}

const key = (vault: string) => `shield.attempts.${vault}`;
const EVT = "shield:attempts";

export function readAttempts(vault: string): BlockedAttempt[] {
  try {
    const raw = localStorage.getItem(key(vault));
    return raw ? (JSON.parse(raw) as BlockedAttempt[]) : [];
  } catch {
    return [];
  }
}

export function recordAttempt(vault: string, a: BlockedAttempt): void {
  const list = [a, ...readAttempts(vault)].slice(0, 50);
  localStorage.setItem(key(vault), JSON.stringify(list));
  window.dispatchEvent(new CustomEvent(EVT));
}

export function useAttempts(vault: string | null): BlockedAttempt[] {
  const [list, setList] = useState<BlockedAttempt[]>(() => (vault ? readAttempts(vault) : []));
  const reload = useCallback(() => setList(vault ? readAttempts(vault) : []), [vault]);
  useEffect(() => {
    reload();
    window.addEventListener(EVT, reload);
    window.addEventListener("storage", reload);
    return () => {
      window.removeEventListener(EVT, reload);
      window.removeEventListener("storage", reload);
    };
  }, [reload]);
  return list;
}
