/**
 * Shield app data layer.
 *
 * Enforcement state (vault, proposals, registry, balances) is read straight
 * from Solana RPC, so every number that governs money is the chain's own,
 * never the server's. The server is used only for what the chain cannot
 * tell you: behavioural history (from The Graph) and the monitor's
 * explanations. If the server is down, the app degrades to "behaviour
 * unavailable" and every rule still works.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Connection, Keypair, PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { ConnectionProvider, WalletProvider, useWallet } from "@solana/wallet-adapter-react";
import { getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  fetchAllProposals,
  fetchRegistry,
  fetchVault,
  parseShieldError,
  vaultPda,
  vaultTokenAccountPda,
  OwnerType,
  type ProposalState,
  type RegistryEntryState,
  type ShieldErrorName,
  type VaultState,
} from "../../../client/shield-client";
import { getJson, type ServerHealth, type VaultPayload } from "./api";

export type Network = "localnet" | "devnet" | "mainnet-beta";
export const RPC_URL: string = (import.meta.env.VITE_SHIELD_RPC_URL as string | undefined) ?? "http://127.0.0.1:8899";
export const API_URL: string = (import.meta.env.VITE_SHIELD_API as string | undefined) ?? "http://localhost:8787";
export const NETWORK: Network = RPC_URL.includes("devnet") ? "devnet" : RPC_URL.includes("mainnet") ? "mainnet-beta" : "localnet";

export function explorerUrl(kind: "tx" | "address", id: string): string {
  const base = `https://explorer.solana.com/${kind}/${id}`;
  if (NETWORK === "devnet") return `${base}?cluster=devnet`;
  if (NETWORK === "localnet") return `${base}?cluster=custom&customUrl=${encodeURIComponent(RPC_URL)}`;
  return base;
}

export class ShieldTxError extends Error {
  constructor(
    message: string,
    public readonly shieldError: ShieldErrorName | null,
    public readonly logs: string[],
    public readonly signature: string | null = null
  ) {
    super(message);
  }
}

export interface Signer {
  publicKey: PublicKey;
  kind: "wallet" | "demo";
  label: string;
}

export interface WalletBalance {
  owner: string;
  label: string;
  kind: OwnerType;
  active: boolean;
  usdc: bigint | null;
}

export interface ShieldData {
  network: Network;
  connection: Connection;
  signer: Signer | null;
  connectDemo: (secretKey: number[]) => void;
  disconnect: () => Promise<void>;
  vaultAddress: PublicKey | null;
  vault: VaultState | null;
  balance: bigint;
  proposals: ProposalState[];
  registry: RegistryEntryState[];
  wallets: WalletBalance[];
  walletUsdc: bigint | null; // signer's own USDC (outside the vault)
  loading: boolean;
  server: VaultPayload | null;
  health: ServerHealth | null;
  serverError: string | null;
  /** True until the first server response (or failure) for this vault. */
  serverLoading: boolean;
  refresh: () => Promise<void>;
  sendTx: (ixs: TransactionInstruction[], opts?: { recordRejection?: boolean }) => Promise<string>;
  simulate: (ixs: TransactionInstruction[]) => Promise<{ ok: true } | { ok: false; error: ShieldErrorName | null; logs: string[] }>;
  now: number;
}

const Ctx = createContext<ShieldData | null>(null);

const DEMO_KEY = "shield.demoSecretKey";

function Inner({ children }: { children: ReactNode }) {
  const wallet = useWallet();
  const connection = useMemo(() => new Connection(RPC_URL, "confirmed"), []);
  const [demoKeypair, setDemoKeypair] = useState<Keypair | null>(() => {
    try {
      const raw = sessionStorage.getItem(DEMO_KEY);
      return raw ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw))) : null;
    } catch {
      return null;
    }
  });

  const signer: Signer | null = useMemo(() => {
    if (wallet.connected && wallet.publicKey) return { publicKey: wallet.publicKey, kind: "wallet", label: wallet.wallet?.adapter.name ?? "Wallet" };
    if (demoKeypair) return { publicKey: demoKeypair.publicKey, kind: "demo", label: "Demo key" };
    return null;
  }, [wallet.connected, wallet.publicKey, wallet.wallet, demoKeypair]);

  const vaultAddress = useMemo(() => (signer ? vaultPda(signer.publicKey)[0] : null), [signer]);

  const [vault, setVault] = useState<VaultState | null>(null);
  const [balance, setBalance] = useState<bigint>(0n);
  const [proposals, setProposals] = useState<ProposalState[]>([]);
  const [registry, setRegistry] = useState<RegistryEntryState[]>([]);
  const [wallets, setWallets] = useState<WalletBalance[]>([]);
  const [walletUsdc, setWalletUsdc] = useState<bigint | null>(null);
  const [loading, setLoading] = useState(true);
  const [server, setServer] = useState<VaultPayload | null>(null);
  const [health, setHealth] = useState<ServerHealth | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverLoading, setServerLoading] = useState(true);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const inflight = useRef(false);
  const vaultExistsRef = useRef(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const refresh = useCallback(async () => {
    if (!vaultAddress || !signer) {
      setVault(null);
      setLoading(false);
      return;
    }
    if (inflight.current) return;
    inflight.current = true;
    try {
      const v = await fetchVault(connection, vaultAddress);
      vaultExistsRef.current = !!v;
      setVault(v);
      if (v) {
        const [vaultAta] = vaultTokenAccountPda(vaultAddress);
        const [acct, props, reg] = await Promise.all([
          getAccount(connection, vaultAta, "confirmed").catch(() => null),
          fetchAllProposals(connection, vaultAddress),
          fetchRegistry(connection, vaultAddress),
        ]);
        setBalance(acct?.amount ?? 0n);
        setProposals(props);
        setRegistry(reg);
        const balances = await Promise.all(
          reg.map(async (r) => {
            const ata = getAssociatedTokenAddressSync(v.usdcMint, r.owner, true);
            const a = await getAccount(connection, ata, "confirmed").catch(() => null);
            return { owner: r.owner.toBase58(), label: r.label, kind: r.kind, active: r.active, usdc: a ? a.amount : null };
          })
        );
        setWallets(balances);
        const own = await getAccount(connection, getAssociatedTokenAddressSync(v.usdcMint, signer.publicKey, true), "confirmed").catch(() => null);
        setWalletUsdc(own ? own.amount : 0n);
      }
    } catch (e) {
      console.warn("refresh failed", e);
    } finally {
      inflight.current = false;
      setLoading(false);
    }
  }, [connection, vaultAddress, signer]);

  const refreshServer = useCallback(async () => {
    try {
      const h = await getJson<ServerHealth>(`${API_URL}/api/health`);
      setHealth(h);
      if (vaultAddress && vaultExistsRef.current) {
        const p = await getJson<VaultPayload>(`${API_URL}/api/vault/${vaultAddress.toBase58()}`);
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
  }, [vaultAddress]);

  useEffect(() => {
    setLoading(true);
    setServerLoading(true);
    // The server payload is only meaningful once we know the vault exists,
    // so the first server fetch follows the first chain fetch.
    void refresh().then(() => refreshServer());
    const a = setInterval(() => void refresh(), 4000);
    const b = setInterval(() => void refreshServer(), 4000);
    return () => {
      clearInterval(a);
      clearInterval(b);
    };
  }, [refresh, refreshServer]);

  const connectDemo = useCallback((secretKey: number[]) => {
    const kp = Keypair.fromSecretKey(Uint8Array.from(secretKey));
    sessionStorage.setItem(DEMO_KEY, JSON.stringify(secretKey));
    setDemoKeypair(kp);
  }, []);

  const disconnect = useCallback(async () => {
    sessionStorage.removeItem(DEMO_KEY);
    setDemoKeypair(null);
    if (wallet.connected) await wallet.disconnect();
  }, [wallet]);

  const buildTx = useCallback(
    async (ixs: TransactionInstruction[]) => {
      if (!signer) throw new Error("connect a wallet first");
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
      const tx = new Transaction({ feePayer: signer.publicKey, blockhash, lastValidBlockHeight });
      tx.add(...ixs);
      return { tx, blockhash, lastValidBlockHeight };
    },
    [connection, signer]
  );

  const simulate = useCallback<ShieldData["simulate"]>(
    async (ixs) => {
      const { tx } = await buildTx(ixs);
      const sim = await connection.simulateTransaction(tx);
      if (sim.value.err) {
        const logs = sim.value.logs ?? [];
        return { ok: false, error: parseShieldError(`${JSON.stringify(sim.value.err)}\n${logs.join("\n")}`), logs };
      }
      return { ok: true };
    },
    [buildTx, connection]
  );

  const sendTx = useCallback<ShieldData["sendTx"]>(
    async (ixs, opts = {}) => {
      if (!signer) throw new Error("connect a wallet first");
      const { tx, blockhash, lastValidBlockHeight } = await buildTx(ixs);

      // Simulate first: a rejection is the program's own decision, and we
      // can show it without asking the wallet to sign anything.
      const sim = await connection.simulateTransaction(tx);
      if (sim.value.err) {
        const logs = sim.value.logs ?? [];
        const name = parseShieldError(`${JSON.stringify(sim.value.err)}\n${logs.join("\n")}`);
        let recorded: string | null = null;
        if (opts.recordRejection && demoKeypair && signer.kind === "demo") {
          // Demo keys can land the rejection on-chain (skip preflight) so the
          // failed transaction is inspectable on an explorer.
          try {
            tx.sign(demoKeypair);
            recorded = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
            await connection.confirmTransaction({ signature: recorded, blockhash, lastValidBlockHeight }, "confirmed").catch(() => null);
          } catch {
            recorded = null;
          }
        }
        throw new ShieldTxError(name ? `Rejected by the vault: ${name}` : "Transaction failed", name, logs, recorded);
      }

      let signature: string;
      if (signer.kind === "demo" && demoKeypair) {
        tx.sign(demoKeypair);
        signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
      } else {
        signature = await wallet.sendTransaction(tx, connection, { preflightCommitment: "confirmed" });
      }
      const conf = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
      if (conf.value.err) throw new ShieldTxError("Transaction failed on-chain", null, [], signature);
      await refresh();
      void refreshServer();
      return signature;
    },
    [buildTx, connection, demoKeypair, refresh, refreshServer, signer, wallet]
  );

  const value: ShieldData = {
    network: NETWORK,
    connection,
    signer,
    connectDemo,
    disconnect,
    vaultAddress,
    vault,
    balance,
    proposals,
    registry,
    wallets,
    walletUsdc,
    loading,
    server,
    health,
    serverError,
    serverLoading,
    refresh,
    sendTx,
    simulate,
    now,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function ShieldProvider({ children }: { children: ReactNode }) {
  return (
    <ConnectionProvider endpoint={RPC_URL} config={{ commitment: "confirmed" }}>
      <WalletProvider wallets={[]} autoConnect>
        <Inner>{children}</Inner>
      </WalletProvider>
    </ConnectionProvider>
  );
}

export function useShield(): ShieldData {
  const v = useContext(Ctx);
  if (!v) throw new Error("useShield outside provider");
  return v;
}
