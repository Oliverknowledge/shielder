/**
 * Where the EVM demo state lives.
 *
 * Shield runs on more than one EVM at once: an Anvil stack for the local
 * gauntlet and the deployed HyperEVM testnet vault. One shared
 * `demo-state.evm.json` meant bootstrapping either network silently clobbered
 * the other, so the file is keyed by network, with the old unsuffixed path
 * kept as a fallback for anything written before.
 */
import { existsSync, readFileSync } from "node:fs";

export interface EvmDemoState {
  chain: string;
  network: string;
  rpcUrl: string;
  chainId: number;
  vault: string;
  usdc: string;
  coreDeposit: string | null;
  authority: string;
  executionWallet: string;
  coldWallet: string;
  riskVerifier: string;
  verifierKeyNote?: string;
  relayer?: string;
  startBlock: number;
  createdAt: string;
}

export function evmNetworkName(chainId: number): string {
  return chainId === 999 ? "hyperevm" : chainId === 998 ? "hyperevm-testnet" : chainId === 31337 ? "anvil" : `evm-${chainId}`;
}

export function evmStatePath(stateDir: string, network: string): string {
  return `${stateDir}/demo-state.evm.${network}.json`;
}

/** The network-specific file if it exists, else the legacy shared one, else `{}`. */
export function readEvmState(stateDir: string, network: string): Partial<EvmDemoState> {
  for (const p of [evmStatePath(stateDir, network), `${stateDir}/demo-state.evm.json`]) {
    if (!existsSync(p)) continue;
    const s = JSON.parse(readFileSync(p, "utf8")) as Partial<EvmDemoState>;
    // The legacy file may belong to a different network: only trust a match.
    if (!s.network || s.network === network || p.endsWith(`.${network}.json`)) return s;
  }
  return {};
}
