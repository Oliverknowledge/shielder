# AI usage disclosure

ETHGlobal's rules ask for attribution of AI tools and, for spec-driven
workflows, the prompts and planning artifacts. This is that disclosure.

## What was used

- **Claude (Anthropic), via Claude Code inside Conductor**, as the primary
  engineering agent for the whole build window (Sept 4–6, 2026): research,
  design, code, tests, QA in a headless browser, and documentation. The
  Sept 6 sprint (Hyperliquid-first architecture, ShieldVault.sol, EVM
  server, Privy integration, landing page, safety flows) ran as a scheduled
  autonomous session directed by `docs/internal/planning/SPRINT_BRIEF_2026-09-06.md`;
  three research subagents fetched the live Hyperliquid, Privy, The Graph
  and ETHGlobal documentation that `docs/ARCHITECTURE_DECISION.md` cites.
- **gstack** (open-source Claude Code skill pack) for office-hours style
  design review and the headless-browser QA tooling.
- **ChatGPT (OpenAI)** as an independent hostile reviewer of the design
  document on Sept 4 (two rounds), whose findings are recorded in
  `docs/designs/shield-treasury-vault.md` ("Reviewer Concerns").
- **The official Substreams SKILLs** (`streamingfast/substreams-skills`,
  `substreams-solana` and `substreams-dev`) to build the Substreams package
  the way The Graph's tooling prescribes. See `docs/substreams-one-prompt.md`.

## Where

Every file in this repository was written with AI assistance, directed by
the human author's decisions (product wedge, threat model corrections, the
"tighten fast / loosen slowly" principle, the choice to stay Solana-native,
the loss-rule semantics). The human reviewed the design at each gate and
ran the review loops. Nothing was pasted from a prior project.

## Planning artifacts (kept verbatim)

- `docs/internal/planning/BUILD_BRIEF.md`: the Sept 5 build brief that directed the agent.
- `docs/internal/planning/SPRINT_BRIEF_2026-09-06.md`: the Sept 6 sprint brief (Hyperliquid-first).
- `docs/designs/shield-treasury-vault.md`: the design document with its
  three Claude review rounds and two ChatGPT hostile-review rounds.
- `docs/HACKATHON_STRATEGY.md`, `docs/ARCHITECTURE_DECISION.md`,
  `docs/THREAT_MODEL.md`: written during the build, from live research.

## What the AI did not do

It did not decide what Shield is for, did not choose the sponsors on its own
(it researched and argued; the human set the constraints: no bounty
stuffing, sponsor follows product), and did not create accounts or spend
funds. Items that need a human (Graph Market key, Chainlink API key, devnet
SOL, the demo video) are listed in `HUMAN_ACTIONS.md`.
