# Architecture decision: Solana Anchor vault, The Graph Substreams, Chainlink CRE

Decided 2026-09-05 after re-evaluating the chain choice against the live
ETHOnline sponsor list and tooling. Status: **locked**.

## The question

Keep the Solana/Anchor treasury vault the project started with, or move to an
EVM smart-account architecture (Safe module, ERC-4337/7579) now that several
EVM sponsors are on the prize list?

## Options compared

| Criterion | A. Solana Anchor vault (chosen) | B. EVM Safe module / ERC-7579 | C. Arc (Circle L1) USDC vault |
|---|---|---|---|
| Self-custodial enforcement | Program-owned PDA token account; only the program's fixed transfer path can move funds; the user's key is the sole authority | Safe + Guard/Delay modifier gives the same shape; well-trodden (Zodiac Delay) | Same as B on an EVM L1 |
| Bypass resistance | Registry allow-list per owner pubkey, single SPL transfer surface, no arbitrary CPI, immutable program after finalisation | Comparable; module-based systems have more surface (fallback handlers, other modules) | Comparable to B |
| Sponsor support | The Graph: Solana devnet + mainnet Substreams endpoints on The Graph Market; Chainlink CRE: Solana devnet/mainnet write capability and Solana trigger flags in CLI 1.32 | The Graph: subgraphs + Substreams; Chainlink: EVM write + log triggers | The Graph: unverified for Arc; CRE: unverified |
| The Graph data availability | Substreams (no Substreams-powered subgraphs for Solana on the Network); Token API mainnet-only | Subgraphs + Substreams; richest tooling | Unknown |
| Wallet UX for the target user | The user is Solana/Axiom-native; Phantom/Solflare/Backpack via wallet-standard | Would force the user onto a new chain and bridge | Same |
| Transaction cost | Cents on devnet/mainnet | Depends on L2; Safe deployments cost more | Cheap |
| Implementation risk | Program already built, 46 invariant tests green in LiteSVM, run live on a validator | Rewrite everything under the deadline | Rewrite + new chain |
| Demo quality | Real rejections on-chain, sub-second confirmations | Fine | Fine |
| Judge reproducibility | `scripts/deploy.sh local` + `bootstrap-demo.ts` reproduce the whole demo in ~1 minute; devnet once funded | Anvil/testnet | Testnet |
| Security | No upgrade authority after finalisation; Ed25519 precompile for verdicts | Mature audited base (Safe) but more moving parts | Immature |

## Decision

**A. Stay Solana-native.** The user this is built for trades from Axiom on
Solana; moving chains to fit a sponsor would betray the wedge ("guard the
top-up into the venue you already use"). Both selected sponsors support
Solana today with primary-source confirmation: The Graph Market lists
`devnet.sol.streamingfast.io:443` and Pinax devnet endpoints; the CRE CLI
ships `--solana-tx-sig`/`--solana-event-index` and the SDK ships
`SolanaClient.writeReport` for `solana-devnet`/`solana-mainnet`. The
program, tests, client, indexer, monitor and app are built and verified
against a live validator.

What we give up: Substreams-powered subgraphs (not available for Solana on
the Network), so the queryable layer is a stream/sink rather than a GraphQL
subgraph; the EVM-only prizes (Arc, ENS, Uniswap, 1inch, Hedera).

## The system, as built

```
                 ┌──────────────────────────────┐
  user's key ──► │  Shield vault program (Anchor) │ ◄── immutable after `deploy.sh finalize`
                 │  floor · 24h limit · pause     │
                 │  cooldown · registry · delays  │
                 └───────┬───────────────┬────────┘
       top-ups ▼ (rules) │               │ apply_risk_verdict (Ed25519, nonce, trigger)
  ┌────────────────┐     │               │
  │ trading wallet │ ────┘ returns       │
  │ (Axiom)        │  (plain SPL xfer)   │
  └────────────────┘                     │
        ▲ indexed                        │ signed verdict
  ┌─────┴──────────────┐   flows   ┌─────┴────────────────────────┐
  │ The Graph          │ ────────► │ Shield server                │
  │ Substreams (devnet)│           │ behaviour → policy → relay   │
  │ 7 modules          │           └─────▲────────────────────────┘
  └────────────────────┘                 │ raw flows + policy in, signed verdict out
                                   ┌─────┴────────────────────────┐
                                   │ Chainlink CRE confidential   │
                                   │ workflow (handlerInTee)      │
                                   │ same evaluate() in a TEE     │
                                   └──────────────────────────────┘
```

- **Enforcement** lives only in the program. The app reads it from RPC.
- **Memory** lives in The Graph: the Substreams package decodes every Shield
  instruction and event and every SPL inflow to a vault token account, and
  classifies flows (`TOP_UP_*`, `RETURN`, `DEPOSIT`, `COLD_TRANSFER`,
  `FULL_EXIT`). The server streams `map_vault_flows` from The Graph Market
  (or falls back to RPC with the same classification) and derives sessions,
  realised loss, streaks and reload-after-loss.
- **Judgment** lives in the enclave: the CRE workflow re-derives the same
  numbers from raw flows and signs a verdict with a seed only it holds. The
  vault checks the attested loss against the user's own trigger and computes
  the pause itself.

## Consequences accepted

- USDC-only (one pinned SPL mint). Native SOL and Token-2022 are rejected at
  the instruction level, not mishandled.
- Behaviour is bounded by registered wallets and by what is observable at the
  SPL level: "realised loss" means "money that went to your trading wallet
  and did not come back in that session". Positions still open in the venue
  are shown as exposure, not loss.
- The verdict is a single enclave signature, not a DON quorum. The native
  `SolanaClient.writeReport` path (Keystone Forwarder, f+1 ECDSA) is the
  production upgrade and is documented in `cre/README.md`.
- Devnet deployment needs SOL the public faucet refused to give this key;
  `scripts/deploy.sh devnet` and `finalize` are one command each once funded.
