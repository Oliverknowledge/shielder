/**
 * Privy bridge. When VITE_PRIVY_APP_ID is set the app is wrapped in
 * PrivyProvider (email / passkey / wallet login, embedded EVM wallet created
 * on login, HyperEVM as the default chain). The bridge publishes the
 * authenticated user's embedded wallet through a tiny context so the EVM
 * engine can sign with it. Without an app ID nothing Privy-related renders
 * and the demo-key path is used instead.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { PrivyProvider, usePrivy, useWallets } from "@privy-io/react-auth";
import type { EIP1193Provider } from "viem";
import { viemChain } from "../../../client/evm";

export const PRIVY_APP_ID: string | undefined = (import.meta.env.VITE_PRIVY_APP_ID as string | undefined) || undefined;

export interface PrivyState {
  available: boolean;
  ready: boolean;
  authenticated: boolean;
  address: string | null;
  label: string;
  provider: EIP1193Provider | null;
  login: () => void;
  logout: () => Promise<void>;
}

const noop: PrivyState = { available: false, ready: true, authenticated: false, address: null, label: "Privy", provider: null, login: () => {}, logout: async () => {} };
const Ctx = createContext<PrivyState>(noop);

function Bridge({ children }: { children: ReactNode }) {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets } = useWallets();
  const [provider, setProvider] = useState<EIP1193Provider | null>(null);
  // Prefer the wallet Privy created. "wallet" is an enabled login method, so a
  // user can also connect an external one through Privy — that still works, but
  // it is not an embedded wallet and the UI must not imply it is.
  const embedded = wallets.find((w) => w.walletClientType === "privy") ?? wallets[0];
  const isEmbedded = embedded?.walletClientType === "privy";
  useEffect(() => {
    let cancelled = false;
    if (!embedded) { setProvider(null); return; }
    embedded.getEthereumProvider().then((p) => { if (!cancelled) setProvider(p as unknown as EIP1193Provider); }).catch(() => setProvider(null));
    return () => { cancelled = true; };
  }, [embedded?.address]); // eslint-disable-line react-hooks/exhaustive-deps
  const value = useMemo<PrivyState>(() => ({
    available: true,
    ready,
    authenticated,
    address: authenticated ? (embedded?.address ?? null) : null,
    label: isEmbedded ? (user?.email?.address ?? "embedded wallet") : `${embedded?.walletClientType ?? "external"} wallet`,
    provider,
    login,
    logout,
  }), [ready, authenticated, embedded?.address, isEmbedded, embedded?.walletClientType, user?.email?.address, provider, login, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function MaybePrivy({ children, chainId, rpcUrl }: { children: ReactNode; chainId: number; rpcUrl: string }) {
  if (!PRIVY_APP_ID) return <Ctx.Provider value={noop}>{children}</Ctx.Provider>;
  // The same chain definition the engine signs against, so Privy's confirmation
  // modal knows this is a testnet and which explorer to offer. Two hand-written
  // copies of a chain object drift, and the one Privy holds is the one the user
  // actually sees.
  const chain = viemChain({ rpcUrl, chainId });
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["email", "passkey", "wallet"],
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
        defaultChain: chain,
        supportedChains: [chain],
        appearance: { theme: "light", accentColor: "#1c6b4a" },
      }}
    >
      <Bridge>{children}</Bridge>
    </PrivyProvider>
  );
}

export const usePrivyState = () => useContext(Ctx);
