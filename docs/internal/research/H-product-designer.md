# H. Product designer pass: would a trader configure this, and does it read as a desk or a parent?

Agent H, 2026-09-07. Reviewer: product designer for active crypto traders.
Inputs: `02-synthesis.md`, `D-trader-behaviour.md` §4–6, `01-capital-ladder-design.md`,
`F-chainlink-judge.md` §2, and the live app at `http://localhost:5174` (hyperevm-testnet,
demo key): `Setup.tsx`, `Overview.tsx`, `Protection.tsx`, `TopUp.tsx`, `Behaviour.tsx`,
`components/Safety.tsx`, `styles.css`. Read-only; nothing but this file was written.

The user in my head: 19, on Hyperliquid daily, has passed or failed at least one prop-firm
challenge, keeps a Notion journal with a "max daily loss" row he does not obey, has blown
one account, and reads any product copy for the tell that it thinks he is a child.

## 0. Verdict first

**The primitive is professional. The proposal is professional if it is named like a
prop-desk rule sheet. The current app tips parental in four specific places, and the
proposal as drafted adds two more.** Nothing in the on-chain mechanics is the problem:
"tighten instantly, loosen slowly, the verifier can only move you down, the deepest rung is
checkable against a public number" is exactly the FTMO / Topstep shape every trader in this
segment already knows and respects. Nobody calls a Topstep daily loss limit parental. The
difference between a desk rule and a parental control is entirely in (a) whose vocabulary
the rule is written in and (b) whether the app ever comments on the trader's *state*
rather than on *numbers*.

Where the current app is a desk: `Protection.tsx` ("Tighten instantly. Loosen slowly.",
rules as first-person sentences), the Home status pill "Within your plan", the legend
"Locked for now", the Behaviour page's numbers-only voice, the one line the app says
everywhere that must survive: *"What is already in Hyperliquid is still yours to trade."*

Where the current app is a parent:

1. **"Not tonight."** (`TopUp.tsx`) with "You decided this before you started trading."
   It is a good line for a landing page and a bad line at the moment of use: it is what a
   parent says. A trader's own playbook says "Daily loss hit." or "Flat on funding."
2. **The 10-second reset ring** (`Safety.tsx` `ResetScreen`): "Your money will still be
   here in 8 seconds." That is Screen Time. The button that opens it, "I still really want
   to trade", puts words in his mouth. Cut or turn into a plain facts card with no timer.
3. **"What do you want Shield to stop?"** (`Setup.tsx` step 1) and the trouble chips:
   "Late-night trading: my worst decisions happen when I'm tired." D §6 says never infer
   tiredness; the onboarding does it in the trader's own voice, which is worse. The Risk
   Desk (data sentences) replaces this step entirely.
4. **"Shield held the line."** (`Overview.tsx` morning section). Heroic. The desk version
   is a stat row: "Blocked 2 reloads, $600. Session −$412."

The proposal adds: **"CAUTION / DEFENSIVE"** (road signs, and "defensive" implies position
management Shield cannot do) and **"Start protected session"** (implies the trading is
protected; only the funding is).

Fix the vocabulary and the shape holds. Details below.

## 1. The flow, step by step

Rating: **do** = would do it unprompted; **skip** = would leave it blank/default and move on;
**churn** = would close the tab or never come back. Quote is what he would say.

| # | Step | Rating | What he says |
|---|---|---|---|
| 1 | Connect Hyperliquid (paste address) | **do** | "It's public anyway. Read-only, no signature, fine." Zero cost, and the address is the same one he screenshots. |
| 2 | "We found something" | **do**, churn if wrong | "3 of my 5 worst sessions had a second deposit. Yeah." One concrete number about *him* is the hook; it is the only moment the product proves it read his account. Churns instantly on a wrong sentence: the `accountClassTransfer` gap (D §1) makes "you never reloaded" false for spot-funded accounts, and a scalper with >2000 fills gets a truncated history. State the coverage ("last 2000 fills, 11 days") or say nothing. Testnet demo shows "One session so far: $0 deployed, $7 lost." — fine for testnet, never for a judge. |
| 3 | "Protect me from this" (one tap fills a rung) | **do** | "Ok, so what does that actually do?" Does it *if* the tap lands on a pre-filled rule with numbers in it. Skips if it opens a builder with nine fields. Churns if the sentence it was attached to has no funding lever ("your next position was 52% larger after a loss" cannot be protected against; see §7). |
| 4 | Build the bad-session plan | **do once**, if <60 s and pre-filled | "This is my FTMO sheet, but for reloads." He will not write this before every session. He will write it once, on the day after a blow-up, and edit it twice a year. Churn points: the word CAUTION, an "expires N hours after session end" picker, a velocity rung that needs a paragraph. |
| 5 | Start protected session (bankroll, duration, ladder on) | **skip** | "I don't 'start a session', I open the chart." Traders do not declare sessions; the app already derives them (6 h gap). The only version of this he taps is the one that *is* the deposit: "Release $1,500 for tonight". Fold it into Add funds and cut the duration field. |
| 6 | Trade | **do** | Nothing to do; correct. Shield must be invisible here. |
| 7 | Tier change (REDUCED) | **do** (reads it), churn if false | "Down $162 from peak, reload's now $100. Fair, I wrote that." One push plus a state change on Home. Churns on the first rung he did not write: a velocity rung firing at 0.5×D1 twenty minutes in is exactly that. Ivanova: the response to a false trigger is to loosen the rule, then lose more. |
| 8 | Cannot instantly move back up | **do** (grumbles) | "Same as a prop firm." Accepted because he already lives with it elsewhere and because he can always drop a rung. Two churn risks: (i) private thresholds mean a wrong REDUCED cannot be shown to anyone (F §2 remedy: return the evidence bundle to him); (ii) if REDUCED blocks a reload for a genuinely good setup he funds Hyperliquid from another wallet. That is outside the threat model and honest; the app must not pretend otherwise (it already does not: "Money you send here yourself never passes through Shield"). |
| 9 | Tomorrow: rung resets / reconfirm | **do** the reset, **skip** the reconfirm | REDUCED resetting by clock: "Daily loss resets at midnight, obviously." Reconfirming to loosen a *rule*: fine, rare. Reconfirming to leave a *rung* he was moved onto: no. If every REDUCED needs a next-day tap, he stops reading the tap. D §4's recommendation (rungs expire on a clock, rules never auto-loosen) is the right split. |

Net: eight steps, he does six of them. The two he skips are the two the proposal invented
for the demo (session ceremony, velocity). The one that decides retention is step 2.

Would he configure it "before a session"? No. Would he configure it once, the morning after
a bad night, in under a minute, and then let it sit? Yes, and that is the product.

## 2. Copy

Rules for all of it: first person or imperative, numbers before words, no adjective about
him, nothing about trades or positions, every rung line describes the *reload allowance*
because that is the only thing a rung changes. Max 12 words per line. Rung names below are
NORMAL / REDUCED / MINIMUM / LOCKED; the on-chain enum can stay whatever it is.

### 2.1 Ladder builder (four rungs)

```
SESSION PLAN
Write the rules before the session.
Shield can only cut funding. The trading stays yours.

Pre-filled from your last 38 sessions. Edit any number.

NORMAL
  Reload allowance $300 per 24h. Big moves wait 30 min.
  Until I'm down $150 from the session peak.

REDUCED
  Down $150 from peak, or one reload while down.
  Reload allowance drops to $100. Every release waits 30 min.
  Resets next session.

MINIMUM                                              (advanced)
  Down $300 from peak, or two reloads in 24h.
  Reload allowance $0 for the session. Floor untouched.
  Resets next session.

LOCKED
  Down $500 from peak.
  No new capital for 12h. Clears by clock only.
  Whatever is on Hyperliquid stays mine to trade.

Shield can move me down. It can never move me up.
I can drop a rung any time, instantly.
Moving up early waits 24h and asks me again.

Your numbers stay off-chain. The rung is public.

[ Save my plan ]        Takes effect now.
```

"From the session peak" is the one phrase worth teaching: it folds giveback into the same
number (D §5) and it is how Topstep says it. Do not show a percentage anywhere in a rule.

### 2.2 Tier-change notification

Push (one line + one line):

```
REDUCED · down $162 from peak
Reload allowance now $100 until your next session.
```

```
LOCKED · daily loss hit
No new capital until 09:15 tomorrow.
```

In-app strip (Home, replaces "No new trading capital until…"):

```
REDUCED since 22:41 · your rule: −$150 from peak
$100 left today · every release waits 30 min
$1,338 on Hyperliquid is untouched.
[ Drop to LOCKED ]   [ See the numbers ]
```

Never: "Shield moved you", "we noticed", "you're tilting", "take a break". The subject is
the rung and the number. The verb belongs to the rule he wrote.

### 2.3 Block states (replaces "Not tonight.")

REDUCED, release over the allowance:

```
RELEASE BLOCKED
Reduced.
Down $162 from your session peak.
Your rule: after −$150, reloads drop to $100.
$40 left today · $50 or more waits 30 min.
You wrote this Tuesday 14:02. Edit it tomorrow.
[ Release $40 ]  [ Drop to LOCKED ]  [ See the numbers ]
```

LOCKED (the current "Not tonight" screen):

```
RELEASE BLOCKED
Daily loss hit.
−$512 realised this session. Your limit was $500.
Your rule: after −$500, no new capital for 12h.
Available again 09:15 · $2,000 stays protected.
$1,338 on Hyperliquid is still yours to trade.
[ Lock till tomorrow instead ]  [ See the numbers ]
```

Keep the "You left yourself this" note (the journal note is trader-native; "note to self"
is exactly what a playbook has). Cut the "I still really want to trade" button and the
ring; the facts card can stay as "See the numbers".

Morning after (replaces "Shield held the line."):

```
LAST NIGHT
Blocked 2 reloads · $600
Session −$412 · $2,000 stayed protected
Rung: LOCKED until 09:15 · resets on its own
```

## 3. Defaults so the builder takes under 60 seconds

Everything below comes from fields `summarise()` already produces (`typicalSessionSize`,
`largestLosingSession`, `sessionsWithReloadAfterLoss`, `medianMinutesToReloadAfterLoss`)
or from the vault's existing rules. Round every dollar figure to a trader number
(25 / 50 / 100 / 150 / 250 / 500 / 1,000 / 1,500 / 2,500 / 5,000). Unrounded defaults
read as computed, and computed reads as "the app decided".

| Field | Default | Why |
|---|---|---|
| NORMAL reload allowance | existing `velocityThreshold` | Already set at onboarding; not a new question. |
| REDUCED trigger (D1) | 10% of typical session size | D §4. On a $1,500 session: $150. |
| REDUCED allowance | half of NORMAL | Matches "Also halve my daily limit" in `Safety.tsx`; one lever he has already seen. |
| MINIMUM trigger (D2) | 20% of typical | Hidden in v1 (see §4). |
| LOCKED trigger (D3) | min(existing `lossTriggerUsdc`, 75% of largest losing session) | The existing recommend() gives 40–50% of bankroll; capping under the largest losing session makes the default *visibly about him*: "your worst session was $812; this fires at $600". |
| LOCKED pause | existing `lossCooldownSecs` (12 h / 24 h) | Already chosen. |
| Reload-while-down → REDUCED | on, if `sessionsWithReloadAfterLoss ≥ 1` | Only show the rule to people whose history contains the behaviour; the Risk Desk sentence is its justification. |
| Rung reset | next session (6 h of no fills/flows), hard cap 24 h | Fixed, not a knob. See §4. |
| Large-move gate per rung | NORMAL: base; REDUCED and below: every release gated | Not a knob. |

Show on the builder, above the rungs, the two numbers that justify them: "Typical session
$1,500 · largest losing session $812". That is the whole "why these defaults" story and it
costs one line.

No history (new account): fall back to the existing numeric onboarding (bankroll → 10% /
50%), and say "no history yet; these are generic".

**Advanced (collapsed, one link "Advanced"):** velocity rung, MINIMUM rung, reload-count
thresholds ("two in 24h"), per-rung large-move gate, reset window hours, the session-gap
definition. Nobody in the target segment opens this in month one, and that is fine.

## 4. Complexity attack: the cut list

In order of how much each cut buys.

1. **Cut the velocity rung from v1.** D §2.6 rates the evidence thin, D §3 gives it the
   highest false-positive risk of the three, and it needs a paragraph ("$ lost in a
   trailing 30 minutes, at half your REDUCED trigger, excluding liquidations of positions
   opened before the session…"). It also fires *below* D1, i.e. it is the one rung he did
   not consciously write. The worst-case product outcome (Ivanova) is that the first false
   REDUCED makes him loosen D1. Trailing-from-peak drawdown already catches the fast
   giveback case. Evaluation is HTTP-triggered at most once a minute, so "velocity" is a
   step function anyway. Keep it in the doc as the v2 "fast tilt" heuristic if the team
   wants it; do not ship it, do not demo it.
2. **Three rungs, not four: NORMAL / REDUCED / LOCKED.** Prop firms have exactly two
   thresholds (daily loss, max drawdown). A trader holds two numbers in his head: "where I
   size down" and "where I'm done". A third intermediate (MINIMUM, allowance $0 but no
   cooldown) is a real state but not a real decision; it is REDUCED with a smaller number.
   Ship it behind Advanced, or as v2. The contract can keep `Tier[3]`; the app just leaves
   the middle one unset.
3. **Fix the rung reset; do not expose it.** "CAUTION and DEFENSIVE expire on a clock the
   calm user set (session end + N h, max 24 h)" is three concepts. The trader concept is
   one: *"resets next session"*, the way a daily loss resets at midnight. Implement as
   D §4 says (earlier of session end + 6 h or 24 h) and write "Resets next session". Hours
   go under Advanced. The phrase "session expiry of a rung" should never reach the UI.
4. **Cut "Start protected session" as a ceremony.** Fold it into Add funds: the release
   *is* the session start ("Release $1,500 · session plan on"). Cut the duration field.
   Sessions are derived, and the app already does it.
5. **Cut the Privy session signer** (§5).
6. **Collapse reload counting.** "1 → CAUTION, 2 in 24 h → DEFENSIVE" becomes one rule:
   *a reload while down moves me to REDUCED*. REDUCED's smaller allowance throttles the
   second reload by itself; the ladder self-enforces and the count disappears from the UI.
   "Two in 24 h → LOCKED" goes under Advanced.
7. **One knob per rung.** Each rung changes the reload allowance. The large-move gate is
   set once ("below NORMAL, every release waits 30 min"), not per rung.
8. **Cut the reset ring and "I still really want to trade"** (`Safety.tsx`). Replace with
   the facts card, no timer.
9. **Replace the trouble chips step** with the Risk Desk sentences. Where history is
   empty, ask for numbers, not self-descriptions. If any chips survive, remove the fatigue
   and "worst decisions" wording.
10. **Demo with trader-sized numbers.** A judge who sees "Lose $3 in a day and new capital
    pauses for 12 hours" on a $70 vault reads parental, because a $3 rule is a toy rule.
    Seed the demo vault at $2,000 / $300 / $500.
11. **Privacy: one line, not a feature.** "Your numbers stay off-chain. The rung is public."
    Traders with public or copy-traded addresses do value not broadcasting their daily loss
    limit; that is real, but it is one sentence in the builder, not a screen. The
    chain-side detail belongs to the judge doc.

What survives: connect → one true sentence → one tap → a three-rung sheet pre-filled from
his own numbers → save. Trading. A rung change with the number that caused it. A lock that
clears by clock. That is the whole product and it fits on one screen.

## 5. The soft session signer

Cut it.

What a trader hears in "your session key expires at 02:00": "Shield ends my session at
02:00." What is true: a Privy-issued agent key stops signing at 02:00 (lazily, minutes
late per B §2), and his master wallet, which is a browser extension one click away for
this segment, trades exactly as before. For a hot-wallet 19-year-old the friction is
zero; for a Ledger user it is a real "go get the device" moment, which is a fair feature
in a different product for a different user.

Three reasons it costs more than it gives here:

- It is the single feature most likely to make a judge or a user believe Shield restricts
  trading (§7). One misread and the honest capital-side story is contaminated.
- Shield revoking the key at LOCKED is actively dangerous if a bot or the app's own
  session is managing an open position through that key. Killing a signer mid-position is
  the one thing a risk product must never do; it turns a funding rule into a liquidation.
- It adds a Privy ceremony to the one screen (Add funds) that should have exactly one
  button.

If it is kept for the Privy prize, it lives on a separate "Convenience" row, never on the
ladder, and the label is: "A short-lived key for this session. Your wallet can always
trade; this is a convenience, not a lock." That sentence is the price of keeping it, and it
is a sentence the demo then has to spend time on.

## 6. What he tells a friend

> "I put my max daily loss in a vault. When I hit it the reload button just stops working
> till tomorrow, and I can't argue with it."

Shorter: "It's my prop-firm daily loss rule, but it's on-chain and it controls the reload,
not me."

## 7. Honesty check: where the proposal implies Shield restricts trading

Shield never restricts trading. It restricts what leaves the vault. Every screen has to
survive the question "so can I still trade?" with "yes, everything on Hyperliquid is yours".
The current app gets this right in three places (`Overview.tsx` cooldown strip,
`Safety.tsx` "Leave $X where it is", the venue panel footnote). The proposal risks it in:

| Where | The implied claim | Say instead |
|---|---|---|
| Rung names CAUTION / DEFENSIVE / STOP | "Defensive" = smaller positions; "Stop" = stop trading. Both are trading vocabulary. | NORMAL / REDUCED / LOCKED. Each rung line names the reload allowance. "Locked" already exists in the app's own legend. |
| "Start protected session" | The session (the trading) is protected. | "Release $1,500 for tonight" or "Session plan on". The plan governs funding. |
| "Your session key expires at 02:00" | Trading ends at 02:00. | Cut; or "This key expires. Your wallet always trades." |
| "Protect me from this" on size / frequency / streak sentences | Shield can act on position size. | Only attach the button to sentences with a funding lever (drawdown, reload, giveback). On the others: "Shield can't size your trades. It can cap what you reload." Or no button. |
| Tier-change push "Shield moved you to DEFENSIVE" | Shield changed how you trade. | "REDUCED · down $162 from peak · reload allowance now $100". |
| "Not tonight." | No trading tonight. | "Daily loss hit." plus the untouched-bankroll line, always. |
| The ladder builder as a whole | Each rung "lowers" something about the trader. | Each rung lowers one thing: the reload allowance. Header line: "Shield can only cut funding. The trading stays yours." |
| Private thresholds | A hidden rule is acting on you. | "Your numbers stay off-chain. The rung and its limits are public." Plus the returned evidence bundle (F §2 A2) so a REDUCED can be shown to a friend. |
| Judge/README copy: "signing authority ratchets down" | Venue-side authority changes. It does not (02 §4). | "The protected capital the trading account can draw on ratchets down." |

One more honesty line the app should keep saying, in the trader's favour: "Money you send
to Hyperliquid yourself never passes through Shield, and none of your rules apply to it."
He will find that bypass in a minute; a product that names it first is the one he trusts.

## 8. Summary for the parent agent

- Professional, conditional on vocabulary: prop-desk names (REDUCED / LOCKED, "from the
  session peak", "daily loss hit", "resets next session"), numbers before words, never a
  word about his state. Parental today in four places: "Not tonight.", the 10-second reset
  ring, "What do you want Shield to stop?" with the fatigue chip, "Shield held the line."
- He configures it once, the morning after, in under a minute, if it is pre-filled from
  `typicalSessionSize` and `largestLosingSession`. Not before every session.
- Cut: velocity rung; the fourth rung (NORMAL/REDUCED/LOCKED in v1); the reset-hours knob
  (fixed "next session"); "Start protected session" as a ceremony (fold into Add funds,
  drop duration); the Privy session signer; reload counting (one reload while down →
  REDUCED); per-rung large-move gate; the reset ring; the trouble-chip step; toy demo
  numbers.
- Keep: connect → one true sentence → one tap → three-rung sheet; rung push with the
  number; lock clears by clock; "note to self"; the untouched-bankroll line on every block.
