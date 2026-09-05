# shield_behavioral_memory

Substreams package for the [Shield](../README.md) vault program on Solana.
It turns raw devnet/mainnet blocks into the behavioural memory Shield
reasons over: *"You sent $4,100 to this trading wallet. $2,810 came back."*

Network: `solana-devnet` (program `4Z46Kz8ygX5Efw22ABbQ2LTf329N3nD2J81Z3CAY5Hyx`).
Switch `network:` to `solana` and update `initialBlock` for mainnet.

## Modules

| Module | Kind | Output | What it does |
|---|---|---|---|
| `map_shield_instructions` | map | `shield.v1.ShieldInstructions` | Decodes every Shield instruction (args + named accounts) into one typed message per instruction. |
| `map_shield_events` | map | `shield.v1.ShieldEvents` | Decodes every Anchor event the program emits (`Program data:` logs). |
| `store_vault_registry` | store (set) | string | `ata:<vault token account> -> vault`, `exec:<vault>:<owner> -> 1/0`, `cold:...`. |
| `store_vault_wallets` | store (append) | string | `wallets:<vault> -> owner;owner;...` |
| `map_vault_flows` | map | `shield.v1.VaultFlows` | Every USDC movement across a vault boundary, classified: `TOP_UP_INSTANT`, `TOP_UP_GATED`, `COLD_TRANSFER`, `FULL_EXIT`, `RETURN` (an execution wallet sending money back, seen at the SPL Token level), `DEPOSIT`. |
| `store_flow_totals` | store (add) | int64 | Running per-vault and per-execution-wallet totals. |
| `map_behavioral_profiles` | map | `shield.v1.BehavioralProfiles` | Per-vault snapshot: sent vs returned per execution wallet, net realized flow, deposits, exits. |

Windowed metrics (24h funding velocity, 7-day realized loss, loss streak,
reload-after-loss) are derived by the consumer (`server/behaviour.ts`)
from the `map_vault_flows` stream, which carries every flow with its
block time. The store keeps whole-history totals; the app keeps windows.

## Build and run

```bash
# toolchain: rustup target add wasm32-unknown-unknown; brew install bufbuild/buf/buf; substreams CLI >= 1.22
substreams build                                   # -> shield-behavioral-memory-v0.2.0.spkg

substreams auth                                    # The Graph Market key -> SUBSTREAMS_API_TOKEN
substreams run substreams.yaml map_vault_flows \
  -e devnet.sol.streamingfast.io:443 -s <slot> -t +200 -o jsonl
substreams gui substreams.yaml map_behavioral_profiles -e devnet.sol.streamingfast.io:443 -s <slot>
```

Shield's server streams `map_vault_flows` and `map_shield_events` from
The Graph Market's devnet endpoint (`@substreams/core`, see
`server/substreams-source.ts`), keeps a cursor, and rebuilds the
behavioural profile on every block. Alternative sinks: `substreams sink
postgres` (built-in SQL sink) or a Hosted Sink on The Graph Market.

## Local development against a local validator

For iterating without a Graph Market key, run a local Firehose against
`solana-test-validator` (StreamingFast's Docker compose in the Substreams
docs) and point `-e` at it. Local-only data does not qualify for The
Graph's hackathon track; the deployed pipeline must stream from a Graph
provider.
