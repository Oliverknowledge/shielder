/**
 * Tiny JSON persistence for the server: per-vault flows, decoded events,
 * source cursors, issued verdicts and evidence bundles. Bigints are
 * stored as strings. Good enough for a hackathon; swap for Postgres via
 * `substreams sink postgres` when the flows should live in a database.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { Flow } from "./behaviour";
import type { ActivityEvent } from "./rpc-source";
import type { EvidenceBundle } from "./policy";
import type { VerdictJson } from "../client/verdict";

export interface VerdictRecord {
  verdict: VerdictJson;
  headline: string;
  lines: string[];
  relayed: boolean;
  signature: string | null;
  error: string | null;
  issuedAt: number;
  source: "server-monitor" | "cre";
}

export interface VaultRecord {
  flows: Flow[];
  events: ActivityEvent[];
  rpcCursor: { vaultSig: string | null; tokenSig: string | null };
  substreamsCursor: string | null;
  lastVerdictLossAt: number;
  verdicts: VerdictRecord[];
}

interface Persisted {
  vaults: Record<string, VaultRecord>;
  evidence: Record<string, EvidenceBundle>;
}

const emptyVault = (): VaultRecord => ({
  flows: [],
  events: [],
  rpcCursor: { vaultSig: null, tokenSig: null },
  substreamsCursor: null,
  lastVerdictLossAt: 0,
  verdicts: [],
});

export class Store {
  private data: Persisted = { vaults: {}, evidence: {} };
  private dirty = false;

  constructor(private path: string) {
    if (existsSync(path)) {
      try {
        const raw = JSON.parse(readFileSync(path, "utf-8")) as Persisted;
        for (const [k, v] of Object.entries(raw.vaults)) {
          raw.vaults[k] = { ...emptyVault(), ...v, flows: v.flows.map((f) => ({ ...f, amount: BigInt(f.amount as unknown as string) })) };
        }
        this.data = raw;
      } catch (e) {
        console.warn(`[store] could not read ${path}: ${String(e)}; starting fresh`);
      }
    }
  }

  vault(key: string): VaultRecord {
    if (!this.data.vaults[key]) {
      this.data.vaults[key] = emptyVault();
      this.dirty = true;
    }
    return this.data.vaults[key];
  }

  vaultKeys(): string[] {
    return Object.keys(this.data.vaults);
  }

  addFlows(key: string, flows: Flow[]): number {
    const rec = this.vault(key);
    const seen = new Set(rec.flows.map((f) => `${f.signature}:${f.kind}:${f.counterparty}:${f.amount}`));
    let added = 0;
    for (const f of flows) {
      const id = `${f.signature}:${f.kind}:${f.counterparty}:${f.amount}`;
      if (seen.has(id)) continue;
      seen.add(id);
      rec.flows.push(f);
      added++;
    }
    if (added) {
      rec.flows.sort((a, b) => a.blockTime - b.blockTime || a.slot - b.slot);
      this.dirty = true;
    }
    return added;
  }

  addEvents(key: string, events: ActivityEvent[]): number {
    const rec = this.vault(key);
    const seen = new Set(rec.events.map((e) => `${e.signature}:${e.name}:${JSON.stringify(e.data)}`));
    let added = 0;
    for (const e of events) {
      const id = `${e.signature}:${e.name}:${JSON.stringify(e.data)}`;
      if (seen.has(id)) continue;
      seen.add(id);
      rec.events.push(e);
      added++;
    }
    if (added) {
      rec.events.sort((a, b) => a.blockTime - b.blockTime || a.slot - b.slot);
      this.dirty = true;
    }
    return added;
  }

  putEvidence(hashHex: string, bundle: EvidenceBundle) {
    this.data.evidence[hashHex] = bundle;
    this.dirty = true;
  }

  evidence(hashHex: string): EvidenceBundle | undefined {
    return this.data.evidence[hashHex];
  }

  touch() {
    this.dirty = true;
  }

  flush() {
    if (!this.dirty) return;
    const dir = this.path.slice(0, this.path.lastIndexOf("/"));
    if (dir) mkdirSync(dir, { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
    renameSync(tmp, this.path);
    this.dirty = false;
  }
}
