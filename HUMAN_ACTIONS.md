# Human actions

Everything else is done and verified on a local validator. These five need
an account, funds, or a camera that only you have. Total time: about 40
minutes plus recording.

## 1. Put ~4 SOL on the deploy key and deploy to devnet (10 min)

Why: the public faucet rate-limited this key at 0 SOL; a 474 KB program
needs ~3.3 SOL of rent.

- Key: `HFt8yKqfAMiXYMLVTWZBCA22tQJW2TnMU1UidBVpJned` (`~/.config/solana/id.json`)
- Faucet: https://faucet.solana.com (GitHub login, 5 SOL/8h) or `solana airdrop 2 --url devnet` until it works.
- Then, from the repo root:

```bash
scripts/deploy.sh devnet        # deploys 4Z46Kz8ygX5Efw22ABbQ2LTf329N3nD2J81Z3CAY5Hyx
scripts/deploy.sh finalize      # burns the upgrade authority (irreversible; required by the threat model)
SHIELD_RPC_URL=https://api.devnet.solana.com bun run scripts/bootstrap-demo.ts
SHIELD_RPC_URL=https://api.devnet.solana.com bun run server/index.ts &
VITE_SHIELD_RPC_URL=https://api.devnet.solana.com bun run dev:app
```

Expected: `solana program show` prints `Authority: none`; the app's pill
reads `devnet`; explorer links open on `?cluster=devnet`.

## 2. The Graph Market key → live Substreams (5 min)

Why: The Graph's prize requires live data from a Graph provider; the
endpoint refuses unauthenticated streams.

- Sign up (free, no card): https://thegraph.market/auth/signup → API key.
- `substreams auth` (or paste the JWT), then:

```bash
export SUBSTREAMS_API_TOKEN=<jwt>
SUBSTREAMS_START_SLOT=<slot of the vault's first devnet tx> bun run server/index.ts
curl -s localhost:8787/api/health | jq .source     # expect "mode": "substreams", "connected": true
cd substreams && substreams run shield-behavioral-memory-v0.2.0.spkg map_vault_flows -e devnet.sol.streamingfast.io:443 -s <slot> -t +500 -o jsonl
```

Keep the terminal output for the submission.

## 3. Chainlink API key → CRE simulation (5 min)

Why: every `cre` command, including `simulate`, needs an account.

- https://app.chain.link → Account Settings → API key (or `cre login`).

```bash
export CRE_API_KEY=<key>
bun run scripts/print-verifier-seed.ts >> cre/.env     # once
VAULT=$(jq -r .vault .shield/demo-state.devnet.json)
bun run client/demo.ts top-up 1500 && bun run client/demo.ts return 80   # fresh loss evidence
cre workflow simulate cre/shield-risk --target staging-settings --non-interactive \
  --trigger-index 0 --http-payload "{\"vault\":\"$VAULT\"}" -R cre -e cre/.env
```

Expected: the TEE banner, `[USER LOG] Enclave evaluation … triggered=true actionable=true`,
`Verdict #N relayed on-chain: <sig>`. Keep the output. (Run the server with
`SHIELD_MONITOR=0` first so the enclave is the only signer.)

## 4. Record the demo video (2–4 min, 720p+, no AI voice)

Follow `docs/DEMO_SCRIPT.md` (2-minute table). Screen-record at 1280 wide;
speak the lines. Upload with the submission.

## 5. Submit on ETHGlobal before Sunday Sept 13, 12:00 pm EDT

- Track: Start Fresh, "Finalist and Partner Prizes".
- Partner prizes: **The Graph** (AI Use Case, From Scratch; also Composable) and **Chainlink** (Best Confidential Workflow).
- Paste from `docs/SUBMISSION.md`; feedback text is in `docs/SPONSOR_INTEGRATIONS.md`.
- Make the repo public and push: `git push origin office-hours` (or merge to main first).
