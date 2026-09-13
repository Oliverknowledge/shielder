# D. Trader behaviour: what moments should the Risk Ladder react to?

Agent D research note, 2026-09-07. Evidence, not brainstorming. Nothing here
edits code; the measurability claims were checked live against the Hyperliquid
mainnet info API on a public address, and the code claims against
`server/behaviour.ts`, `server/hyperliquid.ts`, `cre/shield-risk/evaluate.ts`
and `docs/internal/research/01-capital-ladder-design.md`.

Frame: Shield's hard levers are (a) "no more protected capital released" (a
tier lowers the 24h release budget and the large-move gate) and (b) a cooldown
that blocks every top-up path. Shield cannot close a position, cut leverage,
or cancel an order. So the ladder is a *funding* ladder. Every trigger below is
scored on whether reacting to it with a funding lever is useful, measurable
from public data, honest, and demonstrable.

---

## 1. What the public API can actually see (measurability)

Verified against the docs and by live calls (`api.hyperliquid.xyz/info`,
2026-09-07, address `0x5078…edb6`, a public high-volume perps account chosen
only because it has a long history; nothing about it is used as evidence).

| Request | What it gives | Limits / gotchas |
|---|---|---|
| `userFills` | last 2000 fills: `coin, px, sz, side, time, startPosition, dir, closedPnl, fee, feeToken, hash, oid, tid, crossed, builderFee?, liquidation?{liquidatedUser, markPx, method}, twapId` | 2000 most recent only. `dir` values seen live: `Open Long, Open Short, Close Long, Close Short, Long > Short, Short > Long, Buy, Sell, Spot Dust Conversion`. `aggregateByTime=true` collapses partial fills from one order into one record (the analyser already uses it). |
| `userFillsByTime` | same fields, `startTime`/`endTime` in ms | 2000 per response, only the **10,000 most recent** fills are retrievable at all. A scalper's whole visible history can be days. |
| `clearinghouseState` | `marginSummary{accountValue, totalNtlPos, totalRawUsd, totalMarginUsed}`, `withdrawable`, `assetPositions[]{coin, szi, entryPx, positionValue, unrealizedPnl, returnOnEquity, liquidationPx, marginUsed, leverage{type, value}, cumFunding}`, `time` | **Now only.** No history of leverage, margin or unrealised PnL. |
| `portfolio` | per window (`day, week, month, allTime`, and `perp*` variants): `accountValueHistory[[ms, usd]]`, `pnlHistory[[ms, usd]]`, `vlm` | Bucket spacing measured live: **~15 min for `day`, ~105 min for `week`, ~7 h for `month`**. `pnlHistory` is cumulative from the window start. Deposits/withdrawals move `accountValueHistory` but not `pnlHistory`. |
| `userNonFundingLedgerUpdates` | `{time, hash, delta{type, ...}}`; types seen live: `deposit, withdraw, internalTransfer, spotTransfer, accountClassTransfer, send, rewardsClaim, vaultCreate, vaultDistribution, vaultLeaderCommission` (+ `subAccountTransfer`, `vaultDeposit`/`vaultWithdraw` per docs) | Paged at 500 per time-range response. |
| `userFunding` | funding payments `{coin, usdc, szi, fundingRate}` | Not in `closedPnl`; a carry cost the analyser ignores (small, but a held loser bleeds it). |
| `historicalOrders`, `openOrders`, `frontendOpenOrders` | order objects incl. `orderType`, `reduceOnly`, `isTrigger`, `triggerPx`, `isPositionTpsl`, status | 2000 most recent orders. No modification history, so "moved the stop" is not reconstructible; "had a TP/SL at all" and "cancelled a trigger order" are partially visible. |

Consequences for the ladder:

- **Realised PnL is first-class and exact** (`closedPnl − fee`), already the
  basis of `readVenueLoss` in `cre/shield-risk/evaluate.ts` and of
  `deriveSessions` in `server/hyperliquid.ts`.
- **Unrealised/equity is a snapshot** plus a 15-minute-bucket history for the
  last 24 h. Intraday equity peaks are approximated, not known, and older than a
  day they are lost. Any equity-based trigger is evaluated only at the moment
  the CRE workflow runs (HTTP-triggered by the server, `cre/shield-risk/main.ts`),
  not continuously.
- **Position size per trade is exact** (`sz × px` of an `Open …` fill;
  `startPosition` tells whether it is a fresh open or an add).
- **Leverage per historical trade is not exposed.** Only the current per-coin
  `leverage{type,value}`. A proxy (open notional ÷ `accountValue` from the
  nearest `accountValueHistory` bucket) is possible for the last 24 h at 15-min
  resolution and no better.
- **Liquidations are labelled** on the fill (`liquidation.method`
  `market|backstop`, `liquidatedUser`). This is a strong, honest fact the Risk
  Desk is not yet using.
- **Gap in the current analyser:** `capitalFlows()` in `server/hyperliquid.ts`
  handles `deposit, withdraw, internalTransfer, subAccountTransfer,
  spotTransfer` but not `accountClassTransfer` (spot ↔ perp, `toPerp` flag)
  or `send`. On the probed account 29 of 726 ledger entries were
  `accountClassTransfer`. For users who fund perps from a spot balance, the
  reload the product exists to catch is currently invisible. This should be
  fixed before any "reload" insight is shown on mainnet data.

Illustrative measurability check (n = 1, a whale, **not evidence**): 2000
aggregated fills over 461 days; 553 closes, of which 238 were liquidations;
longest run of losing closes 31; after a losing close the next `Open` within
60 min had median notional 52% larger than after a winning close ($1.52M vs
$1.00M, n = 107/110); median wait before the next open was 476 min after a
loss vs 12.5 min after a win; worst realised 60-minute window −$2.0M. Every one
of those sentences is computable from `userFills` alone, which is the point.

---

## 2. Evidence by phenomenon

Strength labels: **strong** (peer-reviewed, large N, replicated), **moderate**
(peer-reviewed, single dataset or lab), **thin** (small, indirect or
regulator/industry practice without outcome data), **anecdotal** (blogs,
analytics posts).

### 2.1 Risk-taking after losses ("revenge trading") — strong that it exists; the *form* varies

- Coval & Shumway (2005), *J. Finance* 60(1):1–34. CBOT proprietary traders
  with morning losses were ~16% more likely to take above-average afternoon
  risk; they "place more trades, make larger trades, and accumulate more
  inventory". Professionals, real money, intraday. This is the canonical
  citation for *size and frequency escalation after a losing morning*.
  https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1540-6261.2005.00723.x
- Heimer, Iliewa, Imas & Weber (2025), *AER* 115(1):330–363, "Dynamic
  Inconsistency in Risky Choice". eToro retail FX/CFD records (~350k traders)
  plus experiments. People *plan* a loss-exit strategy (keep going after gains,
  stop after losses) and then do the opposite: "cutting gains early and chasing
  losses". Critically for Shield: "more people accept risk when offered a
  commitment to their initial strategy." Retail, leveraged, closest population
  to Hyperliquid users. https://www.aeaweb.org/articles?id=10.1257/aer.20210307
  (working paper: https://www.nber.org/papers/w30910)
- Imas (2016), *AER* 106(8):2086–2109, "The Realization Effect". After a
  **realised** loss people become risk-averse; after the same loss left **on
  paper** they take *more* risk. Reconciles the literature and matters for the
  trigger choice: the dangerous window is while the loss is still open
  (equity drawdown), and realisation is itself a circuit-breaker.
  https://www.aeaweb.org/articles?id=10.1257/aer.20140386
- Thaler & Johnson (1990), *Mgmt Sci* 36(6):643–660: "house money effect"
  (risk-seeking after prior gains) and "break-even effect" (after prior
  losses, gambles offering a chance to get back to zero are especially
  attractive). Lab, real money. https://pubsonline.informs.org/doi/abs/10.1287/mnsc.36.6.643
- Xu & Harvey (2014), *Cognition* 131(2):173–180: 565,915 online sports bets,
  776 gamblers. After losses, bettors chose *riskier* odds (gambler's fallacy),
  which made them more likely to lose again; winners chose safer odds.
  https://www.sciencedirect.com/science/article/pii/S0010027714000031
- Zhang, Rights, Deng, Lesch & Clark (2024), *Sci. Reports*, "Within-session
  chasing of losses and wins in an online eCasino" (BC, Canada, bet-level
  data). Gamblers "bet more and played longer sessions after immediate losses,
  but they bet less and played shorter sessions when losing cumulatively"; after
  wins they bet more after both immediate and cumulative wins. So *immediate*
  loss → escalation; *deep cumulative* loss → contraction (often because the
  money is gone). https://www.nature.com/articles/s41598-024-70738-3
- Locke & Mann (2005), *JFE* 76(2):401–444: 330 CME floor traders; all hold
  losers longer than winners, the least successful hold them longest.
  https://www.sciencedirect.com/science/article/abs/pii/S0304405X0400203X
- Odean (1998), *J. Finance* 53(5):1775–1798: disposition effect in 10,000
  retail accounts (1.5–2× more likely to sell winners than losers). Relevant
  because a realised-only trigger can be *gamed by not closing*.
  https://onlinelibrary.wiley.com/doi/abs/10.1111/0022-1082.00072

### 2.2 Reloads / deposit velocity — strong, and the best-validated marker of harm in account data

- Auer & Griffiths (2023), *J. Gambling Studies* 39(4):1547–1561, doi
  10.1007/s10899-022-10144-4. N = 16,771 online casino players (UK/ES/SE),
  December 2021, five operationalisations of chasing. Definitions: sessions =
  wagers ≤15 min apart; within-session chasing = Spearman correlation of stake
  vs. wager index within session; across-session chasing = correlation of
  session loss with next session's stake (pairs within 24 h); across-days
  chasing = same at day level; account depletion = % sessions ending with
  < €5; **frequent session depositing = % of sessions with more than one
  deposit**. Result: "frequent session depositing reflected chasing losses
  better than any of the other four". High-risk players averaged 39 sessions
  /month vs 20 for low-risk, and more deposits.
  https://pmc.ncbi.nlm.nih.gov/articles/PMC10628006/
- Luquiens et al. (2016), cited in the above: among online poker players,
  "depositing at least three times in a 12-hour period" was one of the
  strongest PGSI risk factors, alongside >60 sessions/30 days.
- Braverman & Shaffer (2012), *Eur. J. Public Health* 22(2):273–278. First
  month of live-action internet betting: the high-risk subgroup was "frequent
  and intensive betting combined with high variability across wager amount
  and an increasing wager size"; 73% of that subgroup later closed their
  account for gambling problems. https://academic.oup.com/eurpub/article/22/2/273/508362
- UK Gambling Commission customer-interaction guidance (formal, 2022+):
  required indicator categories include "frequency of deposits, time of day,
  and escalation in deposit levels", "chasing losses and erratic betting", and
  "failed deposits, multiple payment methods".
  https://www.gamblingcommission.gov.uk/guidance/customer-interaction-guidance-for-remote-gambling-licensees-formal-guidance/requirement-12-customer-interaction-guidance-for-remote-gambling-licensees
- Shield's own `reloadsAfterLoss7d` (3 h window, `server/behaviour.ts`) and
  `reloadsAfterLoss` (deposit while session PnL < 0, `server/hyperliquid.ts`)
  are already the right shape; the literature's numbers are "≥2 deposits in a
  session" and "≥3 in 12 h".

### 2.3 Overtrading / frequency — strong for cost, moderate for after-loss escalation

- Barber & Odean (2000), *J. Finance* 55(2):773–806: 66,465 households; the
  most active quintile earned 11.4% vs 17.9% market. Barber & Odean (2001),
  *QJE* 116(1):261–292: men trade 45% more and earn 1.4 pp less.
  https://onlinelibrary.wiley.com/doi/abs/10.1111/0022-1082.00226
- Coval & Shumway (above): more trades after morning losses.
- Hasso, Pelster & Breitmayer (2019), *J. Behav. Exp. Finance* 23:64–74:
  465,926 brokerage accounts; crypto traders trade more frequently and more
  speculatively and earn less; taking up crypto trading raised leverage use and
  trading intensity in their stock trading too.
  https://www.sciencedirect.com/science/article/abs/pii/S2214635018302806
- Caveat specific to Hyperliquid: many accounts are API/bot-driven; fill counts
  are not decision counts. Frequency must be judged against the account's own
  baseline, never an absolute.

### 2.4 Leverage and crypto specifically — moderate; almost no perp-DEX behavioural data

- Heimer & Imas (2022), *RFS* 35(4):1643–1690, "Biased by Choice": the 2010
  US CFTC leverage cap on retail FX *improved* trader returns by cutting the
  disposition effect; constraints reduce mistakes. Direct support for a
  self-imposed funding constraint. https://academic.oup.com/rfs/article-abstract/35/4/1643/6308957
- Cheng, Deng, Wang & Yu (2021), *Applied Economics* 53(47): BitMEX
  perpetuals; daily forced liquidations 3.51% (long) / 1.89% (short) of open
  interest, and "investors who experience forced liquidation trade aggressively
  with average leverage of 60X". https://arxiv.org/abs/2102.04591
- Liu & Tsyvinski (2021), *RFS* 34(6):2689–2727: crypto returns are lottery-like
  (positive skew), which the lottery-preference literature ties to overtrading
  and leverage. https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3226952
- Mills & Nower (2019), *Addictive Behaviors* 92:136–140 and Delfabbro, King &
  Williams (2021), *J. Behav. Addictions* 10(2): crypto trading intensity is
  predicted by problem-gambling severity. Survey evidence, not account data.
- ESMA (2018) product intervention: national regulators found 74–89% of
  retail CFD accounts lose; cap on crypto CFD leverage set at 2:1.
  https://www.esma.europa.eu/press-news/esma-news/esma-agrees-prohibit-binary-options-and-restrict-cfds-protect-retail-investors
- **Anecdotal:** analytics posts claim 75–86% of Hyperliquid addresses are net
  losers (e.g. https://beincrypto.com/hyperliquid-traders-profitability/,
  https://www.techflowpost.com/en-US/article/31657). Directionally consistent
  with ESMA, but not citable as evidence in judge-facing material.
- **No peer-reviewed study of loss-chasing on a perp DEX was found.** Claims
  about "how Hyperliquid traders behave after losses" must be labelled as
  extrapolation from FX/CFD, prop-desk and gambling data.

### 2.5 Precommitment and how professionals do it — strong on shape, weak on outcomes

- Already in `docs/JUDGE_QA.md`: Marionneau et al. 2025 (tighten-fast /
  loosen-slow across 30 countries), UK RTS 12D (24 h + positive reconfirmation
  to raise a limit; reductions immediate), John 2020 (penalty-backed contracts
  → 55% default), Beshears et al. (illiquid commitment attracts the most
  money), Ivanova et al. 2019 (deposit-limit prompt raised uptake 6.5→45% but
  "did not affect subsequent net loss"; those who later raised limits lost
  more). Nothing found since changes that picture.
- UK LCCP 3.3.4: operators must offer a time-out of "24 hours, one week, one
  month or such other period as the customer may reasonably request, up to a
  maximum of 6 weeks". https://www.gamblingcommission.gov.uk/licensees-and-businesses/lccp/condition/3-3-4-remote-time-out-facility
- Binance Futures "Cooling-off Period" (support article
  ad7fd07f63a64954a6d6e9257d16adcc; page is geo-gated from the UK, details per
  Binance's published summary): user-set 1 day / 1 week / 1 month; disables new
  futures orders across web, app and API; **cannot be lifted early**; reduce-only
  orders still allowed. This is the closest exchange-side analogue and its
  design choices (no early exit, reduce-only permitted) are the ones to copy if
  a venue-side lever ever exists.
- FTMO Maximum Daily Loss (academy.ftmo.com): 5% of initial capital,
  recomputed at midnight CE(S)T, "based on equity, not only on closed results…
  includes… the floating P/L of open positions"; breach = account fails.
  Maximum overall loss 10%. https://academy.ftmo.com/lesson/maximum-daily-loss/
- Topstep: trailing Maximum Loss Limit off the highest end-of-day balance,
  checked live (unrealised counts); optional Daily Loss Limit — on hit, "open
  positions are flattened", "pending orders are canceled", "no new trades until
  5 PM CT next session". https://help.topstep.com/en/articles/10490293-topstepx-trailing-personal-daily-loss-limit
- Apex consistency rule (best day ≤ 30–50% of total profit) exists but targets
  payout gaming, not tilt; not relevant to the ladder.
- Prop-desk practice generally: daily loss limit → flat for the day; max
  drawdown → account closed; both are *equity* measures with a *next-session
  reset*. Note that every professional rule resets on a clock. A ladder whose
  lower rungs never reset (see `01-capital-ladder-design.md` rule 4) is stricter
  than any prop firm and will read as punishment, which Ivanova's finding says
  drives limit-raising.

### 2.6 Loss velocity, consecutive losses, giveback — thin

- Loss velocity: no study operationalises "$ per N minutes" for traders.
  Nearest support is Braverman & Shaffer's "intensity" marker and Zhang et al.'s
  immediate-loss escalation. Practitioner rules ("stop after losing X in an
  hour") are common but undocumented. **Thin.**
- Consecutive losses: Xu & Harvey show worse choices *after* losses, but
  streak-count rules ("3 in a row → stop") have no outcome evidence; Salaghe et
  al. (cited in Zhang et al.) found slot gamblers did *not* change stake within
  losing streaks. For a 45%-win-rate scalper, 5 losses in a row happens ~5% of
  the time by chance. **Thin, and high false-positive.**
- Peak-profit giveback: supported indirectly by house-money (Thaler &
  Johnson), by "cut gains early / chase losses" (Heimer et al.), and by the
  industry's trailing drawdown (Topstep). No paper isolates "gave back X% of
  peak" as a predictor. **Moderate as a mechanism, thin as a threshold.**

---

## 3. Trigger scoring

Scales 1–10. FP = false-positive risk, 10 = low risk. ENF = what Shield's
funding lever can actually do about it. Session = cluster of fills/flows with
no gap > 6 h (`SESSION_GAP_MS`, `server/hyperliquid.ts`), unless stated.

| # | Trigger | User value | Measurability (field) | FP (10=low) | Enforceability | Sponsor | Demo | Sum | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Realised session drawdown (from session peak) | 9 | 10 — `userFillsByTime.closedPnl − fee`, running peak | 8 | 10 — already the verdict primitive | 8 | 9 | 54 | strong (FTMO/Topstep form; Imas; Coval-Shumway) |
| 2 | Reload after loss: count + velocity | 9 | 10 — vault flows (Substreams) + `userNonFundingLedgerUpdates` (`deposit`, `accountClassTransfer.toPerp`, `internalTransfer`, `spotTransfer`) | 7 | 10 — the lever acts on this exact action | 9 | 9 | 54 | strong (Auer & Griffiths; Luquiens; UKGC) |
| 3 | Loss velocity ($ lost in 30/60 min) | 7 | 8 — same fills, windowed sum | 5 | 7 | 6 | 7 | 40 | thin |
| 4 | Equity (unrealised) drawdown | 8 | 6 — `clearinghouseState.marginSummary.accountValue` now; `portfolio.day.accountValueHistory` ~15-min buckets, net of ledger flows | 5 | 5 — refusing a margin top-up can *cause* the liquidation | 7 | 7 | 38 | strong that paper losses are the risk window (Imas), weak as a funding trigger |
| 5 | Peak-profit giveback (ratio) | 7 | 8 — running max of cumulative `closedPnl − fee` in session | 4 (ratio blows up on small peaks) | 6 | 6 | 8 | 39 | moderate mechanism, thin threshold |
| 6 | Position-size escalation after losses | 8 | 7 — `Open …` fill `sz × px` vs session median; `startPosition` for adds | 5 | 5 — Shield can't block the order, only the funding behind it | 5 | 8 | 38 | strong (Coval-Shumway; Braverman; Heimer et al.) |
| 7 | Trade-frequency escalation | 6 | 8 — fills/hour vs own baseline, `aggregateByTime` | 4 (bots, TWAPs, volatility) | 4 | 5 | 6 | 33 | strong that it costs; moderate after-loss |
| 8 | Consecutive losing closes | 6 | 7 — closes (`dir` Close/flip) with `closedPnl − fee < 0` | 3 | 6 | 4 | 6 | 32 | thin |
| 9 | Leverage escalation after losses | 7 | 4 — only current `assetPositions[].leverage`; no history | 4 | 3 | 4 | 5 | 27 | moderate (Cheng et al.), not measurable historically |

---

## 4. Definitions precise enough to implement

Common: all money in USD from the venue's own fields; `pnl(fill) = closedPnl −
fee`; `close` = fill whose `dir` starts with `Close` or contains `>`; `open` =
`dir` starts with `Open` or `>` (the flip both closes and opens). Use
`aggregateByTime: true`. Evaluate whenever the CRE workflow runs (server
trigger); the ladder is a step function of the latest evaluation, not a
stream.

**Session.** Events = fills ∪ capital flows (in/out). A session opens at the
first event after ≥ 6 h of silence and closes after 6 h of silence. (Keep this
identical to `deriveSessions` so the Risk Desk and the ladder agree.) For the
enclave, "session" may be approximated by the rolling 24 h window it already
reads; say so in the evidence bundle.

**T1. Session realised drawdown (trailing).**
`cum(t) = Σ pnl(fill) for fills in session up to t`; `peak(t) = max(0, max
cum(s) for s ≤ t)`; `drawdown(t) = peak(t) − cum(t)` (≥ 0). Threshold form:
absolute USD per tier, user-set while calm, each tier strictly larger:
`CAUTION ≥ D1`, `DEFENSIVE ≥ D2`, `STOP ≥ D3`. With `peak ≥ 0` this equals
plain net loss when the session never went positive, and equals giveback when
it did (start $1,500 → peak +$1,000 → now +$550 gives `drawdown = $450`).
Resets when the session ends. Suggested defaults for the UI, expressed as a
share of `typicalSessionSize` (median deployed): D1 = 10%, D2 = 20%, D3 =
the existing `lossTriggerUsdc`. For on-chain continuity, keep `STOP` on the
existing net-24h `realizedLossUsdc` semantics and attest `drawdownUsdc`
separately for the lower rungs.

**T2. Reload after loss.**
`reload` = any inbound capital event to the execution account (vault top-up
seen by Substreams, or ledger `deposit` / `accountClassTransfer{toPerp:true}`
/ inbound `internalTransfer` / `spotTransfer` / `subAccountTransfer`) that is
not the first inbound event of the session. `reloadAfterLoss` = a reload with
`drawdown(t) > 0` at its time, or within 3 h of a losing close
(`RELOAD_WINDOW_SECS`). Threshold form: count within the session and within
24 h. `CAUTION`: 1 reloadAfterLoss. `DEFENSIVE`: 2 in 24 h (Auer & Griffiths'
">1 deposit per session" is the harm marker; Luquiens' "≥3 in 12 h" is the
strong form). Velocity variant for the Risk Desk only: reloads per hour.
Resets with the 24 h window. This is the trigger the lever is *for*: the
tier it selects lowers the very budget the next reload would draw on.

**T3. Loss velocity (accelerator on T1).**
`v30 = −min(0, Σ pnl over the trailing 30 min)`. Fires `CAUTION` immediately if
`v30 ≥ 0.5 × D1` regardless of cumulative state; never fires higher than
`CAUTION` on its own. Exclude fills with `liquidation` set from the velocity
sum only if the position was opened before the session (otherwise a
liquidation is exactly the moment). Resets after 30 min without a losing
close. Justification is thin (Section 2.6); include only if the team wants a
"fast tilt" rung, and say it is a heuristic.

**T4. Equity drawdown (signal, not a rung).**
`eq = accountValue` from `clearinghouseState` at evaluation; `eqPeak` = max of
`portfolio.day.accountValueHistory` values since session open, corrected by
subtracting inbound and adding outbound ledger flows after the peak.
`eqDD = eqPeak − eq`. Show it; let it colour `CAUTION` only when `eqDD ≥ D1`
and T1 has not yet fired; never let it move to `DEFENSIVE` or `STOP` alone,
because (i) 15-min buckets are not a peak, (ii) it fires on every normal swing
position, and (iii) the funding lever's only effect on an open loser is to
deny margin, which is the one action that can convert a drawdown into a
liquidation. The user's floor already protects the floor; the ladder does not
need to.

**Not rungs (Risk Desk only):** size escalation (median `sz × px` of opens in
the 60 min after a losing close ÷ median of opens after a winning close, ≥ 20
pairs), frequency (fills/hour in losing hours ÷ own baseline), consecutive
losing closes, liquidation count.

**Tier reset.** Trader-native rules reset on a clock (FTMO midnight; Topstep
next session). Recommendation, against `01-capital-ladder-design.md` rule 4:
`CAUTION` and `DEFENSIVE` expire automatically at the earlier of (session end
+ 6 h) or 24 h after they were set; `STOP` remains the cooldown and clears
only when it does. Without an expiry, the first false `CAUTION` will be lived
with for 24 h plus a reconfirmation, and the trader's response will be to set
D1 loose, which is the behaviour Ivanova et al. found preceded bigger losses.
"They do not automatically move back up" should apply to the *rules*, not to
the *rung*.

---

## 5. Recommended smallest set

Three conditions, in this order of importance:

1. **T1 session realised drawdown, trailing from peak** (the spine; the
   thing prop firms and pro desks actually use, in the form a trader already
   thinks in: "down $X on the day / gave back $X").
2. **T2 reload after loss** (the thing the lever can actually stop; the
   best-validated marker in account-level harm research).
3. **T3 loss velocity as a CAUTION-only accelerator** (optional; makes the
   ladder react *during* the bad twenty minutes rather than after; evidence
   thin, so label it a heuristic in the UI).

Equity drawdown is shown and may tint `CAUTION`, never more. Everything else
is Risk Desk material.

**Should peak-profit giveback be its own ladder condition? No.** Fold it into
T1 by measuring drawdown from the session's realised peak (Topstep's form)
instead of from session start. That captures "start $1,500 → peak $2,500 →
now $2,050" as a $450 drawdown with zero extra parameters, avoids the
ratio-on-a-small-peak false positive (a $60 peak that gives back $30 is "50%
given back" and means nothing), and keeps one number the trader can check
against the venue's own PnL panel. Show the percentage in the Risk Desk
sentence ("you gave back 45% of a +$1,000 peak"); do not put a percentage in
the rule.

---

## 6. Risk Desk insight sentences

### Supported by the public API today (or with the `accountClassTransfer` fix)

Existing in `summarise()` and sound:
- "K of your L largest losing sessions involved another reload."
- "You added more money while already down in N of M sessions."
- "Your typical session deploys $X. Your largest losing session cost $Y."
- "Median time from first loss to reload: X minutes." (field exists, not yet surfaced)

New, computable from `userFills` / ledger only, with the minimum-N guard in parentheses:
- "After a losing close, your next position was on median X% larger than after a winning close." (≥ 20 pairs each side; opens within 60 min)
- "Your worst hour: −$X on <date>." (any history)
- "N of your losing sessions ended in a liquidation." (`liquidation` field; ≥ 1)
- "Your biggest giveback: +$P at <time>, ended the session at −$Q." (running peak; ≥ 1 session with peak > 0)
- "Longest run of losing closes: N, on <date>." (state plainly; do not interpret)
- "You closed N trades in your losing hours vs M per hour normally." (≥ 5 sessions; caveat: "fills, which may include automated orders")
- "Deposited $X in total; withdrawn $Y; realised −$Z on the venue." (ledger + fills)
- "Most of your losing sessions started after <hour> UTC." (timestamps; ≥ 8 losing sessions; do not infer tiredness)

### Cannot be supported — never say these

- Anything about **leverage you used on past trades** ("you went to 40× after
  losing"): only current leverage is exposed.
- **Intraday equity peaks or unrealised drawdown older than 24 h**, or finer
  than ~15 min inside 24 h ("you were up $3,000 at 14:07").
- "You **moved / removed your stop-loss**": no order-modification history;
  only 2000 most recent orders; TP/SL intent is not reliably reconstructible.
- "You **revenge traded within N seconds**" for **accounts with > 10,000
  fills** in the window or where the 2000-fill cap truncates the session;
  state the coverage ("based on your last 2000 fills, covering D days").
- Any **emotion, intent or fatigue** claim ("tilted", "tired", "angry");
  any **screen time / app opens**; anything about **other venues** or CEX
  accounts; anything about **sub-accounts** not explicitly analysed.
- **Funding payments** as part of "realised loss" unless `userFunding` is
  added (small, but a held loser bleeds it; today it is silently excluded).
- Reload insights on mainnet **until `accountClassTransfer`/`send` are
  handled** in `capitalFlows()`; until then, "you never reloaded" can be
  false for a spot-funded account.

---

## 7. Honest caveats for judge-facing copy

- No study shows a funding ladder changes trader outcomes; the largest RCT of
  deposit limits (Ivanova 2019) found no effect on net loss. The defensible
  claim is: the *shape* (tighten instantly, loosen slowly, no forfeit) matches
  regulators and the commitment literature; the *triggers* match what
  professional desks and harm-detection research actually use (equity/realised
  daily loss, deposit frequency); and Heimer et al. (2025) show traders will
  *accept* commitment to a plan they know they break.
- No peer-reviewed behavioural data exists for perp DEX users. Every
  "Hyperliquid traders do X" is extrapolation from FX/CFD, prop and gambling
  data, or from analytics blogs.
- Realised-only triggers can be gamed by not closing (disposition effect).
  That is why equity is shown; it is not a rung because the lever cannot help
  an open loser without risking harm.
- The ladder acts on funding, not on trades. Once capital is at the venue,
  Shield's only remaining influence is what it *doesn't* send next.
