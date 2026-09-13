# Demo script — 2–4 minute submission video

One take, HyperEVM testnet (chain 998), the deployed `ShieldVault.sol` v3 at
`0xDaA8B6a85391d54397c3847F006a49A16d0F37b3`.

**Open on the onboarding** (`/` signed out): example account → analysis steps →
"You were down $43 when you added another $300" → replay → "Shield would step in
here", $300 → $140 available / $160 protected → "Protect me from this" → plan →
sign in → Protect $250 → Shield active. About 60 seconds, all real history.

**New in v3, and the beat to build the take around:** the REDUCED rung. The
shot list, the exact `cast call` that goes from `0x` to
`VelocityThresholdExceeded` (`0x54debb02`) and back to `0x` for a smaller
amount, and what must not be said are in
`docs/internal/research/I-wow-judge.md`; the on-set recipe is in
`HUMAN_ACTIONS.md` #3. Everything on screen is a real
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
   `docs/internal/gauntlet/FACTS.md`, "Explorers"). `cast tx <hash> --rpc-url …` is the
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
4. **Substreams rows for the HyperEVM vault.** The Graph indexes HyperEVM
   **mainnet (999)** only; the product vault is on testnet (998), so that
   package completes with zero rows. Do not film that package. Film the
   **Sepolia twin** instead (§ the 2:18 beat): same bytecode, same pipeline,
   real rows, and the Shield server consuming them with
   `source.mode = "substreams"`. Start that server before the take:

   ```bash
   SHIELD_PORT=8790 EVM_CHAIN_ID=11155111 \
     EVM_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com \
     SHIELD_VAULT_ADDRESS=0xf1ef03Ea258EF652939bAC0250d1CDe9B5EF4f6A \
     USDC_ADDRESS=0xb0Cbbeb2783E3965036Db1740911be45ad389837 \
     EVM_START_BLOCK=11654048 SHIELD_MONITOR=0 bun run server/evm-index.ts
   ```

   Say the twin out loud once — it is in the repo, in the evidence and in the
   submission text, so owning it costs nothing and hiding it would cost the
   entry. What you must **not** say is "it returns no rows": that is the v2
   position, it is no longer true, and The Graph's criteria disqualify mocked or
   static datasets, so a judge hearing it may stop there.
5. **DO NOT deposit from the Privy wallet on camera.** Read back from chain on
   2026-09-13: `0x83144b99…` **does** have a v3 vault, and its protected floor is
   **$8,050** against a **$0** balance. The wallet holds $20 of test USDC. Deposit
   that $20 and the releasable slice is $0 — every release reverts with
   `ProtectedFloorBreached`, not with the loss rule — and lowering a floor is a
   *loosening*, so it waits 24 hours and cannot be fixed before the deadline. On
   camera that reads as a broken product, and it would make the 1:38 narration
   ("my own rule fired") simply false.

   **Film Privy as the identity beat only:** sign in with email, open the address
   pill, show that this wallet is the vault's authority and that the contract
   takes orders from no other address. Privy's functional-flow clause is already
   satisfied by the $5.00 release at 1:10, which is a real transaction from that
   same wallet and is proved on screen with `cast tx` — a terminal proof, so it
   does not need the app to cooperate.

   If you want a live Privy deposit badly enough to spend twenty minutes on it,
   the only safe version is a **fresh** Privy wallet (new email → no vault →
   onboarding proposes rules from history → sane floor), funded by transferring
   the $20 USDC across from `0x83144b99…`, which holds 0.3 HYPE for gas. Higher
   reward, real on-camera risk. Decide before you start, not during a take.

6. **`bun run demo:evm loss` / `return`.** Hardcoded to Anvil (chain 31337) and
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

### 3a. What the loss rule now needs, and why this changed

**Read this before planning the loss beat.** Shield used to book any capital
that left the vault and had not come back as a realised loss. That fired on the
live testnet vault and paused an account Hyperliquid reported as *up* $5 — the
worst thing this product can do, and the reason both the server and the
confidential workflow now defer to the venue's own settled PnL wherever the
venue answers.

The consequence for filming is direct: **on HyperEVM testnet, sending USDC back
from the trading wallet no longer creates a loss.** The venue decides, and if the
Hyperliquid account is flat or up over the last 24 hours the rule will not fire,
whatever the flows say. Verify with the enclave itself before you plan the shot:

```bash
cre workflow simulate shield-risk --target evm-settings --non-interactive \
  --trigger-index 0 --http-payload '{"vault":"<authority>"}' -R cre -e cre/.env \
  2>&1 | grep 'USER LOG'
# realisedLoss24h must be greater than the trigger, or nothing will fire.
```

Two honest ways to get the beat:

1. **Take a real losing trade on Hyperliquid testnet** with the registered
   trading account, closed inside the 24-hour window, larger than the loss
   trigger. This is the strongest version — the number on screen is the venue's
   own settlement — and it is what the product actually claims.
2. **Film the beat on the Anvil stack**, where there is no venue API and the flow
   view is the only evidence, so `bun run demo:evm loss` works exactly as
   scripted. Say on camera that it is the local stack. Everything else in the
   video can still be the live testnet.

Do not try to manufacture a testnet loss by returning less than you sent. It
will not fire, and it should not: that is the bug this product fixed.

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

## Pre-flight: ALREADY DONE — the loss beat is armed

Executed 2026-09-13 11:55 UTC. Do not repeat it; just check it is
still true before you roll.

- Loss trigger tightened **$7 -> $1** on the demo vault, instantly, in tx
  `0xf0dca94d0880bc50650d4342ea19415061fb2bad325ab5c4c0f00539b73974d6`
  (block 64158718, `configVersion` 2 -> 3). Tightening needs no wait; that is
  the point, and it is worth saying on camera.
- A **real loss** was then taken on Hyperliquid testnet from the registered
  trading account with `scripts/hyperevm-losing-trade.ts`: fourteen BTC round
  trips at 40x, realised **-$1.89** against a $1.00 trigger.
- `/api/vault/0x9872…` now reports `triggered: true`, `actionable: true`,
  `realizedLossUsdc: 1888661`, headline *"You realised $1.89 in losses in the
  last 24 hours. Your rule pauses new capital for 12h."*
- The vault is deliberately **not in cooldown yet**: `cooldownUntil` is in the
  past and `lastVerdictNonce` is 1. That is what lets the Chainlink beat arm it
  live — the enclave signs nonce 2 on camera. **Do not run `cre workflow
  simulate` before the take**, or the vault will already be LOCKED and the
  enclave will correctly refuse to descend further, which kills the beat.

Check it is still armed (the 24h window holds until roughly this time tomorrow):

```bash
curl -s localhost:8788/api/vault/0x9872f09D96bcA7f878CEe9c4bDc8bCcA269dB006 \
  | jq '.assessment | {triggered, realizedLossUsdc, headline}'
```

If `triggered` has gone false because the window rolled, re-arm with one command
(the trigger is already $1, so this is all that is needed):

```bash
EVM_DEPLOYER_KEY=0x… bun run scripts/hyperevm-losing-trade.ts 1.0 0 8
```

<details><summary>Original pre-flight, kept for the record</summary>

## Pre-flight: arm the loss beat (do this FIRST, ~15 min)

Checked against chain and the Hyperliquid testnet API on **2026-09-13**.

**The problem.** The demo vault's cooldown has expired. `/api/health` and
`/api/vault/0x9872…` now report `triggered: false`, `realizedLossUsdc: 0`,
*"Realised losses in the last 24 hours: $0, below your $7 trigger."* The 1:38
and 2:30 beats — the two the whole video exists for — cannot be filmed in this
state. `FACTS.md` describes this vault as LOCKED; that was true on 2026-09-07
and the 12h cooldown has long since run out.

**You do not need the faucet.** `FACTS.md` says test USDC is exhausted, but the
registered trading account `0xE7c2Adb4…967A1` holds **$4.74 in perps,
withdrawable, with no open positions**, and the funder `0x05a7a130…88DCb` holds
**1.53 HYPE** for gas. That is enough, because the loss trigger can be lowered
to meet it.

**Lowering `lossTriggerUsdc` is a TIGHTENING, so it is instant**
(`ShieldVault.sol:424` — `tighten` reverts if the new trigger is *higher*). No
24-hour wait. Better still, it is a beat worth filming: it is the product's
"toward safety is instant" claim, done live.

1. **Sign in as the demo vault.** Welcome → *Continue with a demo key
   (hyperevm-testnet)* → paste `.shield/hyperevm-keys.json` → `authority`
   (`0x9872f09D…dB006`). The screen names the expected authority, so you can
   check you pasted the right one before you commit to a take.
2. **Tighten the loss trigger, on camera, from $7 to $1.** Protection → *Loss
   trigger* → `1` → confirm. One transaction, effective in that block. Say what
   it is while you do it: "tightening is instant, and this is the contract
   letting me do it in one block."
3. **Stage a real loss with what the account already has.**
   ```bash
   EVM_DEPLOYER_KEY=0x… bun run scripts/hyperevm-losing-trade.ts 1.5 0
   ```
   The `0` is the important argument: trade with the balance already in the
   account instead of trying to fund it. It round-trips a BTC position with IOC
   orders until the venue's own `closedPnl - fees` reaches about `-1.5`, which
   clears the $1 trigger you just set. This is a real fill on Hyperliquid
   testnet, not a simulation.
4. **Let the server see it, then check before you roll.**
   ```bash
   curl -s localhost:8788/api/vault/0x9872f09D96bcA7f878CEe9c4bDc8bCcA269dB006 \
     | jq '.assessment | {triggered, realizedLossUsdc, headline}'
   ```
   Do not start the take until `triggered` is `true`. Then the 1:38 status pill
   and the 2:30 *Not tonight* screen are both live and true.

</details>

**Two servers, both up before you roll.** The HyperEVM one on `:8788` for the
app, and the Sepolia one on `:8790` for the 2:18 Graph beat (command in prep
note 4). They are different chains and do not conflict.

**One vault per segment.** The Privy beat signs in with email and lands on the
Privy wallet; the vault beats need the demo key above. Cut between them — the
script already alternates app and terminal, so it reads as editing, not as a
problem. Privy's functional-flow evidence is the `cast tx` at 1:10, which needs
no app state at all.

---

## Structure: three acts, and why this one

A sponsor judge is skimming for their own clause and a finalist judge is looking
for a reason to care. The same 3:40 has to serve both, so every sponsor beat
ends in a **state change on a real system**, and the story beats carry the
sponsors rather than pausing for them.

**Act 1 — the evidence (0:00-0:40).** Do not open on a logo, a landing page, or
"hi, I'm ...". Open on someone else's money, already moving. The strongest thing
this project owns is that the problem can be proved on a stranger's public
history before a single claim is made, and that a judge can reproduce it from
the submission link in twenty seconds. The first frame should be heading toward
-$117,089.

**Act 2 — why this cannot be a feature (0:40-1:05).** Twenty-five seconds, no
screen recording needed, and the highest-value part of the video for originality.
Anyone can build a time lock. The argument is that nobody who *could* build it
can be trusted to hold it, because a venue holding your money against your stated
wish owns a liability and therefore ships an appeals path. That is the reason
this is a contract with no owner rather than a setting in an app.

**Act 3 — it actually runs (1:05-3:30).** Four consequences in order, each one
somebody else's system agreeing: Privy's wallet becomes the only address the
contract obeys, a real loss fires the user's own rule, a Chainlink enclave signs
the verdict without ever learning the number, and The Graph is where the memory
came from. End on the refusal, because that is the product.

**Close (3:30-3:40).** One line. Do not summarise.

Rules that matter more than the wording:

- **One honesty clause per beat, never two.** The calibrated honesty is a
  differentiator; wallowing in caveats is not. "It could not have undone the
  loss." "The Graph indexes mainnet, so this is a Sepolia twin of the same
  bytecode." That is the dose.
- **Never film a spinner.** Everything below is pre-warmed in the pre-flight.
- **Cut the app tour.** The hero, the venue panel and the activity list are the
  beats a judge forgets. Their content survives as single sentences.

## Where to go, and who you are signed in as

**Four addresses are in this video. Confusing them is the one way to wreck it.**

| Address | What it is | Which beats |
|---|---|---|
| `0x92a7bc…` | **A stranger's Hyperliquid MAINNET account.** Not yours. | 1–7 |
| `0x83144b…` | **Your Privy embedded wallet** (testnet). Owns a vault with an $8,050 floor and $0 — never show that vault. | 8–9 |
| `0x9872f0…` | **Your demo vault authority** (testnet). This is the vault with the armed loss. | 10–17 |
| `0xE7c2Ad…` | **Your registered trading account on Hyperliquid TESTNET.** Took the -$1.89. Appears *inside* the app. | 11 |

### The desk — nothing loading when you hit record

| Window | Open this | State |
|---|---|---|
| **Chrome tab A** | `https://palenque-sigma.vercel.app/start?a=0x92a7bc9b107bdd35e3db97dc171d5a8c1ee33fea` | Analysed once already, then **back out and re-open the link** so it sits on the reveal screen with the replay unplayed. Analysis now takes ~1.6s, the replay ~10s. |
| **Chrome tab B** | `https://app.hyperliquid.xyz/explorer/address/0x92a7bc9b107bdd35e3db97dc171d5a8c1ee33fea` | Loaded |
| **Chrome tab C** | `http://localhost:5174` (`bun run dev:app:hyperevm`) | Signed **out** |
| **Terminal** | 4 tabs, `set -a; . ./.env; set +a` done in each | Commands typed, **not run** |

Servers: **:8788** (app) and **:8790** (Sepolia/Graph). Both are already up.

**Where the Hyperliquid account lives in the UI:** Home → click
**`Details: capital, venue, rules`** → the **Connected venue** panel. It is
collapsed by default. That panel shows `0xE7c2…67A1`, Trading equity `$4.37`,
Session result 24h `-$1.89`, Fills 28.

## Final shot list — 3:50

Narration is written at 2.5 words/second. Do not add words.

| # | Start | Len | Where | Do | Say (verbatim) |
|---|---|---|---|---|---|
| 1 | 0:00 | 0:12 | Tab A, the **reveal** screen | Hold on "Your most expensive reload session" and the three numbers. Press **Replay what happened** on the last word. | "That is a real Hyperliquid trader. Not my account — their public history. They were down thirteen hundred dollars. And then they added another thirteen thousand, eight hundred." |
| 2 | 0:12 | 0:11 | Tab A, the **replay** | It runs for about ten seconds and stops on its own. **Two seconds of silence** as it falls past the reload marker. Watch the header count the loss: `Fri, Sep 11 · 2:52 PM · −$25,997 since the reload`. | "Fifty-seven minutes later that session was down fifty-three thousand. It ended at minus one hundred and seventeen thousand dollars." |
| 3 | 0:23 | 0:06 | **Tab B** | Cut across. Two seconds. Cut back. | "That is the same account on Hyperliquid's own explorer. Anyone can check it." |
| 4 | 0:29 | 0:18 | Tab A → **Show where Shield steps in** | Let the numbers land. Rest on the line beneath. | "Shield reads that history and builds a plan from their own numbers. They asked for thirteen thousand eight hundred. Their own plan allows three thousand seven hundred and fifty. Ten thousand stays out. And it says the honest thing — it could not have undone the loss." |
| 5 | 0:47 | 0:14 | Hold. Mouse still. | The argument. Do not click. | "Every wallet ever built would sign that deposit. And no exchange can be the one to refuse it — an exchange holding your money against your own wishes builds an appeals path. That is the thing that breaks it." |
| 6 | 1:01 | 0:10 | Terminal 1 | `cast call $SHIELD_VAULT_ADDRESS "VERSION()(uint8)" --rpc-url $EVM_RPC_URL` → `3` | "So it is a contract with nobody to ask. No owner, no upgrade path, not even for me. Tightening is instant. Loosening waits a day." |
| 7 | 1:11 | 0:16 | Tab A → **Protect me from this** | Rest on the three rungs, then **🔒 Private trigger**. | "It proposes three levels from their own numbers. Normal, bad session, severe loss. And look at what it will not show you. The exact loss that moves you down stays private. The chain only learns which level you are on." |
| 8 | 1:27 | 0:16 | **Tab C** → *Use this protection* → Privy | Email → code → **open the address pill, show `Privy · hyperevm-testnet`, then STOP.** Do not browse the app. **[CUT the code wait]** | "Only now does it ask for a wallet, once it has earned it. I do not create one — Privy makes a self-custodial wallet in the browser, no seed phrase. And that wallet is the only address this contract takes orders from." |
| 9 | 1:43 | 0:12 | Terminal 2 | `cast tx 0x94960d1f…f889be from --rpc-url $EVM_RPC_URL` → the Privy address | "And it has already moved real money. Five dollars out of a vault, through Circle's deposit contract, into a Hyperliquid account. One transaction, signed by that wallet." |
| 10 | 1:55 | 0:08 | Tab C | Sign out → **Continue with a demo key** → paste `.shield/hyperevm-keys.json` → `authority` → Home | "Here is one I set up a week ago, so there is real history behind it." |
| 11 | 2:03 | 0:14 | Tab C, Home → **Details** → **Connected venue** | Expand it. Point at `0xE7c2…67A1`. | "That is my trading account, read live from Hyperliquid. Four dollars left. Minus one eighty-nine today, over twenty-eight fills. And my rule says one dollar." |
| 12 | 2:17 | 0:24 | Terminal 3 — **SINGLE TAKE** | `cre workflow simulate …` (below). Nitro banner + both `[USER LOG]` lines. Then `cast tx <the new verdict>`. | "What decides is a Chainlink confidential workflow, inside an AWS Nitro enclave — that is the CLI saying so. It reads my fills, compares them against my private number, and the only thing that leaves is a level. No threshold. No dollar figure. And there is the verdict, accepted on chain by a contract that can only move me down a ladder I wrote myself." |
| 13 | 2:41 | 0:20 | Terminal 4 | `curl -s localhost:8790/api/health \| jq .source` → `"substreams"`, then the flows | "Shield's memory is a Substreams package built on The Graph's ethereum-common index — I never wrote a log scanner. This is the server reading it live from a Graph provider. Ten thousand in. Fifteen hundred out. Eighty coming back. The Graph has no HyperEVM testnet, so that is a Sepolia twin of the same contract." |
| 14 | 3:01 | 0:20 | Tab C → **Add trading funds** | Opens on **Not tonight**. Scroll slowly. **Click nothing.** | "This is the moment the whole thing exists for. I am reaching for money I already decided not to risk. It does not lecture me and it does not give me a button. It shows me what I wrote, what is still protected, and when I get to decide again." |
| 15 | 3:21 | 0:12 | Terminal 1 | The refusal call (below) → `execution reverted: CooldownActive` | "And that refusal is not the app being polite. That is the contract refusing the identical call. Shield asks first so I do not pay gas to be told no." |
| 16 | 3:33 | 0:06 | Tab C | Click **I still really want to trade**, show there is no unlock, back out. | "There is no override at the end of this." |
| 17 | 3:39 | 0:10 | Tab C, Home. Still. | Nothing. | "Calm me set the limits. Tilted me cannot undo them tonight. Real contract, real account, real refusal." |

**3:49.** The replay now runs ~10s (it was 21s), so beat 2 is the replay itself
rather than a held frame. Cut order if long: 16 (-0:06), then 9 (-0:12), then 6 (-0:04).
**Never cut 1–4, 12 or 13.**

## The commands, verbatim

From the repo root, with `set -a; . ./.env; set +a` done and
`$HOME/.foundry/bin`, `$HOME/.local/bin`, `$HOME/.cre/bin` on `PATH`.

```bash
AUTHORITY=0x9872f09D96bcA7f878CEe9c4bDc8bCcA269dB006   # the demo vault
VENUE=0xE7c2Adb44064e705A2e955770440C527373967A1       # the registered trading account
```

**Beat 6 — the contract is immutable**

```bash
cast call $SHIELD_VAULT_ADDRESS "VERSION()(uint8)" --rpc-url $EVM_RPC_URL   # 3
```

**Beat 9 — the Privy wallet signed a real release**

```bash
cast tx 0x94960d1f937a3e36e1b16e69922a2579e77b584ed25b2ced044da7991fe889be from \
  --rpc-url $EVM_RPC_URL
# 0x83144b99D89947703714Ee9aA3A3614985041D2B
```

**Beat 11 — optional, the loss as the server sees it**

```bash
curl -s localhost:8788/api/vault/$AUTHORITY | jq '.assessment | {triggered, realizedLossUsdc, headline}'
```

**Beat 12 — the confidential workflow. SINGLE TAKE, and it must target the demo vault**

```bash
cre workflow simulate shield-risk --target evm-settings --non-interactive \
  --trigger-index 0 --http-payload '{"vault":"0x9872f09D96bcA7f878CEe9c4bDc8bCcA269dB006"}' \
  -R cre -e cre/.env
```

Expect the boxed "AWS Nitro in us-west-2" banner, the `[USER LOG] Enclave …`
lines, a signed verdict and `Simulation complete!`. This **arms the cooldown** —
which is what makes beats 14 and 15 work. Copy the verdict hash it prints and
show it:

```bash
cast tx <verdict-hash-from-the-simulate-output> --rpc-url $EVM_RPC_URL
```

**Beat 13 — The Graph, live**

```bash
curl -s localhost:8790/api/health | jq .source
curl -s localhost:8790/api/vault/$AUTHORITY/flows | jq '.source, [.flows[] | {kind, amount}]'
```

**Beat 15 — the contract itself refuses**

```bash
cast call $SHIELD_VAULT_ADDRESS "instantTopUp(address,uint64)" $VENUE 5000000 \
  --from $AUTHORITY --rpc-url $EVM_RPC_URL
# Error: execution reverted: CooldownActive
```

Read-only, so re-run it as often as the take needs. **Checked today: before the
beat-12 verdict lands this returns `0x` (allowed); after it lands it reverts.**
If you have 12 spare seconds, running it *before* beat 12 as well turns it into
a before-and-after and is the single most convincing pair of shots available —
allowed, enclave decides, refused.


## ⚠ The Chainlink beat is a single take

Once the enclave signs nonce 2, the demo vault is LOCKED and a second run will
correctly refuse to descend further — the enclave reports
`tierInForce=LOCKED decision=already-reduced-or-locked`, which is right, and
useless as a re-take. So:

1. Rehearse everything else first. Shoot the CRE beat when you are warm.
2. Shoot Acts 1 and 2 and the Privy beats **before** it. They do not depend on it.
3. The blocked beat at 2:45 **depends on it** — film that immediately after.

**Insurance, one command, twenty seconds.** The CRE demo vault
`0x751D1e26d79FeffE95F8a8662aB7A022780ED023` is a complete spare: $10 balance,
ladder committed, nonce 1, cooldown expired. It shares the same trading account,
so the -$1.89 loss already applies to it — its trigger is just $3.00. Tighten it
to $1 and you have a second vault you can shoot the whole Chainlink beat against
if the first take fluffs:

```bash
bun run scripts/tighten-loss-trigger.ts 0x751D1e26d79FeffE95F8a8662aB7A022780ED023 1
```

