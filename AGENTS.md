# Notes for AI coding agents

See [`CLAUDE.md`](./CLAUDE.md) — same guidance, whichever agent you are using.
Nothing in either file is required to build, test or run Shield; `README.md`
covers that.

The short version:

- `contracts/src/ShieldVault.sol` is **deployed and immutable**. Changing it
  produces a new deployment, never an upgrade. `docs/internal/gauntlet/FACTS.md`
  pins which address is current.
- `bun test tests/ server/` and `cd contracts && forge test` both must pass.
  `bun run typecheck` is part of `bun run lint`.
- Judge-facing documents may only assert what is in
  `docs/internal/gauntlet/FACTS.md`. If a claim is not there, verify it against
  the chain or a command you actually ran, and add it there first.
