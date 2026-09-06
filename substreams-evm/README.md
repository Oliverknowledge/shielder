# Shield behavioural memory — EVM Substreams

The same five-module pipeline as `../substreams` (Solana), for `ShieldVault.sol`
on HyperEVM or any EVM chain, composed on The Graph's foundational
`ethereum-common@v0.3.3` package: its `index_events` block index filters both
maps by `evt_addr:` (the vault contract and native USDC) so blocks with no
relevant log are skipped before decoding.

```
map_shield_events       Block ⨯ index_events(params) -> ShieldEvents      typed ShieldVault events (Abigen)
store_vault_registry    set   exec:<vault>:<owner> -> 1|0                   which addresses are trading wallets
map_vault_flows         Block ⨯ events ⨯ registry -> VaultFlows            boundary crossings incl. USDC returns
store_flow_totals       add   sent/returned/deposited/topups/returns per vault
map_behavioral_profiles deltas -> BehavioralProfiles
```

Build: `substreams build` (Rust + wasm32 target; Foundry's ABI is copied to
`abi/ShieldVault.json`). Run against The Graph Market with the shared JWT in
`.env` (`SUBSTREAMS_API_TOKEN`; endpoint `SUBSTREAMS_HYPEREVM_ENDPOINT`,
default `hyperevm.substreams.pinax.network:443`, HyperEVM mainnet only):

```bash
bun run substreams:hyperevm                  # last 20 blocks, proves auth + package load
bun run substreams:hyperevm <deploy block> +200   # with EVM_CHAIN_ID=999, SHIELD_VAULT_ADDRESS, USDC_ADDRESS set
# equivalent raw CLI:
SUBSTREAMS_API_TOKEN=<jwt> substreams run substreams.yaml map_vault_flows \
  -e hyperevm.substreams.pinax.network:443 -s <vault deploy block> -t +200 \
  -p map_shield_events="evt_addr:<vault>" \
  -p map_vault_flows="evt_addr:<vault> || evt_addr:<native usdc>"
```

`server/evm-index.ts` consumes the same module through `@substreams/core`
when `EVM_CHAIN_ID=999` and the JWT is set (`/api/health` → `source.mode:
"substreams"`).

Output `Flow` messages carry the same fields the Solana package emits, so
`server/behaviour.ts`, `server/policy.ts` and the Chainlink CRE workflow
consume either chain's stream unchanged: one pipeline shape, reused across
chains.
