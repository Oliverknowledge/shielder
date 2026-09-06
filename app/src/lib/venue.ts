/**
 * The connected venue: where the user actually trades.
 *
 * Shield holds protected capital and releases bankroll under rules; the
 * trading itself happens on Hyperliquid. This hook is the one place that
 * answers "which account is that, what is in it right now, and how did the
 * session go", and it never invents a number: if the venue has no account for
 * the registered address, `state` says so.
 */
import { useEffect, useState } from "react";
import { useShield } from "./shield";
import { loadAccount, loadRecentPnl, venueUrl, type AccountView, type HlNet, type RecentPnl } from "./hyperliquid";
import { OwnerKind, Route, type WalletBalanceView } from "../../../client/views";

export const VENUE_NAME = "Hyperliquid";

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms))]);
}

/** Testnet unless the build is explicitly on Hyperliquid mainnet. */
export const HL_NET: HlNet = ((import.meta.env.VITE_HL_NETWORK as string | undefined) === "mainnet" ? "mainnet" : "testnet");

export interface Venue {
  /** The registered execution destination, or null before onboarding finishes. */
  registration: WalletBalanceView | null;
  address: string | null;
  label: string;
  /** Live venue account, once the info API has answered. */
  account: AccountView | null;
  session: RecentPnl | null;
  url: string;
  /**
   * "live"       – the venue knows this account; equity and PnL below are real.
   * "no-account" – the address has never traded on this Hyperliquid network.
   * "loading"    – first read in flight.
   * "unreachable"– the info API failed.
   * "simulated"  – Shield is on a local chain, so releases land in a mock
   *                deposit contract rather than a real Hyperliquid account.
   * "none"       – no trading destination registered yet.
   */
  state: "live" | "no-account" | "loading" | "unreachable" | "simulated" | "none";
  /** True when a release from the vault lands in HyperCore for real (HyperEVM), false on the Anvil mock. */
  deliversToCore: boolean;
  /** USDC sitting in the destination wallet on the Shield chain, when Shield can see it. */
  walletUsdc: bigint | null;
  /** What is actually in the bankroll, from whichever source is authoritative on this chain. */
  bankroll: bigint | null;
}

export function useVenue(): Venue {
  const { wallets, network, chain } = useShield();
  const reg = wallets.find((w) => w.kind === OwnerKind.Execution && w.active) ?? null;
  const address = reg?.owner ?? null;
  const linked = chain === "evm" && reg?.route === Route.HyperCore && (network === "hyperevm" || network === "hyperevm-testnet");
  const [account, setAccount] = useState<AccountView | null>(null);
  const [session, setSession] = useState<RecentPnl | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    // Only read the venue when Shield's releases actually land there. On a
    // local chain the destination is a mock, and the same address may well
    // have an unrelated real account on Hyperliquid — showing that as the
    // bankroll would be a live number about the wrong thing.
    if (!address || !linked) return;
    let alive = true;
    setStatus("loading");
    const load = async () => {
      try {
        // Bounded: a venue that never answers must show as unreachable rather
        // than leave the panel reading "loading" forever.
        const [a, p] = await withTimeout(Promise.all([loadAccount(HL_NET, address), loadRecentPnl(HL_NET, address, Date.now() - 86_400_000)]), 8000);
        if (!alive) return;
        setAccount(a);
        setSession(p);
        setStatus("ok");
      } catch (e) {
        console.warn("venue read failed", e);
        if (alive) setStatus("error");
      }
    };
    void load();
    const t = setInterval(() => void load(), 15_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [address, linked]);

  const state: Venue["state"] = !address ? "none" : !linked ? "simulated" : status === "loading" ? "loading" : status === "error" ? "unreachable" : account?.exists ? "live" : "no-account";

  return {
    registration: reg,
    address,
    label: linked || reg?.route === Route.HyperCore ? VENUE_NAME : reg?.label || (chain === "evm" ? VENUE_NAME : "your trading wallet"),
    account,
    session,
    url: venueUrl(HL_NET),
    state,
    deliversToCore: linked,
    walletUsdc: reg?.usdc ?? null,
    bankroll: linked && account?.exists ? BigInt(Math.round(account.accountValue * 1e6)) : (reg?.usdc ?? null),
  };
}
