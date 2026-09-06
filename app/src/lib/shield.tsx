/**
 * Shield app data layer, chain-agnostic.
 *
 * Enforcement state (vault, proposals, registry, balances) is read straight
 * from the chain through an Engine (Solana program or ShieldVault.sol), so
 * every number that governs money is the chain's own, never the server's.
 * The server only adds what the chain cannot tell you: behavioural history
 * and the monitor's explanations. If it is down the app degrades to
 * "behaviour unavailable" and every rule still works.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Keypair } from "@solana/web3.js";
import { ConnectionProvider, WalletProvider, useWallet } from "@solana/wallet-adapter-react";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Chain, ProposalView, RegistryView, VaultView, WalletBalanceView } from "../../../client/views";
import { getJson, type ServerHealth, type VaultPayload } from "./api";
import type { Actions, Engine, PreparedTx, Signer } from "./engine";
import { solanaEngine } from "./solana-engine";
import { evmEngine, type EvmEngineConfig } from "./evm-engine";
import { MaybePrivy, usePrivyState } from "./privy";

export { ShieldTxError } from "./engine";
export type { Signer } from "./engine";

export const CHAIN: Chain = ((import.meta.env.VITE_SHIELD_CHAIN as string | undefined) === "evm" ? "evm" : "solana");
export const RPC_URL: string = (import.meta.env.VITE_SHIELD_RPC_URL as string | undefined) ?? (CHAIN === "evm" ? "http://127.0.0.1:8545" : "http://127.0.0.1:8899");
export const API_URL: string = (import.meta.env.VITE_SHIELD_API as string | undefined) ?? "http://localhost:8787";
export const EVM_CHAIN_ID = Number((import.meta.env.VITE_EVM_CHAIN_ID as string | undefined) ?? 31337);

/**
 * The public HyperEVM RPC meters requests by weight, and one vault read is
 * several eth_calls. Polling it as fast as a local chain gets the app rate
 * limited, so it backs off there; the server does the same (server/evm-index.ts).
 */
const IS_PUBLIC_HYPEREVM = EVM_CHAIN_ID === 998 || EVM_CHAIN_ID === 999;
const CHAIN_POLL_MS = IS_PUBLIC_HYPEREVM ? 20_000 : 4_000;
const SERVER_POLL_MS = IS_PUBLIC_HYPEREVM ? 6_000 : 4_000;

/** Human network name for the badge. */
export const NETWORK: string = CHAIN === "evm"
  ? (EVM_CHAIN_ID === 999 ? "hyperevm" : EVM_CHAIN_ID === 998 ? "hyperevm-testnet" : EVM_CHAIN_ID === 31337 ? "anvil" : `evm-${EVM_CHAIN_ID}`)
  : RPC_URL.includes("devnet") ? "devnet" : RPC_URL.includes("mainnet") ? "mainnet-beta" : "localnet";

export const IS_MAINNET = NETWORK === "mainnet-beta" || NETWORK === "hyperevm";

export interface ShieldData {
  chain: Chain;
  network: string;
  engine: Engine | null;
  signer: Signer | null;
  connectDemo: (secret: number[] | string) => void;
  disconnect: () => Promise<void>;
  /** Server key for this signer's vault. */
  vaultKey: string | null;
  vault: VaultView | null;
  balance: bigint;
  proposals: ProposalView[];
  registry: RegistryView[];
  wallets: WalletBalanceView[];
  walletUsdc: bigint | null;
  usdc: string | null;
  loading: boolean;
  /** True once a chain read has actually completed. Until then "no vault" is unknown, not false. */
  vaultKnown: boolean;
  server: VaultPayload | null;
  health: ServerHealth | null;
  serverError: string | null;
  serverLoading: boolean;
  refresh: () => Promise<void>;
  actions: Actions | null;
  sendTx: (tx: PreparedTx, opts?: { recordRejection?: boolean }) => Promise<string>;
  explorerUrl: (kind: "tx" | "address", id: string) => string;
  privy: ReturnType<typeof usePrivyState>;
  now: number;
}

const Ctx = createContext<ShieldData | null>(null);
const DEMO_KEY = "shield.demoSecretKey";
const DEMO_EVM_KEY = "shield.evmDemoKey";

let explorerRef: (kind: "tx" | "address", id: string) => string = (kind, id) => `#${kind}/${id}`;
/** Module-level accessor for components outside the provider tree (toasts). */
export const explorerUrl = (kind: "tx" | "address", id: string) => explorerRef(kind, id);

function Inner({ children }: { children: ReactNode }) {
  const wallet = useWallet();
  const privy = usePrivyState();
  const [health, setHealth] = useState<ServerHealth | null>(null);

  // --- demo keys (session only) ---
  const [demoKeypair, setDemoKeypair] = useState<Keypair | null>(() => {
    try {
      const raw = sessionStorage.getItem(DEMO_KEY);
      return raw ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw))) : null;
    } catch {
      return null;
    }
  });
  const [demoEvmKey, setDemoEvmKey] = useState<Hex | null>(() => (sessionStorage.getItem(DEMO_EVM_KEY) as Hex | null) ?? null);
  const demoKeypairRef = useRef(demoKeypair);
  demoKeypairRef.current = demoKeypair;
  const demoEvmRef = useRef(demoEvmKey);
  demoEvmRef.current = demoEvmKey;
  const walletRef = useRef(wallet);
  walletRef.current = wallet;
  const privyRef = useRef(privy);
  privyRef.current = privy;

  // --- engine ---
  const evmCfg: EvmEngineConfig | null = useMemo(() => {
    if (CHAIN !== "evm") return null;
    const env = import.meta.env as Record<string, string | undefined>;
    const vault = env.VITE_SHIELD_VAULT_ADDRESS ?? health?.evm?.vault;
    const usdc = env.VITE_USDC_ADDRESS ?? health?.evm?.usdc;
    if (!vault || !usdc) return null;
    return {
      rpcUrl: RPC_URL,
      chainId: EVM_CHAIN_ID,
      vault: vault as `0x${string}`,
      usdc: usdc as `0x${string}`,
      coreDepositMock: (env.VITE_CORE_DEPOSIT_MOCK ?? health?.evm?.coreDepositMock ?? undefined) as `0x${string}` | undefined,
      hyperliquidNetwork: (env.VITE_HL_NETWORK as "mainnet" | "testnet" | undefined) ?? (EVM_CHAIN_ID === 999 ? "mainnet" : EVM_CHAIN_ID === 998 ? "testnet" : undefined),
    };
  }, [health?.evm?.vault, health?.evm?.usdc, health?.evm?.coreDepositMock]);

  const engine: Engine | null = useMemo(() => {
    if (CHAIN === "solana") {
      return solanaEngine(RPC_URL, () => demoKeypairRef.current, () => (walletRef.current.connected ? { sendTransaction: (tx, c, o) => walletRef.current.sendTransaction(tx, c, o) } : null));
    }
    if (!evmCfg) return null;
    return evmEngine(evmCfg, () => demoEvmRef.current, () => privyRef.current.provider);
  }, [evmCfg]);

  useEffect(() => {
    if (engine) explorerRef = engine.explorerUrl;
  }, [engine]);

  // --- signer ---
  const signer: Signer | null = useMemo(() => {
    if (CHAIN === "solana") {
      if (wallet.connected && wallet.publicKey) return { address: wallet.publicKey.toBase58(), kind: "wallet", label: wallet.wallet?.adapter.name ?? "Wallet" };
      if (demoKeypair) return { address: demoKeypair.publicKey.toBase58(), kind: "demo", label: "Demo key" };
      return null;
    }
    if (privy.authenticated && privy.address) return { address: privy.address, kind: "privy", label: privy.label };
    if (demoEvmKey) return { address: privateKeyToAccount(demoEvmKey).address, kind: "demo", label: "Demo key" };
    return null;
  }, [wallet.connected, wallet.publicKey, wallet.wallet, demoKeypair, demoEvmKey, privy.authenticated, privy.address, privy.label]);

  const vaultKey = useMemo(() => (engine && signer ? engine.vaultKeyFor(signer) : null), [engine, signer]);

  // --- state ---
  const [vault, setVault] = useState<VaultView | null>(null);
  const [balance, setBalance] = useState<bigint>(0n);
  const [proposals, setProposals] = useState<ProposalView[]>([]);
  const [registry, setRegistry] = useState<RegistryView[]>([]);
  const [wallets, setWallets] = useState<WalletBalanceView[]>([]);
  const [walletUsdc, setWalletUsdc] = useState<bigint | null>(null);
  const [loading, setLoading] = useState(true);
  const [vaultKnown, setVaultKnown] = useState(false);
  const [server, setServer] = useState<VaultPayload | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverLoading, setServerLoading] = useState(true);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const inflight = useRef(false);
  const vaultExistsRef = useRef(false);
  const vaultKnownRef = useRef(false);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const refresh = useCallback(async () => {
    if (!engine || !signer) {
      vaultKnownRef.current = false;
      setVaultKnown(false);
      setVault(null);
      setLoading(CHAIN === "evm" && !engine && !!signer); // still waiting for config
      return;
    }
    if (inflight.current) return;
    inflight.current = true;
    try {
      const snap = await engine.read(signer);
      vaultExistsRef.current = !!snap.vault;
      vaultKnownRef.current = true;
      setVaultKnown(true);
      setVault(snap.vault);
      setBalance(snap.balance);
      setProposals(snap.proposals);
      setRegistry(snap.registry);
      setWallets(snap.wallets);
      setWalletUsdc(snap.walletUsdc);
    } catch (e) {
      // Transient RPC failures (rate limiting, a dropped connection) must not
      // wipe the vault the user is looking at: keep the last good snapshot.
      console.warn("refresh failed", e);
      // Nothing to show yet: retry soon rather than waiting out a poll that is
      // paced for a healthy connection.
      if (!vaultKnownRef.current) retry.current = setTimeout(() => void refreshRef.current?.(), 2500);
    } finally {
      inflight.current = false;
      setLoading(false);
    }
  }, [engine, signer]);

  const refreshServer = useCallback(async () => {
    try {
      const h = await getJson<ServerHealth>(`${API_URL}/api/health`);
      setHealth(h);
      if (vaultKey && vaultExistsRef.current) {
        const p = await getJson<VaultPayload>(`${API_URL}/api/vault/${vaultKey}`);
        setServer(p);
        setServerLoading(false);
      } else {
        setServer(null);
      }
      setServerError(null);
    } catch (e) {
      setServerError(e instanceof Error ? e.message : String(e));
      setServerLoading(false);
    }
  }, [vaultKey]);

  useEffect(() => {
    setLoading(true);
    setServerLoading(true);
    void refresh().then(() => refreshServer());
    const a = setInterval(() => void refresh(), CHAIN_POLL_MS);
    const b = setInterval(() => void refreshServer(), SERVER_POLL_MS);
    return () => {
      clearInterval(a);
      clearInterval(b);
      if (retry.current) clearTimeout(retry.current);
    };
  }, [refresh, refreshServer]);

  refreshRef.current = refresh;

  const connectDemo = useCallback((secret: number[] | string) => {
    if (CHAIN === "solana") {
      const arr = typeof secret === "string" ? (JSON.parse(secret) as number[]) : secret;
      const kp = Keypair.fromSecretKey(Uint8Array.from(arr));
      sessionStorage.setItem(DEMO_KEY, JSON.stringify(arr));
      setDemoKeypair(kp);
    } else {
      const hex = (typeof secret === "string" ? secret.trim() : "") as Hex;
      privateKeyToAccount(hex); // validates
      sessionStorage.setItem(DEMO_EVM_KEY, hex);
      setDemoEvmKey(hex);
    }
  }, []);

  const disconnect = useCallback(async () => {
    sessionStorage.removeItem(DEMO_KEY);
    sessionStorage.removeItem(DEMO_EVM_KEY);
    setDemoKeypair(null);
    setDemoEvmKey(null);
    if (wallet.connected) await wallet.disconnect();
    if (privy.authenticated) await privy.logout();
  }, [wallet, privy]);

  const usdc = CHAIN === "evm" ? (evmCfg?.usdc ?? null) : (vault?.usdc ?? health?.usdcMint ?? ((import.meta.env.VITE_USDC_MINT as string | undefined) || null));
  const actions = useMemo<Actions | null>(() => (engine && signer && usdc ? engine.actions(signer, usdc) : null), [engine, signer, usdc]);

  const sendTx = useCallback<ShieldData["sendTx"]>(
    async (tx, opts = {}) => {
      if (!engine || !signer) throw new Error("connect a wallet first");
      const sig = await engine.send(signer, tx, opts);
      await refresh();
      void refreshServer();
      return sig;
    },
    [engine, signer, refresh, refreshServer]
  );

  const value: ShieldData = {
    chain: CHAIN,
    network: NETWORK,
    engine,
    signer,
    connectDemo,
    disconnect,
    vaultKey,
    vault,
    balance,
    proposals,
    registry,
    wallets,
    walletUsdc,
    usdc,
    loading,
    vaultKnown,
    server,
    health,
    serverError,
    serverLoading,
    refresh,
    actions,
    sendTx,
    explorerUrl: engine ? engine.explorerUrl : explorerUrl,
    privy,
    now,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function ShieldProvider({ children }: { children: ReactNode }) {
  // Solana wallet-standard providers are harmless on EVM builds; Privy wraps only when configured.
  return (
    <ConnectionProvider endpoint={CHAIN === "solana" ? RPC_URL : "http://127.0.0.1:8899"} config={{ commitment: "confirmed" }}>
      <WalletProvider wallets={[]} autoConnect={CHAIN === "solana"}>
        <MaybePrivy chainId={EVM_CHAIN_ID} rpcUrl={RPC_URL}>
          <Inner>{children}</Inner>
        </MaybePrivy>
      </WalletProvider>
    </ConnectionProvider>
  );
}

export function useShield(): ShieldData {
  const v = useContext(Ctx);
  if (!v) throw new Error("useShield outside provider");
  return v;
}
