# Pass 1 — sponsor qualification gauntlet

Four adversarial prosecutors, one per sponsor plus a cold-read reproducibility
auditor, each given only the verbatim criteria in `CRITERIA.md` and told to find
reasons a sponsor would refuse to pay. Every finding below was re-verified
against the code, the chain or a command before anything was changed. Two were
wrong and are recorded as wrong; critics hallucinate too.

## The one sentence that matters

Shield's evidence is stronger than Shield's documentation. The Privy wallet
moved real money, the CRE workflow ran in the TEE simulator and landed a signed
verdict on chain, and the Substreams package streams live from The Graph Market
— while the README, `SUBMISSION.md`, `HUMAN_ACTIONS.md`, `HACKATHON_STRATEGY.md`
and `JUDGE_QA.md` all still told a judge that none of it had been done. Nothing
needed to be built. It needed to stop contradicting itself.

## Verdicts by clause

### The Graph — both tracks
| Clause | Before | After |
|---|---|---|
| Compose two or more products, or build on a standardized schema | **FAIL in practice** | **PASS.** The `ethereum_common:index_events` composition was declared in the manifest but the built `.spkg` carried an empty filter query, so the composition was inert. Rebuilt; `substreams info` now prints the populated query on both maps. |
| Consume live data from a Graph provider | **FAIL** | **PARTIAL, honestly stated.** The pipeline runs live against `hyperevm.substreams.pinax.network` and completes successfully (`docs/evidence/substreams-live.txt`), but emits no rows: The Graph indexes HyperEVM **mainnet** and the vault is on **testnet**. Only the mainnet deploy closes this. |
| Contribute a reusable composable module | **FAIL** | **PASS.** Both `.spkg` artefacts are committed rather than gitignored, and the package URL typo (`shiedler` → `shielder`) is fixed. |
| Public repository | **FAIL** | **Still FAIL — human action.** |
| AI track | **FAIL** | **Still FAIL.** There is no AI in the shipped product. `AI_USAGE.md` is about AI writing the repo, which is a different thing. Do not enter this track. |

### Privy — Best Financial Flow
Qualifies on the merits and always did. A Privy embedded wallet (nonce 4) moved
$5.00 of USDC out of a no-admin vault into a Hyperliquid Core account: tx
`0x94960d1f…889be`, block 63581864, verified log by log. The failures were that
the README called it unrun, and that the app's own Activity screen showed the
vault as empty because the indexer started after the transaction. Both fixed.
**Best B2B Financial Product is not claimable** — it needs Privy policies,
quorums or session signers, none of which Shield implements.

### Chainlink — Best Confidential Workflow
`handlerInTee` is genuinely registered, the confidential handler does all the
evaluation and signing rather than wrapping work done outside it, and the
verifier key is read in-enclave via `runtime.getSecret` and used to produce the
EIP-712 signature. The on-chain result verifies exactly as claimed. The
prize-losing defect was that six judge-facing passages said the CLI simulation
could not be run, and the transcript existed nowhere in the repo. It is now at
`docs/evidence/cre-simulate.txt`, and the documented command — which failed on
its first argument and pointed at the Solana target — is corrected.
**The Continuity track is not claimable**: Shield is net-new, so there is no
existing project to improve. The repo already declines it; it still should.

## Findings the prosecutors got wrong

- **"The shipped `.spkg` has no blockFilter on any module."** It did have one on
  both maps. What it lacked was a populated *query*, because the artefact
  predated the manifest edit. Directionally right, materially wrong, and it
  would have sent us rewriting a manifest that was already correct.
- **"Substreams can never emit data because the manifest hardcodes testnet
  addresses on a mainnet network."** True today but not the stated cause: the
  real defect was that `params` and `blockFilter.query` named *different*
  contracts, so the pipeline streamed the right blocks and decoded nothing.

## Fixed in this pass

- Substreams `params` and `blockFilter` aligned, with a test that fails if they
  drift; package rebuilt; `initialBlock` moved off 0, which had made any
  stateful run backprocess 45 million blocks and fail outright.
- Return detection in `substreams-evm/src/lib.rs` resolved the owning vault only
  from ShieldVault events **in the same block**. The ordinary case — a venue
  returning funds in its own transaction — has no such event, so returns were
  silently dropped. This is the measurement the entire product rests on. Now
  resolved through a reverse index, and filtered to the USDC contract rather
  than counting any inbound ERC-20 as a return.
- Reading a vault was eleven sequential `eth_call`s, which tripped the public
  RPC's rate limiter and left the app on "Reading your vault" for 46 seconds and
  counting. Multicall3 makes it two requests and 483ms.
- The same flaw on the write path reported a rate-limited pre-flight to the user
  as "Rejected by the vault" for a transaction the chain never saw.
- The indexer could not backfill at all: the public RPC caps `eth_getLogs` under
  200 blocks, the cursor only advanced after an entire range succeeded, and
  transient upstream errors were treated as fatal. All four vaults now index in
  about a minute, and Activity tells the real story instead of "Nothing yet".
- No public explorer indexes HyperEVM testnet — the one the app linked to reports
  the vault as an EOA with zero transactions. Dead "View" links are worse than
  none, so they degrade to a copyable hash with the `cast` command that works.
- Repo hygiene before going public: 96 tracked symlinks into the author's home
  directory, a 912 KB CRE build temp file, and an ignored lockfile.
- Stale Solana artefacts in user-facing copy: the landing page said "You sent
  $1,500 to Axiom" and "an immutable on-chain program"; `package.json` described
  a vault on Solana.

## Open, and not fixable from here

1. **The repository is private.** Every track requires a public repo. Nothing
   else in this document matters until that changes.
2. **The HyperEVM mainnet deploy.** It is the single change that turns The
   Graph's hardest clause from FAIL to PASS, and it also gives every transaction
   a working block explorer. It needs real money — see `HUMAN_ACTIONS.md`.
3. **The demo video.** Required by all three tracks; does not exist.
