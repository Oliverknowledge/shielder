/**
 * Chain engine interface. The app talks to one engine; the engine talks to
 * one chain. Pages only ever see the chain-agnostic views and `Actions`.
 */
import type { TransactionInstruction } from "@solana/web3.js";
import type { EvmCall } from "../../../client/evm";
import type { InitView, RegistrationInput } from "../../../client/solana-adapter";
import type { Chain, LoosenView, ProposalKind, ProposalView, RegistryView, ShieldErrorName, TightenView, VaultView, WalletBalanceView } from "../../../client/views";

export type PreparedTx = { chain: "solana"; ixs: TransactionInstruction[] } | { chain: "evm"; calls: EvmCall[] };

export interface Signer {
  address: string;
  kind: "wallet" | "demo" | "privy";
  label: string;
}

export interface VaultSnapshot {
  vault: VaultView | null;
  balance: bigint;
  proposals: ProposalView[];
  registry: RegistryView[];
  wallets: WalletBalanceView[];
  walletUsdc: bigint | null;
}

export interface Actions {
  activate(p: InitView, regs: RegistrationInput[]): PreparedTx;
  deposit(amount: bigint): PreparedTx;
  registerOwner(r: RegistrationInput): PreparedTx;
  removeRegistration(owner: string): PreparedTx;
  tighten(t: TightenView): PreparedTx;
  proposeLoosen(l: LoosenView): PreparedTx;
  executeRuleChange(registerOwner?: string): PreparedTx;
  cancelProposal(category: ProposalKind): PreparedTx;
  instantTopUp(dest: string, amount: bigint): PreparedTx;
  proposeTopUp(dest: string, amount: bigint): PreparedTx;
  executeTopUp(dest: string): PreparedTx;
  instantColdTransfer(dest: string, amount: bigint): PreparedTx;
  proposeColdTransferAboveCap(dest: string, amount: bigint): PreparedTx;
  proposeUninstallVault(dest: string): PreparedTx;
  executeFullExit(dest: string): PreparedTx;
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

export interface Engine {
  chain: Chain;
  network: string;
  /** Key the server indexes the vault under (Solana: vault PDA; EVM: authority address). */
  vaultKeyFor(signer: Signer): string;
  explorerUrl(kind: "tx" | "address", id: string): string;
  read(signer: Signer): Promise<VaultSnapshot>;
  actions(signer: Signer, usdc: string): Actions;
  send(signer: Signer, tx: PreparedTx, opts: { recordRejection?: boolean }): Promise<string>;
  isValidAddress(s: string): boolean;
}
