/**
 * The private half of the risk ladder, kept in this browser only.
 *
 * The chain holds a salted commitment plus the REDUCED allowance and duration;
 * the threshold that selects REDUCED never leaves the user's device except as
 * the secret they hand to the monitor's enclave. Shield's server never sees it.
 */
import { useCallback, useEffect, useState } from "react";
import { ladderFromJson, ladderHashOf, ladderToJson, type Ladder } from "../../../client/ladder";

const key = (owner: string) => `shield.ladder.${owner.toLowerCase()}`;

export function readLadder(owner: string): Ladder | null {
  try {
    const raw = localStorage.getItem(key(owner));
    return raw ? ladderFromJson(raw) : null;
  } catch {
    return null;
  }
}

export function writeLadder(owner: string, ladder: Ladder | null): void {
  if (ladder) localStorage.setItem(key(owner), ladderToJson(ladder));
  else localStorage.removeItem(key(owner));
}

export function randomSalt(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return "0x" + Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}

export function useLadder(owner: string | null): [Ladder | null, (l: Ladder | null) => void] {
  const [ladder, setLadder] = useState<Ladder | null>(() => (owner ? readLadder(owner) : null));
  useEffect(() => setLadder(owner ? readLadder(owner) : null), [owner]);
  const set = useCallback((l: Ladder | null) => { if (owner) writeLadder(owner, l); setLadder(l); }, [owner]);
  return [ladder, set];
}

export { ladderHashOf, ladderToJson };
