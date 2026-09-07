# Shield × Chainlink CRE — the confidential loss-rule monitor

`cre/shield-risk` is a Chainlink Runtime Environment (CRE) **Confidential
Workflow**. It is the tamper-resistant version of the monitor Shield's server
also runs: the same pure evaluation code, executed inside a TEE, with a signing
key that only exists inside the enclave.

The shipped product is on **HyperEVM (chain 998)**, so the EVM path
(`config.evm.json`, EIP-712 verdicts, `ShieldVault.sol`) is the live one. The
Solana v0 path is still present and still compiles; it is not the path to run.

## What runs inside the enclave (`handlerInTee`)

`handlerInTee` is imported from `@chainlink/cre-sdk` and registered at
`cre/shield-risk/main.ts:88` with `[{ tee: "nitro", regions: ["us-west-2"] }]`.
The whole evaluation runs inside it.

| Step | Inside the enclave | Why it matters |
|---|---|---|
| 1 | `runtime.getSecret({ id: "SHIELD_EVM_VERIFIER_KEY" })` (`cre/shield-risk/evaluate.ts:89`) | The secp256k1 private key whose address the user's vault pinned as `riskVerifier`. Mapped in `cre/secrets.yaml`. In a deployed workflow the Vault DON releases it only into an attested enclave. **This is the sensitive input the bounty requires.** |
| 2 | `HTTPClient.sendRequest(teeRuntime, …)` for `/api/vault/:vault` and `/api/vault/:vault/flows` | The vault's policy and its capital flows are fetched into the enclave rather than into a server process. |
| 3 | `deriveProfile()` + `assess()` (`server/behaviour.ts`, `server/policy.ts`) | Sessions, realised loss, streaks and reloads are re-derived from the raw flows; the enclave does not trust the server's opinion. |
| 4 | `signVerdict()` / `evm-verdict.ts` | The verdict — attested loss, evidence hash, nonce, expiry, vault + contract binding — is signed as EIP-712 inside the enclave. |
| 5 | `HTTPClient.sendRequest(teeRuntime, POST /api/verdicts)` | Only the signed verdict and the public evidence bundle leave. Shield's relayer submits it; `ShieldVault.sol` recovers the signer and checks it against the address the **user** pinned. |

### What is and is not confidential — read this before writing a claim

The clause Shield satisfies is *"the confidential portion must process at least
one sensitive input, secret, confidential API response, private parameter"*.
The sensitive input is the **verifier private key** in step 1. It is read
in-enclave, used in-enclave, and only its signature leaves.

Do **not** claim that the capital flows entering the enclave are confidential.
They are fetched over plain HTTP from an unauthenticated local endpoint, and
they are derived from public logs on a public chain — anyone can read them.
Saying otherwise is an overclaim a judge can disprove in one request, and it
would be the only false sentence in an otherwise checkable submission.

## What the vault does with a verdict

`ShieldVault.sol:536-558` (`applyRiskVerdict`) checks that the recovered signer
matches the pinned `riskVerifier`, the domain binding, the expiry, and a
strictly increasing nonce, and that the attested loss is **at or above the
user's own `lossTriggerUsdc`**. It then arms a cooldown of the **user's own
`lossCooldownSecs`**.

A verdict carries no duration, no floor, no limit and no destination.
`cooldownUntil` only ever moves forward. Cold transfers and the full exit are
never gated by it. The worst a compromised enclave can do is bounded by
`MAX_LOSS_COOLDOWN_SECS = 30 days`; the invariant is tested at
`ShieldVault.t.sol:259-261`.

## Simulate — the evidence Chainlink asks for

Chainlink's criterion is *"provide evidence of successful simulation or
deployment in the submission, such as demo video or execution logs"*. A verbatim
transcript is committed at **`docs/evidence/cre-simulate.txt`**; the video beat
that films it is in `docs/DEMO_SCRIPT.md`.

Every `cre` command needs a Chainlink account (free): see
<https://docs.chain.link/cre>, or run `cre login`.

### Prerequisites

```bash
# 1. Shield's EVM server must be answering on http://localhost:8788
#    (config.evm.json points the enclave's HTTP calls there)
bun run server:evm

# 2. cre/.env — copy the example and fill in the two keys it documents
cp cre/.env.example cre/.env
#    SHIELD_EVM_VERIFIER_KEY  — required for the EVM path; without it the run
#                               fails at runtime.getSecret and nothing is signed
#    SHIELD_VERIFIER_SEED_B64 — only for the Solana v0 path
```

### The command that works, from the repository root

```bash
cre workflow simulate shield-risk --target evm-settings --non-interactive \
  --trigger-index 0 --http-payload '{"vault":"0x751D1e26d79FeffE95F8a8662aB7A022780ED023"}' \
  -R cre -e cre/.env
```

Two things about that command are easy to get wrong:

- `-R cre` sets the project root to `cre/`, which makes the workflow path
  `shield-risk`. Without it, pass `cre/shield-risk`. Passing both is the
  common mistake and it fails to resolve.
- The target selects both the RPC set (`cre/project.yaml`) and the workflow
  config (`cre/shield-risk/workflow.yaml`):

  | `--target` | Config | RPCs | Use it for |
  |---|---|---|---|
  | `evm-settings` | `config.evm.json` — HyperEVM 998, `secretId: SHIELD_EVM_VERIFIER_KEY` | Sepolia only | **This is the one.** The live EIP-712 path. |
  | `staging-settings` | `config.staging.json` — Solana v0 | solana-devnet + Sepolia | The v0 path. The CLI validates every RPC a target declares, so this one demands a funded `CRE_SOLANA_PRIVATE_KEY` the workflow never uses. |
  | `production-settings` | `config.production.json` | mainnets | Unused; kept so the target set is complete. |

### Expected output

The simulator's TEE banner —

```
Trigger requested TEE Execution your trigger will run in one of the following Tees:
    - AWS Nitro in us-west-2
```

— then one `[USER LOG] Enclave evaluation: vault=… triggered=… actionable=…`
line, a `Workflow Simulation Result` JSON with the attested loss and evidence
hash, and `Simulation complete!`.

`actionable: false` is a correct result, not a failure. The enclave only signs
when the loss is newer than the vault's last verdict *and* the new cooldown
would extend the current one; a vault already in cooldown from the same loss
declines to double-arm. To make a run actionable, produce a fresh realised loss
for that vault first.

An actionable run signs and relays, and the vault applies it. The one on record:
tx `0x2e411cea49a5c8edff69dddb7376aca1b5c2eee9f92be1fcb12f78733676bb35`, block
63584417, `RiskVerdictApplied(nonce=1, reasonCode=1, realizedLossUsdc=3500000,
cooldownUntil=1788776770, extended=true, evidenceHash=0x4c7946…918b)`. Verify it
with:

```bash
cast tx 0x2e411cea49a5c8edff69dddb7376aca1b5c2eee9f92be1fcb12f78733676bb35 \
  --rpc-url https://rpc.hyperliquid-testnet.xyz/evm
```

There is no public block explorer that indexes HyperEVM testnet, so `cast` is
the verification. See `docs/gauntlet/FACTS.md`, "Explorers".

### Compile only (no account needed)

```bash
bun run build:cre
# = bunx cre-compile cre/shield-risk/main.ts cre/shield-risk/dist/shield-risk.wasm
```

## Trust model, stated plainly

- The simulator says of itself: *"The simulator is not a real TEE, and is meant
  to debug."* A deployed Confidential Workflow runs in AWS Nitro with the secret
  released by the Vault DON only into an attested enclave. Deployment is an
  invite-only private beta (`cre account access`); simulation is the documented
  hackathon path and the evidence the criterion names.
- The verdict is a single EIP-712 signature from the enclave key, verified by
  `ShieldVault.sol`. It does not carry DON consensus. The native alternative —
  writing a DON report through the Keystone Forwarder, with its ECDSA f+1
  signatures — is the production upgrade: add a report entry point with the same
  extend-only semantics and pin the forwarder address. Either way the user's own
  rules are the floor and the monitor can only tighten.
- Shield's server runs the identical evaluation as a deterministic path
  (`server/evm-index.ts`, `SHIELD_MONITOR=1`). Point the vault's `riskVerifier`
  at the enclave key and turn the server monitor off to make the enclave the
  only signer. The two share `server/behaviour.ts` and `server/policy.ts`
  verbatim, which is why a server-relayed verdict and an enclave-relayed one
  produce the same evidence hash for the same flows.
- The CLI warns that `SHIELD_EVM_VERIFIER_KEY` and `SHIELD_VERIFIER_SEED_B64`
  use their own names as env vars. That is intentional here — one name to look
  up in `cre/secrets.yaml`, `cre/.env.example` and this README — and the warning
  is harmless.

## Not claimed

The **Best Chainlink-Powered Upgrade (Continuity)** track needs an existing
project the integration improves. Shield is net-new (first commit 2026-09-04),
so that track is declined. Keep declining it.
