# Phase 3 — architecture decision (2026-09-07)

Inputs: A, B, C, D, E, F, G, H (I pending; it only affects the demo cut).

## Capability A — Dynamic Trading Authority Ratchet: RED at the venue, YELLOW as capital

**Why RED.** Neither Privy nor Hyperliquid can constrain what a trading key
signs. Every Hyperliquid order/leverage/cancel action is signed as
`Agent{source, connectionId}` with the whole action hashed into one opaque
`bytes32` (A §2, §4 dumps); Privy's typed-data policies cannot see reduce-only,
leverage, size or asset class, and Privy ships no Hyperliquid decoder (A §3).
Hyperliquid itself has no per-agent scoping at all; an agent can do every
trading action up to max leverage, and `valid_until` expiry is enforced
minutes late (B §2–3, testnet-verified). Any Shield-held agent key is bypassed
by the master wallet or one `approveAgent` in about one second (B §13–14, C
§5). The only hard version is a Privy 2-of-2 quorum where Shield co-signs
every order: time-locked co-custody, a liveness dependency that can stop a
user closing a position, and the end of the self-custody claim (A §7, C §5).
Not built. Not claimed. Documented as impossible-for-self-custody, which is
the accurate statement.

**Why YELLOW.** The capital side is fully enforceable by the primitive Shield
already has, and it is where every trigger with evidence actually bites (D):
the protected capital the trading account can draw on ratchets down with the
session, on chain, under rules written while calm, and only the user can
ratchet it back up. That is a real change in financial authority (the next
reload is refused by the chain), never a UI state.

## Capability B — Personal Risk Ladder: GREEN, scoped by H

Three rungs, not four: **NORMAL / REDUCED / LOCKED**. Keyed to trailing
realised session drawdown (D T1: D1 → REDUCED, D3 = the existing loss trigger
→ LOCKED). Reload-after-loss stays a Risk Desk sentence and a default for D1,
not a separate rung (H: the smaller allowance throttles the second reload by
itself). Loss velocity: cut (thin evidence, fires below the rule the trader
wrote). REDUCED lowers the on-chain reload allowance to a value the user
pre-wrote; LOCKED is the cooldown. REDUCED expires on a clock the calm user
set (default 24h, bounded 1h–7d); LOCKED clears with the cooldown; moving up
early is a proposal with delay + reconfirmation; the user can drop to REDUCED
instantly. Thresholds are private (F option (a)): the chain holds a salted
commitment and the rung's public allowance; the enclave holds the plaintext;
LOCKED additionally keeps the public `lossTriggerUsdc` floor so the deepest
rung stays checkable against a public number.

## Capability C — Private Risk Desk: GREEN, data-gated

Only sentences the public API supports (D §6), each gated on a minimum sample,
each with "Protect me from this" only where a funding lever exists (H §7).
Bug fixed first: spot→perps transfers were invisible as reloads.

## Contract change: yes, v3, deliberately

The brief says not to edit the deployed contract casually. This is the
opposite of casual: three judges independently locate the remaining score
in the same missing primitive (a pre-authorised rung the verifier may select),
F found a nonce-exhaustion bug in the verifier swap, and C found that gated
top-ups never re-check the budget. v3 = ladder + both fixes + `via_ir` for
bytecode headroom. v2 stays as history exactly as v1 did.

## The Graph: rows now, signals next

Real rows exist as of today on Ethereum Sepolia (a twin of the same bytecode,
ROUTE_EVM only), streamed from `sepolia.eth.streamingfast.io` with the same
JWT. Next: a `map_signals` module the server actually consumes, and the
credibility fixes E listed. The general `custody-boundary` package split is
the right shape and is scoped to "if time remains".

## Cut on purpose

Session signer, Privy policies, quorum, agent keys, "Start protected
session" ceremony, velocity rung, fourth rung, reset-hours knob, reload
counting as a rung, per-rung large-move gate, any "risk tier" adjective that
implies position management.
