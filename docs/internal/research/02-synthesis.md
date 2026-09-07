# Phase 2 synthesis (draft, updated as reports land)

Inputs: A (Privy/Hyperliquid signing), B (Hyperliquid protocol map), D
(trader behaviour). Pending at time of drafting: C (attacker), E (Graph
judge), F (Chainlink judge), G/H/I (Privy judge, product designer, WOW judge).

## 1. What is technically possible

- **Venue-side order restrictions via Privy policy: impossible.** Every
  Hyperliquid L1 action (order, cancel, modify, updateLeverage, twap, spot
  order, agentSendAsset…) is signed as `Agent{source, connectionId}` where
  `connectionId = keccak(msgpack(action)‖nonce‖vault‖expiresAfter)`. A policy
  sees one opaque bytes32. Reduce-only, leverage, size, asset class are all
  inside the preimage. Privy has no Hyperliquid decoder (A §1–3, dumps in §4).
- **Venue-side scoping by Hyperliquid itself: none.** `approveAgent` carries
  only address, name, nonce; the sole option is a `valid_until` expiry, which
  is enforced lazily (agents kept working minutes past expiry). Agents can do
  everything trading-side including raising leverage to the asset max; only
  the master can move funds out, approve/revoke agents, or pay third parties
  (B §2–3, verified on testnet).
- **Class-level and custody-side control via Privy policy: possible.** A
  policy can deny the whole L1 class after a time, and can allow/deny/constrain
  user-signed actions field by field (withdraw3, usdSend, sendAsset,
  approveAgent). Time-bound signers exist. But a user-owned embedded wallet's
  sole owner can detach the policy, remove signers, export the key (A §3.3–3.5).
- **The only enforceable trading ratchet is Shield co-signing** (2-of-2 quorum
  on a fresh Privy-held master account, export denied, approveAgent denied,
  Shield recomputing `connectionId` from the plaintext action and refusing to
  co-sign risk-expanding orders). Cost: Shield becomes a liveness dependency
  for every trade, the user is no longer sole owner, the demo-key path dies,
  and the "self-custodial" claim becomes false (A §7).
- **The capital side is fully enforceable today** by the deployed primitive
  (floor, 24h budget, large-move gate, cooldown, verifier that only tightens)
  and can be extended into a ladder with a small contract change
  (`01-capital-ladder-design.md`; ~6.6 KB of bytecode headroom with `via_ir`).

## 2. What is actually enforceable (working classification, C to confirm)

| Control | Class |
|---|---|
| Protected floor, registry, exit delay, cooldown, 24h budget, large-move gate | HARD (contract) |
| Verifier moves the vault DOWN a user-written ladder; cannot move it up | HARD once implemented (contract) |
| Shield-held agent that refuses risk-expanding orders | UX FRICTION for a self-custodial user (one `approveAgent` or the master wallet in the venue UI bypasses it in ~1 s) |
| Privy co-signing quorum on a Privy-held master | HARD only with 2-of-2 + export denied; then not self-custodial and Shield is a liveness dependency |
| Privy custody policies on a user-owned embedded wallet | SOFT (owner can detach) |
| Agent `valid_until` expiry | SOFT (lazy enforcement, minutes) |
| Anything on money that never entered the vault, other venues, other wallets | OUTSIDE THREAT MODEL |

## 3. What the trader would value (D)

Ranked triggers: trailing realised session drawdown (54), reload after loss
(54), loss velocity (40), giveback (39, fold into drawdown-from-peak), equity
drawdown (38, show only), size escalation (38, Risk Desk only). Recommended
ladder conditions: T1 drawdown rungs D1/D2/D3, T2 reload-after-loss
(1 → CAUTION, 2 in 24h → DEFENSIVE), T3 30-min velocity as CAUTION-only
accelerator. Rungs below STOP should expire on a clock the calm user set;
rules never auto-loosen. Evidence: strong for post-loss risk-taking and
deposit frequency as a harm marker; zero peer-reviewed perp-DEX data (say so).

## 4. Capability A verdict (working): RED for order-level enforcement, YELLOW as scoped

The "trader's actual signing authority ratchets down" idea is not real for a
self-custodial trader: neither Privy nor Hyperliquid can constrain what an
agent signs, and the master key always retains full authority. The honest,
enforceable subset is the capital side: the amount of protected capital the
trading account can draw on ratchets down with the session, on-chain, by
rules written while calm, and only the user can ratchet it back up after a
delay. That is a real change in financial authority (the next reload is
refused by the chain), not a UI state. It is implemented as a ladder in the
vault, with the verifier selecting rungs the user pre-wrote.

Optional soft layer, honestly labelled: a Privy-issued, time-bound session
signer for the venue ("Start protected session: 6h") that expires with the
session and that Shield can revoke when STOP is reached. It removes the wallet
ceremony and gives a visible "your session key is gone" moment, but the docs
must say the master wallet can always trade around it. Decide after G/H/I.

## 5–6. Sponsor competitiveness, WOW, dangerous complexity

(To be completed from E, F, G, I.) Known so far: the ladder gives The Graph
new on-chain events (RiskTierChanged, ReloadBlocked) and derived stores; gives
Chainlink a genuinely private input (the user's rung thresholds, which need
not be on-chain: the verdict carries only `tier`); gives Privy the
session-signer flow if kept. Dangerous complexity: a third contract deploy in
three days; private thresholds vs contract verifiability; any claim that
trading permissions changed when only capital did.
