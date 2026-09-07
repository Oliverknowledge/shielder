# Human actions

Five things are left. Everything a machine could do is done: the contract is live on HyperEVM testnet, a Privy embedded wallet has
moved real USDC to HyperCore, `cre workflow simulate` has run and its transcript
is committed, and the Substreams package streams live from The Graph Market.
The evidence for all of that is in `docs/SPONSOR_INTEGRATIONS.md`; the facts it
is allowed to assert are pinned in `docs/internal/gauntlet/FACTS.md`.

Ordered by leverage. #1 is worth more than #2 and #3 combined, because without
it neither of them can be judged. #4 and #5 are small, but both are decisions
that get much cheaper if you make them *before* #1, not after.

---

## 1. Make the repository public (5 minutes, no cost)

**All three sponsors require it.** The Graph: "Submit a public repository".
Privy: "Provide a working demo and access to the project's source code".
Chainlink: evidence a judge can open. `github.com/Oliverknowledge/shielder` is
private today.

**The decision you have to make:** which branch a judge lands on. The remote's
default branch is `main`, and it currently sits 22 commits behind
`office-hours`, which is where all of this work is. Either fast-forward `main`
or point the default branch at `office-hours`. A judge who clones the default
branch and finds a stale tree reads it as an abandoned project. Check the gap
before you flip anything: `git rev-list --count origin/main..office-hours`.

```bash
# 1. Confirm nothing sensitive is tracked. Expect no output.
git ls-files | grep -E '(^|/)\.env$|\.shield/|hyperevm-keys|keypair\.json'

# 2. Push the work. Push branches only.
git push origin office-hours

# 3. Then EITHER fast-forward the default branch (remote main is an ancestor of
#    office-hours, so this is a clean fast-forward and needs no checkout —
#    which matters here, because main may be checked out in another worktree)...
git push origin office-hours:main
#    ...OR move the default branch instead:
gh repo edit Oliverknowledge/shielder --default-branch office-hours

# 4. Flip visibility.
gh repo edit Oliverknowledge/shielder --visibility public \
  --accept-visibility-change-consequences
```

**One thing to know before you flip it.** `.env`, `cre/.env` and `.shield/` are
gitignored and untracked, so no key is in any branch. There *is* one `.env` blob
in the object database, added by a local `refs/conductor-checkpoints/…` snapshot
ref that no branch reaches — `git push origin <branch>` cannot publish it, but
`git push --all` or `git push --mirror` would. Push named branches only.

---

## 2. Deploy the vault to HyperEVM mainnet (about 20 minutes, roughly two cents of gas plus whatever USDC you choose to protect)

This is the one change that turns The Graph's hardest clause from FAIL to PASS.
The Substreams package streams live from a Graph Market provider today and
returns **no rows**, because The Graph indexes HyperEVM **mainnet (999)** — there
is no HyperEVM testnet entry in its networks registry — and the vault is on
**testnet (998)**. A mainnet vault is the only way that stream produces a row.

**The decision you have to make:** how much real USDC to put behind a live
vault. The contract is immutable and enforces what you set: lowering a floor or
raising a limit waits 24 hours by design, and there is no owner and no upgrade
path. Pick a number you are content to have locked for the judging window. The
deployer holds **4.8 USDC on HyperCore**, so anything above that also needs
funding.

**Costs, checked on 2026-09-07.** Mainnet base fee 0.115 gwei; the deployment is
5,364,724 gas, so **about 0.0006 HYPE — roughly two cents**. The four setup
transactions come to well under a cent. The deployer
`0x05a7a130869a793719BB6B341009ea3B70588DCb` holds **0.0000564 HYPE** on
HyperEVM mainnet, about a tenth of what the deploy costs, so gas has to be
bridged from HyperCore first.

**The procedure is `docs/MAINNET_RUNBOOK.md`** — every step in it was executed
against a fork of mainnet state before being written down, and it is not
repeated here. Four things it is worth knowing before you start:

- Bridge gas first: `EVM_DEPLOYER_KEY=0x… EVM_CHAIN_ID=999 bun run scripts/hyperevm-bridge.ts HYPE <amount>`.
  It dust-probes before sending the rest, because a Core→EVM transfer is a
  `spotSend` to a system address and a wrong one loses the funds.
- Big blocks are required on mainnet exactly as on testnet: a 5.4M-gas
  deployment does not fit a small block. `bun run hyperevm:big-blocks on`
  before `forge create`, and `off` immediately after, or ordinary vault
  transactions take a minute each.
- Pass `USDC_ADDRESS=0xb88339CB7199b77E23DB6E890353E22632Ba630f` explicitly.
  `scripts/hyperevm-bootstrap.ts` deliberately refuses to guess mainnet USDC.
  (Read back today: `symbol()` → `USDC`, `decimals()` → 6.)
- `EVM_START_BLOCK` must be set to the new deploy block or explicitly cleared,
  or the testnet value in `.env` is silently reused and the indexer starts in
  the wrong place.

**Then, for The Graph** — two edits in `substreams-evm/substreams.yaml` and
nothing else in the pipeline changes:

1. The two `evt_addr` filter strings and the `params:` block name the mainnet
   vault and `0xb88339CB…630f` instead of the testnet addresses.
2. `initialBlock` (currently `45220000`) becomes the vault's deploy block.

```bash
bun run substreams:hyperevm                      # expect flow rows, not just "Completed successfully"
EVM_CHAIN_ID=999 bun run server:evm
curl -s localhost:8788/api/health | jq .source   # expect {"mode":"substreams", …}
```

**Known gap, so budget for it:** the `CHAIN_ID === 999` branch in
`server/evm-index.ts` turns the Substreams source on and the demo endpoints off,
and it has never run against a real vault because until now there was none.
Exercise it straight after the deploy, not during the recording.

---

## 3. Record the 2–4 minute demo video and submit (about an hour)

Every track requires it — The Graph and Privy name it in their criteria,
Chainlink accepts it as the evidence of execution — and it does not exist.

**The decision you have to make:** record before or after #2. After is better if
#2 lands, because the Graph story becomes something you can show rather than
explain. Before is the safe fallback if mainnet funding stalls; in that case say
on camera that the vault is on testnet and that The Graph indexes mainnet only.
Do not imply otherwise — the transcript in `docs/evidence/substreams-live.txt`
says so in writing and a judge will read it.

Rules the upload is checked against: 2 to 4 minutes (anything outside is
rejected outright), 720p or better, no speed-up, no AI voice-over, no phone
recording. The beat-by-beat script is `docs/DEMO_SCRIPT.md`.

**Sign in as the right vault.** One contract holds many vaults, keyed by
authority address, and signing in with a key that owns an empty one shows a real
but empty dashboard that looks like a bug.

| Vault authority | State | Use it? |
|---|---|---|
| `0x9872f09D96bcA7f878CEe9c4bDc8bCcA269dB006` | $600 balance, floor $500, $100/24h | **Yes** — key in `.shield/hyperevm-keys.json` under `authority` |
| `0x83144b99D89947703714Ee9aA3A3614985041D2B` | $45, floor $10 — the Privy embedded wallet | Yes, for the Privy beat: sign in with email, not a pasted key |
| `0x05a7a130869a793719BB6B341009ea3B70588DCb` | $0 balance, floor $6,000 | **No.** The floor exceeds anything you can deposit and lowering it waits 24 hours. This is the funder and the registered Hyperliquid destination, not a vault to demo |

```bash
SHIELD_PORT=8788 bun run server:evm    # indexer + monitor + relayer + API on :8788
bun run dev:app:hyperevm               # http://localhost:5174
```

**Filming the cooldown needs a fresh loss.** A verdict only lands when there is
one, and nonce 1 is already consumed on both the demo vault and the CRE vault
(`0x751D1e26d79FeffE95F8a8662aB7A022780ED023`). Stage one first — release, then
send back less than you released — or the verdict is correctly refused on camera.
Send it back with `deposit(authority, amount)` from the trading wallet, **not**
with a plain USDC transfer to the vault address: the contract credits
`v.balance` only inside `deposit()`, so a raw transfer is stranded and cannot be
recovered by anyone. There is already $30.50 stuck in the deployed contract that
way (`docs/THREAT_MODEL.md`, Known gaps 7).

**Then submit** on ETHGlobal before **Sunday 13 September, 12:00 pm EDT**
(16:00 UTC); late submissions are not accepted. Partner prizes: **The Graph**,
**Privy**, **Chainlink**. Paste from `docs/SUBMISSION.md`.

---

## 4. Decide what to do with `CLAUDE.md` and `.claude/hooks/check-gstack.sh` (5 minutes)

Both are in the repository and both are hostile to a stranger. `CLAUDE.md`
opens with "Before doing ANY work, verify gstack is installed" and instructs the
agent to **stop and refuse** if it is not. `.claude/hooks/check-gstack.sh` backs
that up mechanically: `.claude/settings.json` registers it as a `PreToolUse`
hook on the `Skill` tool, and it returns `"permissionDecision":"deny"` and exits
2 whenever a third-party toolchain (`github.com/garrytan/gstack`) is not found
in one of a dozen home-directory locations. That is a private-repo convention.
In a public repository it means a judge or a contributor who opens the project
in Claude Code, Codex or Cursor has a tool denied outright, with an install
instruction for software that has nothing to do with Shield and that they did
not ask for. It reads as a dependency the project does not have.

**The decision is yours; nothing has been deleted.** Two reasonable options:

- Delete both `CLAUDE.md` and `.claude/hooks/check-gstack.sh` before publishing.
  Nothing in the build depends on them.
- Keep them but make them non-blocking: drop the hook entirely (it is the part
  that denies), and reduce `CLAUDE.md` to a note saying which tools the authors
  used, with no "STOP" and no refusal instruction.

Either way, if you remove the script also remove the `PreToolUse` block in
`.claude/settings.json` that points at it, so nothing is left referencing a
missing file.

---

## 5. Decide whether to rewrite git history, and do it before the repo is public (15 minutes)

`.git/objects` is **22 MB**; every tracked file in the working tree adds up to
**4.0 MB**. The difference is almost entirely the first commit, `816fdca`
"Initial commit with gstack", which imported **1,623 files, about 27 MB** of a
vendored third-party toolchain. The second commit, `e3cd394`, deleted them —
1,529 files, 390,601 deletions — so they are in nobody's working tree and in
everybody's clone.

The repository is pushed to `origin` (private) and both remote branches contain
`816fdca`. **It has not been made public yet, and that is the whole window.**
Right now a rewrite is a `git filter-repo` run and one force-push, and the only
person it inconveniences is you. Once the repository is public — and especially
once a judge has cloned it or anyone has forked it — a rewrite breaks every
clone, every fork and every commit link, and the old objects stay reachable on
GitHub through the fork network anyway. The cost goes from fifteen minutes to
not worth doing.

Do it or decline it deliberately. It is not urgent for judging: 22 MB clones
fine and no judge will notice. It only becomes permanent.

If you do it, do it **before** step #1, on a mirror, and re-run the secret check
in #1 afterwards.

---

## 6. Optional, and the best Solidity work available: fix the three defects

Not needed for the submission. Worth doing because you said you wanted to write
some of the contract yourself, and because this is real work with real value
rather than an exercise.

`contracts/test/KnownDefects.t.sol` holds three failing-by-design tests that
assert what `ShieldVault.sol` currently *does*. Each one is a bug, each one is
disclosed in `docs/THREAT_MODEL.md`, and each one has a small, self-contained
fix that cannot be made to the deployed contract because it is immutable:

1. `_refundVelocity` refunds into the bucket index stored at proposal time,
   which after a full lap of the window is current again and holds unrelated
   spend. Store the reservation's absolute timestamp and refund only if the
   window has not rolled since.
2. `tighten` bounds `lossCooldownSecs` and the self-pause but places no upper
   bound on `loosenCooldownSecs` or `fullExitCooldownSecs`, so a user can lock
   themselves out of their own exit in one instant, unconfirmed call. Add the
   bounds.
3. `_rollBuckets` clamps `elapsed` before using it to advance `bucketStart` and
   never advances `currentBucketIndex` in the long-idle branch, so an idle gap
   refunds the whole daily limit once per idle day, in a single block. Advance
   `bucketStart` to the current window and the index with it.

The tests are already written and they describe the bug precisely. Invert each
assertion, make it pass, and you have a v2 worth deploying. Nothing else in the
contract needs to change.
