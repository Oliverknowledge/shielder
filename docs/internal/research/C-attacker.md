# C. Attacker's report: what a tilted user can still do

Research spike, Agent C (security / threat model). 2026-09-07. Read-only
against `contracts/src/ShieldVault.sol` (v2), `cre/shield-risk/evaluate.ts`,
`cre/shield-risk/main.ts`, `server/evm-index.ts`, `server/policy.ts`,
`server/behaviour.ts`, `server/hyperliquid.ts`, `app/src/pages/Setup.tsx`,
`app/src/pages/Behaviour.tsx`, `docs/THREAT_MODEL.md`, and the spike notes
A (Privy), B (Hyperliquid), D (behaviour) and `01-capital-ladder-design.md`.

Adversary: the account owner, ten minutes after a loss, with their own keys,
their own laptop, `cast`, the Hyperliquid UI and no patience. They will do
anything that takes under a minute and costs nothing. They will not run a
DDoS, bribe a node operator or break TLS. Everything below is judged against
that person. A control that this person walks around in under a minute is
labelled what it is.

Classification key:

- **HARD GUARANTEE**: enforced by immutable code against the key holder;
  the bypass needs a delay the user set while calm, or does not exist.
- **SOFT GUARANTEE**: holds unless a specific, cheap, documented action is
  taken; states the action and the time it takes.
- **UX FRICTION**: an extra click, signature or minute; nothing more.
- **OUTSIDE THREAT MODEL**: not something Shield claims to govern, or an
  attacker Shield does not defend against.

## 0. The two findings that change the picture

1. **On the shipped network, no verdict is produced automatically.**
   `server/evm-index.ts:60` sets `SHIELD_MONITOR` off by default on any
   chain that is not Anvil, and nothing in either server file calls the CRE
   HTTP trigger; the workflow runs when a person types `cre workflow
   simulate` (deployment is invite-only). In the ten minutes after a loss on
   HyperEVM testnet the vault's cooldown does not arm itself. Every dynamic
   control in this report (verdict cooldown, ladder tiers) is therefore
   currently a **manual** control; only the static rules (floor, 24h budget,
   large-move gate, self-pause, delays) act on their own. Until an
   always-on signer exists, the ladder's honest description is "a rule the
   contract will enforce if a verdict arrives", not "a rule that fires".
2. **The first reload after a loss always wins the race.** Best case with
   the monitor on: fill at T0, server poll every 15 s
   (`POLL_MS`), venue cache 30 s (`venueLossCache`), sign, `pub.call`
   simulate, `sendTransaction`, confirm on a rate-limited public RPC:
   roughly T0 + 45 s to 2 min. The user's `instantTopUp` is one transaction,
   T0 + 3 s. The verdict cooldown, and every ladder tier, governs the
   *second* reload. Only the static rules govern the first one. The 30-minute
   large-move gate is the one dynamic-looking control that beats the race,
   because `executeTopUp` re-reads `cooldownUntil` (`ShieldVault.sol:546`).

## 1. The capital ladder (on-chain tiers moved down by the verifier)

Design under attack: `01-capital-ladder-design.md` (tiers with lower
`velocityThreshold`, lower `topUpThresholdBps`, optional `pauseSecs`;
verifier may only select a higher rung the user wrote; Agent D's variant
where CAUTION/DEFENSIVE expire on a clock and STOP is the cooldown).

### 1.1 Attacks on the contract side

| # | Attack | Steps | Time | Outcome | Class |
|---|---|---|---|---|---|
| L1 | Pre-load before the session | While calm and at NORMAL, release the whole 24h budget (`velocityThreshold`) to the venue in one or several `instantTopUp` calls below the large-move gate, or one `proposeTopUp` + 30 min. Trade. | 0 s extra | Legal under every rule. The ladder has nothing left to lower: the budget is already at the venue. Tiers reduce a budget that pre-loading has spent. | OUTSIDE (accepted scope) but must be stated: **the ladder governs the marginal reload, not the bankroll** |
| L2 | Split releases | Four `instantTopUp` calls under the gate | 10 s | Summed by the six buckets; fifth dollar reverts (`_checkVelocity`, test `test_splittingDoesNotBeatTheDailyLimit`). | HARD |
| L3 | Reload via the emergency cold cap during a cooldown | `instantColdTransfer(coldWallet, emergencyCap)` (not cooldown-gated, `ShieldVault.sol:611-625`), then from the cold wallet's key send to Hyperliquid directly (`CoreDepositWallet.depositFor` on HyperEVM, ~2 s; or Arbitrum bridge, ~5 min) | 30 s to 5 min | Works, bounded by `min(emergencyCap, remaining 24h budget, balance - floor)`. The cold wallet is the user's own key. The ladder lowering `velocityThreshold` shrinks this too (design rule 5), but the cap itself is not a tier field. | SOFT: bypass amount = emergency cap. Already in THREAT_MODEL; the ladder design should say whether tiers also lower `emergencyCap` or accept that a cooldown leaks up to the cap |
| L4 | Cancel and re-propose to reset the budget | `cancelProposal(TOP_UP)` then re-propose | 5 s | Fresh reservation refunded, aged reservation dropped (v2 fix, `_reservationStillCurrent`). No gain. | HARD |
| L5 | Pending gated top-up survives a tier drop | `proposeTopUp` for a large amount at NORMAL; a verdict then drops the vault to CAUTION/DEFENSIVE (lower velocity); at maturity call `executeTopUp` | 30 min | **Design gap.** `executeTopUp` checks cooldown, floor and destination but never velocity (`ShieldVault.sol:541-557`); the reservation was made under the old threshold and the design says verdicts never bump `configVersion`. A tier with `pauseSecs = 0` therefore does not stop a top-up already in flight. STOP (cooldown) does. | SOFT for CAUTION/DEFENSIVE until fixed; fix = re-check `_effectiveVelocity` in `executeTopUp`, or let a tier drop strand pending top-up proposals only (not rule proposals) |
| L6 | Race the verdict | See section 0, finding 2 | 3 s | First reload lands. Second is blocked once the verdict lands. | SOFT by construction; state it |
| L7 | Wait out the verdict TTL | Nothing to do: if the relayer's tx does not land within 15 min (`expiry = now + 900`, `evaluate.ts`), the verdict dies | 0 s | The enclave re-evaluates on the next trigger; `actionable` re-derives from `view.verdicts` that were relayed, so a dead verdict does not poison the next one. But every re-evaluation on the shipped network is manual (section 0). | HARD once relayed; liveness SOFT |
| L8 | Starve the relayer | Relayer key out of gas, or public RPC rate-limiting the `sendTransaction` | n/a | The signed verdict JSON is public in `/api/vault/:key` (`verdicts[].verdict`) and `applyRiskVerdict` is permissionless, so anyone with gas can relay inside 15 min. The user cannot starve it; Shield can only fail to relay it. | HARD (relay is permissionless), liveness on Shield |
| L9 | Make the tier expire and go again | Agent D: CAUTION/DEFENSIVE expire at `min(session end + 6h, 24h)` | 6 to 24 h | Intended. Note that re-arming needs a fresh verdict, which today is manual. | by design |
| L10 | Set the ladder to never fire | Write `triggerUsdc` for every tier above any plausible loss, or pin no verifier, or pin a verifier key you hold | 0 s at setup; later via `proposeLoosen` + 24h | The ladder is user-written. Removing or replacing the verifier is a loosening (delay), adding one is instant. A vault with `riskVerifier = address(0)` has no dynamic controls at all and the app should say so on the rules screen. | OUTSIDE (opt-in commitment device) |
| L11 | Pre-sign vault transactions while calm | Sign `instantTopUp` calldata in advance, broadcast when tilted | n/a | The contract evaluates state at execution; a pre-signed tx obeys the same checks. | HARD |
| L12 | Export the Privy authority key / use `cast` | `exportWallet()` then `cast send` | 1 min | Same `msg.sender`, same checks (`test_rawTransferPathIsUnreachable`). | HARD |

### 1.2 Attacks on what the verifier can see

The verdict's loss figure comes from `readVenueLoss`
(`cre/shield-risk/evaluate.ts:83-106`): it takes the **first** active
registry entry with `kind == KIND_EXECUTION && route == ROUTE_HYPERCORE`,
POSTs `userFillsByTime` for the last 24h to the venue's public info API, and
sums `closedPnl - fee` over every fill. `net < 0` is the loss; otherwise 0.
The server path (`server/evm-index.ts:177-199`) is the same with `userFills`.
If the venue answers at all, the venue's number **replaces** the flow view
(`policy.ts`, `venueDecides = !!venue`). If the request fails, the flow view
is used, and the flow view books a loss only once money has come *back*.

| # | Attack | Steps | Time | Outcome | Class |
|---|---|---|---|---|---|
| V1 | Trade from a different Hyperliquid account | After the vault credits the registered account, `usdSend`/`sendAsset` (master-signed, ~1 s, no fee) to a second address you own; trade there | 5 s | Registered account has no fills; venue loss = 0; verdict never signs. Flow view is not consulted because the venue *answered*. | **SOFT, and the cheapest hole in the system**: zero cost, five seconds, no trace Shield reads |
| V2 | Sub-account | `subAccountTransfer` then trade with `vaultAddress` set; fills accrue to the sub-account address | 5 s | Same as V1. Needs $100k lifetime volume to create sub-accounts (Agent B), so retail users cannot, but the users who lose the most can. | SOFT |
| V3 | Hyperliquid vault / HLP | `vaultTransfer` (an agent may do this too) into a vault you lead or into HLP; fills accrue to the vault address | 5 s | Same as V1. | SOFT |
| V4 | Do not register the account you trade from | At setup register a **ROUTE_EVM** execution wallet (plain ERC-20 delivery on HyperEVM), bridge to Hyperliquid yourself | 0 s | `readVenueLoss` returns `null` (no HyperCore entry), so the flow view decides; the flow view's `realised` flag needs a RETURN, so a trader who never sends money back has `realisedLoss = 0` forever. | **HARD guarantee that the ladder will not fire.** The ladder is opt-in via registration; say so |
| V5 | Register two HyperCore execution wallets | Register A then B; top up B, trade on B | 0 s at setup | `.find()` returns A; B's fills are never read. | SOFT; fix = read every active HyperCore entry and sum, or forbid more than one |
| V6 | Do not close the position | Hold the loser open; add margin from reloads | 0 s | `closedPnl` is only written on closes. Realised loss stays 0 while the account bleeds. Liquidation does realise (the fill carries `liquidation` and `closedPnl`), so the hole closes at the worst possible moment. This is the window Imas (2016) says is the dangerous one (Agent D, 2.1). | **Unrealised is a hole**, by the definition the ladder chose. Not a bypass of the rule; a limit of the rule. Must be in the docs |
| V7 | Offset the loss with manufactured gains | The reader is a 24h **net** sum. Two of your own accounts on a thin pair: rest an off-market order from B, hit it from registered A so A books positive `closedPnl` equal to the loss; B (unregistered) books the mirror loss | 2 to 10 min; costs taker/maker fees plus the risk a stranger fills the resting order | Net goes to 0, no verdict. Also works with genuine gains earlier in the window (Agent D's trailing-peak drawdown fixes the second case, not the first). Spot fills are included in the sum (`userFills` returns spot `Buy`/`Sell` with `closedPnl`), which widens the surface to every spot pair. | SOFT; cost is fees, feasibility depends on book depth. Mitigation: sum losses and gains separately and trigger on gross loss or trailing drawdown, and only over perps `dir` values |
| V8 | Flood the fill window | `userFillsByTime` returns at most 2000 fills per call and only the 10,000 most recent exist (Agent D, 1). Neither reader pages. A high-frequency account (or a bot placing $10 orders) can push the losing fills outside what one call returns | Hours of noise, real fees | UNVERIFIED which end of the window the API truncates; if it returns the oldest 2000 after `startTime`, the flood must precede the loss; if the newest, it must follow it. Either is possible for a bot. | SOFT until paged; fix = page by `endTime` until the window is covered, and treat `fills == 2000` as "incomplete, use flow view" |
| V9 | Another venue | `withdraw3` to Arbitrum (5 min, $1), or Core -> EVM `spotSend` (seconds), then any DEX/CEX | 5 min | Invisible. | OUTSIDE (Shield is Hyperliquid-scoped); say it |
| V10 | Feed the reader a different account | The account comes from the on-chain registry via Shield's server; the user cannot alter Shield's server response | n/a | Not possible without compromising Shield's server. A dishonest server that omits the HyperCore entry pushes the enclave to the flow view, which over-counts (safe direction) or, with no returns, counts nothing. | OUTSIDE for the user; see V11 for Shield |
| V11 | Enclave / server offline | Shield's server down, RPC down, DON down | n/a | `evaluateVault` throws on a failed `/api/vault` fetch; no verdict. A user cannot cause this except by DDoS. Shield can cause it by neglect. The ladder degrades to static rules **silently**: the user believes they are protected. | SOFT on liveness; the app must show "last evaluated at" and "no monitor pinned" states |
| V12 | Public, unauthenticated venue API as a manipulation vector | The user is never on the path between the enclave (or Shield's server) and `api.hyperliquid.xyz`; both use HTTPS. A MITM needs the DON's or Shield's egress, or Hyperliquid itself | n/a | For the tilted user: OUTSIDE. For the infrastructure threat model: **unverified whether the CRE HTTP capability terminates TLS inside the Nitro enclave**; if a node operator terminates it, a colluding operator can return `[]` and suppress a verdict (never forge one that tightens more than the user's own rule allows). A `200 []` is treated as "no loss", a non-2xx as "unreachable, use flows"; the two are not distinguished, so any upstream that returns an empty body on error silently reads as a winning day. Fix: treat `fills == 0` with a non-zero open exposure in the flow view as "unknown", not "zero" | OUTSIDE (user); open item (infra) |
| V13 | Compromised verifier key, worst case | Sign verdicts at will | n/a | Can: extend the cooldown in `lossCooldownSecs` increments forever (max 30 days each), and with the ladder select any rung the user wrote, at any time, including STOP. Cannot: move money, touch floor/cap/destinations, block cold transfers or the exit, shorten anything, or stop the user removing it via `proposeLoosen` (1h to 30 days, 24h default; not cooldown-gated). The symmetric failure is worse and quieter: a verifier that **refuses to sign** removes every dynamic control and nothing on-chain records that it did. | HARD bound (documented, tested); the silent-refusal case needs a heartbeat |

### 1.3 Ladder verdict

- **HARD**: floor, 24h budget, large-move gate, delays, monotone cooldown,
  "a verdict can only pick a rung the user wrote". These are the existing
  vault invariants and the ladder inherits them.
- **SOFT**: everything that depends on the verifier *seeing* the loss. The
  loss reader has four zero-cost holes (V1, V4, V5, V6) and two cheap ones
  (V7, V8). A user who wants to reload will trade from an address the vault
  does not know about, and it takes five seconds.
- **The ladder's dynamic part is today a manual control** (section 0).

The honest sentence is: *the ladder makes the contract able to enforce a
stricter budget after a loss the verifier can see; it does not make the
verifier able to see a loss the user hides, and hiding one is free.*

## 2. A Shield-held agent key (or a Privy co-signing quorum)

Design under attack: Shield approves a named agent on the user's Hyperliquid
account and only signs the orders the ladder allows (reduce-only at
DEFENSIVE, nothing at STOP); or the user's master is a Privy wallet whose
signing requires Shield's co-signature after preimage verification (Agent A,
section 7.3).

| # | Attack | Steps | Time | Outcome |
|---|---|---|---|---|
| A1 | Master key in the Hyperliquid UI | Connect the master wallet, click "Enable trading" (the UI creates its own unnamed agent), trade | 5 s | Full authority. Agent B, section 5: nothing on the venue distinguishes master from agent for trading; master is a strict superset. |
| A2 | Approve a second agent | One `approveAgent` signature; up to 3 named + 1 unnamed; unnamed agents are invisible to `extraAgents` | 1 s | Full authority through a key Shield cannot see. |
| A3 | Revoke Shield's agent | `approveAgent` with Shield's name and `0x0` | 1.5 s | Shield's key dies immediately. |
| A4 | Export the Privy key | `exportWallet()`; enabled by default for a user-owned wallet | 1 min | Then A1 forever. |
| A5 | Remove Shield as signer | `removeSigners()` ("revoke consent") is a client-side method for the owner | 10 s | Shield's signer gone. |
| A6 | External wallet as master | Use MetaMask as the Hyperliquid account; the app already accepts any 0x address as the execution destination (`Setup.tsx:connectVenue`) | 0 s | Nothing enforceable at all. This is the shipped configuration: the HL master in the demo is the raw `execution` key, not the Privy wallet. |
| A7 | Pre-sign inside Hyperliquid's nonce window | Only matters under a co-signing quorum: get Shield to co-sign N orders while calm, hold them, submit when tilted (nonce window T-2d..T+1d, Agent A 7.3) | minutes of prep | Defeated only if Shield refuses to co-sign without `expiresAfter` in the hashed preimage. |
| A8 | Shield outage under a 2-of-2 quorum | Nothing to do | n/a | The user cannot trade, cannot close a losing position, cannot withdraw, cannot export. Shield is a liveness dependency for reducing risk, which is the one thing a risk product must never block. |

**Conclusion.** For a self-custodial user (sole owner of the Privy wallet, or
any external wallet) a Shield-held agent is **UX FRICTION**: every bypass is
one signature and under five seconds, and the master key holder retains
every one of them by construction (Agent B: "there is no configuration of a
Hyperliquid account in which the key that controls it has less authority than
an agent"). It is a *service* (a de-risk button, an agent that only ever
signs `r: true`) and can be described as one; it is not a restriction.

What would make it hard: the Hyperliquid master account is a Privy wallet
**created fresh by Shield**, owned by a 2-of-2 quorum (user + Shield
authorization key), with `DENY exportPrivateKey`, `DENY
HyperliquidTransaction:ApproveAgent` (or agent address allowlisted to
Shield's), `DENY withdraw3/usdSend/spotSend/sendAsset` except to the vault,
and Shield co-signing every L1 action after recomputing `connectionId` from
the plaintext and requiring `expiresAfter`. Then A1 to A6 all need Shield's
signature. That is enforceable (Privy's TEE enforces the quorum) and it is
**not self-custodial**: the user cannot trade, withdraw or export without
Shield; Shield cannot steal but can freeze; Shield's outage is the user's
outage (A8); and the user still has V9 (any other account, any other venue,
their own bank) for capital that never passed through Shield. The only
construction that is hard *and* escapable is a pre-built dead-man's switch:
at wallet creation add the user's own key as an additional signer with a
time-bound override policy (`system.current_unix_timestamp >= T`) and have
Shield co-sign a PATCH pushing `T` forward while the relationship is alive.
If Shield disappears, `T` arrives and the user regains full trading and
withdrawal (not export) authority. That is "time-locked co-custody", and it
must be sold as that, not as self-custody. It also contradicts the current
`docs/JUDGE_QA.md` line "Shield deliberately does not co-own keys, so there
is no 2-of-2 in which Shield could hold a user's funds hostage." One of the
two claims has to go.

## 3. Privy policies on user-signed actions

Design under attack: a policy on the user's embedded wallet that denies
`withdraw3`/`usdSend`/`spotSend`/`sendAsset` to non-allowlisted
destinations, denies `approveAgent`, and time-bounds a Shield signer.

First, an architectural fact: in the shipped product the Privy wallet is the
**vault authority**, and the Hyperliquid master is a separate address the
user types in (`Setup.tsx`, `draft.executionAddress`). A policy on the Privy
wallet therefore governs vault calls, which the contract already governs
better, and governs nothing on Hyperliquid unless the app is changed so the
Privy wallet *is* the Hyperliquid master.

Assuming that change:

| Who can remove the policy | Answer | Consequence |
|---|---|---|
| The wallet owner | Yes: "owners can update the policies assigned to a wallet" (Agent A, 3.5). For a user-owned embedded wallet the owner is the user. | The control binds Shield's delegated signer, not the user. |
| The user, unilaterally, in practice | **Unverified.** Detaching a policy is a REST `PATCH /v1/wallets/:id` that needs Shield's app secret *and* the owner's signature. If the client SDK exposes no policy update, the user needs Shield's app to offer the button. | Two outcomes, both bad for the claim: (a) the user can remove it: UX FRICTION; (b) the user cannot remove it without Shield's app: the wallet is not self-custodial, and a dead Shield app leaves a wallet whose export is denied forever. Run Agent A's E4 before designing on either. |
| Export | Enabled by default for owners; deniable by policy | Same dichotomy: a deny-export policy the user can lift is friction; one they cannot lift is custody. |

Even a perfectly sticky policy is **not anti-tilt**: it stops money leaving
the Hyperliquid account or new agents being approved; it does nothing about
losing the money that is already there, which is the entire tilt surface.
Its real value is anti-drain (a scammer, a leaked session, a rogue Shield
signer). The time-bound signer likewise protects the user *from Shield's
key*, not from themselves.

Also unverified and load-bearing: whether a `lte` condition on the
string-typed `amount` field compares numerically (Agent A, E6). If it is
lexicographic, a "max $10 withdrawal" policy allows "$100".

**Class: UX FRICTION for a user-owned wallet; custody, not self-custody, for
a quorum-owned one; OUTSIDE the tilt threat model either way (it is a drain
control).** Worth shipping as "your Shield wallet cannot be emptied by a
scammer or by Shield" if E4/E6 pass; never as a trading restriction.

## 4. The Risk Desk: privacy attack surface

Data path today: the user types a Hyperliquid address in setup; the app GETs
`${API_URL}/api/hyperliquid/<address>?network=` on Shield's server
(`Setup.tsx:92`, `Behaviour.tsx:36`); the server fetches ledger updates
(up to 20 paged calls) and fills from Hyperliquid's public API and returns
the profile. The same browser session GETs `/api/vault/<authority>`.

| What | Who learns it | New information? | Acceptable? |
|---|---|---|---|
| Hyperliquid address | Shield's server (path in access logs; CORS `*`, no auth), any proxy/CDN in front of it, and Hyperliquid (Shield's egress IP asks about the address) | The address is already on-chain in `RegistrationChanged` once registered, so the vault-to-account link is public regardless. What Shield's server uniquely learns is the **correlation** with the browser session/IP and, through the same session, the authority address, i.e. "this person". Privy separately knows email ↔ wallet; Shield's server never sees the email (there is no auth), so the email ↔ HL account join needs Privy plus Shield's logs. | Acceptable only if stated. Cheaper and better: the app already has a browser-side `InfoClient` (`app/src/lib/hyperliquid.ts`); run the Risk Desk analysis in the browser (`deriveSessions`/`summarise` are pure) so Shield's server never sees the address at all. This also removes an amplification vector: one unauthenticated GET makes Shield fan out up to 21 requests to Hyperliquid under Shield's IP. |
| Evidence bundle (`EvidenceBundle` in `policy.ts`) | Anyone: `/api/evidence/<hash>` is public and the hash is in the on-chain event | Vault, `asOf`, the 24h sessions with wallet addresses, amounts and tx hashes, `lossStreak`, `reloadsAfterLoss7d`, velocity, median top-up, policy, and the venue account with fills count and `lastFillAt`. All derivable from public data; the bundle is a ready-made dossier. | Acceptable for a system whose honesty claim is "the number is checkable". Do not add anything to it that is not already public (no equity, no leverage, no open positions). |
| On-chain: `RiskVerdictApplied(vault, nonce, reasonCode, realizedLossUsdc, cooldownUntil, extended, evidenceHash)`; `PolicyTightened` with every rule value; `RegistrationChanged` linking the venue account; `TopUpExecuted` amounts; with the ladder, `tier` | Everyone, forever | "Authority A, trading as Hyperliquid account H, keeps a $F floor and a $V daily budget, lost at least $N on this date, and was paused for reason 3 (reloading after a loss); now at DEFENSIVE." The loss trigger is already public via `PolicyTightened`, so `realizedLossUsdc` adds the exact figure; `reasonCode` adds a behavioural label the contract never reads (`lastVerdictReason` is informational). | The loss figure must stay in calldata (the contract checks it against the user's trigger; that check is the core invariant). `reasonCode` is gratuitous: move it into the evidence bundle and store a constant on-chain, or accept the label and say so on the rules screen. A `tier` field is needed by the contract and is therefore public. Say plainly in the docs: **the vault is pseudonymous, not private; your rules, your registered venue account and every pause are public.** |
| CRE node operators | The DON | The HTTP trigger payload `{vault}` arrives outside the TEE, so operators see which vault is being evaluated and when; the config (`shieldApiUrl`, `programId`) is public; the enclave's egress destinations are visible. The verifier key and, per Chainlink's claim, the request/response bodies are not. In a real deployment `shieldApiUrl` cannot be `http://localhost:8788`; it becomes a plaintext HTTP fetch of the vault view and flows across the operator's network. That data is public chain data, as `cre/README.md` already insists, so the leak is the **timing signal**: "Shield evaluated vault X at T" is a good proxy for "X just lost money". | Acceptable with the existing README wording; add the timing-signal sentence. |

## 5. Residual guarantees, ranked

What Shield can say after every attack above, strongest first:

1. **Capital that is in the vault leaves only through five paths, to
   pre-registered destinations, under rules that tighten instantly and
   loosen after a delay the user set (1 h to 30 days), and nobody — not
   Shield, not a compromised monitor, not the user in the moment — can
   change that.** HARD. Immutable contract, 49 forge tests, no admin.
2. **The protected floor is never breached except by a full exit at the
   user's own delay.** HARD.
3. **No more than the 24h budget reaches any destination in any rolling
   24 hours, however it is split, and a large release waits 30 minutes.**
   HARD (v2; two v1 defects fixed and pinned).
4. **A cooldown, once armed, cannot be shortened by anyone, blocks every
   top-up path, and never blocks the cold path or the exit.** HARD. Leak:
   up to `emergencyCap` per 24h via the cold wallet (L3).
5. **A verdict, or a ladder tier, can only make the vault stricter, only
   in ways the user pre-wrote, and only when the attested loss meets the
   user's own trigger.** HARD on what a verdict *does*.
6. **A verdict fires when the registered Hyperliquid account's own
   settled 24h PnL is at or below minus the trigger.** SOFT. Holds only if
   the user trades from the registered account, closes positions, and does
   not manufacture offsetting gains; each of V1, V4, V5, V6 is free and
   takes seconds. And on the shipped network it fires only when a person
   runs the enclave.
7. **A Shield-held agent limits what the user can do on Hyperliquid.**
   FALSE for a self-custodial user (UX FRICTION). True only under a 2-of-2
   quorum that is not self-custody.
8. **A Privy policy restricts the user's trading.** FALSE (opaque hash).
   Restricts withdrawals and agent approvals only, and only for as long as
   the owner leaves it attached.

**Is the hard guarantee only the capital vault? Yes.** Items 1 to 5 are the
vault and nothing else. Everything on the venue side is either soft (the
loss reader), friction (agent keys, policies) or custody (quorums). The
ladder adds degrees of freedom to item 5; it does not move anything from
soft to hard, because it sits behind the same loss reader.

### The paragraph that must appear in the docs

> **What a determined tilted user can still do.** Shield governs money
> that is inside the vault and nothing else. In the minutes after a loss,
> a user who wants to keep going can: reload once before any verdict lands
> (about three seconds against a best case of a minute for the monitor);
> move up to their emergency cap to their own safe wallet and send it to
> the venue from there; add margin to a losing position that they never
> close, because an open loss is not a realised loss; move the released
> capital to a second Hyperliquid address, a sub-account or a vault in one
> signature and trade there, where Shield's monitor does not look; trade
> from an account they never registered; offset a realised loss with a
> manufactured gain on a thin pair; or fund any other venue from any other
> source. A Shield-held trading key cannot stop any of this, because the
> master key can revoke it, approve another, or trade directly in about a
> second, and a wallet policy cannot read an order at all. What no amount
> of tilt can do is take protected capital below the floor, exceed the 24h
> budget from the vault, skip the large-move wait, shorten a cooldown,
> weaken a rule without the delay, or send vault money anywhere that was
> not registered while calm. On the current deployment the loss monitor
> runs only when Shield's operator runs it; until it is always-on, the
> cooldown and ladder are rules the contract will honour if a verdict
> arrives, not rules that fire by themselves.

## 6. Concrete fixes, in priority order

1. Make verdict production always-on before claiming any dynamic control
   (server monitor on with the enclave key, or a scheduled CRE trigger), and
   show "last evaluated at" and "no monitor pinned" in the app.
2. Close the free holes in the loss reader: sum **every** active HyperCore
   execution entry (V5); page `userFillsByTime` to cover the window and treat
   a 2000-fill response as incomplete (V8); trigger on gross loss or trailing
   drawdown, not 24h net, and restrict to perps `dir` values (V7); treat
   `200 []` with open exposure as unknown rather than zero (V12).
3. In the ladder, re-check `_effectiveVelocity` in `executeTopUp` or strand
   pending top-up proposals on a tier drop (L5), and decide whether tiers
   lower `emergencyCap` (L3).
4. Document V1/V4/V6/V9 in `docs/THREAT_MODEL.md` under "Accepted
   limitations" using the paragraph above; add the pseudonymity sentence and
   the timing-signal sentence to the privacy section.
5. Move the Risk Desk analysis into the browser; drop `reasonCode` from the
   on-chain struct or declare it.
6. Do not build the agent-key layer as a restriction. If built, name it a
   service ("de-risk button"). If the 2-of-2 route is chosen, rewrite the
   custody claims in `JUDGE_QA.md` and `THREAT_MODEL.md` first, and run
   Agent A's E4 and E6 before designing on Privy policies.
