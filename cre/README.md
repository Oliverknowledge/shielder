# Shield × Chainlink CRE — the confidential loss-rule monitor

`cre/shield-risk` is a Chainlink Runtime Environment (CRE) **Confidential
Workflow**. It is the tamper-resistant version of the monitor that Shield's
server also runs: same pure evaluation code, but executed inside a TEE with
a signing key that only exists in the enclave.

## What runs inside the enclave (`handlerInTee`)

| Step | Inside the enclave | Why it matters |
|---|---|---|
| 1 | `runtime.getSecret({ id: "SHIELD_VERIFIER_SEED_B64" })` | The Ed25519 seed behind the key the user's vault pinned as `risk_verifier`. Not even Shield's operator can sign a verdict outside the enclave. |
| 2 | `HTTPClient.sendRequest(teeRuntime, …)` for `/api/vault/:vault` and `/api/vault/:vault/flows` | The user's on-chain policy and raw capital flows (a person's trading history) are fetched into the enclave, not into a server process. |
| 3 | `deriveProfile()` + `assess()` (`server/behaviour.ts`, `server/policy.ts`) | Sessions, realised loss, streaks and reloads are re-derived independently from the raw flows; the enclave does not trust the server's opinion. |
| 4 | `signVerdict()` | The verdict (attested loss, evidence hash, nonce, expiry, vault + program binding) is signed in the enclave. |
| 5 | `HTTPClient.sendRequest(teeRuntime, POST /api/verdicts)` | Only the signed verdict and the public evidence bundle leave. The relayer submits it; the vault verifies the signature with the Ed25519 precompile. |

What the vault does with it (`programs/shield-vault/src/lib.rs`,
`apply_risk_verdict`): checks the verifier matches the pinned key, the
binding, the expiry, the strictly increasing nonce, and that the attested
loss is **at or above the user's own trigger**; then arms a cooldown of the
**user's own length**. The workflow never chooses a duration and can never
move money, loosen a rule, or touch cold transfers and exits.

## Simulate (the bounty's accepted evidence)

Every `cre` command needs a Chainlink account (free): create an API key at
https://app.chain.link (Account Settings) or run `cre login`.

```bash
# 0. Shield's server must be running with a vault that has a loss to report
bun run server/index.ts &                     # http://localhost:8787
bun run client/demo.ts top-up 1500 && bun run client/demo.ts return 80

# 1. Secrets for the enclave (base64 seed of the demo verifier the vault pinned)
cp cre/.env.example cre/.env
bun run scripts/print-verifier-seed.ts >> cre/.env   # fills SHIELD_VERIFIER_SEED_B64
export CRE_API_KEY=...                                # or: cre login

# 2. Simulate the confidential workflow against the live vault
VAULT=$(jq -r .vault .shield/demo-state.localnet.json)
cre workflow simulate cre/shield-risk --target staging-settings --non-interactive \
  --trigger-index 0 --http-payload "{\"vault\":\"$VAULT\"}" -R cre -e cre/.env
```

Expected output: the simulator's TEE banner (`Trigger requested TEE
Execution … AWS Nitro in us-west-2`), `[USER LOG] Enclave evaluation: …
triggered=true actionable=true`, `[USER LOG] Verdict #N relayed on-chain:
<signature>`, and a `Workflow Simulation Result` JSON with the attested
loss, evidence hash and the Solana signature of the `apply_risk_verdict`
transaction the vault accepted. Run `bun run client/demo.ts top-up 100`
afterwards and the vault rejects it with `CooldownActive`.

Compile only (no account needed):

```bash
bunx cre-compile cre/shield-risk/main.ts cre/shield-risk/dist/shield-risk.wasm
```

## Trust model, stated plainly

- The simulator "is not a real TEE"; a deployed Confidential Workflow runs in
  AWS Nitro with the seed released by the Vault DON only into an attested
  enclave. Deployment is an invite-only private beta; simulation is the
  documented hackathon path.
- The verdict is a single Ed25519 signature from the enclave key, verified by
  the Solana program. It does not carry DON consensus. The native alternative
  (`SolanaClient.writeReport` through the Keystone Forwarder, ECDSA f+1
  signatures) is the production upgrade: add an `on_report` instruction with
  the same extend-only semantics and pin the forwarder. Either way the vault's
  own rules are the floor, and the monitor can only tighten.
- Shield's server runs the identical evaluation as a deterministic demo path
  (`server/index.ts`, `SHIELD_MONITOR=1`). Point the vault's `risk_verifier`
  at the enclave key and disable the server monitor to make the enclave the
  only signer.
