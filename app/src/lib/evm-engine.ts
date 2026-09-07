import { createPublicClient, createWalletClient, custom, decodeFunctionData, http, isAddress, type Address, type EIP1193Provider, type Hex, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { MOCK_CORE_DEPOSIT_ABI } from "../../../client/abi/MockCoreDepositWallet";
import { MOCK_USDC_ABI } from "../../../client/abi/MockUSDC";
import { evmCalls, readProposals, readRegistry, readUsdcAllowance, readUsdcBalance, readVault, readVaultBundle, shieldErrorFromRevert, supportsBundledReads, viemChain, type EvmConfig } from "../../../client/evm";
import { Route } from "../../../client/views";
import { ShieldTxError, type Actions, type Engine, type PreparedTx, type Signer, type VaultSnapshot } from "./engine";

export interface EvmEngineConfig extends EvmConfig {
  /** Anvil-only: the mock CoreDepositWallet whose coreBalance stands in for the HyperCore account. */
  coreDepositMock?: Address;
  /** Real HyperCore: which Hyperliquid network to read account values from. */
  hyperliquidNetwork?: "mainnet" | "testnet";
}

const HL_INFO = { mainnet: "https://api.hyperliquid.xyz/info", testnet: "https://api.hyperliquid-testnet.xyz/info" };

/**
 * What a HyperCore destination is actually holding.
 *
 * A unified Hyperliquid account reports a perps `accountValue` of 0 and keeps
 * its collateral as spot balances, so the perps summary alone reads $0 for an
 * account with money in it. Equity is the perps value plus the spot balances
 * priced at the venue's own mids; a token with no mid is left out rather than
 * guessed at.
 */
async function hyperCoreAccountValue(network: "mainnet" | "testnet", user: string): Promise<bigint | null> {
  const post = async <T>(body: unknown): Promise<T | null> => {
    try {
      const res = await fetch(HL_INFO[network], { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      return res.ok ? ((await res.json()) as T) : null;
    } catch {
      return null;
    }
  };
  const [perps, spot, mids] = await Promise.all([
    post<{ marginSummary?: { accountValue?: string } }>({ type: "clearinghouseState", user }),
    post<{ balances?: Array<{ coin: string; total: string }> }>({ type: "spotClearinghouseState", user }),
    post<Record<string, string>>({ type: "allMids" }),
  ]);
  if (!perps && !spot) return null;
  let value = Number(perps?.marginSummary?.accountValue ?? 0);
  for (const b of spot?.balances ?? []) {
    const total = Number(b.total);
    if (!total) continue;
    const mid = b.coin === "USDC" ? 1 : Number(mids?.[b.coin] ?? NaN);
    if (Number.isFinite(mid)) value += total * mid;
  }
  return Number.isFinite(value) ? BigInt(Math.round(value * 1_000_000)) : null;
}

export function evmEngine(cfg: EvmEngineConfig, demoKey: () => Hex | null, provider: () => EIP1193Provider | null): Engine {
  const chain = viemChain(cfg);
  const pub = createPublicClient({ chain, transport: http(cfg.rpcUrl) });

  /** True when this call is an approve(vault, n) the current allowance already covers. */
  async function isRedundantApproval(call: { to: Address; data: Hex }, owner: Address): Promise<boolean> {
    let decoded;
    try {
      decoded = decodeFunctionData({ abi: MOCK_USDC_ABI, data: call.data });
    } catch {
      return false;
    }
    if (decoded.functionName !== "approve") return false;
    const [spender, amount] = decoded.args as [Address, bigint];
    if (spender.toLowerCase() !== cfg.vault.toLowerCase()) return false;
    const current = await readUsdcAllowance(pub, cfg, owner);
    return current >= amount;
  }
  const network = cfg.chainId === 999 ? "hyperevm" : cfg.chainId === 998 ? "hyperevm-testnet" : cfg.chainId === 31337 ? "anvil" : `evm-${cfg.chainId}`;

  const walletClient = (signer: Signer): WalletClient => {
    const pk = demoKey();
    if (signer.kind === "demo" && pk) return createWalletClient({ account: privateKeyToAccount(pk), chain, transport: http(cfg.rpcUrl) });
    const p = provider();
    if (!p) throw new Error("wallet not connected");
    return createWalletClient({ account: signer.address as Address, chain, transport: custom(p) });
  };

  /** Retry a read while the public RPC says "rate limited"; other errors bubble. */
  const rpc = async <T,>(fn: () => Promise<T>, attempts = 5): Promise<T> => {
    for (let i = 0; ; i++) {
      try {
        return await fn();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (i >= attempts - 1 || !/rate limit|32005|exceeds defined limit/i.test(msg)) throw e;
        await new Promise((r) => setTimeout(r, Math.min(4000, 600 * 2 ** i)));
      }
    }
  };

  return {
    chain: "evm",
    network,
    vaultKeyFor: (signer) => signer.address.toLowerCase(),
    // Only HyperEVM mainnet has a public explorer that indexes this contract.
    // The Blockscout instance commonly cited for testnet reports our vault as an
    // EOA with zero transactions, and the Hyperliquid app's explorer route
    // renders blank for a tx hash — so linking there hands a judge a dead end and
    // makes "open it yourself" a broken promise. An empty string means "no
    // explorer"; ExplorerLink degrades to a copyable hash and says how to verify.
    explorerUrl: (kind, id) => (cfg.chainId === 999 ? `https://hyperevmscan.io/${kind}/${id}` : ""),
    isValidAddress: (s) => isAddress(s),
    async read(signer): Promise<VaultSnapshot> {
      const authority = signer.address as Address;

      // Where Multicall3 exists, one refresh is two requests rather than eleven.
      // On the public HyperEVM RPC that is the difference between a screen that
      // loads and one that sits on "Reading your vault" until the rate limiter
      // relents. Chains without it keep the one-call-at-a-time path.
      const bundle = supportsBundledReads(cfg) ? await rpc(() => readVaultBundle(pub, cfg, authority)) : undefined;
      const usdcOf = (who: string): bigint | null => bundle?.usdc[who.toLowerCase()] ?? null;

      let base: { vault: VaultSnapshot["vault"]; balance: bigint; proposals: VaultSnapshot["proposals"]; registry: VaultSnapshot["registry"] } | null;
      let walletUsdc: bigint | null;
      if (bundle !== undefined) {
        walletUsdc = usdcOf(authority);
        base = bundle && { vault: bundle.vault, balance: bundle.balance, proposals: bundle.proposals, registry: bundle.registry };
      } else {
        const r = await rpc(() => readVault(pub, cfg, authority));
        walletUsdc = await readUsdcBalance(pub, cfg, authority).catch(() => null);
        if (!r) base = null;
        else {
          const [proposals, registry] = await Promise.all([rpc(() => readProposals(pub, cfg, authority)), rpc(() => readRegistry(pub, cfg, authority))]);
          base = { vault: r.vault, balance: r.balance, proposals, registry };
        }
      }
      if (!base) return { vault: null, balance: 0n, proposals: [], registry: [], wallets: [], walletUsdc };

      // HyperCore destinations hold their balance off the EVM entirely, so those
      // are the one read the batch cannot answer.
      const wallets = await Promise.all(
        base.registry.map(async (e) => {
          let usdc: bigint | null = null;
          if (e.kind === 0 && e.route === Route.HyperCore) {
            if (cfg.coreDepositMock) usdc = (await pub.readContract({ address: cfg.coreDepositMock, abi: MOCK_CORE_DEPOSIT_ABI, functionName: "coreBalance", args: [e.owner as Address] }).catch(() => null)) as bigint | null;
            else if (cfg.hyperliquidNetwork) usdc = await hyperCoreAccountValue(cfg.hyperliquidNetwork, e.owner);
          } else {
            usdc = bundle !== undefined ? usdcOf(e.owner) : await readUsdcBalance(pub, cfg, e.owner as Address).catch(() => null);
          }
          return { owner: e.owner, label: e.label, kind: e.kind, route: e.route, active: e.active, usdc };
        })
      );
      return { vault: base.vault, balance: base.balance, proposals: base.proposals, registry: base.registry, wallets, walletUsdc };
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
      let confirmedAt: bigint | null = null;
      for (const call of prepared.calls) {
        // A deposit is [approve, deposit]: two wallet prompts to move your own
        // money into your own vault, every single time, on the one action Shield
        // never gates. Skip the approve when the allowance already covers it.
        if (call.to.toLowerCase() === cfg.usdc.toLowerCase()) {
          const skip = await isRedundantApproval(call, account.address).catch(() => false);
          if (skip) continue;
        }
        // A batch like activate() is [initializeVault, registerOwner, ...],
        // where each call's precondition is created by the one before. The
        // public RPC is load balanced, so a receipt can be confirmed by one
        // node while eth_call is served by another that is a block behind —
        // and registerOwner against a vault that node cannot see yet reverts
        // Unauthorized. Wait for the reader to catch up before simulating.
        if (confirmedAt !== null) {
          for (let i = 0; i < 12; i++) {
            const head = await rpc(() => pub.getBlockNumber()).catch(() => null);
            if (head !== null && head >= confirmedAt) break;
            await new Promise((r) => setTimeout(r, 500));
          }
        }
        // Simulate first: a revert is the contract's own decision, shown without a signature prompt.
        // The retry matters more here than on any read. Without it a metered-RPC
        // "rate limited" arrives as a thrown error, is indistinguishable from a
        // revert, and the user is told the vault rejected a transaction it never
        // saw — mid-demo, before the wallet ever prompts.
        try {
          await rpc(() => pub.call({ account: account.address, to: call.to, data: call.data, value: call.value }));
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
        // The transaction is already broadcast; a rate-limited receipt poll must
        // not be reported as a failure, or the user retries something that landed.
        const rcpt = await rpc(() => pub.waitForTransactionReceipt({ hash }));
        if (rcpt.status !== "success") throw new ShieldTxError("Transaction reverted on-chain", null, [], hash);
        confirmedAt = rcpt.blockNumber;
        last = hash;
      }
      return last ?? "";
    },
  };
}
