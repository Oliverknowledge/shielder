# Human actions

Everything else is built and verified. These need an account, funds or a
camera that only you have. Time: about 40 minutes plus the recording.

**Step 2 is done.** `ShieldVault.sol` is live on HyperEVM testnet (chain 998)
at `0xcdB6d631A00857584e70a21d800f51C5776302Fe`, the vault for
`0x05a7a130869a793719BB6B341009ea3B70588DCb` is initialized with its two
destinations, and `.env` points the server and app at it. What is left there is
the USDC drip (step 2b), which needs a Hyperliquid-mainnet-active address.

## 1. Privy app ID (5 min) → real sign-in and embedded wallet

Why: the app's email/passkey sign-in and the self-custodial embedded wallet
come from Privy. Without an app ID the app falls back to a pasted demo key.

- https://dashboard.privy.io → New app → copy the **App ID**.
- In the app settings: enable **Ethereum embedded wallets** (create on login),
  login methods email / passkey / wallet, and add `http://localhost:5174`
  (and your deploy URL) to allowed origins.
- Add to the repo-root `.env` (gitignored; `app/vite.config.mts` reads it via `envDir`):

```
VITE_PRIVY_APP_ID=<app id>
```

Expected: the welcome screen shows "Continue with email, passkey or wallet";
after login the account chip shows your email and an `0x…` embedded wallet.

## 2. HyperEVM testnet deployment — DONE

`ShieldVault.sol` is deployed and wired up. For the record:

| | |
|---|---|
| Contract | `0xcdB6d631A00857584e70a21d800f51C5776302Fe` |
| Deploy tx | `0x67ffb6531f406758758adb98fb81008f1888e6793b9a39fb79bde9ee6df66ebc` (block 63561837, 5,364,724 gas) |
| Chain | HyperEVM testnet, chain id 998, `https://rpc.hyperliquid-testnet.xyz/evm` |
| Deployer / authority | `0x05a7a130869a793719BB6B341009ea3B70588DCb` |
| Constructor args | USDC `0x2B3370eE501B4a559b57D449569354196457D8Ab`, CoreDepositWallet `0x0B80659a4076E9E93C7DbE0f10675A16a3e5C206` |

Two things about HyperEVM that the deployment turned up, in case you redeploy:

- **Big blocks are required.** ShieldVault costs ~5.4M gas and HyperEVM's small
  blocks cap out around 2-3M, so the deploy key has to opt into big blocks
  (~1/min, 30M gas) first and opt back out afterwards so ordinary vault
  transactions confirm in a second again:

  ```bash
  EVM_DEPLOYER_KEY=0x… bun run hyperevm:big-blocks on
  cd contracts && forge create src/ShieldVault.sol:ShieldVault \
    --rpc-url https://rpc.hyperliquid-testnet.xyz/evm --private-key $EVM_DEPLOYER_KEY \
    --gas-limit 6000000 --legacy --broadcast \
    --constructor-args 0x2B3370eE501B4a559b57D449569354196457D8Ab 0x0B80659a4076E9E93C7DbE0f10675A16a3e5C206
  cd .. && EVM_DEPLOYER_KEY=0x… bun run hyperevm:big-blocks off
  # then: EVM_DEPLOYER_KEY=0x… SHIELD_VAULT_ADDRESS=0x… bun run bootstrap:hyperevm
  ```

  `evmUserModify` is a Hyperliquid L1 action, so it fails with "User does not
  exist" until the address has an account on HyperCore. Sending a little native
  HYPE to `0x2222222222222222222222222222222222222222` on HyperEVM creates one.

- **The public RPC is metered.** `eth_getLogs` is capped at 50 blocks and bursts
  come back as `rate limited`, so the indexer paces itself there (see the
  pacing knobs at the bottom of `.env.example`).

Run it:

```bash
SHIELD_PORT=8788 bun run server:evm    # indexer + monitor + relayer + API on :8788
bun run dev:app:hyperevm               # http://localhost:5174
```

In the app: Welcome → "Continue with a demo key (hyperevm-testnet)" → paste the
deploy key. Overview reads the live vault: floor $6,000, daily limit $2,000,
loss rule $1,000 → 18h, Axiom and Ledger registered.

## 2a. Which key opens the funded vault — DONE, but read this

`ShieldVault.sol` is multi-tenant: one contract, one vault per owner address.
Signing in with a key that owns no vault, or an empty one, shows a real but
empty dashboard, which looks like a bug and is not.

| Owner | Balance | Floor | Use it? |
|---|---|---|---|
| `0x9872f09D96bcA7f878CEe9c4bDc8bCcA269dB006` | **$600** | $500 | **yes** — key in `.shield/hyperevm-keys.json` under `authority` |
| `0x05a7a130869a793719BB6B341009ea3B70588DCb` | $0 | $6,000 | no — the floor exceeds anything you can deposit |

`0x05a7…` is your Hyperliquid account and the funder; it holds the gas and is
the vault's registered trading destination. Its own vault was created earlier
with a $6,000 floor sized for a $10,000 demo, and lowering a floor waits 24
hours by design, so a second vault was the only same-day path.

The welcome screen now names the stack's vault under the demo-key box, so a
mismatch is visible before you sign in.

Live state (2026-09-06):

- Vault holds **$600** USDC on HyperEVM; floor $500, $100/day, $50 loss → 12h.
- Trading destination is your Hyperliquid account; **$347** equity, read live.
- A **$100 release ran end to end**: vault $700 → $600, your HyperCore USDC
  131.844 → 231.844, through Circle's real `CoreDepositWallet.depositFor`.

## 3. The Graph Market key (5 min) → live Substreams

Why: both Graph prizes require live data from a Graph provider.

- https://thegraph.market → sign up → API key (a JWT). Put it in `.env` (gitignored) as
  `SUBSTREAMS_API_TOKEN=<jwt>`. One JWT serves both stacks; the endpoints are separate:
  `SUBSTREAMS_SOLANA_ENDPOINT=devnet.sol.streamingfast.io:443` and
  `SUBSTREAMS_HYPEREVM_ENDPOINT=hyperevm.substreams.pinax.network:443` (see `.env.example`).
- Verify authentication: `bun run substreams:hyperevm` (streams the last 20 HyperEVM
  mainnet blocks) and `bun run substreams:solana <slot>`. Without the JWT the same
  commands fail with an authentication error, which is the negative control.
- Servers: `bun run server` (Solana) switches `/api/health` `source.mode` to `substreams`
  as soon as the JWT is set; `bun run server:evm` does the same on HyperEVM mainnet
  (`EVM_CHAIN_ID=999`), since The Graph does not index the HyperEVM testnet or Anvil.

Keep the terminal output for the submission.

## 4. Chainlink: install the `cre` CLI (10 min) → the bounty's named evidence

`CRE_API_KEY` is set and the confidential evaluation already runs against the
live vault. What is missing is the CLI itself: `cre` is a separate Go binary,
not on npm or Homebrew, so `cre workflow simulate` cannot run here.

Already proven without it — the same `evaluateVault` function, the same signed
output, on the live deployment:

```
[USER LOG] Enclave evaluation: vault=0x9872f09D… realisedLoss24h=70000000
           trigger=50000000 triggered=true actionable=true
[USER LOG] Verdict #1 relayed on-chain: 0x0c4387ce…
```

Verdict #1 attested $70, the deployed vault accepted it (block 63578192), and
it armed a 12-hour cooldown that then blocked the next release on-chain.

That evidence comes from `dryrun.ts`, which stands plain `fetch` in for the
enclave's HTTP capability and `cre/.env` in for the Vault DON. The bounty asks
for a simulation **through the CRE CLI** or a live deployment, so this is
strong but not literally what was asked. To close it:

1. Install the `cre` CLI from Chainlink's docs (docs.chain.link/cre) — check
   whether Confidential Workflows access has to be granted to your account
   first (docs.chain.link/cre/account/confidential-workflows-access).
2. Then, with the loss standing on the vault and `SHIELD_MONITOR=0` so the
   enclave is the only signer:

```bash
SHIELD_MONITOR=0 bun run server:evm &
cre workflow simulate cre/shield-risk --target staging-settings --non-interactive \
  --trigger-index 0 --http-payload '{"vault":"0x9872f09D96bcA7f878CEe9c4bDc8bCcA269dB006"}' \
  -R cre -e cre/.env
```

Expect the TEE banner (`Trigger requested TEE Execution … AWS Nitro`) on top of
the same two `[USER LOG]` lines. `cre/.env` already signs with the key this
vault pins (`0x4A41Fa3d…`), so a verdict it produces will be accepted.

Note a verdict only lands when there is a *new* loss: nonce 1 is used, so stage
another one (release, then send back less than you released) before re-running.

## 5. Solana devnet (optional, 10 min) → the v0 stack live

`HFt8yKqfAMiXYMLVTWZBCA22tQJW2TnMU1UidBVpJned` needs ~4 SOL from
https://faucet.solana.com, then `scripts/deploy.sh devnet`, `scripts/deploy.sh finalize`
(irreversible), `SHIELD_RPC_URL=https://api.devnet.solana.com bun run scripts/bootstrap-demo.ts`.

## 6. Record the video (2–4 min, 720p+, no AI voice) and submit

Follow `docs/DEMO_SCRIPT.md`. Submit on ETHGlobal before **Sunday Sept 13,
12:00 pm EDT** with partner prizes **The Graph**, **Privy**, **Chainlink**,
pasting from `docs/SUBMISSION.md`. Push: `git push origin office-hours`.
