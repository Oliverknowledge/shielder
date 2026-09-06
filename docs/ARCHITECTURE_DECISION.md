# Architecture decision: Hyperliquid-first, with a Shield vault as the enforcement primitive

Decided 2026-09-06 (sprint 2) after live research of Hyperliquid, HyperEVM,
Privy and The Graph documentation. Supersedes the 2026-09-05 decision, which
is kept at the bottom as "v0" because that implementation still exists, is
tested, and remains the local demo of the same semantics.

## The question

Shield's promise is "calm-you sets the limits; tilted-you can't instantly
undo them". The user this is built for trades on **Hyperliquid**. Where must
protected capital live, and what must enforce the boundary, so that the
promise holds against the user's own future self, and the product can be
demoed with real trades?

## What the research established (primary sources, 2026-09-06)

- **Hyperliquid account model.** API/agent wallets can only sign L1 actions
  (orders, cancels, leverage, sub-account transfers within the same user).
  Every action that moves value to another address or out of the account
  (`withdraw3`, `usdSend`, `spotSend`, `sendAsset`, `approveAgent`) is a
  user-signed EIP-712 action that only the master key can sign. Sub-accounts
  have no keys; they are controlled by the master. Nothing inside Hyperliquid
  lets a user bind *their own* master key, so Hyperliquid alone cannot stop
  tilted-you from adding capital.
- **HyperEVM ↔ HyperCore.** USDC on HyperEVM is Circle's native USDC; the
  spot-linked contract is Circle's `CoreDepositWallet`, whose
  `depositFor(recipient, amount, dex)` credits *any* HyperCore account. A
  contract holding USDC on HyperEVM can therefore fund a user's Hyperliquid
  perps account directly, in one transaction, without the user's key. The
  reverse (Core → EVM) credits the same address only, and is user-signed.
  Gas on HyperEVM is ~0.1 gwei; a contract deployment costs a fraction of a
  cent of HYPE. Chain IDs: 999 mainnet, 998 testnet.
- **Testnet reality.** The Hyperliquid testnet faucet (`claimDrip`) only
  serves addresses that have deposited on mainnet, and Circle's testnet
  CCTP path has the same rule. HyperEVM testnet is therefore only usable by
  an address with mainnet history.
- **The Graph.** HyperEVM *mainnet* has Substreams and Firehose on The Graph
  Market (Pinax). There is no HyperEVM testnet on The Graph, and no Subgraph
  Studio target for HyperEVM. Arbitrum Sepolia has both. Solana devnet has
  Substreams (StreamingFast, Pinax).
- **Privy.** Embedded wallets on HyperEVM (viem `hyperliquidEvmTestnet` /
  `hyperEvm`), `toViemAccount` for the `@nktkas/hyperliquid` SDK, policies
  enforced in Privy's TEE, quorums, and a dedicated Hyperliquid recipe set.
  Users can always export their key via the API unless the wallet is owned
  by a 2-of-2 quorum with the app, and "only one policy per wallet". Privy
  is infrastructure-level control, not a self-custodial commitment.
- **Hackathon rules.** Privy "Best financial flow" needs one functional
  flow with a Privy wallet (transfers, bridging, swaps…). The Graph tracks
  need live data from a Graph provider. Three partner selections allowed.

## Options compared

| | A. Keep Solana vault, add Hyperliquid on the side | B. Shield vault on HyperEVM (chosen) | C. Shield vault on Arbitrum Sepolia |
|---|---|---|---|
| Protected capital | Solana PDA vault | `ShieldVault.sol` on HyperEVM holding native USDC | Same contract on Arbitrum Sepolia |
| How the bankroll is funded | Solana USDC → (no testnet bridge) → Hyperliquid: the enforced release and the trade would be disconnected | Vault calls `CoreDepositWallet.depositFor(user, amount, perps)`: the enforced release *is* the deposit into the user's Hyperliquid account | Vault releases to the user's EOA; user deposits via CCTP → HyperCore (extra hop, testnet-gated) |
| Hard enforcement | Yes (built, 46 tests) | Yes (Solidity port, same semantics, Foundry tests) | Same |
| Privy | Solana embedded wallet possible, but no financial flow into Hyperliquid | Embedded EVM wallet signs the Core→EVM return and the agent approval; `depositFor` is the funding flow | Same, plus CCTP |
| The Graph, live | Solana devnet Substreams (built) | HyperEVM mainnet Substreams via Pinax (cheap to reach: fraction-of-a-cent gas, tiny USDC) | Arbitrum Sepolia Substreams/Subgraphs (free) |
| Chainlink CRE | Solana write (built) | EVM write; ECDSA verdict | EVM write |
| Demo honesty | Trade and block happen on different chains: theatre | One chain, one flow: vault → Hyperliquid account → trade → return → vault | Coherent but with a bridge hop judges must understand |
| Cost to reach a live demo | devnet SOL + Graph key | HYPE for gas (pennies), small USDC, a Hyperliquid-active address, Privy app ID, Graph key | Sepolia ETH, Circle testnet USDC, Hyperliquid-active address, Privy app ID, Graph key |

## Decision

**B. Hyperliquid-first on HyperEVM.** The enforcement primitive stays what
it always was, a self-custodial vault contract whose *only* outbound path
is governed by the user's own rules, ported to Solidity as `ShieldVault`.
What changes is where the bankroll goes: the vault funds the user's
Hyperliquid account directly through Circle's `CoreDepositWallet.depositFor`,
so the thing the rules govern ("add more capital to trading") is exactly
the thing Hyperliquid users do.

Development and tests run against Anvil with mocks of USDC and the
CoreDepositWallet (`contracts/test`). The live target is HyperEVM mainnet
with small amounts, because that is the only HyperEVM The Graph indexes and
because the gas cost is negligible; HyperEVM testnet works for any address
with mainnet history. Both are one deploy command apart.

The Solana implementation ("v0") is not deleted. It is the same product on a
different chain, fully tested, and it is the zero-credential local demo of
the rule engine. The app selects a backend at build time.

## The gate questions, answered

- **A. Where is protected capital?** In `ShieldVault` on HyperEVM, as native
  USDC, credited per user (one contract, many vaults keyed by the user's
  address). Not in Hyperliquid, not in Privy, not with Shield.
- **B. Who can move it?** Only the vault's authority (the user's EVM key),
  and only through the contract's five outbound paths: instant top-up,
  matured top-up, instant cold transfer (capped), matured cold transfer,
  matured full exit. There is no admin, no owner, no upgrade path.
- **C. How does money become trading bankroll?** `topUp(amount)` checks
  cooldown → floor → 24h velocity → large-amount pause, reserves velocity,
  then approves and calls `CoreDepositWallet.depositFor(user, amount, PERPS)`.
  The USDC leaves the vault and appears in the user's Hyperliquid perps
  account in the same HyperEVM block.
- **D. What does Hyperliquid hold?** Only the bankroll: whatever the vault
  has released plus its trading PnL. Hyperliquid never holds protected
  capital.
- **E. Is a sub-account useful?** Not required. Sub-accounts need $100k of
  volume and no isolation of authority (the master key controls them). The
  bankroll's isolation comes from the vault, not from Hyperliquid's account
  tree. Sub-accounts remain an optional way to separate PnL bookkeeping.
- **F. What can an agent wallet do?** Trade: place/cancel/modify orders,
  set leverage, move margin within the user's own account. This is what
  makes ordinary trading fast: approve the agent once, then no prompts.
- **G. What can't it do?** Withdraw, send to another address, approve
  agents, or touch the vault. Every value-moving action is user-signed.
- **H. Where do Privy policies add enforcement?** Defence in depth on the
  trading side: a policy on the embedded wallet can deny
  `HyperliquidTransaction:Withdraw` to any destination other than the vault
  contract, and deny key export. That protects the return path from scams
  and rushed transfers. It does not, and is not claimed to, enforce the
  vault's rules; the contract does.
- **I. Who owns those policies?** The user's wallet is user-owned; policy
  changes go through Privy's signer/quorum model. We state plainly that a
  policy is a Privy-level control the app configures, not a chain-level
  guarantee.
- **J. Can the user export or bypass the wallet?** Yes: Privy documents
  that users can always export unless a 2-of-2 quorum with the app exists,
  and we deliberately do not co-own the user's key. Exporting the key does
  not weaken Shield: the vault rules bind the key itself. Bypassing means
  moving protected USDC, and the contract has no path for that.
- **K. How does tighten-fast / loosen-slow work?** Identically to v0.
  `tighten()` applies immediately and bumps `configVersion`. `proposeLoosen()`
  records the change with `executeAfter = now + loosenCooldown` (≥ 1h,
  default 24h) and the current `configVersion`. `executeRuleChange()` only
  works after `executeAfter`, before `expiry`, and only if `configVersion`
  is unchanged; it never runs by itself, so the user must positively
  reconfirm the day after ("Still want to?"). Any tighten in between
  invalidates the pending weakening.
- **L. How does the user recover if Shield disappears?** Every function is
  callable with the user's key alone. `client/recovery-cli.ts` (v0) and
  `contracts/script` (EVM) show the raw calls. No server, no Privy, no Graph
  needed to cancel, cold-transfer or exit.
- **M. How do we avoid stranding funds?** Instant cold transfers up to the
  cap always work, even during cooldowns; the full exit always matures; the
  contract cannot be paused by anyone. Registering a cold destination is
  the only prerequisite, done during setup.
- **N. Which actions can be instant safely?** Everything that reduces risk:
  tighten any rule, pause funding, cold transfer within the cap, cancel a
  proposal, remove a destination. Plus ordinary trading via the agent.
- **O. Which actions must be delayed?** Everything that expands risk: raise
  the daily limit, lower the floor, weaken the loss rule, shorten a delay,
  add a destination, remove the monitor, the full exit, top-ups above the
  large-amount threshold, cold transfers above the cap.
- **P. Where does Graph data come from?** An EVM Substreams package over
  HyperEVM mainnet (Pinax endpoint on The Graph Market) that composes the
  foundational `ethereum_common` modules with Shield's typed event decoding
  and the USDC `Transfer` stream into the vault (returns). The v0 Solana
  package is the same module set on Solana devnet: one pipeline shape,
  reused across chains.
- **Q. Where does CRE sit?** Unchanged: the confidential workflow re-derives
  sessions from raw flows in the enclave and signs a verdict with a secret
  seed; the vault accepts it only if the attested loss meets the user's own
  trigger, and it can only extend a cooldown. On EVM the verdict is an
  EIP-712 message verified with `ecrecover`.
- **R. What is guaranteed on-chain vs at the wallet-infrastructure level?**
  On-chain: everything about protected capital (floor, limits, delays,
  cooldowns, destinations, exit). Wallet-infrastructure (Privy): key
  custody UX, the agent approval, optional withdrawal/export policies on the
  *trading* wallet. Server/enclave: memory and judgment only, never
  release.

## Consequences accepted

- Two implementations of one rule engine exist (Anchor, Solidity). They
  share the client's evaluation logic (`evaluateTopUp`) and the server's
  behaviour engine; the app talks to either through one backend interface.
- The live HyperEVM demo needs a Hyperliquid-active address and pennies of
  HYPE; it is a human step (`HUMAN_ACTIONS.md`).
- "Realised loss" remains "money that went to trading and did not come
  back", now measured as USDC that left the vault via `depositFor` minus
  USDC returned to the vault from the same address. Open positions are
  exposure, not loss, until they come back.
- The EVM verdict is a single enclave signature (ECDSA). DON-signed reports
  via the CRE EVM forwarder are the production upgrade.

---

## v0 (2026-09-05): Solana Anchor vault, kept as the local reference

Decided after re-evaluating the chain against the sponsor list: keep the
Solana/Anchor treasury vault (program-owned PDA token account, registry
allow-list, six 4-hour velocity buckets, Ed25519-verified verdicts), The
Graph Substreams on Solana devnet, and Chainlink CRE with Solana write.
Everything in that stack is built and verified on a local validator
(`scripts/deploy.sh local` + `bootstrap-demo.ts`) with 46 invariant tests.
It remains the fastest way to run the rule engine end to end with no
credentials, and its threat model is unchanged. Its limitation, which the
2026-09-06 decision resolves, is that the user's actual venue is
Hyperliquid, and there is no enforced path from a Solana vault into a
Hyperliquid account.
