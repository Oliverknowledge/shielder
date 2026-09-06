# Human actions

Everything else is built and verified locally. These need an account, funds
or a camera that only you have. Do them in this order; the first three are
the ones that turn the Hyperliquid-first build from "runs on Anvil" into
"runs on HyperEVM with real sponsor evidence". Time: about an hour plus the
recording.

## 1. Privy app ID (5 min) → real sign-in and embedded wallet

Why: the app's email/passkey sign-in and the self-custodial embedded wallet
come from Privy. Without an app ID the app falls back to a pasted demo key.

- https://dashboard.privy.io → New app → copy the **App ID**.
- In the app settings: enable **Ethereum embedded wallets** (create on login),
  login methods email / passkey / wallet, and add `http://localhost:5174`
  (and your deploy URL) to allowed origins.
- Add to `app/.env.local`:

```
VITE_PRIVY_APP_ID=<app id>
```

Expected: the welcome screen shows "Continue with email, passkey or wallet";
after login the account chip shows your email and an `0x…` embedded wallet.

## 2. A Hyperliquid-active address + HYPE for gas (15 min) → HyperEVM

Why: HyperEVM testnet only serves addresses that have deposited on
Hyperliquid mainnet, and HyperEVM mainnet is the only HyperEVM The Graph
indexes. Gas is ~0.1 gwei, so a deployment costs a fraction of a cent.

Pick one:

**A. HyperEVM testnet (chain 998, free, but needs a mainnet-active address).**
- From an address that has deposited on Hyperliquid mainnet, claim testnet USDC at
  https://app.hyperliquid-testnet.xyz/drip (1,000 USDC, once).
- Get testnet HYPE for gas from the QuickNode HyperEVM faucet (no account needed).
- Move some USDC HyperCore → EVM (Hyperliquid testnet app: "Transfer to EVM").

**B. HyperEVM mainnet (chain 999, tiny real funds, The Graph-indexed).**
- Send ~$1 of HYPE and ~$50 USDC to the deploy key on HyperEVM. Real money:
  keep the demo amounts small.

Then, with `EVM_DEPLOYER_KEY` in your shell (never committed):

```bash
cd contracts && forge install foundry-rs/forge-std --no-git && cd ..
# USDC on HyperEVM testnet: 0x2B3370eE501B4a559b57D449569354196457D8Ab; CoreDepositWallet testnet: 0x0B80659a4076E9E93C7DbE0f10675A16a3e5C206
# (mainnet: CoreDepositWallet 0x6B9E773128f453f5c2C60935Ee2DE2CBc5390A24; USDC per Circle's HyperEVM listing)
cd contracts && forge create src/ShieldVault.sol:ShieldVault --rpc-url https://rpc.hyperliquid-testnet.xyz/evm --private-key $EVM_DEPLOYER_KEY --constructor-args <USDC> <CoreDepositWallet> --broadcast && cd ..
```

Write the printed contract address into `.shield/demo-state.evm.json`
(`vault`, `usdc`, `coreDeposit: null`, `rpcUrl`, `chainId`, `authority`) or
export `SHIELD_VAULT_ADDRESS`, `USDC_ADDRESS`, `EVM_RPC_URL`, `EVM_CHAIN_ID`,
then:

```bash
SHIELD_EVM_VERIFIER_KEY=<fresh key> SHIELD_EVM_RELAYER_KEY=<funded key> bun run server:evm
VITE_SHIELD_CHAIN=evm VITE_SHIELD_RPC_URL=https://rpc.hyperliquid-testnet.xyz/evm VITE_EVM_CHAIN_ID=998 bun run --cwd app vite
```

Expected: the setup wizard creates your vault with one transaction, a
top-up lands in your Hyperliquid perps account within a block (visible on
app.hyperliquid-testnet.xyz), and the Trade screen shows your real account.

## 3. The Graph Market key (5 min) → live Substreams

Why: both Graph prizes require live data from a Graph provider.

- https://thegraph.market → sign up → API key → `substreams auth`.
- Solana (v0 stack, devnet): `SUBSTREAMS_API_TOKEN=<jwt> bun run server` and
  `cd substreams && substreams run shield-behavioral-memory-v0.2.0.spkg map_vault_flows -e devnet.sol.streamingfast.io:443 -s <slot> -t +500`.
- HyperEVM mainnet: `cd substreams-evm && substreams run substreams.yaml map_vault_flows -e hyperevm.substreams.pinax.network:443 -s <deploy block> -t +200 -p map_shield_events="evt_addr:<vault>" -p map_vault_flows="evt_addr:<vault> || evt_addr:<usdc>"`.

Keep the terminal output for the submission.

## 4. Chainlink API key (5 min) → CRE simulation evidence

- https://app.chain.link → Account → API key (or `cre login`).

```bash
export CRE_API_KEY=<key>
echo "SHIELD_EVM_VERIFIER_KEY=<the verifier key the vault pins>" >> cre/.env
cre workflow simulate cre/shield-risk --target staging-settings --non-interactive --trigger-index 0 --http-payload '{"vault":"<authority address>"}' -R cre -e cre/.env
```

Expected: the TEE banner, `[USER LOG] Enclave evaluation … triggered=true actionable=true`,
`Verdict #N relayed on-chain: 0x…`. Run the server with `SHIELD_MONITOR=0` so the
enclave is the only signer. (The identical function already runs locally:
`bun run cre/shield-risk/dryrun.ts --evm <authority>`.)

## 5. Solana devnet (optional, 10 min) → the v0 stack live

`HFt8yKqfAMiXYMLVTWZBCA22tQJW2TnMU1UidBVpJned` needs ~4 SOL from
https://faucet.solana.com, then `scripts/deploy.sh devnet`, `scripts/deploy.sh finalize`
(irreversible), `SHIELD_RPC_URL=https://api.devnet.solana.com bun run scripts/bootstrap-demo.ts`.

## 6. Record the video (2–4 min, 720p+, no AI voice) and submit

Follow `docs/DEMO_SCRIPT.md`. Submit on ETHGlobal before **Sunday Sept 13,
12:00 pm EDT** with partner prizes **The Graph**, **Privy**, **Chainlink**,
pasting from `docs/SUBMISSION.md`. Push: `git push origin office-hours`.
