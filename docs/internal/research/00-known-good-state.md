# Known-good state before the risk-ladder spike (2026-09-07)

- Commit `e392e21` (tag `known-good-v2-2026-09-07`), branch `office-hours`, tree clean.
- Contract: ShieldVault v2 `0xba1Bb356e546AD2d036f4cAA8D25fbba4F5C1006`, HyperEVM testnet 998, block 63626253.
- Vaults: demo `0x9872f09D…dB006` ($70), CRE `0x751D1e26…ED023` ($6, verdict #1 on-chain `0xa02e2fcb…`), Privy wallet `0x83144b99…1D2B` ($20 test USDC, no v2 vault).
- Tests: forge 49/49, bun 66/66, typecheck clean, build:app clean.
- Evidence: docs/evidence/cre-simulate.txt (3 runs), docs/evidence/substreams-live.txt (2 providers + negative control).
- Pinned facts: docs/internal/gauntlet/FACTS.md. Nothing in this spike may point anything back at v1 or edit the deployed contract casually.
