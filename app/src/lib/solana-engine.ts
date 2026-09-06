import { Connection, Keypair, PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { fetchAllProposals, fetchRegistry, fetchVault, parseShieldError, vaultPda, vaultTokenAccountPda } from "../../../client/shield-client";
import { solanaActions, toProposalView, toRegistryView, toVaultView } from "../../../client/solana-adapter";
import { Route, type ShieldErrorName } from "../../../client/views";
import { ShieldTxError, type Actions, type Engine, type PreparedTx, type Signer, type VaultSnapshot } from "./engine";

export interface SolanaWalletBridge {
  sendTransaction: (tx: Transaction, connection: Connection, opts: { preflightCommitment: "confirmed" }) => Promise<string>;
}

export function solanaEngine(rpcUrl: string, demoKeypair: () => Keypair | null, walletBridge: () => SolanaWalletBridge | null): Engine {
  const connection = new Connection(rpcUrl, "confirmed");
  const network = rpcUrl.includes("devnet") ? "devnet" : rpcUrl.includes("mainnet") ? "mainnet-beta" : "localnet";

  const explorerUrl = (kind: "tx" | "address", id: string) => {
    const base = `https://explorer.solana.com/${kind}/${id}`;
    if (network === "devnet") return `${base}?cluster=devnet`;
    if (network === "localnet") return `${base}?cluster=custom&customUrl=${encodeURIComponent(rpcUrl)}`;
    return base;
  };

  const buildTx = async (signer: Signer, ixs: TransactionInstruction[]) => {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    const tx = new Transaction({ feePayer: new PublicKey(signer.address), blockhash, lastValidBlockHeight });
    tx.add(...ixs);
    return { tx, blockhash, lastValidBlockHeight };
  };

  return {
    chain: "solana",
    network,
    vaultKeyFor: (signer) => vaultPda(new PublicKey(signer.address))[0].toBase58(),
    explorerUrl,
    isValidAddress: (s) => { try { new PublicKey(s); return s.length >= 32; } catch { return false; } },
    async read(signer): Promise<VaultSnapshot> {
      const authority = new PublicKey(signer.address);
      const [vaultPk] = vaultPda(authority);
      const state = await fetchVault(connection, vaultPk);
      if (!state) return { vault: null, balance: 0n, proposals: [], registry: [], wallets: [], walletUsdc: null };
      const [vaultAta] = vaultTokenAccountPda(vaultPk);
      const [acct, props, reg] = await Promise.all([
        getAccount(connection, vaultAta, "confirmed").catch(() => null),
        fetchAllProposals(connection, vaultPk),
        fetchRegistry(connection, vaultPk),
      ]);
      const wallets = await Promise.all(
        reg.map(async (r) => {
          const a = await getAccount(connection, getAssociatedTokenAddressSync(state.usdcMint, r.owner, true), "confirmed").catch(() => null);
          const v = toRegistryView(r);
          return { owner: v.owner, label: v.label, kind: v.kind, route: Route.Evm, active: v.active, usdc: a ? a.amount : null };
        })
      );
      const own = await getAccount(connection, getAssociatedTokenAddressSync(state.usdcMint, authority, true), "confirmed").catch(() => null);
      return { vault: toVaultView(state), balance: acct?.amount ?? 0n, proposals: props.map(toProposalView), registry: reg.map(toRegistryView), wallets, walletUsdc: own ? own.amount : 0n };
    },
    actions(signer, usdc): Actions {
      const a = solanaActions(new PublicKey(signer.address), new PublicKey(usdc));
      const wrap = (ixs: TransactionInstruction[]): PreparedTx => ({ chain: "solana", ixs });
      return {
        activate: (p, regs) => wrap(a.activate(p, regs)),
        deposit: (amount) => wrap(a.deposit(amount)),
        registerOwner: (r) => wrap(a.registerOwner(r)),
        removeRegistration: (owner) => wrap(a.removeRegistration(owner)),
        tighten: (t) => wrap(a.tighten(t)),
        proposeLoosen: (l) => wrap(a.proposeLoosen(l)),
        executeRuleChange: (owner) => wrap(a.executeRuleChange(owner)),
        cancelProposal: (c) => wrap(a.cancelProposal(c)),
        instantTopUp: (d, amt) => wrap(a.instantTopUp(d, amt)),
        proposeTopUp: (d, amt) => wrap(a.proposeTopUp(d, amt)),
        executeTopUp: (d) => wrap(a.executeTopUp(d)),
        instantColdTransfer: (d, amt) => wrap(a.instantColdTransfer(d, amt)),
        proposeColdTransferAboveCap: (d, amt) => wrap(a.proposeColdTransferAboveCap(d, amt)),
        proposeUninstallVault: (d) => wrap(a.proposeUninstallVault(d)),
        executeFullExit: (d) => wrap(a.executeFullExit(d)),
      };
    },
    async send(signer, prepared, opts) {
      if (prepared.chain !== "solana") throw new Error("wrong chain");
      const { tx, blockhash, lastValidBlockHeight } = await buildTx(signer, prepared.ixs);
      // Simulate first: a rejection is the program's own decision.
      const sim = await connection.simulateTransaction(tx);
      if (sim.value.err) {
        const logs = sim.value.logs ?? [];
        const name = parseShieldError(`${JSON.stringify(sim.value.err)}\n${logs.join("\n")}`) as ShieldErrorName | null;
        let recorded: string | null = null;
        const kp = demoKeypair();
        if (opts.recordRejection && kp && signer.kind === "demo") {
          try {
            tx.sign(kp);
            recorded = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
            await connection.confirmTransaction({ signature: recorded, blockhash, lastValidBlockHeight }, "confirmed").catch(() => null);
          } catch {
            recorded = null;
          }
        }
        throw new ShieldTxError(name ? `Rejected by the vault: ${name}` : "Transaction failed", name, logs, recorded);
      }
      let signature: string;
      const kp = demoKeypair();
      if (signer.kind === "demo" && kp) {
        tx.sign(kp);
        signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
      } else {
        const bridge = walletBridge();
        if (!bridge) throw new Error("wallet not connected");
        signature = await bridge.sendTransaction(tx, connection, { preflightCommitment: "confirmed" });
      }
      const conf = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
      if (conf.value.err) throw new ShieldTxError("Transaction failed on-chain", null, [], signature);
      return signature;
    },
  };
}
