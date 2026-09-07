# Demo script — 2–4 minute submission video

One take, HyperEVM testnet (chain 998), the deployed `ShieldVault.sol` at
`0xcdB6d631A00857584e70a21d800f51C5776302Fe`. Everything on screen is a real
transaction on a real chain. Target length **3:25**; the hard ceiling is 4:00.

The one thing to keep saying: **Shield is not where you trade.** The user
trades on Hyperliquid. Shield is the control layer around the capital behind
that account.

Scope discipline, because every sponsor track wants a short video:

- **One browser window, one tab.** No second tab, no explorer, no landing page.
- **One terminal window, one pane.** Six commands, all of them below.
- Screen at **1280×800**, terminal font large enough to read at 720p.

---

## What is on camera and what is not

| Beat | Produced how | Verified |
|---|---|---|
| Privy sign-in → embedded wallet | live, in the app | yes — wallet `0x83144b99…` exists and has signed 4 txs |
| Release landed in a Hyperliquid account | on-chain record + the live venue panel | yes — tx `0x94960d1f…`, and the Hyperliquid testnet spot account reads live |
| Loss arrives | live `cast send` from the venue wallet | yes — same shape as the returns already indexed |
| Verdict armed on chain | live, by the running server monitor | yes — it has fired twice on 998 today |
| Chainlink TEE banner + `[USER LOG]` | live `cre workflow simulate` | yes — run twice today, 4 s each |
| Verdict transaction on chain | `cast tx` on a stored hash | yes |
| The Graph Substreams live run | live `substreams run` against Pinax | yes — "Completed successfully", 4 s warm |
| The block | live, in the app, from on-chain state | yes — `cast call` reverts `CooldownActive` |

**Cannot be filmed and is not scripted:**

1. **A block explorer.** There is no working HyperEVM testnet explorer (see
   `docs/gauntlet/FACTS.md`, "Explorers"). `cast tx <hash> --rpc-url …` is the
   verification that works on camera. Do not open a browser tab for a hash.
2. **A live *successful* release from the Privy vault**, unless its rolling
   24-hour window has cleared. As of 2026-09-07 the vault's whole $5 daily limit
   is spent inside that window, and raising a limit is a loosening that waits 24
   hours. So the release is scripted as its on-chain record plus the live
   Hyperliquid balance — which is what the Privy track asks for ("complete at
   least one functional financial flow"). Check first: if
   `rollingVelocity` has decayed (gate check (b), field 18, the six velocity
   buckets, all zero) you can film a live $2 release at 1:10 instead, and it is
   a better shot. Do it **before** the loss beat, never after.
3. **A CRE simulation that relays a *new* verdict on camera.** The vault it is
   pointed at is already in cooldown with no loss newer than its last verdict,
   so the run reports `actionable: false` and writes nothing. That is the
   correct, repeatable, gas-free take — and the banner and `[USER LOG]` line
   that Chainlink's criterion names are both in it.
4. **Substreams rows for the demo vault.** The Graph indexes HyperEVM
   **mainnet (999)** only; the vault is on testnet (998). The run completes and
   returns zero rows. Say this out loud — the server says it too.
5. **`bun run demo:evm loss` / `return`.** Hardcoded to Anvil (chain 31337) and
   it throws on testnet by design. Do not put it in the video.

---

## Pre-flight (off camera, ~15 minutes, once)

### 1. Stack

```bash
# Server: HyperEVM testnet. Port 8788 — check nothing else holds it.
lsof -ti :8788 || true
SHIELD_MONITOR=1 bun run server:evm     # reads .env; needs EVM_LOG_INDEX_RPC_URL for a fast cold index

# App
bun run dev:app:hyperevm                # http://localhost:5174
```

The Anvil stack now lives on its own ports (server **8799**, app **5175**), so
the two can run side by side. Check 8788 anyway: an older Anvil server left
running from before that change will still be sitting on it, and the app then
reports "vault not found" for every real vault.

`SHIELD_MONITOR=1` is deliberate. On a real network the monitor is off by
default, so that the Chainlink enclave is the only thing signing verdicts. Turn
it on for the film only if you intend to demo the loss rule firing by itself; if
you are showing the CRE beat instead, leave it off and let the enclave arm the
cooldown on camera.

### 2. Gate checks — do not roll until all five pass

```bash
export PATH="$HOME/.foundry/bin:$PATH"
set -a; . ./.env; set +a
PRIVY=0x83144b99D89947703714Ee9aA3A3614985041D2B

# a. server is on testnet, monitor on, and honest about Substreams
curl -s localhost:8788/api/health | jq '{network, source:.source.mode, substreams:.substreamsAvailable, monitor:.monitor.enabled}'
#    -> "hyperevm-testnet", "rpc", "no: The Graph indexes HyperEVM mainnet only", true

# b. the vault's rules and state
cast call $SHIELD_VAULT_ADDRESS \
  'getVault(address)((bool,address,uint64,uint16,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint8,uint64,uint64,uint8,bytes32,uint64[6],uint64,uint8,uint64,uint64,uint64,uint64))' \
  $PRIVY --rpc-url $EVM_RPC_URL
#    field 12 cooldownUntil must be in the PAST  (otherwise you cannot film the flip)
#    field  7 lossTriggerUsdc must be SMALL (2000000 = $2), see step 3
```

- c. The app at `localhost:5174` loads and Privy sign-in works.
- d. `cre workflow simulate …` (the command in the table) prints the TEE banner.
- e. `scripts/substreams-live.sh hyperevm <START> +20` prints "Completed successfully".

### 3. Set the loss rule low enough to fire — **before filming, not during**

The vault's stock trigger is $10, but its daily limit is $5, so a $10 realised
loss is unreachable. Lower the trigger to **$2**. Do it in the app on the
Protection screen ("Loss trigger" → 2 → *Tighten now*) signed in as the Privy
wallet — lowering a trigger is an instant tightening, and only the Privy wallet
can sign for its own vault.

Do this **at least 24 hours before**, or immediately after step 4 clears the
window. If a realised loss is already inside the rolling 24-hour window when
you tighten, the monitor fires a verdict within one poll and you lose the live
flip — the vault will already be blocked when you start rolling.

Check with gate (b): `cooldownUntil` in the past, `lossTriggerUsdc` = 2000000.

### 4. Pre-warm — the public RPC is metered

- **The app.** Load `localhost:5174`, sign in with Privy, click through Home →
  Behaviour → Protection → Activity, then leave it on Home for two minutes
  before rolling. A cold load hits the metered RPC and the app shows "Still
  reading hyperevm-testnet…" after 4 seconds. Never film a cold page load.
- **Substreams.** Run it once with an **explicit start block** and reuse that
  same block on camera. Cold: 17 s (3,000 store blocks to prepare). Warm on the
  same range: **4 s**. Note the block number you used.
- **CRE.** Run the simulate once; the compile is cached. Warm run: 4 s.
- **cast.** One throwaway `cast block-number` so the RPC connection is hot.
- **Privy.** Sign in once and stay signed in, or have the login email already
  open. The code email is the slowest thing in the video.

### 5. Re-shooting

Everything except the block resets for free. To re-arm the loss and shoot the
flip again, send another small return from the venue wallet (the 1:22 command)
and wait one poll. The cooldown is 24 h and cannot be shortened, so **each take
of the flip needs a fresh return** — budget one take per return and keep a few
dollars of testnet USDC in the venue wallet.

---

## Shot list

Timings are cumulative. Cut points are marked **[CUT]** — the take will have
dead air there; remove it in the edit.

| Start | Len | Screen | Do | Say |
|---|---|---|---|---|
| 0:00 | 0:12 | App, signed out (Welcome) | Hold on the headline and the $10,000 capital bar. Do not scroll. | "Nobody blows up on one trade. They blow up on the top-up after the trade. This is the account that says no to that top-up." |
| 0:12 | 0:18 | Privy modal | Click **Continue with email, passkey or wallet** → email → code → lands on Home. **[CUT the wait for the code]** | "I don't make a wallet. I sign in, and Privy creates a self-custodial wallet in the browser. No seed phrase, no extension." |
| 0:30 | 0:12 | Home, then the address pill top-right | Click the pill: it reads **Privy · hyperevm-testnet** and the full `0x83144b99…`. Close it. | "That wallet is the vault's authority. The contract takes orders from that address and nothing else — not from me, not from a server." |
| 0:42 | 0:16 | Home, hero | Cursor across **Protected → Shield → Trading on Hyperliquid**, then the capital bar legend (Floor / Can be released / In Hyperliquid). | "This is the whole product in one line. Shield holds the capital. Hyperliquid holds the trading. The floor can never be released; the middle slice moves only by rules I set while I was calm." |
| 0:58 | 0:12 | Home, **Connected venue** panel | Point at Trading equity, Session result 24h, Fills. | "That side is read live from Hyperliquid — Shield doesn't custody it and doesn't gate a single trade. Trade all of it to zero if you like." |
| 1:10 | 0:12 | Activity | Point at the row **Sent $5.00 to Hyperliquid**. Then terminal: `cast tx 0x94960d1f937a3e36e1b16e69922a2579e77b584ed25b2ced044da7991fe889be from --rpc-url $EVM_RPC_URL` | "That release is one transaction, and `from` is the Privy wallet — it signed it itself. Inside that transaction the money walks vault → Circle's deposit contract → the HyperCore system address. That's it landing in my Hyperliquid account, which is the number you just saw." |
| 1:22 | 0:16 | Protection, then terminal | Read the loss rule in the user's own words. Then run the venue's return (below). **[CUT 20–45 s while the indexer and monitor catch up]** | "This is the rule, in my words, written before I started. Now I trade, and it goes badly: my trading account sends back a fraction of what it took. Nothing here calls Shield. Shield is watching the chain." |
| 1:38 | 0:14 | Home (refreshes itself) | Status pill flips to **New capital paused**; the releasable slice greys out; the strip reads "your loss rule fired after $X in losses" with a countdown. | "My own rule fired. The server saw the flows, an EIP-712 verdict was signed and relayed, and the vault armed the pause itself. Nobody clicked anything." |
| 1:52 | 0:22 | Terminal | `cre workflow simulate …` (below). Banner + `[USER LOG]` on screen. Then `cast tx 0x2e411cea… --rpc-url $EVM_RPC_URL`. | "The thing that decides this is a Chainlink confidential workflow. It runs in an AWS Nitro enclave — that's the CLI telling me so — and the signing key is a secret released only inside it. That's the log line from inside the enclave. And that transaction is a verdict this enclave signed, on chain, in block 63584417." |
| 2:14 | 0:16 | Terminal | `bun run substreams:hyperevm` (warm, ~4 s). Then `curl -s localhost:8788/api/health \| jq .substreamsAvailable`. | "Shield's memory is a Substreams package composed on The Graph's `ethereum-common` block index. This is it running live against a Graph Market provider. And the honest bit: The Graph indexes HyperEVM mainnet, not testnet, so for a testnet vault it returns zero rows — the server says exactly that, and Shield falls back to reading logs itself." |
| 2:30 | 0:26 | App → **Add trading funds** | The screen leads with **Release blocked / Not tonight.** Move slowly down: *You decided this before you started trading* → **Your rule** in the user's words → **Still protected** → **Available again in**. Do not click anything. | "This is the moment the product exists for. I'm reaching for capital I already decided not to risk. It doesn't lecture me and it doesn't offer me a button. It shows me what I wrote, what's still protected, and when I get to decide again." |
| 2:56 | 0:16 | Terminal | `cast call … instantTopUp … --from $PRIVY` → `execution reverted: CooldownActive` | "And that refusal isn't the app being polite. That's the contract on HyperEVM, refusing the identical call. Shield asks it first so I don't pay gas to be told no — but the no comes from the chain." |
| 3:12 | 0:08 | App | Click **I still really want to trade**, show there is no unlock at the end of it, back out. Click **End my session**. | "There's no override at the end of this. Safer is instant. Less safe waits 24 hours and then has to ask me again." |
| 3:20 | 0:10 | Home, hold | — | "Calm me sets the limits. Tilted me can't undo them tonight. Real contract, real Hyperliquid account, real refusal." |

**Total 3:30.** Under the 4:00 ceiling with 30 seconds of slack for the Privy
sign-in running long.

---

## The six commands, verbatim

Run all of them from the repository root with `set -a; . ./.env; set +a` already
done and `$HOME/.foundry/bin`, `$HOME/.local/bin`, `$HOME/.cre/bin` on `PATH`.

```bash
PRIVY=0x83144b99D89947703714Ee9aA3A3614985041D2B
VENUE=0x05a7a130869a793719BB6B341009ea3B70588DCb
```

**1:10 — the Privy wallet signed the release** (~0.7 s)

```bash
cast tx 0x94960d1f937a3e36e1b16e69922a2579e77b584ed25b2ced044da7991fe889be from \
  --rpc-url $EVM_RPC_URL
# 0x83144b99D89947703714Ee9aA3A3614985041D2B
```

**1:22 — the venue gives back less than it took** (~3 s, then 20–45 s of indexing)

```bash
cast send $USDC_ADDRESS "transfer(address,uint256)" $SHIELD_VAULT_ADDRESS 600000 \
  --rpc-url $EVM_RPC_URL --private-key $EVM_DEPLOYER_KEY | grep -E 'transactionHash|^status'
```

Only `status 1 (success)` and the hash need to be legible.

The signer here must be the address the vault has **registered as its execution
destination** — that is what makes the indexer classify the transfer as a
`RETURN` rather than a deposit. For this vault that address is
`0x05a7a130…`, which is the deployer, so the key is `$EVM_DEPLOYER_KEY`. Check
it on the Home screen's account menu ("Where Shield can send") before you roll.
Keep it a variable name on screen — never paste a key into a terminal you are
filming.

**1:52 — the Chainlink confidential workflow** (~4 s warm)

```bash
cre workflow simulate shield-risk --target evm-settings --non-interactive \
  --trigger-index 0 --http-payload '{"vault":"0x751D1e26d79FeffE95F8a8662aB7A022780ED023"}' \
  -R cre -e cre/.env
```

Expect the boxed banner "Trigger requested TEE Execution … AWS Nitro in
us-west-2", one `[USER LOG] Enclave evaluation: …` line, the result JSON, and
"Simulation complete!". `actionable: false` is correct and expected — that
vault's cooldown is already armed and there is no loss newer than its last
verdict, so the enclave declines to write. Say "it already fired; it won't
double-arm" rather than skipping past it.

**1:52 — the verdict that enclave signed, on chain** (~0.7 s)

```bash
cast tx 0x2e411cea49a5c8edff69dddb7376aca1b5c2eee9f92be1fcb12f78733676bb35 \
  --rpc-url $EVM_RPC_URL
```

`to` is the vault contract, `chainId` is 998, block 63584417.

**2:14 — The Graph, live** (~4 s warm, 17 s cold)

```bash
bun run substreams:hyperevm                    # defaults to mainnet head-20
# or, warm and deterministic, reusing the block you pre-warmed:
scripts/substreams-live.sh hyperevm <START_BLOCK> +20
curl -s localhost:8788/api/health | jq .substreamsAvailable
```

**2:56 — the contract itself refuses** (~0.7 s)

```bash
cast call $SHIELD_VAULT_ADDRESS "instantTopUp(address,uint64)" $VENUE 5000000 \
  --from $PRIVY --rpc-url $EVM_RPC_URL
# Error: execution reverted: CooldownActive
```

This is the strongest ten seconds in the video and it costs nothing. It is a
read-only call, so it can be re-run as many times as the take needs.

---

## Cuts — what was in the old script and should stay out

- **The marketing landing page** (scroll animation, coin, "BLOCKED"). 25 seconds
  of motion graphics that a judge reads as a mock. Open on the product.
- **The setup wizard.** Four screens, two minutes, and it repeats what the
  Protection screen shows in twelve seconds.
- **The mobile viewport shot.** Nice; not evidence of anything a sponsor asked
  for.
- **`bun test` / the test count.** Put it in the README, not the video.
- **Scheduling a loosening and watching it count down, then superseding it.**
  Two beats that cost 30 seconds to earn one sentence. The 3:12 beat says the
  same thing in eight.
- **"Move funds to cold" and the 7-day exit.** True, good, and cuttable.
- **The recovery CLI.** A README paragraph.
- **Any explorer link.** There isn't one that works.

If the take runs over 4:00, cut in this order: 3:12 (8 s), 0:58 (12 s), 1:10
(12 s). Never cut 2:30 or 2:56.

---

## If a beat fails on the day

- **The verdict doesn't arm within 60 s of the return.** Check the server log
  for the poll; the HyperEVM indexer polls every 15 s and walks at most 100
  blocks per poll. If it is behind, wait — it catches up. If the monitor is off,
  `/api/health` shows `monitor.enabled: false`.
- **The app shows "Still reading hyperevm-testnet…".** The metered RPC is
  throttling. Stop, wait a minute, reload, and start the take again. Do not
  narrate over it.
- **Privy sign-in stalls.** `VITE_PRIVY_APP_ID` must be set in `.env` (the app
  reads it via `app/vite.config.mts` `envDir`). Without it the Welcome screen
  offers a demo-key path instead, which loses the Privy beat entirely — do not
  film that variant.
- **The block screen shows an amount field instead of "Not tonight."** The
  cooldown is not a *loss* cooldown. `cooldownReason` must be 2
  (`RISK_VERDICT`); a self-pause is reason 1 and renders as "Paused by you".
- **You need a bigger-numbers fallback.** Vault `0x9872f09D…` ($600 protected,
  $500 floor, $100/day, 12 h cooldown) reads better on camera and can be signed
  in on the Welcome screen's "Continue with a demo key" path with the
  `authority` key from `.shield/hyperevm-keys.json`. It costs you the Privy
  beat, so only fall back to it if the Privy wallet is unusable. That path also
  lands failed transactions on chain, so a blocked release there produces a real
  rejection hash the app will show.

## Judge Q&A

See `docs/JUDGE_QA.md`. Have three ready: "isn't this just a spending limit?",
"can't the user just move the money out?", and "what happens when The Graph or
Chainlink is down?"
