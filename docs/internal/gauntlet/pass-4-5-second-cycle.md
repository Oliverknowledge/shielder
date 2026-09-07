# Passes 4 and 5 — the second cycle

Fresh agents, told nothing about what the first cycle found, looking at the
product as it stood after two rounds of fixes. The point was regressions and
blind spots, and both showed up.

## Pass 4 — sponsor qualification, re-audited

Verdicts, all re-verified against the chain and the running system rather than
against any document:

- **The Graph, composable track.** The composition is real *in the built
  artefact*, not just the manifest, and the live run against the Graph Market
  provider reproduces. It emits no rows, because The Graph indexes HyperEVM
  mainnet and the vault is on testnet. `SUBSTREAMS_ACTIVE` is false in the
  shipped config, so The Graph is not load-bearing today. Podium-capable, not
  first, and the mainnet deploy is the single change that moves it.
- **The Graph, AI track.** Correctly declined. There is no AI in the shipped
  product and entering would cost credibility on the track that can be won.
- **Privy, Best Financial Flow.** The cleanest of the three. The embedded wallet
  is genuinely the vault's authority — verified on chain — and the $5
  HyperEVM→HyperCore release is a complete financial flow, verifiable log by log.
  No commercial-tier or mocked features are counted anywhere.
- **Chainlink, Best Confidential Workflow.** Stronger than the docs were
  claiming. The auditor proved the secret is load-bearing with a negative test —
  substituting a bad key fails the workflow before it can do anything else — and
  traced the chain of custody from `secretId` through `secrets.yaml` to the key
  whose address both live vaults pin as `riskVerifier`.

### What it caught that the first cycle did not

Three of its four P0s existed **because this gauntlet had been editing faster
than its own evidence**: docs quoted a line that no longer appeared in the
regenerated transcript, and the single most-cited code reference for Chainlink's
decisive criterion pointed at a line that had moved when the venue read was
added above it. Its closing note is the discipline for any future round:

> Freeze the code, then regenerate every transcript and citation last.

Acted on: the CRE evidence now contains the negative-secret test alongside the
successful run, using a new non-delivering target so it can be reproduced without
broadcasting a verdict; `substreams:hyperevm` runs the committed package rather
than rebuilding the wasm, which was the entire reason for committing it; the
Behaviour footer prints the server's own sentence about the Graph limitation,
which Welcome had been claiming the app said and it did not.

## Pass 5 — the user, cold, a second time

Caught a regression this gauntlet introduced two hours earlier: the blocked
screen's primary action had been renamed to **"Move money to safety"**, and it
moves nothing — it opens a sheet that locks funding down further, while
Protection has a real "Move funds" button that does send USDC. Naming a lock
after a transfer, on the screen where the user is already suspicious, is exactly
the kind of thing that stops the rest of the copy being believed.

Also found and fixed:

- **"Back" did nothing.** It cleared the local rejection, but the screen falls
  back to the live cooldown, so the identical page re-rendered and the app looked
  frozen.
- **The countdown expired into a second refusal.** It ran to the cooldown while
  the daily budget refilled eight hours later, and said nothing about it.
- **The correction was buried.** The explanation for why a pause runs while
  today's realised loss is $0 was nine items down the third tab. Anyone who did
  not scroll there got the raw contradiction and read it as a broken app rather
  than a corrected one. It is in the red banner on Home now.
- **Capital still sitting at the venue was drawn in loss-red with a minus sign.**
  To a trader that is money that is gone.
- **The reset screen's ninety seconds.** The lock behind it had already gone, so
  what remained was ninety seconds of sitting still for pressing a link, on a
  screen that had just said the realised loss was zero. Ten.

Its verdict, which is the useful summary: *"the writing is better than 95% of
crypto apps I've closed, and the product is currently punishing me for a loss it
admits, in its own words, was never a loss."* The first half survived the pass;
the second half is fixed.
