# Threat model

The unusual part: the owner of the funds is also, for minutes at a time, the
adversary. Alex sets rules while calm; five minutes after a loss, Alex is the
attacker trying to get around them. Everything else (scammers, a compromised
Shield server, a malicious monitor) is secondary and easier.

Invariants are stated first; each attack below names the invariant that
stops it and the test that proves it (`tests/shield-vault.test.ts`, run with
`bun test`).

## Invariants

1. **Only the program moves vault funds, through one transfer path.** The
   vault's USDC account is owned by a PDA; the only CPI the program ever
   makes is `spl_token::transfer` from that account to a token account owned
   by a registered pubkey. No delegate approvals, no arbitrary CPI, no
   authority change instruction.
2. **No unregistered destination, ever.** Every outbound instruction takes
   the registry entry PDA for the destination owner and checks the supplied
   token account's `owner` field against it.
3. **Types are permanent.** A registered owner is `Execution` or `Cold`
   forever. Removing is instant; re-adding is a delayed weakening change.
4. **Tighten is instant and monotonic; loosen is delayed.** `tighten`
   rejects any field that does not move in the stricter direction;
   `propose_loosen` rejects any field that does not move in the weaker
   direction and executes only after `loosen_cooldown_secs` (≥ 1h).
5. **Stale proposals die.** Every user tighten bumps `config_version`; a
   proposal created under an older version cannot execute.
6. **Funding is globally aggregated.** One 24h accumulator across all
   top-ups and capped cold transfers, checked and reserved atomically.
7. **A cooldown is a wall.** While `now < cooldown_until` no top-up executes
   on any path; proposals cannot mature before it ends; it only ever extends.
8. **External input can only tighten.** The single external instruction,
   `apply_risk_verdict`, requires the pinned verifier's signature (Ed25519
   precompile introspection), exact vault + program binding, freshness, a
   strictly increasing nonce, and an attested loss at or above the user's
   trigger; its only effect is `cooldown_until = max(current, now +
   loss_cooldown_secs)`. It never touches config_version, so it cannot
   invalidate the user's own proposals.
9. **Proposals are one-shot and bound.** Destination and amount are locked at
   creation; execution re-checks the registry and the token account owner;
   the account is closed on execute or cancel.
10. **Recovery needs nothing Shield operates.** `client/recovery-cli.ts`
    talks to an RPC URL only: status, cancel, capped cold transfer, propose
    exit, execute matured proposals.
11. **The code cannot be swapped.** The judged deployment runs
    `scripts/deploy.sh finalize` (upgrade authority set to none). Until that
    is done the invariant is not yet true and the README says so.

## Attacks, by attacker

### Alex, five minutes after a loss

| Attack | What happens | Invariant / test |
|---|---|---|
| Call the program directly, skip the app | Same instructions, same checks. The app has no privileged path. | 1, 2 · every test drives raw instructions |
| Plain SPL transfer out of the vault account | Token program rejects: the PDA is the owner and only the program signs for it. | 1 · "nothing but the program can move vault funds" |
| Split $1,600 into four $400 top-ups | The accumulator sums them; the fifth dollar fails `VelocityThresholdExceeded`. The gated path reserves from the same accumulator. | 6 · "structuring" |
| Route the reload through a cold wallet, then forward it | Cold transfers are capped (`emergency_cap`, $200 default), share the accumulator, and anything above the cap takes the 7-day exit path. | 6, 9 · "capped cold transfer… shares the accumulator" |
| Register a fresh "cold" wallet and drain to it | Registration while funded is a 24h weakening proposal; even after it lands, only the cap moves instantly. | 3, 4 · "scam-address case" |
| Re-register the trading wallet as cold | `AlreadyRegisteredDifferentType`. Types are permanent. | 3 |
| Raise the daily limit right now | `tighten` rejects (`NotATightening`); `propose_loosen` waits 24h. | 4 · "instant path refuses…" |
| Propose the raise calmly, tighten later, then execute the stale raise | `ProposalStale`: the tighten bumped `config_version`. | 5 · "stale proposal invalidation" |
| Shorten the weakening delay to 0 | `InvalidParameter`: floor of 1h; and the change itself waits the current delay. | 4 |
| "Just leave Shield" | Exit is a 7-day proposal to a registered cold wallet; limits keep working while it is pending. | 4, 9 · "leaving Shield…", "pending exit does not unlock top-ups" |
| Execute a matured exit to a different token account | `TokenAccountOwnerMismatch`. | 9 · substitution test |
| Schedule a large top-up, then wait out the 30 min while a loss cooldown lands | `execute_top_up` re-checks the cooldown: `CooldownActive`. | 7 · "cooldown armed AFTER a proposal" |
| Pause, then un-pause | There is no un-pause instruction. Pauses only extend and expire by time. | 7 · "self-pause is… extend-only" |
| Use a second vault to reach the first vault's registry | Registry PDAs are seeded by vault; the other vault's entries do not exist. | 2 · "second vault cannot borrow…" |
| Deposit from somewhere else and trade there | Out of scope by design: Shield governs what leaves the vault, not money that never entered it. Stated in the app. | accepted limitation |

### A scammer ("send it to this recovery address")

Adding any destination to a funded vault is a 24h weakening change; after
that, only the emergency cap moves instantly; a full withdrawal takes 7
days. The `tighten` path cannot add destinations. Test: "the scam-address
case".

### Shield's server / indexer (compromised or dead)

- Dead: the app reads enforcement state from RPC; the vault's floor, limit,
  pause and any armed cooldown keep working; the recovery CLI works. The UI
  shows "behavioural data unavailable".
- Compromised: it can sign verdicts only if it holds the verifier seed. With
  the CRE workflow as the signer, it does not. Even with the seed, a verdict
  can only pause top-ups for the user's chosen length and must attest a loss
  at or above the user's trigger; it cannot move money, loosen, or invalidate
  the user's proposals. Tests: "the monitor cannot loosen", "no griefing".
- Lying about flows to the enclave: the enclave re-derives from raw flows,
  which are themselves on-chain facts (signatures are in the evidence
  bundle); fabricating flows would require fabricating transactions.

### A malicious or buggy monitor / AI

The vault does not trust the monitor's judgment, only its signature over a
number it then checks against the user's rule. Reason codes and evidence
hashes are informational. A rogue monitor's worst case is repeated 18h (or
whatever the user chose) top-up pauses; the user can remove the monitor via
the 24h path, and cold transfers and exits are never affected. Replay,
expiry, wrong vault, wrong program, forged key, tampered message, and missing
precompile instruction are all rejected (tests: "replay protection",
"malformed verdicts", "without the Ed25519 precompile").

### Program upgrade authority (Shield the company)

Until `deploy.sh finalize` runs, whoever holds the upgrade authority could
redeploy logic that ignores every rule. This is why finalising is a
submission blocker, not a nice-to-have, and why the README lists it.

### Clock manipulation

Solana's `Clock` sysvar is validator-set and monotonic in practice; windows
are 30 minutes to 7 days, so sub-minute drift is irrelevant. Verdicts carry
`issued_at`/`expiry` with a 5-minute skew tolerance.

### Account and token edge cases

- Only the pinned SPL mint and the classic Token program are accepted
  (`WrongMint`; the account types reject Token-2022 accounts).
- Any token account passed as a destination must be owned by the registered
  owner (not just any account for the same owner is enough: the owner field
  is what is checked, so the user creating a second token account changes
  nothing).
- Proposal accounts are PDAs with one slot per category; a second concurrent
  proposal fails at `init`.
- Rent-refunds on close go to the authority.

## Accepted limitations (deliberate)

- Shield protects only what is inside the vault.
- Once money is in the trading wallet, Shield observes but cannot enforce.
- A determined user who waits 24h / 7d can always weaken or leave. That is
  the product: friction against impulses, not custody.
- Losing the authority key has no recovery in v1 (single-key self-custody).
- "Realised loss" is closed-cycle USDC accounting at the SPL level, not
  per-trade P&L. It is narrow and true rather than universal and guessed.
- The verdict is a single enclave signature, not a DON quorum (see
  `cre/README.md` for the native forwarder upgrade).
- The simulator is not a real TEE; deployed Confidential Workflows are a
  private beta.

## What was tested

46 program tests in LiteSVM with a warpable clock cover: deposits; instant,
gated and blocked top-ups; floor; 24h limit and structuring; window roll;
large-transfer threshold; proposal maturity, expiry, cancellation, refund and
one-shot execution; concurrent proposals; cooldown arming, expiry,
monotonicity, post-proposal arming; verdict trigger check, replay, expiry,
future-dating, binding, forged key, tampered message, missing precompile;
self-pause bounds; tighten monotonicity across every field; loosen delays
and floors; stale invalidation; no-griefing by verdicts; monitor
add/remove; registration rules and the scam-address case; cold transfers,
above-cap routing, full exit, substitution and stale exit; authorization on
every mutating instruction. Seven behaviour-engine tests cover sessions,
realised loss, streaks and reloads.


---

## 2026-09-06: ShieldVault.sol (HyperEVM / EVM)

The invariants above hold unchanged for the Solidity port; this section
records what is different on EVM and what was tested.

### Differences that matter

- **One contract, many vaults.** Vaults are keyed by the authority's address.
  There is no owner, admin, pauser or upgrade path in the contract; the only
  privileged party over a vault is its authority.
- **Release paths.** Five, as before. Execution destinations registered with
  `ROUTE_HYPERCORE` are paid via `CoreDepositWallet.depositFor(destination,
  amount, PERPS)`; the vault approves exactly `amount` and the call credits
  the destination's HyperCore account. `ROUTE_EVM` destinations and cold
  wallets receive a plain ERC-20 transfer. State is updated before external
  calls and every outbound function is `nonReentrant`.
- **Verdicts.** EIP-712 (`RiskVerdict`, domain `ShieldVault/1/chainId/contract`)
  recovered with `ecrecover`; high-s signatures and v ∉ {27, 28} are rejected.
  Binding is the authority address in the struct; a verdict for vault A cannot
  be replayed on vault B, and the domain pins the chain and the contract.
- **Registry enumeration.** `getRegistryOwners` exists so clients need no log
  scans; it is append-only.
- **Reconfirmation.** `executeRuleChange` is the only way a weakening applies,
  and only between `executeAfter` and `expiry` with an unchanged
  `configVersion`; nothing applies by itself when the timer ends.

### What Privy does and does not protect

- Privy's embedded wallet is the authority. Privy's TEE-enforced policies can
  additionally deny `HyperliquidTransaction:Withdraw` to non-vault
  destinations and deny key export; we treat those as **defence in depth on
  the trading side**, never as enforcement of the vault's rules.
- Privy documents that a user can always export their key unless the wallet
  is owned by a 2-of-2 quorum with the app. Shield does not co-own keys.
  Exporting the key does not weaken any vault rule: the rules bind the key.

### Attacks tested (contracts/test/ShieldVault.t.sol, 41 tests)

Direct calls by a stranger; raw transfer path (none exists); unregistered
and cold destinations for top-ups; floor breach; structuring below the daily
limit; check order (cooldown → floor → velocity → threshold); gated top-up
maturity and cancellation refunds; self-pause monotonicity and the 30-day cap;
verdict below trigger, replayed (same and lower nonce), wrong signer,
tampered, expired, from the future, without a monitor; verdict cannot shorten
a cooldown and never bumps `configVersion`; instant tighten superseding a
pending loosen; loosen maturity, expiry and delay floors; adding a destination
waits and then works; removing the monitor waits; one proposal per category;
cold transfer within cap during a cooldown, above cap, and sharing velocity;
full exit maturity and destination swap after registration removal; exit to
an execution wallet refused; anyone may deposit, nobody may withdraw.

### Accepted limitations (EVM)

- `depositFor` on testnet credits only addresses that exist on Hyperliquid
  mainnet (Circle's rule); the contract cannot detect a silently failed
  credit. On mainnet the credit is immediate.
- The verdict is one enclave signature; a DON-signed report through the CRE
  EVM forwarder is the production upgrade.
- Anvil demos use mocks of USDC and the CoreDepositWallet with the documented
  interfaces plus two demo-only functions (`withdrawToEvm`, `settleLoss`)
  that stand in for HyperCore behaviour.
