/**
 * EVM adapter for ShieldVault.sol (HyperEVM, Anvil, any EVM chain).
 *
 * Reads the contract into the chain-agnostic views in ./views.ts and builds
 * calls for every action. Pure functions over viem clients; no React.
 */
import {
  createPublicClient,
  decodeErrorResult,
  encodeFunctionData,
  http,
  parseEventLogs,
  type Address,
  type Chain as ViemChain,
  type Hex,
  type PublicClient,
} from "viem";
import { SHIELD_VAULT_ABI } from "./abi/ShieldVault";
import { MOCK_USDC_ABI } from "./abi/MockUSDC";
import {
  OwnerKind,
  ProposalKind,
  Route,
  type LoosenView,
  type ProposalView,
  type RegistryView,
  type ShieldErrorName,
  type TightenView,
  type VaultView,
  SHIELD_ERROR_NAMES,
} from "./views";

export { SHIELD_VAULT_ABI };

export interface EvmCall {
  to: Address;
  data: Hex;
  value?: bigint;
}

export interface EvmConfig {
  rpcUrl: string;
  chainId: number;
  vault: Address;
  usdc: Address;
}

export const ANVIL_CHAIN_ID = 31337;
export const HYPEREVM_MAINNET_ID = 999;
export const HYPEREVM_TESTNET_ID = 998;

/**
 * Multicall3, at the canonical CREATE2 address it holds on every chain that
 * has it. Verified deployed on both HyperEVM networks.
 *
 * Reading a vault is eleven contract calls: the vault, three proposal slots,
 * the registry owner list, an entry and a USDC balance per destination, plus
 * the authority's own balance. Issued one at a time against the public
 * HyperEVM RPC that is enough to trip its rate limit, and a rate-limited read
 * is indistinguishable from a vault that does not exist. Batched, the same
 * refresh is two requests.
 */
export const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;
const CHAINS_WITH_MULTICALL3 = new Set<number>([HYPEREVM_MAINNET_ID, HYPEREVM_TESTNET_ID]);

/** Only the chain identity matters here, so callers that have no vault yet (the
 *  Privy provider at boot) can build the same chain object the engine signs with. */
export function viemChain(cfg: Pick<EvmConfig, "chainId" | "rpcUrl">): ViemChain {
  const name = cfg.chainId === HYPEREVM_MAINNET_ID ? "HyperEVM" : cfg.chainId === HYPEREVM_TESTNET_ID ? "HyperEVM Testnet" : cfg.chainId === ANVIL_CHAIN_ID ? "Anvil" : `EVM ${cfg.chainId}`;
  const symbol = cfg.chainId === HYPEREVM_MAINNET_ID || cfg.chainId === HYPEREVM_TESTNET_ID ? "HYPE" : "ETH";
  return {
    id: cfg.chainId,
    name,
    testnet: cfg.chainId !== HYPEREVM_MAINNET_ID,
    nativeCurrency: { name: symbol, symbol, decimals: 18 },
    rpcUrls: { default: { http: [cfg.rpcUrl] } },
    blockExplorers:
      cfg.chainId === HYPEREVM_MAINNET_ID ? { default: { name: "HyperEVMScan", url: "https://hyperevmscan.io" } }
      : cfg.chainId === HYPEREVM_TESTNET_ID ? { default: { name: "HyperEVM Testnet", url: "https://explore-testnet.hyperpc.app" } }
      : undefined,
    ...(CHAINS_WITH_MULTICALL3.has(cfg.chainId) ? { contracts: { multicall3: { address: MULTICALL3 } } } : {}),
  };
}

export function publicClientFor(cfg: EvmConfig): PublicClient {
  return createPublicClient({ chain: viemChain(cfg), transport: http(cfg.rpcUrl) });
}

const label = (b: Hex): string => {
  const bytes = Buffer.from(b.slice(2), "hex");
  const end = bytes.indexOf(0);
  return bytes.subarray(0, end === -1 ? bytes.length : end).toString("utf8");
};

export const encodeLabel = (text: string): Hex => {
  const bytes = Buffer.alloc(24);
  Buffer.from(text, "utf8").copy(bytes, 0, 0, 24);
  return `0x${bytes.toString("hex")}` as Hex;
};

// ---------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------

type RawVault = {
  exists: boolean; riskVerifier: Address; protectedFloor: bigint; topUpThresholdBps: number; emergencyCap: bigint; velocityThreshold: bigint;
  lossTriggerUsdc: bigint; lossCooldownSecs: bigint; topUpCooldownSecs: bigint; loosenCooldownSecs: bigint; fullExitCooldownSecs: bigint;
  cooldownUntil: bigint; cooldownReason: number; cooldownSetAt: bigint; lastVerdictNonce: bigint; lastVerdictReason: number; lastVerdictEvidence: Hex;
  velocityBuckets: readonly [bigint, bigint, bigint, bigint, bigint, bigint]; bucketStart: bigint; currentBucketIndex: number; configVersion: bigint;
  proposalNonceCounter: bigint; createdAt: bigint; balance: bigint;
};

const ZERO = "0x0000000000000000000000000000000000000000";

function vaultViewOf(raw: RawVault, cfg: EvmConfig, authority: Address): VaultView {
  return {
    chain: "evm",
    address: cfg.vault,
    authority,
    usdc: cfg.usdc,
    riskVerifier: raw.riskVerifier.toLowerCase() === ZERO ? null : raw.riskVerifier,
    protectedFloor: raw.protectedFloor,
    topUpThresholdBps: Number(raw.topUpThresholdBps),
    emergencyCap: raw.emergencyCap,
    velocityThreshold: raw.velocityThreshold,
    lossTriggerUsdc: raw.lossTriggerUsdc,
    lossCooldownSecs: raw.lossCooldownSecs,
    topUpCooldownSecs: raw.topUpCooldownSecs,
    loosenCooldownSecs: raw.loosenCooldownSecs,
    fullExitCooldownSecs: raw.fullExitCooldownSecs,
    cooldownUntil: raw.cooldownUntil,
    cooldownReason: Number(raw.cooldownReason),
    cooldownSetAt: raw.cooldownSetAt,
    lastVerdictNonce: raw.lastVerdictNonce,
    lastVerdictReason: Number(raw.lastVerdictReason),
    velocityBuckets: [...raw.velocityBuckets],
    bucketStart: raw.bucketStart,
    currentBucketIndex: Number(raw.currentBucketIndex),
    configVersion: raw.configVersion,
    proposalNonceCounter: raw.proposalNonceCounter,
    createdAt: raw.createdAt,
  };
}

export async function readVault(client: PublicClient, cfg: EvmConfig, authority: Address): Promise<{ vault: VaultView; balance: bigint } | null> {
  const raw = (await client.readContract({ address: cfg.vault, abi: SHIELD_VAULT_ABI, functionName: "getVault", args: [authority] })) as RawVault;
  if (!raw.exists) return null;
  return { vault: vaultViewOf(raw, cfg, authority), balance: raw.balance };
}

export async function readRegistry(client: PublicClient, cfg: EvmConfig, authority: Address): Promise<RegistryView[]> {
  const owners = (await client.readContract({ address: cfg.vault, abi: SHIELD_VAULT_ABI, functionName: "getRegistryOwners", args: [authority] })) as readonly Address[];
  const entries = await Promise.all(
    owners.map(async (owner) => {
      const e = (await client.readContract({ address: cfg.vault, abi: SHIELD_VAULT_ABI, functionName: "getRegistryEntry", args: [authority, owner] })) as { kind: number; route: number; active: boolean; registeredAt: bigint; label: Hex };
      return registryViewOf(owner, e);
    })
  );
  return entries;
}

type RawLoosen = {
  hasProtectedFloor: boolean; protectedFloor: bigint; hasTopUpThresholdBps: boolean; topUpThresholdBps: number; hasEmergencyCap: boolean; emergencyCap: bigint;
  hasVelocityThreshold: boolean; velocityThreshold: bigint; hasLossTriggerUsdc: boolean; lossTriggerUsdc: bigint; hasLossCooldownSecs: boolean; lossCooldownSecs: bigint;
  hasTopUpCooldownSecs: boolean; topUpCooldownSecs: bigint; hasLoosenCooldownSecs: boolean; loosenCooldownSecs: bigint; hasFullExitCooldownSecs: boolean; fullExitCooldownSecs: bigint;
  hasRiskVerifier: boolean; riskVerifier: Address; registerOwner: Address; registerKind: number; registerRoute: number; registerLabel: Hex;
};

function loosenView(r: RawLoosen): LoosenView {
  const v: LoosenView = {};
  if (r.hasProtectedFloor) v.newProtectedFloor = r.protectedFloor;
  if (r.hasTopUpThresholdBps) v.newTopUpThresholdBps = Number(r.topUpThresholdBps);
  if (r.hasEmergencyCap) v.newEmergencyCap = r.emergencyCap;
  if (r.hasVelocityThreshold) v.newVelocityThreshold = r.velocityThreshold;
  if (r.hasLossTriggerUsdc) v.newLossTriggerUsdc = r.lossTriggerUsdc;
  if (r.hasLossCooldownSecs) v.newLossCooldownSecs = r.lossCooldownSecs;
  if (r.hasTopUpCooldownSecs) v.newTopUpCooldownSecs = r.topUpCooldownSecs;
  if (r.hasLoosenCooldownSecs) v.newLoosenCooldownSecs = r.loosenCooldownSecs;
  if (r.hasFullExitCooldownSecs) v.newFullExitCooldownSecs = r.fullExitCooldownSecs;
  if (r.hasRiskVerifier) v.newRiskVerifier = r.riskVerifier.toLowerCase() === ZERO ? null : r.riskVerifier;
  if (r.registerOwner.toLowerCase() !== ZERO) {
    v.registerOwner = r.registerOwner;
    v.registerKind = Number(r.registerKind) as OwnerKind;
    v.registerRoute = Number(r.registerRoute) as Route;
    v.registerLabel = label(r.registerLabel);
  }
  return v;
}

type RawProposal = {
  exists: boolean; category: number; action: number; nonce: bigint; createdAt: bigint; executeAfter: bigint; expiry: bigint; configVersionAtCreation: bigint; destinationOwner: Address; amount: bigint; reservedBucketIndex: number; loosen: RawLoosen;
};

function proposalViewOf(p: RawProposal, authority: Address, category: 0 | 1 | 2): ProposalView | null {
  if (!p.exists) return null;
  const action: ProposalView["action"] =
    p.action === 0 ? { kind: "loosen", params: loosenView(p.loosen) }
    : p.action === 1 ? { kind: "topUp", destinationOwner: p.destinationOwner, amount: p.amount }
    : p.action === 2 ? { kind: "uninstallVault", destinationOwner: p.destinationOwner }
    : { kind: "coldTransferAboveCap", destinationOwner: p.destinationOwner, amount: p.amount };
  return { id: `${authority.toLowerCase()}:${category}:${p.nonce}`, category: category as ProposalKind, action, nonce: p.nonce, createdAt: p.createdAt, executeAfter: p.executeAfter, expiry: p.expiry, configVersionAtCreation: p.configVersionAtCreation };
}

const PROPOSAL_CATEGORIES = [0, 1, 2] as const;

function registryViewOf(owner: Address, e: { kind: number; route: number; active: boolean; registeredAt: bigint; label: Hex }): RegistryView {
  return { owner, kind: Number(e.kind) as OwnerKind, route: Number(e.route) as Route, active: e.active, registeredAt: e.registeredAt, label: label(e.label) };
}

export async function readProposals(client: PublicClient, cfg: EvmConfig, authority: Address): Promise<ProposalView[]> {
  const out: ProposalView[] = [];
  for (const category of PROPOSAL_CATEGORIES) {
    const p = (await client.readContract({ address: cfg.vault, abi: SHIELD_VAULT_ABI, functionName: "getProposal", args: [authority, category] })) as RawProposal;
    const view = proposalViewOf(p, authority, category);
    if (view) out.push(view);
  }
  return out;
}

/** Everything one refresh of the app needs from the chain. */
export interface VaultBundle {
  vault: VaultView;
  balance: bigint;
  proposals: ProposalView[];
  registry: RegistryView[];
  /** USDC held by the authority and by each registered destination, keyed lowercase. */
  usdc: Record<string, bigint>;
}

/** Whether this chain can serve a bundle in two requests instead of eleven. */
export function supportsBundledReads(cfg: EvmConfig): boolean {
  return CHAINS_WITH_MULTICALL3.has(cfg.chainId);
}

/**
 * Read a whole vault through Multicall3: one request for the vault, its three
 * proposal slots and its destination list; a second for each destination's
 * entry and USDC balance. Returns `null` when the vault does not exist — the
 * same signal `readVault` gives — so callers cannot confuse "no vault" with
 * "the RPC refused us", which is the failure this exists to prevent.
 */
export async function readVaultBundle(client: PublicClient, cfg: EvmConfig, authority: Address): Promise<VaultBundle | null> {
  const vault = { address: cfg.vault, abi: SHIELD_VAULT_ABI } as const;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mc = (contracts: unknown[]) => client.multicall({ allowFailure: false, contracts: contracts as any, multicallAddress: MULTICALL3 });

  const [rawVault, ...rest] = (await mc([
    { ...vault, functionName: "getVault", args: [authority] },
    ...PROPOSAL_CATEGORIES.map((c) => ({ ...vault, functionName: "getProposal", args: [authority, c] })),
    { ...vault, functionName: "getRegistryOwners", args: [authority] },
    { address: cfg.usdc, abi: MOCK_USDC_ABI, functionName: "balanceOf", args: [authority] },
  ])) as [RawVault, RawProposal, RawProposal, RawProposal, readonly Address[], bigint];

  if (!rawVault.exists) return null;
  const [p0, p1, p2, owners, authorityUsdc] = rest as [RawProposal, RawProposal, RawProposal, readonly Address[], bigint];
  const proposals = [p0, p1, p2].map((p, i) => proposalViewOf(p, authority, PROPOSAL_CATEGORIES[i]!)).filter((p): p is ProposalView => p !== null);

  const usdc: Record<string, bigint> = { [authority.toLowerCase()]: authorityUsdc };
  let registry: RegistryView[] = [];
  if (owners.length > 0) {
    const second = (await mc([
      ...owners.map((o) => ({ ...vault, functionName: "getRegistryEntry", args: [authority, o] })),
      ...owners.map((o) => ({ address: cfg.usdc, abi: MOCK_USDC_ABI, functionName: "balanceOf", args: [o] })),
    ])) as unknown[];
    registry = owners.map((o, i) => registryViewOf(o, second[i] as { kind: number; route: number; active: boolean; registeredAt: bigint; label: Hex }));
    owners.forEach((o, i) => {
      usdc[o.toLowerCase()] = second[owners.length + i] as bigint;
    });
  }
  return { vault: vaultViewOf(rawVault, cfg, authority), balance: rawVault.balance, proposals, registry, usdc };
}

export async function readUsdcBalance(client: PublicClient, cfg: EvmConfig, who: Address): Promise<bigint> {
  return (await client.readContract({ address: cfg.usdc, abi: MOCK_USDC_ABI, functionName: "balanceOf", args: [who] })) as bigint;
}

export async function readUsdcAllowance(client: PublicClient, cfg: EvmConfig, owner: Address): Promise<bigint> {
  return (await client.readContract({ address: cfg.usdc, abi: MOCK_USDC_ABI, functionName: "allowance", args: [owner, cfg.vault] })) as bigint;
}

// ---------------------------------------------------------------------
// Calls (encode only; the caller signs and sends)
// ---------------------------------------------------------------------

const vaultCall = (cfg: EvmConfig, functionName: string, args: readonly unknown[]): EvmCall => ({
  to: cfg.vault,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: encodeFunctionData({ abi: SHIELD_VAULT_ABI as any, functionName, args: args as any }),
});

export const evmCalls = {
  approveUsdc: (cfg: EvmConfig, amount: bigint): EvmCall => ({ to: cfg.usdc, data: encodeFunctionData({ abi: MOCK_USDC_ABI, functionName: "approve", args: [cfg.vault, amount] }) }),
  initializeVault: (cfg: EvmConfig, p: { riskVerifier: Address | null; protectedFloor: bigint; topUpThresholdBps: number; emergencyCap: bigint; velocityThreshold: bigint; lossTriggerUsdc: bigint; lossCooldownSecs: bigint }): EvmCall =>
    vaultCall(cfg, "initializeVault", [{ riskVerifier: p.riskVerifier ?? ZERO, protectedFloor: p.protectedFloor, topUpThresholdBps: p.topUpThresholdBps, emergencyCap: p.emergencyCap, velocityThreshold: p.velocityThreshold, lossTriggerUsdc: p.lossTriggerUsdc, lossCooldownSecs: p.lossCooldownSecs }]),
  deposit: (cfg: EvmConfig, authority: Address, amount: bigint): EvmCall => vaultCall(cfg, "deposit", [authority, amount]),
  registerOwner: (cfg: EvmConfig, owner: Address, kind: OwnerKind, route: Route, labelText: string): EvmCall => vaultCall(cfg, "registerOwner", [owner, kind, route, encodeLabel(labelText)]),
  removeRegistration: (cfg: EvmConfig, owner: Address): EvmCall => vaultCall(cfg, "removeRegistration", [owner]),
  tighten: (cfg: EvmConfig, t: TightenView): EvmCall =>
    vaultCall(cfg, "tighten", [{
      hasProtectedFloor: t.newProtectedFloor !== undefined, protectedFloor: t.newProtectedFloor ?? 0n,
      hasTopUpThresholdBps: t.newTopUpThresholdBps !== undefined, topUpThresholdBps: t.newTopUpThresholdBps ?? 0,
      hasEmergencyCap: t.newEmergencyCap !== undefined, emergencyCap: t.newEmergencyCap ?? 0n,
      hasVelocityThreshold: t.newVelocityThreshold !== undefined, velocityThreshold: t.newVelocityThreshold ?? 0n,
      hasLossTriggerUsdc: t.newLossTriggerUsdc !== undefined, lossTriggerUsdc: t.newLossTriggerUsdc ?? 0n,
      hasLossCooldownSecs: t.newLossCooldownSecs !== undefined, lossCooldownSecs: t.newLossCooldownSecs ?? 0n,
      hasTopUpCooldownSecs: t.newTopUpCooldownSecs !== undefined, topUpCooldownSecs: t.newTopUpCooldownSecs ?? 0n,
      hasLoosenCooldownSecs: t.newLoosenCooldownSecs !== undefined, loosenCooldownSecs: t.newLoosenCooldownSecs ?? 0n,
      hasFullExitCooldownSecs: t.newFullExitCooldownSecs !== undefined, fullExitCooldownSecs: t.newFullExitCooldownSecs ?? 0n,
      hasPauseTopUpsUntil: t.pauseTopUpsUntil !== undefined, pauseTopUpsUntil: t.pauseTopUpsUntil ?? 0n,
      hasRiskVerifier: t.setRiskVerifier !== undefined, riskVerifier: (t.setRiskVerifier ?? ZERO) as Address,
    }]),
  proposeLoosen: (cfg: EvmConfig, l: LoosenView): EvmCall =>
    vaultCall(cfg, "proposeLoosen", [{
      hasProtectedFloor: l.newProtectedFloor !== undefined, protectedFloor: l.newProtectedFloor ?? 0n,
      hasTopUpThresholdBps: l.newTopUpThresholdBps !== undefined, topUpThresholdBps: l.newTopUpThresholdBps ?? 0,
      hasEmergencyCap: l.newEmergencyCap !== undefined, emergencyCap: l.newEmergencyCap ?? 0n,
      hasVelocityThreshold: l.newVelocityThreshold !== undefined, velocityThreshold: l.newVelocityThreshold ?? 0n,
      hasLossTriggerUsdc: l.newLossTriggerUsdc !== undefined, lossTriggerUsdc: l.newLossTriggerUsdc ?? 0n,
      hasLossCooldownSecs: l.newLossCooldownSecs !== undefined, lossCooldownSecs: l.newLossCooldownSecs ?? 0n,
      hasTopUpCooldownSecs: l.newTopUpCooldownSecs !== undefined, topUpCooldownSecs: l.newTopUpCooldownSecs ?? 0n,
      hasLoosenCooldownSecs: l.newLoosenCooldownSecs !== undefined, loosenCooldownSecs: l.newLoosenCooldownSecs ?? 0n,
      hasFullExitCooldownSecs: l.newFullExitCooldownSecs !== undefined, fullExitCooldownSecs: l.newFullExitCooldownSecs ?? 0n,
      hasRiskVerifier: l.newRiskVerifier !== undefined, riskVerifier: (l.newRiskVerifier ?? ZERO) as Address,
      registerOwner: (l.registerOwner ?? ZERO) as Address, registerKind: l.registerKind ?? 0, registerRoute: l.registerRoute ?? 0, registerLabel: encodeLabel(l.registerLabel ?? ""),
    }]),
  executeRuleChange: (cfg: EvmConfig): EvmCall => vaultCall(cfg, "executeRuleChange", []),
  cancelProposal: (cfg: EvmConfig, category: ProposalKind): EvmCall => vaultCall(cfg, "cancelProposal", [category]),
  instantTopUp: (cfg: EvmConfig, destinationOwner: Address, amount: bigint): EvmCall => vaultCall(cfg, "instantTopUp", [destinationOwner, amount]),
  proposeTopUp: (cfg: EvmConfig, destinationOwner: Address, amount: bigint): EvmCall => vaultCall(cfg, "proposeTopUp", [destinationOwner, amount]),
  executeTopUp: (cfg: EvmConfig): EvmCall => vaultCall(cfg, "executeTopUp", []),
  instantColdTransfer: (cfg: EvmConfig, destinationOwner: Address, amount: bigint): EvmCall => vaultCall(cfg, "instantColdTransfer", [destinationOwner, amount]),
  proposeColdTransferAboveCap: (cfg: EvmConfig, destinationOwner: Address, amount: bigint): EvmCall => vaultCall(cfg, "proposeColdTransferAboveCap", [destinationOwner, amount]),
  proposeUninstallVault: (cfg: EvmConfig, destinationOwner: Address): EvmCall => vaultCall(cfg, "proposeUninstallVault", [destinationOwner]),
  executeFullExit: (cfg: EvmConfig): EvmCall => vaultCall(cfg, "executeFullExit", []),
  applyRiskVerdict: (cfg: EvmConfig, v: { vault: Address; nonce: bigint; issuedAt: bigint; expiry: bigint; reasonCode: number; realizedLossUsdc: bigint; evidenceHash: Hex }, signature: Hex): EvmCall =>
    vaultCall(cfg, "applyRiskVerdict", [v, signature]),
};

// ---------------------------------------------------------------------
// Errors and events
// ---------------------------------------------------------------------

/** Map a viem revert (simulate/estimate/receipt) to a Shield error name. */
export function shieldErrorFromRevert(e: unknown): ShieldErrorName | null {
  const seen = new Set<unknown>();
  let cur: unknown = e;
  while (cur && typeof cur === "object" && !seen.has(cur)) {
    seen.add(cur);
    const o = cur as { data?: unknown; cause?: unknown; message?: string; shortMessage?: string; details?: string };
    const data = o.data;
    if (typeof data === "string" && data.startsWith("0x") && data.length >= 10) {
      try {
        const d = decodeErrorResult({ abi: SHIELD_VAULT_ABI, data: data as Hex });
        if ((SHIELD_ERROR_NAMES as readonly string[]).includes(d.errorName)) return d.errorName as ShieldErrorName;
      } catch { /* not ours */ }
    }
    if (data && typeof data === "object" && "errorName" in (data as object)) {
      const name = (data as { errorName?: string }).errorName;
      if (name && (SHIELD_ERROR_NAMES as readonly string[]).includes(name)) return name as ShieldErrorName;
    }
    for (const text of [o.shortMessage, o.message, o.details]) {
      if (typeof text === "string") for (const name of SHIELD_ERROR_NAMES) if (text.includes(`${name}(`)) return name;
    }
    cur = o.cause;
  }
  return null;
}

export type ShieldEvmEvent = { name: string; args: Record<string, unknown>; txHash: Hex; blockNumber: bigint; logIndex: number };

export function decodeShieldLogs(logs: Parameters<typeof parseEventLogs>[0]["logs"]): ShieldEvmEvent[] {
  const parsed = parseEventLogs({ abi: SHIELD_VAULT_ABI, logs, strict: false });
  return parsed.map((l) => ({ name: l.eventName, args: (l.args ?? {}) as Record<string, unknown>, txHash: l.transactionHash as Hex, blockNumber: l.blockNumber as bigint, logIndex: Number(l.logIndex) }));
}
