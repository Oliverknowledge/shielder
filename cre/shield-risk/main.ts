/**
 * Shield risk monitor — a Chainlink CRE Confidential Workflow.
 *
 * The user's vault has one external input: a verdict signed by the key it
 * pinned as `risk_verifier`, attesting a realised loss. The vault checks the
 * attested figure against the USER's own on-chain trigger and computes the
 * pause length itself. This workflow is where that verdict is produced.
 *
 * Everything in `evaluate.ts` runs inside a TEE (`handlerInTee`):
 *
 *   1. the Ed25519 seed behind the pinned verifier is fetched with
 *      `runtime.getSecret()` — released only into the attested enclave, never
 *      to node operators, never to Shield's own server
 *   2. the vault's raw capital flows (a person's trading history) and its
 *      on-chain policy are fetched from inside the enclave
 *   3. sessions, realised loss, streaks and reloads are re-derived
 *      INDEPENDENTLY with the same pure code the app uses
 *      (server/behaviour.ts + server/policy.ts) — the enclave does not trust
 *      the server's opinion, only its raw data, which is itself on-chain
 *   4. if the user's rule is met by new evidence, the verdict is signed in
 *      the enclave and handed to the relayer; only the signed verdict and the
 *      public evidence bundle (whose hash is stored on-chain) leave
 *
 * What the vault enforces regardless of this workflow: a verdict can only
 * ever pause top-ups; never move money, never loosen a rule, never touch cold
 * transfers or exits. A dead or compromised monitor degrades Shield to its
 * static rules, never below them. See docs/THREAT_MODEL.md.
 */
import { cre, handlerInTee, text, Runner, type HTTPPayload, type TeeRuntime } from "@chainlink/cre-sdk";
import { z } from "zod";
import { base64Encode, evaluateVault, type EnclaveIO } from "./evaluate";

export const configSchema = z.object({
  /** Shield server: serves raw flows + vault policy, and relays verdicts. */
  shieldApiUrl: z.string(),
  /** Deployed Shield vault program id (verdicts are bound to it). */
  programId: z.string(),
  /** Secret id holding the base64 Ed25519 seed of the pinned verifier. */
  secretId: z.string(),
  /** POST the signed verdict to the relayer (false = evaluate + sign only). */
  deliver: z.boolean(),
});
type Config = z.infer<typeof configSchema>;

/** Adapt the TEE runtime to the evaluation's I/O interface. Every call here
 * executes from inside the enclave (`HTTPClient.sendRequest` has a
 * `TeeRuntime` overload), so request and response payloads stay confidential. */
function enclaveIo(runtime: TeeRuntime<Config>): EnclaveIO {
  const http = new cre.capabilities.HTTPClient();
  return {
    getSecret: (id) => runtime.getSecret({ id }).result().value,
    get: (url) => {
      const res = http.sendRequest(runtime, { url, method: "GET" }).result();
      return { status: res.statusCode, body: text(res) };
    },
    postJson: (url, body) => {
      const res = http
        .sendRequest(runtime, {
          url,
          method: "POST",
          multiHeaders: { "content-type": { values: ["application/json"] } },
          body: base64Encode(new TextEncoder().encode(body)),
        })
        .result();
      return { status: res.statusCode, body: text(res) };
    },
    now: () => Math.floor(runtime.now().getTime() / 1000),
    log: (msg) => runtime.log(msg),
  };
}

const onEvaluate = (runtime: TeeRuntime<Config>, payload: HTTPPayload) => {
  const input = JSON.parse(new TextDecoder().decode(payload.input)) as { vault?: string };
  return evaluateVault(enclaveIo(runtime), runtime.config, input.vault ?? "");
};

const initWorkflow = () => {
  // HTTP trigger: Shield's server (or the CLI in simulation) posts { vault }.
  // In production, restrict `authorizedKeys` to Shield's relayer key.
  const trigger = new cre.capabilities.HTTPCapability().trigger({});
  return [handlerInTee(trigger, onEvaluate, [{ tee: "nitro", regions: ["us-west-2"] }])];
};

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema });
  await runner.run(initWorkflow);
}

await main();
