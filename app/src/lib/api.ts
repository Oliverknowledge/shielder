/** Types for the Shield server payloads (server/index.ts). Bigints arrive as strings. */

export interface ServerHealth {
  ok: boolean;
  network: "localnet" | "devnet" | "mainnet-beta";
  rpcUrl: string;
  programId: string;
  source: SourceStatus;
  substreamsEndpoint: string;
  spkg: string;
  monitor: { enabled: boolean; verifier: string | null };
  demo: boolean;
  vaults: string[];
  usdcMint: string | null;
  executionWallet: string | null;
  chain?: "solana" | "evm";
  evm?: { vault: string; usdc: string; coreDepositMock?: string | null; chainId: number; rpcUrl: string } | null;
}

export interface SourceStatus {
  mode: "substreams" | "rpc";
  connected: boolean;
  headSlot: string | null;
  error: string | null;
  endpoint: string;
}

export type FlowKind = "TOP_UP_INSTANT" | "TOP_UP_GATED" | "COLD_TRANSFER" | "FULL_EXIT" | "RETURN" | "DEPOSIT";

export interface FlowJson {
  slot: number;
  signature: string;
  blockTime: number;
  vault: string;
  kind: FlowKind;
  outbound: boolean;
  counterparty: string;
  amount: string;
  counterpartyIsExecution: boolean;
}

export interface SessionJson {
  wallet: string;
  openedAt: number;
  lastActivityAt: number;
  sent: string;
  returned: string;
  net: string;
  topUps: number;
  returns: number;
  realised: boolean;
  isLoss: boolean;
  signatures: string[];
}

export interface WindowJson {
  hours: number;
  sent: string;
  returned: string;
  realisedLoss: string;
  realisedGain: string;
  topUpCount: number;
  lossSessions: number;
}

export interface ProfileJson {
  vault: string;
  asOf: number;
  totals: { sent: string; returned: string; net: string; deposited: string; exited: string };
  wallets: Array<{
    owner: string;
    sent: string;
    returned: string;
    net: string;
    topUpCount: number;
    returnCount: number;
    lastTopUpAt: number | null;
    lastReturnAt: number | null;
    medianTopUp: string;
    openExposure: string;
  }>;
  sessions: SessionJson[];
  windows: { h24: WindowJson; d7: WindowJson; d30: WindowJson };
  velocity24h: string;
  medianTopUp30d: string;
  lossStreak: number;
  reloadsAfterLoss7d: number;
  lastLossAt: number | null;
  lastLossAmount: string;
  timeline: FlowJson[];
}

export interface AssessmentJson {
  triggered: boolean;
  actionable: boolean;
  realizedLossUsdc: string;
  reasonCode: number;
  reasonLabel: string;
  headline: string;
  lines: string[];
  evidenceHash: string;
  newestLossAt: number | null;
}

export interface EventJson {
  name: string;
  data: Record<string, string | boolean | number>;
  signature: string;
  slot: number;
  blockTime: number;
}

export interface VerdictRecordJson {
  verdict: { nonce: string; realizedLossUsdc: string; reasonCode: number; evidenceHash: string; issuedAt: string; verifier: string };
  headline: string;
  lines: string[];
  relayed: boolean;
  signature: string | null;
  error: string | null;
  issuedAt: number;
  source: "server-monitor" | "cre";
}

export interface VaultPayload {
  vault: string;
  network: string;
  programId: string;
  balance: string;
  profile: ProfileJson;
  assessment: AssessmentJson;
  events: EventJson[];
  verdicts: VerdictRecordJson[];
  source: SourceStatus;
  lastSyncAt: number;
}

export interface EvidenceJson {
  version: number;
  vault: string;
  asOf: number;
  window: string;
  realisedLossUsdc: string;
  lossSessions: number;
  lossStreak: number;
  reloadsAfterLoss7d: number;
  velocity24hUsdc: string;
  medianTopUp30dUsdc: string;
  sessions: Array<{ wallet: string; sent: string; returned: string; net: string; openedAt: number; lastActivityAt: number; signatures: string[] }>;
  policy: { lossTriggerUsdc: string; lossCooldownSecs: string };
}

export async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

export interface HlSessionJson {
  openedAt: number;
  closedAt: number | null;
  deployed: number;
  returned: number;
  realisedPnl: number;
  fills: number;
  reloads: number;
  reloadsAfterLoss: number;
  firstLossAt: number | null;
  firstReloadAfterLossAt: number | null;
  hashes: string[];
}

export interface HlProfileJson {
  address: string;
  network: "mainnet" | "testnet";
  asOf: number;
  sessions: HlSessionJson[];
  totals: { deposited: number; withdrawn: number; realisedPnl: number; fills: number; sessions: number };
  typicalSessionSize: number | null;
  largestLosingSession: { pnl: number; deployed: number; openedAt: number } | null;
  sessionsWithReloadAfterLoss: number;
  sessionsWithTwoPlusReloads: number;
  medianMinutesToReloadAfterLoss: number | null;
  worstSessionsWithReload: { worst: number; withReload: number };
  insight: string | null;
  suggestions: Array<{ key: "chasing" | "reloads" | "savings"; text: string }>;
  source: "hyperliquid-info-api";
}
