import { createPublicClient, createWalletClient, custom, http, isAddress, type Address, type EIP1193Provider, type Hex, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { MOCK_CORE_DEPOSIT_ABI } from "../../../client/abi/MockCoreDepositWallet";
import { evmCalls, readProposals, readRegistry, readUsdcBalance, readVault, shieldErrorFromRevert, viemChain, type EvmConfig } from "../../../client/evm";
import { Route } from "../../../client/views";
import { ShieldTxError, type Actions, type Engine, type PreparedTx, type Signer, type VaultSnapshot } from "./engine";

export interface EvmEngineConfig extends EvmConfig {
  /** Anvil-only: the mock CoreDepositWallet whose coreBalance stands in for the HyperCore account. */
  coreDepositMock?: Address;
  /** Real HyperCore: which Hyperliquid network to read account values from. */
  hyperliquidNetwork?: "mainnet" | "testnet";
}

const HL_INFO = { mainnet: "https://api.hyperliquid.xyz/info", testnet: "https://api.hyperliquid-testnet.xyz/info" };

async function hyperCoreAccountValue(network: "mainnet" | "testnet", user: string): Promise<bigint | null> {
  try {
    const res = await fetch(HL_INFO[network], { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "clearinghouseState", user }) });
    const j = (await res.json()) as { marginSummary?: { accountValue?: string } };
    const v = Number(j.marginSummary?.accountValue ?? NaN);
    return Number.isFinite(v) ? BigInt(Math.round(v * 1_000_000)) : null;
  } catch {
    return null;
  }
}

export function evmEngine(cfg: EvmEngineConfig, demoKey: () => Hex | null, provider: () => EIP1193Provider | null): Engine {
  const chain = viemChain(cfg);
  const pub = createPublicClient({ chain, transport: http(cfg.rpcUrl) });
  const network = cfg.chainId === 999 ? "hyperevm" : cfg.chainId === 998 ? "hyperevm-testnet" : cfg.chainId === 31337 ? "anvil" : `evm-${cfg.chainId}`;

  const walletClient = (signer: Signer): WalletClient => {
    const pk = demoKey();
    if (signer.kind === "demo" && pk) return createWalletClient({ account: privateKeyToAccount(pk), chain, transport: http(cfg.rpcUrl) });
    const p = provider();
    if (!p) throw new Error("wallet not connected");
    return createWalletClient({ account: signer.address as Address, chain, transport: custom(p) });
  };

  return {
    chain: "evm",
    network,
    vaultKeyFor: (signer) => signer.address.toLowerCase(),
    explorerUrl: (kind, id) => (cfg.chainId === 999 ? `https://hyperevmscan.io/${kind}/${id}` : cfg.chainId === 998 ? `https://explore-testnet.hyperpc.app/${kind}/${id}` : `#${kind}/${id}`),
    isValidAddress: (s) => isAddress(s),
    async read(signer): Promise<VaultSnapshot> {
      const authority = signer.address as Address;
      const r = await readVault(pub, cfg, authority);
      const walletUsdc = await readUsdcBalance(pub, cfg, authority).catch(() => null);
      if (!r) return { vault: null, balance: 0n, proposals: [], registry: [], wallets: [], walletUsdc };
      const [proposals, registry] = await Promise.all([readProposals(pub, cfg, authority), readRegistry(pub, cfg, authority)]);
      const wallets = await Promise.all(
        registry.map(async (e) => {
          let usdc: bigint | null = null;
          if (e.kind === 0 && e.route === Route.HyperCore) {
            if (cfg.coreDepositMock) usdc = (await pub.readContract({ address: cfg.coreDepositMock, abi: MOCK_CORE_DEPOSIT_ABI, functionName: "coreBalance", args: [e.owner as Address] }).catch(() => null)) as bigint | null;
            else if (cfg.hyperliquidNetwork) usdc = await hyperCoreAccountValue(cfg.hyperliquidNetwork, e.owner);
          } else {
            usdc = await readUsdcBalance(pub, cfg, e.owner as Address).catch(() => null);
          }
          return { owner: e.owner, label: e.label, kind: e.kind, route: e.route, active: e.active, usdc };
        })
      );
      return { vault: r.vault, balance: r.balance, proposals, registry, wallets, walletUsdc };
    },
    actions(signer): Actions {
      const authority = signer.address as Address;
      const wrap = (...calls: ReturnType<typeof evmCalls.deposit>[]): PreparedTx => ({ chain: "evm", calls });
      return {
        activate: (p, regs) => wrap(evmCalls.initializeVault(cfg, { riskVerifier: (p.riskVerifier as Address | null) ?? null, protectedFloor: p.protectedFloor, topUpThresholdBps: p.topUpThresholdBps, emergencyCap: p.emergencyCap, velocityThreshold: p.velocityThreshold, lossTriggerUsdc: p.lossTriggerUsdc, lossCooldownSecs: p.lossCooldownSecs }), ...regs.map((r) => evmCalls.registerOwner(cfg, r.owner as Address, r.kind, r.route, r.label))),
        deposit: (amount) => wrap(evmCalls.approveUsdc(cfg, amount), evmCalls.deposit(cfg, authority, amount)),
        registerOwner: (r) => wrap(evmCalls.registerOwner(cfg, r.owner as Address, r.kind, r.route, r.label)),
        removeRegistration: (owner) => wrap(evmCalls.removeRegistration(cfg, owner as Address)),
        tighten: (t) => wrap(evmCalls.tighten(cfg, t)),
        proposeLoosen: (l) => wrap(evmCalls.proposeLoosen(cfg, l)),
        executeRuleChange: () => wrap(evmCalls.executeRuleChange(cfg)),
        cancelProposal: (c) => wrap(evmCalls.cancelProposal(cfg, c)),
        instantTopUp: (d, amt) => wrap(evmCalls.instantTopUp(cfg, d as Address, amt)),
        proposeTopUp: (d, amt) => wrap(evmCalls.proposeTopUp(cfg, d as Address, amt)),
        executeTopUp: () => wrap(evmCalls.executeTopUp(cfg)),
        instantColdTransfer: (d, amt) => wrap(evmCalls.instantColdTransfer(cfg, d as Address, amt)),
        proposeColdTransferAboveCap: (d, amt) => wrap(evmCalls.proposeColdTransferAboveCap(cfg, d as Address, amt)),
        proposeUninstallVault: (d) => wrap(evmCalls.proposeUninstallVault(cfg, d as Address)),
        executeFullExit: () => wrap(evmCalls.executeFullExit(cfg)),
      };
    },
    async send(signer, prepared, opts) {
      if (prepared.chain !== "evm") throw new Error("wrong chain");
      const wc = walletClient(signer);
      const account = wc.account!;
      let last: Hex | null = null;
      for (const call of prepared.calls) {
        // Simulate first: a revert is the contract's own decision, shown without a signature prompt.
        try {
          await pub.call({ account: account.address, to: call.to, data: call.data, value: call.value });
        } catch (e) {
          const name = shieldErrorFromRevert(e);
          let recorded: string | null = null;
          if (opts.recordRejection && signer.kind === "demo") {
            // Land the rejection on-chain (explicit gas skips estimation) so the failed transaction is inspectable.
            try {
              const hash = await wc.sendTransaction({ account, chain, to: call.to, data: call.data, value: call.value, gas: 400_000n });
              await pub.waitForTransactionReceipt({ hash }).catch(() => null);
              recorded = hash;
            } catch {
              recorded = null;
            }
          }
          throw new ShieldTxError(name ? `Rejected by the vault: ${name}` : e instanceof Error ? e.message : "Transaction failed", name, [], recorded);
        }
        const hash = await wc.sendTransaction({ account, chain, to: call.to, data: call.data, value: call.value });
        const rcpt = await pub.waitForTransactionReceipt({ hash });
        if (rcpt.status !== "success") throw new ShieldTxError("Transaction reverted on-chain", null, [], hash);
        last = hash;
      }
      return last ?? "";
    },
  };
}
