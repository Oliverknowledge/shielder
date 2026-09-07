# Design note: the capital-side Risk Ladder (drafted before the signing research landed)

Whatever the Privy/Hyperliquid research says about venue-side signing, one
layer of the ladder is enforceable today with the primitive Shield already
has: the vault decides what protected capital may leave, and a pinned
verifier may only make that stricter. This note designs the smallest contract
change that turns "a verdict extends a cooldown" into "a verdict moves the
vault down a ladder the user wrote while calm". It is a design, not a
decision; Phase 3 decides.

## What exists (v2)

- `applyRiskVerdict(RiskVerdict, sig)`: verifier-signed, nonce-monotone,
  `realizedLossUsdc >= lossTriggerUsdc` or reject, effect = `cooldownUntil =
  max(cooldownUntil, now + lossCooldownSecs)`. Nothing else.
- `tighten()` instant, authority-only; `proposeLoosen()` + `executeRuleChange()`
  after `loosenCooldownSecs` with positive reconfirmation; any tighten bumps
  `configVersion` and strands pending loosenings.
- One 24h release budget (`velocityThreshold`), a large-move gate
  (`topUpThresholdBps`), a protected floor, an emergency cap for cold moves.

So today the ladder has exactly two rungs: NORMAL and STOP (cooldown).

## The smallest honest extension: tiers as pre-authorised tightenings

```
struct Tier {            // set by the authority while calm; each strictly tighter than the one below
    uint64 triggerUsdc;  // session realised drawdown at which the verifier may move the vault here
    uint64 velocityThreshold;   // reload allowance while in this tier (<= base)
    uint16 topUpThresholdBps;   // large-move gate while in this tier (<= base)
    uint64 pauseSecs;           // 0 = no cooldown; STOP sets this
}
Tier[3] ladder;          // CAUTION, DEFENSIVE, STOP (index 1..3; 0 = NORMAL = base params)
uint8 activeTier;        // monotone upward except through the loosen path
uint64 tierSetAt;
```

Rules the contract enforces:

1. **Setting the ladder** is a tightening when every tier gets stricter or a
   new tier is added below an existing one; it is a loosening (delay +
   reconfirm) when any tier's trigger rises or any tier's limits widen.
   Reuses `TightenParams`/`LoosenParams` machinery: add `hasLadder` + the
   array; strictness check is per field.
2. **Moving down the ladder** (`applyRiskVerdict` with a new `tier` field):
   allowed only if `rv.tier > v.activeTier`, `rv.realizedLossUsdc >=
   ladder[rv.tier].triggerUsdc`, verifier signature valid, nonce fresh. Effect:
   `activeTier = rv.tier`; if `ladder[tier].pauseSecs > 0`, extend
   `cooldownUntil` exactly as today. The verdict still carries no limits of its
   own: it can only select a rung the user pre-wrote.
3. **The user can move down instantly** (`tighten({hasTier, tier})`): "Get me
   safe" becomes "drop to STOP now".
4. **Moving back up** is a loosening: `proposeLoosen({hasTier, tier: lower})`
   waits `loosenCooldownSecs` and needs `executeRuleChange()`; any tighten in
   between strands it. There is no automatic reset. (Optionally a `tierExpiry`
   after which the vault returns to NORMAL without reconfirmation: rejected
   here because it contradicts "they do not automatically move back up".)
5. **Effective limits**: every release path reads
   `_effectiveVelocity(v) = activeTier == 0 ? base : min(base, ladder[tier].velocityThreshold)`
   and likewise for the large-move gate. Floor, registry, exit path unchanged.

What the verifier can do: select a higher rung the user wrote, extend a
cooldown. What it cannot do: pick a limit, lower a rung, shorten a cooldown,
touch the floor, touch destinations, touch the exit. Same least-privilege shape
as v2, one more degree of freedom, all of it pre-authorised.

## Cost

- Bytecode: v2 sits 72 bytes under EIP-170 at `optimizer_runs = 1`. Measured
  2026-09-07: `via_ir = true` brings the runtime to 17,977 bytes (6.6 KB of
  headroom) with identical tests. The ladder is a few hundred bytes.
- EIP-712: `RiskVerdict` gains `uint8 tier`; the typehash changes, so
  `cre/shield-risk/evm-verdict.ts`, `server/evm-index.ts` signing and the
  `hashVerdict` check all move together (one constant each). v2 verdicts are
  not replayable on v3 (different domain: new contract address) — fine.
- Deployment: v3 on testnet is ~2 cents of test HYPE and needs big blocks.
  The v2 evidence stays valid history exactly as v1's did. This is the third
  deploy in three days: acceptable only if the ladder is central to the demo;
  otherwise not worth the evidence churn.
- Authorship: Oliver wants to write Solidity himself
  (`~/.claude/.../oliver-wants-to-write-contracts.md`). This extension is the
  ideal candidate: interface and tests can be written first, body left to him.
  If the spike implements it for the demo, say so and offer the rewrite.

## What this does NOT give

It does not change what the user can do *inside* Hyperliquid with money that
has already left the vault. That is the venue-side layer, and whether it is
hard, soft or theatre is exactly what Agents A/B/C are determining.
