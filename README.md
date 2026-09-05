# Shield

**Wallets protect your keys. Shield protects you from your own decisions.**

Shield is a self-custodial treasury for people who trade. Most of your
capital sits in a vault on Solana; you trade from a smaller bankroll wherever
you already trade. Refilling the bankroll is governed by rules you set while
calm: a protected floor, a daily limit that can't be gamed by splitting, a
pause on large moves, and a loss rule fed by your real on-chain history.
Making a rule stricter is instant. Making it weaker waits 24 hours. Leaving
waits 7 days. Emergency withdrawals to your own cold wallet are always
instant. When a refill is blocked, the money does not move.

Built for ETHGlobal ETHOnline 2026 (Start Fresh). Sponsors: **The Graph**
(Substreams as the behavioural memory) and **Chainlink CRE** (a confidential
workflow as the monitor). Details: `docs/`.

## Run the whole thing locally (3 minutes)

Prerequisites: Rust + `cargo build-sbf` (Agave 4.x), Bun ≥ 1.2, `solana-test-validator`.

```bash
bun install
scripts/deploy.sh local                       # builds the program, starts a validator with it preloaded
SHIELD_RPC_URL=http://127.0.0.1:8899 bun run scripts/bootstrap-demo.ts   # $10,000 vault, Axiom + Ledger registered
bun run server/index.ts &                     # indexer + monitor + relayer + API on :8787
bun run dev:app                               # http://localhost:5173
```

In the app: Welcome → "Continue with a demo key" → paste
`~/.config/solana/id.json`. Then the hero sequence from a second terminal:

```bash
bun run client/demo.ts top-up 1500    # instant
bun run client/demo.ts return 80      # the trading wallet sends $80 back: a $1,420 realised loss
bun run client/demo.ts top-up 100     # ❌ rejected on-chain: CooldownActive
bun run client/demo.ts loosen daily=5000   # ✅ queued 24h
bun run client/demo.ts exit           # ✅ queued 7d
bun run client/demo.ts cold 150       # ✅ instant, even during the cooldown
bun run client/demo.ts scoreboard
```

`docs/DEMO_SCRIPT.md` has the same sequence as a spoken demo.

## Verify

```bash
bun test                                  # 53 tests: 46 against the real program in LiteSVM (warpable clock), 7 behaviour-engine
bun run typecheck                         # app, server, clients, CRE workflow, tests
bun run build:app                         # production bundle
cd substreams && substreams build         # Substreams package (wasm + spkg)
bunx cre-compile cre/shield-risk/main.ts cre/shield-risk/dist/shield-risk.wasm   # CRE workflow
```

## What is verified, and what isn't

| Claim | Status |
|---|---|
| Program compiles and enforces every invariant in `docs/THREAT_MODEL.md` | Verified: 46 LiteSVM tests, plus the live localnet sequence above |
| App: onboarding, overview, top-up (instant / scheduled / blocked), behaviour, protection, activity, mobile | Verified in a headless browser against the live localnet demo; production build passes |
| Server: RPC indexing, behaviour derivation, loss rule, signed verdict relayed on-chain | Verified live (verdicts #1–#2 on the demo vault) |
| Chainlink CRE workflow compiles; its evaluation signs and delivers a verdict the vault accepts | Verified via `cre/shield-risk/dryrun.ts` (identical function, server monitor off). **`cre workflow simulate` needs a Chainlink account** |
| Substreams package builds and describes the devnet pipeline | Verified (`substreams build`, `substreams info`). **Live streaming needs a Graph Market key** |
| Devnet deployment with the upgrade authority burned | **Not yet**: the public faucet gave this key 0 SOL. One command each once funded |

The three missing pieces are credentials and funds only; see `HUMAN_ACTIONS.md`.

## How it fits together

```
user's key ──► Shield vault program (Anchor, immutable after finalize)
                 floor · 24h limit · 30-min large-move pause · cooldown · registry · 24h/7d delays
                        ▲ apply_risk_verdict (Ed25519, nonce, must meet the user's loss trigger)
trading wallet ──returns──► vault token account  ──indexed──► The Graph Substreams (devnet.sol.streamingfast.io)
                                                                     │ map_vault_flows
                                                              Shield server: sessions → realised loss → verdict → relay
                                                                     ▲ raw flows + policy
                                                              Chainlink CRE confidential workflow (handlerInTee):
                                                              same evaluate(), signs in the enclave
```

- The app reads every number that governs money straight from RPC. The
  server only adds behaviour and explanations; if it dies, the rules and the
  exits keep working.
- The monitor (server or enclave) can only ever pause top-ups, for the length
  the user set, when the loss it attests meets the user's trigger.

## Repository

```
programs/shield-vault/   Anchor program: state.rs (layout), lib.rs (instructions), events.rs, ed25519.rs
client/                  shield-client.ts (isomorphic instruction builder/decoder), verdict.ts, demo.ts, recovery-cli.ts
tests/                   LiteSVM harness + invariant suite
substreams/              The Graph Substreams package (proto, src/lib.rs, substreams.yaml, README)
server/                  Bun server: index.ts, behaviour.ts (+tests), policy.ts, rpc-source.ts, substreams-source.ts, store.ts
cre/                     Chainlink CRE project: project.yaml, secrets.yaml, shield-risk/{main,evaluate,dryrun}.ts, README
app/                     React + Vite web app (src/pages, src/lib, src/components, styles.css)
scripts/                 deploy.sh (local | devnet | finalize), bootstrap-demo.ts, print-verifier-seed.ts
docs/                    HACKATHON_STRATEGY, ARCHITECTURE_DECISION, THREAT_MODEL, SPONSOR_INTEGRATIONS,
                         DEMO_SCRIPT, JUDGE_QA, SUBMISSION, AI_USAGE, substreams-one-prompt, designs/, planning/
HUMAN_ACTIONS.md         the five things only a human can do
```

## The rules, as the program enforces them

| Rule | Tighten (instant) | Loosen (waits `loosen_cooldown`, ≥1h, default 24h) |
|---|---|---|
| Protected floor | raise | lower |
| Daily top-up limit (24h rolling, vault-global, includes capped cold transfers) | lower | raise |
| Large top-up threshold (% of balance) and its pause | lower % / longer pause | raise % / shorter pause |
| Loss trigger and pause length | lower trigger / longer pause | raise trigger / shorter pause |
| Emergency cold cap | lower | raise |
| Weakening delay, exit delay | longer | shorter (floors: 1h) |
| Destinations | remove | add (once the vault is funded) |
| Monitor | add (none → some) | change / remove |
| Pause top-ups (self) | extend, up to 30 days | — (expires by time) |
| Leave Shield | — | whole balance to a cold wallet after `full_exit_cooldown` (default 7d) |

Any user tightening bumps `config_version`; pending weakening proposals
created earlier become stale and cannot execute. Monitor verdicts do not
bump it (no griefing).

## Recovery without Shield

```bash
SHIELD_RPC_URL=<any rpc> bun run client/recovery-cli.ts status <authorityPubkey>
bun run client/recovery-cli.ts cancel <keypair.json> <rule-change|top-up|full-exit>
bun run client/recovery-cli.ts cold-transfer <keypair.json> <coldOwner> <usdc>
bun run client/recovery-cli.ts propose-exit <keypair.json> <coldOwner>
bun run client/recovery-cli.ts execute <keypair.json> <category>
```

## Program

- ID: `4Z46Kz8ygX5Efw22ABbQ2LTf329N3nD2J81Z3CAY5Hyx` (localnet now; devnet after `HUMAN_ACTIONS.md` #1)
- Build: `cargo build-sbf --manifest-path programs/shield-vault/Cargo.toml` (Anchor CLI's own build/IDL commands hit an upstream toolchain incompatibility on this machine; the client is IDL-free by design)

## License

MIT for the hackathon submission.
