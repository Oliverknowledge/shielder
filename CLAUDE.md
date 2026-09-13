# Notes for AI coding agents

Nothing here is required to build, test or run Shield. See `README.md` for that.

This project was built with AI coding agents (Claude Code, plus the `gstack`
skill suite the authors use locally). Earlier revisions of this file instructed
the agent to **stop and refuse** if `gstack` was not installed, and a
`PreToolUse` hook in `.claude/settings.json` enforced it by denying the `Skill`
tool outright. Both are gone: they were a private-repo convention, and in a
public repository they mean anyone opening the project in Claude Code, Codex or
Cursor has a tool denied and is told to install third-party software that has
nothing to do with Shield. If you use `gstack`, it still works; if you do not,
nothing is missing.

Useful things to know before changing code:

- `contracts/src/ShieldVault.sol` is **deployed and immutable**. Changing it
  produces a new deployment, never an upgrade. `docs/internal/gauntlet/FACTS.md`
  pins which address is current.
- `bun test tests/ server/` and `cd contracts && forge test` both must pass.
  `bun run typecheck` is part of `bun run lint`.
- Judge-facing documents may only assert what is in
  `docs/internal/gauntlet/FACTS.md`. If a claim is not there, verify it against
  the chain or a command you actually ran, and add it there first.
