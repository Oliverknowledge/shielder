# I. The 36 seconds: what makes a judge say "wait, the permission actually changed"

Agent I, 2026-09-07. Reviewer: an ETHGlobal finalist judge, 300 videos deep, who no
longer believes any screen that turns red. Inputs: `02-synthesis.md`, `H-product-designer.md`,
`F-chainlink-judge.md` §2/§4/§6, `E-graph-judge.md` §4, `docs/DEMO_SCRIPT.md`,
`docs/evidence/cre-simulate.txt`, `docs/internal/gauntlet/FACTS.md`, the live app on
`localhost:5174` (signed in as the `0x9872…B006` demo vault, currently in a verdict cooldown),
`contracts/src/ShieldVault.sol` as it sits in the working tree **right now** (the v3 ladder is
being written: `commitLadder`, `RiskVerdict.tier`, `RiskTierChanged`, `_effectiveVelocity`,
`contracts/test/Ladder.t.sol` with 15 tests), and live `cast`/`substreams` calls against
HyperEVM testnet 998 and Sepolia 11155111. Read-only; nothing but this file was written.

## 0. Verdict first

**Choose candidate 2, the REDUCED rung, and build the beat around one artefact: the identical
`eth_call`, run twice, with one verdict receipt between the two runs.** Before the verdict the
call returns `0x` (the contract would execute it). After the verdict the *same line, recalled
with the up-arrow*, returns `execution reverted: VelocityThresholdExceeded`. A third call for a
smaller amount returns `0x` again. That is a permission that changed *shape*, not a switch that
flipped, and nothing on screen is UI state: it is the contract answering the same question
differently because a rule the trader wrote earlier was applied by a signer the trader pinned.

What makes a judge sit up is not the red screen. It is **the same command giving a different
answer**, and the smaller amount still passing. A wall ("CooldownActive") reads as a rate limit;
a proportional cut reads as a policy. Every one of the 300 videos I watched this week had a
wall. None had the second, smaller call succeed.

The existing cooldown beat (candidate 1) is the fallback and it is a good one: keep it filmed
and ready. The morning-after beat (candidate 3) is a five-second coda, not a beat.

The Sepolia rows do **not** belong in these 36 seconds. They are a different chain, a different
vault and a different sponsor, and "which chain am I looking at?" is the one question that
kills a 36-second beat. They get their own 15 seconds elsewhere (§6).

## 1. What "the permission changed" has to mean on camera

A judge who has seen 300 demos discounts everything that a frontend could have rendered from
local state. The only things that survive that discount:

| Artefact | Why it survives | Cost on camera |
|---|---|---|
| **The same `eth_call`, before and after, different result** | Same calldata, same `--from`, same contract, no UI in the loop; the only thing that changed is chain state | 2 × ~1 s, free, repeatable per take |
| A verdict **receipt** (`status 1`, `to` = vault, `from` = relayer) | Proves a transaction landed between the two calls | ~1 s; but its logs are raw hex and unreadable at 720p |
| A **state read** before/after (`currentTier` 0 → 1, `effectiveVelocityThreshold` 1200… → 750…) | Names the exact field that moved | 2 × ~1 s; small integers are legible |
| A **failed transaction on chain** (the app's demo-key path lands the rejected `instantTopUp`, status 0, and shows the hash) | Strongest for the "not just a simulation" objection | Costs a real tx and ~2 s; keep as the app's proof line, not the hero |

Everything else in the current app (the red pill, "Not tonight.", the countdown) is a
*rendering* of the above and must be shown only *after* the chain has spoken, never instead of
it.

Order of checks in `instantTopUp` (working tree, `ShieldVault.sol` ~L550): registry →
`CooldownActive` → floor → `_rollBuckets` → `VelocityThresholdExceeded` (against
`_effectiveVelocity`, i.e. the REDUCED allowance when the rung is REDUCED) → large-move gate.
So a REDUCED vault with no cooldown reverts on **velocity**, and only on velocity, which is
exactly the proportional refusal we want. If a cooldown were armed too, the revert would be
`CooldownActive` and the proportional story would be invisible. **REDUCED must not arm a
cooldown in the demo vault**, and it does not in the current code (only `TIER_LOCKED` touches
`cooldownUntil`).

Selectors, verified with `cast sig`: `CooldownActive()` = `0xaa9a98df`,
`VelocityThresholdExceeded()` = `0x54debb02`. `cast call` prints the name, not the selector,
when the ABI is known locally; the JSON form prints both. Print the name on camera.

## 2. The three candidates

### Candidate 1: the existing cooldown beat (LOCKED), filmable today

What exists: vault `0x751D…` and the demo vault `0x9872…` are both on v2 in a 12 h
`RISK_VERDICT` cooldown (`0x9872…` until Tue 00:20, verdict #3, $7.35 attested). The
`cast call instantTopUp … --from $ME` → `CooldownActive` line is real and I re-ran it today.
The block screen ("Not tonight.") is live in the app.

Shot list (32 s):

| t | Screen | Legible | Say |
|---|---|---|---|
| 0–5 | Terminal | `cast call $V "instantTopUp(address,uint64)" $HL 5000000 --from $ME` → `0x` | "Before the session: the vault will release $5 to my Hyperliquid account. `0x` is the contract saying yes." |
| 5–11 | Terminal → app venue panel | last line of `hyperevm-losing-trade.ts`: `venue realised PnL (closedPnl - fees): $-7.12`; app: **Session result 24h −$7.12** | "Real trades on Hyperliquid testnet, and they lose. Hyperliquid settled that number, not Shield." |
| 11–22 | Terminal | `cre workflow simulate …` TEE banner, `[USER LOG] … realisedLoss24h=7119301 trigger=3000000 … triggered=true`, `Verdict #1 relayed on-chain: 0xa02e…` | "A Chainlink confidential workflow reads the venue, decides inside the enclave, and signs with a key only the enclave holds." |
| 22–27 | Terminal | up-arrow, the identical call → `execution reverted: CooldownActive` | "Same call. The contract now says no." |
| 27–32 | App Home | pill **New capital paused**; strip "No new trading capital until … · what is already in Hyperliquid is still yours to trade" | "The app is just reading the chain. Trading is untouched; the reload is gone until tomorrow." |

Artefact: the identical-call pair with `CooldownActive`, plus `cast tx 0xa02e… to/chainId/blockNumber`.

Weaknesses a judge sees: it is a wall, so it looks like every rate limiter; there is no
proportionality; the confidential input is only the signing key (F §6 calls this "a
second-place video"). The `[USER LOG]` prints dollars and the public trigger, so "private
rules" cannot be claimed. Also, each take needs a vault whose `cooldownUntil` is in the past
and whose verdict nonce is fresh: **the two current vaults cannot film the "before" call
until Tue 00:20**, so a fresh vault per take is required regardless.

### Candidate 2: the REDUCED rung, proportional refusal (the ladder being built this week)

What exists as of this pass, in the working tree: v3 `ShieldVault.sol` with
`commitLadder(ladderHash, reducedVelocityThreshold, tierResetSecs)`, `RiskVerdict{…, tier,
ladderHash, …}`, `applyRiskVerdict` that accepts `TIER_REDUCED` only against the committed
`ladderHash` and `TIER_LOCKED` only above the public `lossTriggerUsdc`, `currentTier()`,
`effectiveVelocityThreshold()`, `RiskTierChanged`, and `Ladder.t.sol` including
`test_reducedVerdictLowersTheBudgetProportionally` and `test_reducedThenSmallerReleaseStillFits`,
which are literally the two shots below. Not yet there (grep found no `tier` in `cre/`,
`server/` or `app/src/lib/`): the CRE evaluation producing a tier verdict, the relayer accepting
the v3 shape, the app committing a ladder and rendering a rung. Not yet deployed: v3 on 998.

Full shot list in §3. Artefact: identical `eth_call` pair (`0x` → `VelocityThresholdExceeded`)
with a third, smaller call returning `0x`, bracketed by `currentTier` 0 → 1.

Why it wins: the change is *visibly rule-shaped* ("$500 no, $200 yes"); the chain learned the
rung, not the rule (a real confidential input, F §4); the same 36 seconds carries Chainlink
(banner + a `[USER LOG]` that prints no dollars), the contract, and the Privy address pill in
the app frame. It is also the beat H's trader would recognise ("down $162 from peak, reload's
now $100. Fair, I wrote that").

Risks: a v3 deploy plus CRE typehash plus relayer plus app is 1.5–2 days (F §2 estimate) and
it is the third deploy in three days. If any link is missing on film day, fall back to
candidate 1 without changing the shot grammar (the identical-call pair works for both).

### Candidate 3: the morning after (rung expires / reconfirm)

What exists: `tierUntil` and `_currentTier` (REDUCED expires on its own clock,
`tierResetSecs`, 1 h–7 d, default 24 h); LOCKED clears with `cooldownUntil`; moving up early
is `proposeLadderChange(resetTier=true)` + delay + reconfirm.

The honest shot is a clock passing. It cannot be filmed inside 40 seconds except as a cut
("later that day…"), and what it proves is that a restriction *lifted*, which is what every
timeout does. Its value is a single sentence of trust ("it resets on its own; only loosening a
*rule* asks me again"), and the current 3:12 beat already says that in eight seconds. Keep it
as a 4–5 s coda on the end of candidate 2 if there is room: `cast call $V "currentTier(address)(uint8)" $ME`
→ `1`, then the app strip "REDUCED · resets 12:47 tomorrow". Do not build a beat around it.

### Scores (5 = best)

| | Proof of change | Legible at 720p | Honesty | Sponsor coverage in one shot | Buildable by film day |
|---|---|---|---|---|---|
| 1. Cooldown (LOCKED) | 4: identical call, but a wall | 5: one word, `CooldownActive` | 4: fine if "Not tonight." is replaced per H §2.3 | 3: Chainlink banner + log; Privy only as the pill; Graph no | 5: exists, but needs a fresh vault per take |
| **2. REDUCED rung** | **5**: identical call refused *and* a smaller one allowed; `currentTier` 0→1 | **4**: two reverts to read; `VelocityThresholdExceeded` is 25 chars (fits at 20 pt) | **5** with the "reload allowance" wording and the F §2 privacy sentence | **5**: private input → public rung is the confidential story; contract; Privy pill | 3: v3 + CRE + relayer + app, in flight now |
| 3. Morning after | 2: a clock passed | 3 | 4 | 1 | 4: contract done, app not |

## 3. The chosen sequence: 36 seconds, one browser tab, one terminal

Screen 1280×800. Terminal at 20 pt so lines wrap at ~85 columns; every command below is
under that with the four variables exported off camera:

```bash
export PATH="$HOME/.foundry/bin:$HOME/.cre/bin:$PATH"; set -a; . ./.env; set +a
V=$SHIELD_VAULT_ADDRESS          # v3 on 998, once deployed
ME=<the take's authority>        # the vault signed into the app
HL=0xE7c2Adb44064e705A2e955770440C527373967A1   # registered trading account
R=$EVM_RPC_URL
```

Numbers for the take (see §4 for why and what they cost): vault **$2,000**, floor $1,000,
NORMAL allowance **$600/24 h**, REDUCED allowance **$350/24 h**, large-move gate 20 % ($400 at
$2,000), `tierResetSecs` 24 h. Pre-roll: one real `instantTopUp` of **$250** has already
landed (Activity row "Sent $250 to Hyperliquid"). So at t=0 the vault has $250 of $600 spent;
a second $250 fits NORMAL ($500 ≤ $600) and does not fit REDUCED ($500 > $350); an $80
release fits REDUCED ($330 ≤ $350).

If trader-sized test USDC cannot be sourced (§4), the same shape at on-hand scale is: vault
$70, floor $50, NORMAL $12, REDUCED $7, releases $5 / $5 / $1.50. Same grammar, toy numbers;
H §4 item 10 says what that costs.

| t | Screen | What is legible | Do | Say |
|---|---|---|---|---|
| 0:00–0:04 | App, Home | Address pill `0x98…B006`; tier strip **NORMAL · $350 of $600 left today**; Activity row **Sent $250 to Hyperliquid, 12:41** | Hold. Do not scroll. | "Session's on. I set the rules an hour ago while I was calm: a normal reload allowance, and a smaller one if I fall past a line only I know." |
| 0:04–0:08 | Terminal | `cast call $V "instantTopUp(address,uint64)" $HL 250000000 --from $ME --rpc-url $R` → `0x` | Type it once; it stays in history. | "Ask the contract: would it release another $250 right now? `0x` is yes." |
| 0:08–0:13 | Terminal, then app venue panel | Last line of `bun run scripts/hyperevm-losing-trade.ts`: `venue realised PnL (closedPnl - fees) since start: $-7.12`; app: **Session result 24h −$7.12** in red **[CUT the ~15 s of round trips]** | Show only the final line, then the panel. | "Then I trade, on Hyperliquid, and it goes badly. That's the venue's own settled number. Shield never saw an order." |
| 0:13–0:24 | Terminal | `cre workflow simulate shield-risk --target evm-settings --non-interactive --trigger-index 0 --http-payload '{"vault":"'$ME'"}' -R cre -e cre/.env` → the boxed **Trigger requested TEE Execution … AWS Nitro in us-west-2**, then exactly one evaluation line: `[USER LOG] Enclave evaluation: vault=0x98… tier=REDUCED ladderHash=0x4f27… nonce=1`, then `[USER LOG] Verdict #1 relayed on-chain: 0x…` | Warm compile: ~4 s. | "A Chainlink confidential workflow reads my fills, compares them to the ladder it holds as a secret, and signs a verdict with a key that never leaves it. Look at what it prints: the rung and a hash. Not my threshold." |
| 0:24–0:29 | Terminal | Up-arrow twice, **the identical line** → `Error: execution reverted: VelocityThresholdExceeded` | Re-run without editing. | "Same call, same $250. The contract now says no." |
| 0:29–0:32 | Terminal | Edit the amount to `80000000` → `0x` | | "Eighty dollars still goes. It didn't lock me out. It cut the allowance to the number I wrote." |
| 0:32–0:36 | App, Home (self-refreshes) | Strip **REDUCED since 12:47 · $100 left today · resets 12:47 tomorrow · $327 on Hyperliquid is untouched** | Hold. | "The app is reading the chain. Trading's still mine. The reload is what changed." |

Optional 4 s coda (0:36–0:40), terminal: `cast call $V "currentTier(address)(uint8)" $ME --rpc-url $R` → `1`, then
`cast call $V "effectiveVelocityThreshold(address)(uint64)" $ME --rpc-url $R` → `350000000`. Say:
"Rung one. Allowance three-fifty. Public. My threshold isn't."

Total spoken: ~110 words in 36 s. It fits.

Why these exact beats:

- 0:04 is the shot the current `DEMO_SCRIPT.md` is missing. Without the *before* call, 2:56's
  revert proves a state, not a change. Three seconds buys the whole "wait" moment.
- 0:13's log line is the Chainlink judge's 20 seconds (F §6, step 3) verbatim. The current
  `evaluate.ts` line prints `realisedLoss24h=… trigger=…`; for a REDUCED verdict it must print
  **tier, ladderHash, nonce** and no dollars, or the privacy sentence in 0:13 is false.
- 0:24 uses the shell's history on purpose. A judge trusts the up-arrow more than any script
  name: nothing was edited, nothing was substituted.
- 0:29 is the difference between a wall and a rule. Never cut it.
- 0:32 must come *after* the terminal, never before. The app is the caption, the chain is the
  evidence.

The one on-chain artefact, if only one survives the edit: **the identical-call pair at
0:04 and 0:24**. The receipt hash from the `[USER LOG]` line is the bridge between them; a
judge who wants it can `cast tx` it themselves and the README should give the command.

## 4. Pre-flight the chosen sequence needs

1. **A fresh vault per take.** Moving back up from REDUCED is a loosening (delay + reconfirm),
   so a REDUCED vault cannot be reset for take two. Init + `registerOwner` + `deposit` +
   `commitLadder` + the pre-roll $250 release is five transactions on 998 (seconds, pennies of
   HYPE). Script it (`scripts/hyperevm-bootstrap.ts` is the starting point) and run it off
   camera; the app signs in on the demo-key path with that take's key.
2. **Test USDC is the real constraint for trader-sized numbers.** On 998 today: deployer
   $2.50, trading account $1.00, Privy wallet $20, demo vault $70. Hyperliquid testnet: the
   trading account has $77.24 in perps, the deployer $4.06 in spot. A $2,000 vault needs the
   Hyperliquid testnet faucet (HyperCore) then `scripts/hyperevm-bridge.ts USDC <amount>` to
   HyperEVM. Human step, and it decides which number set in §3 you film. At on-hand scale the
   beat still proves the same thing; it just reads smaller.
3. **Monitor off.** `SHIELD_MONITOR` unset when the server starts, so the enclave is the only
   signer. If the server monitor is on it fires first, the CRE run reports `actionable:
   false`, and the flip is gone. `curl localhost:8788/api/health | jq .monitor.enabled` must
   be `false`.
4. **The loss is real and small.** `hyperevm-losing-trade.ts` produces $3–8 of realised loss
   per run (fees + spread on BTC IOC round trips from a $77 account). Set the private REDUCED
   threshold below that (it is private; nobody sees it is $5). The LOCKED rung's public
   `lossTriggerUsdc` should be above what the script can reach, so the take lands on REDUCED,
   not LOCKED, and the revert is velocity, not cooldown.
5. **Ladder in the enclave.** F §2 option A1: the plaintext ladder + salt as a Vault DON
   secret `LADDER_<vault>`, `ladderHash` committed with `commitLadder`. The enclave must refuse
   a ladder whose hash does not match chain (the contract refuses it anyway with
   `LadderMismatch`, but the log line should never print for a mismatched ladder).
6. **Relayer accepts the v3 verdict.** `server` `/api/verdicts` and `cre/shield-risk/evm-verdict.ts`
   both change `VERDICT_TYPEHASH` to the v3 string (already in the contract at L261) and carry
   `tier`/`ladderHash`. `.shield/eip712-check.ts` pattern re-verified against `hashVerdict`.
7. **App strings for the rung**, from H §2.2/§2.3: "REDUCED since 12:47 · $100 left today ·
   resets 12:47 tomorrow", block copy "Reduced. Down $7.12 from your session peak. Your rule:
   reloads drop to $350." Replace "Not tonight." on the LOCKED screen with "Daily loss hit."
   and cut the 10-second ring. None of these are needed for the chain proof; all of them are
   needed so a judge who reads the frame does not read "parental".
8. **Warm everything** exactly as `DEMO_SCRIPT.md` pre-flight §4 says: the CRE compile is
   cached, the RPC connection is hot, the app has been on Home for two minutes.
9. **Rehearse the identical-call pair first.** It is free (`eth_call`), and if it does not
   flip, nothing else in the beat matters.

## 5. What must not be shown or said

- No rung name that is trading vocabulary. NORMAL / REDUCED / LOCKED only; never CAUTION,
  DEFENSIVE, STOP, "risk tier: RED". A rung name on screen without a `cast call` behind it in
  the same beat is a UI state and a judge scores it as one.
- Never "your permissions changed", "your session key expired", "Shield stopped the trade",
  "signing authority ratchets down". The sentence is: *the protected capital the trading
  account can draw on* changed. The venue panel's "$327 on Hyperliquid is untouched" line
  stays in frame at 0:32 for exactly this reason.
- No Privy session signer, policy or quorum anywhere in the beat (02 §1, FACTS: not used and
  must not be claimed). The Privy beat is the sign-in and the address pill; that is enough.
- Do not show the `getVault` tuple. It is 24 fields of integers and it is unreadable at 720p.
  `currentTier` and `effectiveVelocityThreshold` are the reads that fit on one line.
- Do not show a receipt's `logs` array. Show `cast tx <hash> to chainId blockNumber` or nothing.
- Do not print the private threshold anywhere: not in the `[USER LOG]`, not in the app strip
  during the take. The app may show the *drawdown* ($7.12) and the *allowance* ($350); the
  line the drawdown crossed stays off screen. If it appears, the privacy sentence is a lie.
- Do not say "enclave" without the qualifier the simulator prints itself: it is a Chainlink
  confidential workflow targeting AWS Nitro; the simulator is not a real TEE
  (`cre-simulate.txt` header). "Runs in a Chainlink confidential workflow" is accurate.
- Do not show the losing trades themselves. Fifteen seconds of IOC fills is noise; the final
  line and the venue panel's red number are the evidence.
- Do not show the block screen *before* the terminal has refused. The order is chain, then app.
- Do not put the Sepolia rows, the substreams `gui`, or any second chain inside these 36 s.
- Do not show the negative control (secret replaced by `0xdeadbeef`). It belongs in the
  evidence file, not the video (E §4 says the same about its own negative control).

## 6. The Sepolia rows: elsewhere, and 15 seconds

Verified today: the Sepolia twin streams **three real rows** for the demo vault from both
`sepolia.eth.streamingfast.io:443` and `sepolia.substreams.pinax.network:443` with the shared
JWT: `DEPOSIT 10000000000` (block 11653919), `TOP_UP_INSTANT 1500000000 … counterpartyIsExecution: true`
(11653920), `DEPOSIT 80000000` from the trading wallet (11653923). Manifest
`substreams-evm/substreams.sepolia.yaml`, package `shield-evm-behavioral-memory-sepolia-v0.1.0.spkg`,
`initialBlock 11653907`. The tight, warm command for camera:

```bash
cd substreams-evm && substreams run shield-evm-behavioral-memory-sepolia-v0.1.0.spkg \
  map_vault_flows -e sepolia.substreams.pinax.network:443 -s 11653915 -t +10 -o jsonl
```

That is the Graph judge's beat (E §4, 0–6 s) and it replaces the current 2:14 "zero rows, here
is why" anti-demo. It does not belong in the wow beat, for three reasons:

1. It is chain 11155111 and vault balance $10,000; the wow beat is chain 998 and a $2,000 (or
   $70) vault. Two chains in 36 seconds makes the judge audit instead of watch.
2. It cannot honestly feed the verdict. On 998 the server reads logs itself
   (`source.mode: "rpc"`), and the enclave reads flows from Shield's API and the loss from
   Hyperliquid. E §4's line "the verdict read that row" is false for the vault that gets the
   verdict, and must not be spoken. Say instead: "Same package, same proto, on a chain The
   Graph indexes. On HyperEVM mainnet this is what the vault's memory looks like."
3. Do not move the wow beat to Sepolia to fix (2). Sepolia has no Hyperliquid venue; the
   release goes to an EVM address, the loss cannot be real, and the whole credibility of the
   beat is that the loss is the venue's own number.

Place the Sepolia beat *before* the wow beat, as the memory layer ("this is what Shield
remembers"), 12–15 s, then cut to 998 and say the chain name once on the way in.

## 7. If v3 is not on 998 by film day

Film candidate 1 with the identical-call pair: `cast call … 5000000 --from $ME` → `0x`
(0:04), real loss, CRE run with `realisedLoss24h=… triggered=true`, up-arrow → `CooldownActive`,
app strip. It needs a fresh v2 vault per take (both current v2 vaults are in cooldown until
Tue 00:20 with nonces consumed). Say "the confidential input is the signing key" and nothing
about private thresholds. Keep 0:29's smaller-amount call out (it would also revert
`CooldownActive`, which is the wall the beat is trying not to be).

## 8. Summary for the parent agent

- Chosen: candidate 2, the REDUCED rung, 36 s, chain 998, one vault, one terminal, one tab.
- Hero artefact: the identical `cast call instantTopUp` recalled with the up-arrow, `0x` before
  the verdict, `VelocityThresholdExceeded` after, and a smaller amount returning `0x`; bracketed
  by `currentTier` 0 → 1 and `effectiveVelocityThreshold` if there is room.
- Shot list: app strip NORMAL (4 s) → `0x` (4 s) → venue loss line + red panel (5 s) → CRE
  banner + `[USER LOG] tier=REDUCED ladderHash=… nonce=1` + relay hash (11 s) → identical call
  refused (5 s) → $80 allowed (3 s) → app strip REDUCED with the untouched-bankroll line (4 s).
- Must build this week: CRE tier verdict with a no-dollars log line, relayer for the v3 shape,
  app ladder commit + rung strip + H's copy, per-take fresh-vault script, test USDC via the
  Hyperliquid faucet and `hyperevm-bridge.ts`. The contract and its 15 ladder tests are already
  in the working tree.
- Fallback: candidate 1 with the same grammar (the before-call is the 3 s the current script lacks).
- Sepolia rows: verified live today, three rows, both Graph endpoints; own 12–15 s beat before
  the wow beat, never inside it, and never with the sentence "the verdict read that row".
