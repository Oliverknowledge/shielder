/**
 * Shield vault invariant suite. Every test runs the real compiled program
 * in LiteSVM with a warpable clock. Names describe the invariant or the
 * bypass attempt, not the happy path.
 *
 *   bun test tests/
 */
import {expect, test} from "bun:test";
import { Keypair, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  OwnerType,
  ProposalCategory,
  COOLDOWN_REASON,
  VERDICT_REASON,
  SHIELD_PROGRAM_ID,
  applyRiskVerdictIxs,
  cancelProposalIx,
  depositIx,
  executeFullExitIx,
  executeRuleChangeIx,
  executeRuleChangeWithRegistrationIx,
  executeTopUpIx,
  instantColdTransferIx,
  instantTopUpIx,
  proposeColdTransferAboveCapIx,
  proposeLoosenIx,
  proposeTopUpIx,
  proposeUninstallVaultIx,
  registerOwnerIx,
  removeRegistrationIx,
  tightenIx,
  usdcToRaw,
  evaluateTopUp,
  decodeEventsFromLogs,
} from "../client/shield-client";
import { setupVault, signVerdict, evidenceHash, H, D, type Fixture, solanaSuite } from "./harness";

const $ = usdcToRaw;

function topUp(f: Fixture, amount: bigint, signer = f.authority) {
  return f.chain.send(
    [
      instantTopUpIx({
        authority: signer.publicKey,
        vault: f.vault,
        destinationOwner: f.execution.publicKey,
        destinationTokenAccount: f.executionAta,
        amount,
      }),
    ],
    [signer]
  );
}

function proposeTopUp(f: Fixture, amount: bigint) {
  return f.chain.send(
    [proposeTopUpIx({ authority: f.authority.publicKey, vault: f.vault, destinationOwner: f.execution.publicKey, amount })],
    [f.authority]
  );
}

function executeTopUp(f: Fixture, signer = f.authority) {
  return f.chain.send(
    [
      executeTopUpIx({
        authority: signer.publicKey,
        vault: f.vault,
        destinationOwner: f.execution.publicKey,
        destinationTokenAccount: f.executionAta,
      }),
    ],
    [signer]
  );
}

function applyVerdict(f: Fixture, opts: Partial<{ nonce: bigint; loss: bigint; expiry: bigint; issuedAt: bigint; signer: Keypair; vault: PublicKey; programId: PublicKey; relayer: Keypair }> = {}) {
  const now = f.chain.now();
  const verdict = signVerdict(
    f,
    {
      nonce: opts.nonce ?? 1n,
      issuedAt: opts.issuedAt ?? now,
      expiry: opts.expiry ?? now + H,
      reasonCode: VERDICT_REASON.REALIZED_LOSS,
      realizedLossUsdc: opts.loss ?? $(1_420),
      evidenceHash: evidenceHash("evidence"),
      vault: opts.vault,
      programId: opts.programId,
    },
    opts.signer
  );
  const relayer = opts.relayer ?? f.stranger;
  // The precompile instruction carries whichever key actually signed; the
  // program must then reject any key that isn't the vault's pinned verifier.
  const presentedKey = (opts.signer ?? f.verifier).publicKey;
  return f.chain.send(
    applyRiskVerdictIxs({ relayer: relayer.publicKey, vault: f.vault, verifier: presentedKey, verdict }),
    [relayer]
  );
}

solanaSuite("deposits and protected capital", () => {
  test("deposit moves funds into the vault PDA token account and emits Deposited", () => {
    const f = setupVault({}, { deposit: 0n });
    expect(f.chain.tokenBalance(f.vaultAta)).toBe(0n);
    const r = f.chain.mustSend(
      [depositIx({ depositor: f.authority.publicKey, vault: f.vault, sourceTokenAccount: f.authorityAta, amount: $(10_000) })],
      [f.authority]
    );
    expect(f.chain.tokenBalance(f.vaultAta)).toBe($(10_000));
    const events = decodeEventsFromLogs(r.logs);
    expect(events.some((e) => e.name === "Deposited" && e.data.amount === $(10_000).toString())).toBe(true);
  });

  test("anyone may deposit (inbound is never gated)", () => {
    const f = setupVault({}, { deposit: 0n });
    const strangerAta = f.chain.createAta(f.stranger, f.mint, f.stranger.publicKey);
    f.chain.mintTo(f.authority, f.mint, strangerAta, $(500));
    const r = f.chain.send(
      [depositIx({ depositor: f.stranger.publicKey, vault: f.vault, sourceTokenAccount: strangerAta, amount: $(500) })],
      [f.stranger]
    );
    expect(r.ok).toBe(true);
    expect(f.chain.tokenBalance(f.vaultAta)).toBe($(500));
  });

  test("the protected balance is real: nothing but the program can move vault funds", () => {
    const f = setupVault();
    // The vault token account's owner is the vault PDA; a raw SPL transfer
    // signed by the user fails at the token program (no authority).
    const { createTransferInstruction } = require("@solana/spl-token");
    const r = f.chain.send(
      [createTransferInstruction(f.vaultAta, f.executionAta, f.authority.publicKey, Number($(1)))],
      [f.authority]
    );
    expect(r.ok).toBe(false);
    expect(r.logs.join("\n")).toContain("owner does not match");
  });
});

solanaSuite("instant top-ups", () => {
  test("a permitted replenishment executes instantly and reserves 24h capacity", () => {
    const f = setupVault();
    const r = topUp(f, $(400));
    expect(r.ok).toBe(true);
    expect(f.chain.tokenBalance(f.executionAta)).toBe($(400));
    const v = f.chain.vault(f.vault);
    expect(v.velocityBuckets.reduce((a, b) => a + b, 0n)).toBe($(400));
    const ev = decodeEventsFromLogs(r.logs).find((e) => e.name === "TopUpExecuted");
    expect(ev?.data.instant).toBe(true);
  });

  test("protected floor: a top-up that would breach the floor is rejected", () => {
    // floor $6,000 on a $10,000 vault; velocity generous so the floor is the binding gate
    const f = setupVault({ velocityThreshold: $(100_000), topUpThresholdBps: 10_000 });
    expect(topUp(f, $(4_000)).ok).toBe(true); // exactly to the floor is allowed
    const r = topUp(f, $(1));
    expect(r.ok).toBe(false);
    expect(r.shieldError).toBe("ProtectedFloorBreached");
    expect(f.chain.tokenBalance(f.vaultAta)).toBe($(6_000));
  });

  test("period cap: four $400 top-ups consume exactly what one $1,600 would (structuring)", () => {
    const f = setupVault({ velocityThreshold: $(1_600) });
    for (let i = 0; i < 4; i++) expect(topUp(f, $(400)).ok).toBe(true);
    const fifth = topUp(f, $(1));
    expect(fifth.ok).toBe(false);
    expect(fifth.shieldError).toBe("VelocityThresholdExceeded");
    // ...and the gated path can't be used to sneak past the cap either
    const gated = proposeTopUp(f, $(1));
    expect(gated.ok).toBe(false);
    expect(gated.shieldError).toBe("VelocityThresholdExceeded");
  });

  test("period cap is rolling: capacity returns after the 24h window passes", () => {
    const f = setupVault({ velocityThreshold: $(1_600) });
    expect(topUp(f, $(1_600)).ok).toBe(true);
    expect(topUp(f, $(1)).shieldError).toBe("VelocityThresholdExceeded");
    f.chain.warp(D + H);
    expect(topUp(f, $(1_600)).ok).toBe(true);
  });

  test("large transfer threshold: at or above the instant threshold must take the gated path", () => {
    const f = setupVault({ velocityThreshold: $(6_000) });
    // 20% of $10,000 = $2,000
    const r = topUp(f, $(2_000));
    expect(r.ok).toBe(false);
    expect(r.shieldError).toBe("AmountRequiresGatedTopUp");
    expect(topUp(f, $(1_999)).ok).toBe(true);
  });

  test("client-side evaluateTopUp mirrors the program's decision order", () => {
    const f = setupVault({ velocityThreshold: $(1_600) });
    const now = f.chain.now();
    const v = f.chain.vault(f.vault);
    expect(evaluateTopUp(v, $(10_000), $(400), now).path).toBe("instant");
    expect(evaluateTopUp(v, $(10_000), $(1_601), now).reason).toBe("VelocityThresholdExceeded");
    expect(evaluateTopUp(v, $(10_000), $(4_001), now).reason).toBe("ProtectedFloorBreached");
    expect(evaluateTopUp({ ...v, velocityThreshold: $(6_000) }, $(10_000), $(2_000), now).path).toBe("gated");
  });
});

solanaSuite("gated top-ups (large transfer pause)", () => {
  test("proposal cannot execute early, executes after the pause, and is one-shot", () => {
    const f = setupVault({ velocityThreshold: $(6_000) });
    expect(proposeTopUp(f, $(3_800)).ok).toBe(true);
    const p = f.chain.proposal(f.vault, ProposalCategory.TopUp)!;
    expect(p.action.kind).toBe("topUp");
    expect(p.executeAfter - p.createdAt).toBe(30n * 60n);

    const early = executeTopUp(f);
    expect(early.ok).toBe(false);
    expect(early.shieldError).toBe("ProposalNotMatured");

    f.chain.warp(31n * 60n);
    expect(executeTopUp(f).ok).toBe(true);
    expect(f.chain.tokenBalance(f.executionAta)).toBe($(3_800));
    expect(f.chain.proposal(f.vault, ProposalCategory.TopUp)).toBeNull();
    // replaying the execute fails: the proposal account is gone
    expect(executeTopUp(f).ok).toBe(false);
  });

  test("concurrent requests: a second top-up proposal cannot be created while one is pending", () => {
    const f = setupVault({ velocityThreshold: $(6_000) });
    expect(proposeTopUp(f, $(2_500)).ok).toBe(true);
    const second = proposeTopUp(f, $(2_500));
    expect(second.ok).toBe(false); // PDA already initialized
  });

  test("cancelling a pending top-up refunds its 24h reservation", () => {
    const f = setupVault({ velocityThreshold: $(6_000) });
    expect(proposeTopUp(f, $(3_800)).ok).toBe(true);
    expect(f.chain.vault(f.vault).velocityBuckets.reduce((a, b) => a + b, 0n)).toBe($(3_800));
    expect(
      f.chain.send([cancelProposalIx({ authority: f.authority.publicKey, vault: f.vault, category: ProposalCategory.TopUp })], [f.authority]).ok
    ).toBe(true);
    expect(f.chain.vault(f.vault).velocityBuckets.reduce((a, b) => a + b, 0n)).toBe(0n);
    expect(f.chain.proposal(f.vault, ProposalCategory.TopUp)).toBeNull();
  });

  test("a matured proposal expires after the grace window", () => {
    const f = setupVault({ velocityThreshold: $(6_000) });
    expect(proposeTopUp(f, $(3_800)).ok).toBe(true);
    f.chain.warp(8n * D);
    const r = executeTopUp(f);
    expect(r.ok).toBe(false);
    expect(r.shieldError).toBe("ProposalExpired");
  });
});

solanaSuite("cooldowns: the loss rule and self-pause", () => {
  test("a valid loss verdict arms a cooldown of the USER's configured length and blocks every top-up path", () => {
    const f = setupVault({ velocityThreshold: $(6_000) });
    const before = f.chain.now();
    const r = applyVerdict(f, { loss: $(1_420) });
    expect(r.ok).toBe(true);
    const v = f.chain.vault(f.vault);
    expect(v.cooldownUntil).toBe(before + 18n * H);
    expect(v.cooldownReason).toBe(COOLDOWN_REASON.RISK_VERDICT);
    expect(v.lastVerdictNonce).toBe(1n);

    const blocked = topUp(f, $(100));
    expect(blocked.ok).toBe(false);
    expect(blocked.shieldError).toBe("CooldownActive");

    // the gated path is a wall too: it cannot mature before the cooldown ends
    expect(proposeTopUp(f, $(3_000)).ok).toBe(true);
    const p = f.chain.proposal(f.vault, ProposalCategory.TopUp)!;
    expect(p.executeAfter).toBe(v.cooldownUntil);
    f.chain.warp(H);
    expect(executeTopUp(f).shieldError).toBe("ProposalNotMatured");
  });

  test("cooldown expiry: top-ups resume exactly when the cooldown ends", () => {
    const f = setupVault();
    expect(applyVerdict(f).ok).toBe(true);
    f.chain.warp(18n * H - 60n);
    expect(topUp(f, $(100)).shieldError).toBe("CooldownActive");
    f.chain.warp(61n);
    expect(topUp(f, $(100)).ok).toBe(true);
  });

  test("a cooldown armed AFTER a proposal was created still blocks its execution", () => {
    const f = setupVault({ velocityThreshold: $(6_000) });
    expect(proposeTopUp(f, $(3_800)).ok).toBe(true);
    f.chain.warp(10n * 60n);
    expect(applyVerdict(f).ok).toBe(true);
    f.chain.warp(25n * 60n); // proposal's own 30m has passed
    const r = executeTopUp(f);
    expect(r.ok).toBe(false);
    expect(r.shieldError).toBe("CooldownActive");
  });

  test("the monitor cannot loosen: a verdict below the user's loss trigger is rejected outright", () => {
    const f = setupVault();
    const r = applyVerdict(f, { loss: $(999) });
    expect(r.ok).toBe(false);
    expect(r.shieldError).toBe("VerdictBelowLossTrigger");
    expect(f.chain.vault(f.vault).cooldownUntil).toBe(0n);
  });

  test("monotonic: a later verdict can only extend, never shorten, an existing cooldown", () => {
    const f = setupVault();
    expect(applyVerdict(f, { nonce: 1n }).ok).toBe(true);
    const until = f.chain.vault(f.vault).cooldownUntil;
    // a user self-pause shorter than the existing cooldown is not a tightening
    const shorter = f.chain.send(
      [tightenIx({ authority: f.authority.publicKey, vault: f.vault, pauseTopUpsUntil: until - H })],
      [f.authority]
    );
    expect(shorter.ok).toBe(false);
    expect(shorter.shieldError).toBe("NotATightening");
    // a second verdict 6h later pushes the end forward (now + 18h > previous)
    f.chain.warp(6n * H);
    expect(applyVerdict(f, { nonce: 2n }).ok).toBe(true);
    expect(f.chain.vault(f.vault).cooldownUntil).toBe(until + 6n * H);
  });

  test("replay protection: a verdict nonce can never be reused or go backwards", () => {
    const f = setupVault();
    expect(applyVerdict(f, { nonce: 5n }).ok).toBe(true);
    expect(applyVerdict(f, { nonce: 5n }).shieldError).toBe("VerdictReplayed");
    expect(applyVerdict(f, { nonce: 4n }).shieldError).toBe("VerdictReplayed");
    expect(applyVerdict(f, { nonce: 6n }).ok).toBe(true);
  });

  test("malformed verdicts: expired, future-dated, wrong vault, wrong program, wrong signer, tampered", () => {
    const f = setupVault();
    const now = f.chain.now();
    expect(applyVerdict(f, { expiry: now - 1n }).shieldError).toBe("VerdictExpired");
    expect(applyVerdict(f, { issuedAt: now + 10n * H }).shieldError).toBe("VerdictNotYetValid");
    expect(applyVerdict(f, { vault: Keypair.generate().publicKey }).shieldError).toBe("VerdictWrongBinding");
    expect(applyVerdict(f, { programId: Keypair.generate().publicKey }).shieldError).toBe("VerdictWrongBinding");
    expect(applyVerdict(f, { signer: Keypair.generate() }).shieldError).toBe("InvalidVerifier");

    // tampered: sign one loss figure, submit another (Ed25519 ix vs. instruction data mismatch)
    const verdict = signVerdict(f, {
      nonce: 1n,
      issuedAt: now,
      expiry: now + H,
      reasonCode: VERDICT_REASON.REALIZED_LOSS,
      realizedLossUsdc: $(1_420),
      evidenceHash: evidenceHash("e"),
    });
    const tampered = { ...verdict, realizedLossUsdc: $(9_000) };
    const ixs = applyRiskVerdictIxs({ relayer: f.stranger.publicKey, vault: f.vault, verifier: f.verifier.publicKey, verdict: tampered });
    const r = f.chain.send(ixs, [f.stranger]);
    expect(r.ok).toBe(false); // the ed25519 precompile rejects the mismatched message
    expect(f.chain.vault(f.vault).cooldownUntil).toBe(0n);
  });

  test("a verdict without the Ed25519 precompile instruction is rejected", () => {
    const f = setupVault();
    const now = f.chain.now();
    const verdict = signVerdict(f, {
      nonce: 1n,
      issuedAt: now,
      expiry: now + H,
      reasonCode: 1,
      realizedLossUsdc: $(2_000),
      evidenceHash: evidenceHash("e"),
    });
    const [, applyOnly] = applyRiskVerdictIxs({ relayer: f.stranger.publicKey, vault: f.vault, verifier: f.verifier.publicKey, verdict });
    const r = f.chain.send([applyOnly], [f.stranger]);
    expect(r.ok).toBe(false);
    expect(r.shieldError).toBe("InvalidVerifier");
  });

  test("no monitor configured: verdicts are rejected, and adding one is an instant tighten", () => {
    const f = setupVault({}, { verifier: false });
    expect(applyVerdict(f).shieldError).toBe("NoRiskVerifier");
    expect(
      f.chain.send([tightenIx({ authority: f.authority.publicKey, vault: f.vault, setRiskVerifier: f.verifier.publicKey })], [f.authority]).ok
    ).toBe(true);
    expect(applyVerdict(f).ok).toBe(true);
  });

  test("self-pause is instant, extend-only, and bounded", () => {
    const f = setupVault();
    const now = f.chain.now();
    expect(
      f.chain.send([tightenIx({ authority: f.authority.publicKey, vault: f.vault, pauseTopUpsUntil: now + 6n * H })], [f.authority]).ok
    ).toBe(true);
    const v = f.chain.vault(f.vault);
    expect(v.cooldownUntil).toBe(now + 6n * H);
    expect(v.cooldownReason).toBe(COOLDOWN_REASON.SELF_PAUSE);
    expect(topUp(f, $(10)).shieldError).toBe("CooldownActive");
    const tooLong = f.chain.send(
      [tightenIx({ authority: f.authority.publicKey, vault: f.vault, pauseTopUpsUntil: now + 31n * D })],
      [f.authority]
    );
    expect(tooLong.shieldError).toBe("PauseTooLong");
  });

  test("cooldowns never touch the safe exits: capped cold transfers still work while paused", () => {
    const f = setupVault();
    expect(applyVerdict(f).ok).toBe(true);
    const r = f.chain.send(
      [
        instantColdTransferIx({
          authority: f.authority.publicKey,
          vault: f.vault,
          destinationOwner: f.cold.publicKey,
          destinationTokenAccount: f.coldAta,
          amount: $(200),
        }),
      ],
      [f.authority]
    );
    expect(r.ok).toBe(true);
    expect(f.chain.tokenBalance(f.coldAta)).toBe($(200));
  });
});

solanaSuite("tighten fast, loosen slowly", () => {
  test("tightening applies immediately across every parameter", () => {
    const f = setupVault();
    const r = f.chain.send(
      [
        tightenIx({
          authority: f.authority.publicKey,
          vault: f.vault,
          newProtectedFloor: $(7_000),
          newVelocityThreshold: $(500),
          newTopUpThresholdBps: 1_000,
          newEmergencyCap: $(100),
          newLossTriggerUsdc: $(500),
          newLossCooldownSecs: 24n * H,
          newTopUpCooldownSecs: 2n * H,
          newLoosenCooldownSecs: 48n * H,
          newFullExitCooldownSecs: 10n * D,
        }),
      ],
      [f.authority]
    );
    expect(r.ok).toBe(true);
    const v = f.chain.vault(f.vault);
    expect(v.protectedFloor).toBe($(7_000));
    expect(v.velocityThreshold).toBe($(500));
    expect(v.topUpThresholdBps).toBe(1_000);
    expect(v.emergencyCap).toBe($(100));
    expect(v.lossTriggerUsdc).toBe($(500));
    expect(v.lossCooldownSecs).toBe(24n * H);
    expect(v.loosenCooldownSecs).toBe(48n * H);
    expect(v.fullExitCooldownSecs).toBe(10n * D);
    expect(v.configVersion).toBe(2n);
    expect(topUp(f, $(501)).shieldError).toBe("VelocityThresholdExceeded");
  });

  test("the instant path refuses anything that is not a tightening", () => {
    const f = setupVault();
    for (const bad of [
      { newProtectedFloor: $(5_000) },
      { newVelocityThreshold: $(2_000) },
      { newTopUpThresholdBps: 3_000 },
      { newEmergencyCap: $(300) },
      { newLossTriggerUsdc: $(2_000) },
      { newLossCooldownSecs: 1n * H },
      { newLoosenCooldownSecs: 1n * H },
      { newFullExitCooldownSecs: 1n * D },
      {},
    ]) {
      const r = f.chain.send([tightenIx({ authority: f.authority.publicKey, vault: f.vault, ...bad })], [f.authority]);
      expect(r.shieldError).toBe("NotATightening");
    }
  });

  test("loosening is queued for 24h, cannot execute early, then applies", () => {
    const f = setupVault();
    const r = f.chain.send(
      [proposeLoosenIx({ authority: f.authority.publicKey, vault: f.vault, newVelocityThreshold: $(3_000), newProtectedFloor: $(5_000) })],
      [f.authority]
    );
    expect(r.ok).toBe(true);
    const p = f.chain.proposal(f.vault, ProposalCategory.RuleChange)!;
    expect(p.executeAfter - p.createdAt).toBe(D);
    expect(p.action.kind).toBe("loosen");
    // nothing changed yet
    expect(f.chain.vault(f.vault).velocityThreshold).toBe($(1_600));

    const early = f.chain.send([executeRuleChangeIx({ authority: f.authority.publicKey, vault: f.vault })], [f.authority]);
    expect(early.shieldError).toBe("ProposalNotMatured");

    f.chain.warp(D + 1n);
    expect(f.chain.send([executeRuleChangeIx({ authority: f.authority.publicKey, vault: f.vault })], [f.authority]).ok).toBe(true);
    const v = f.chain.vault(f.vault);
    expect(v.velocityThreshold).toBe($(3_000));
    expect(v.protectedFloor).toBe($(5_000));
  });

  test("the delayed path refuses anything that is not a loosening, and enforces delay floors", () => {
    const f = setupVault();
    for (const bad of [{ newVelocityThreshold: $(100) }, { newProtectedFloor: $(9_000) }, {}]) {
      const r = f.chain.send([proposeLoosenIx({ authority: f.authority.publicKey, vault: f.vault, ...bad })], [f.authority]);
      expect(r.shieldError).toBe("NotALoosening");
    }
    const zeroDelay = f.chain.send(
      [proposeLoosenIx({ authority: f.authority.publicKey, vault: f.vault, newLoosenCooldownSecs: 0n })],
      [f.authority]
    );
    expect(zeroDelay.shieldError).toBe("InvalidParameter");
  });

  test("stale proposal invalidation: a tighten after a pending loosen kills the loosen", () => {
    const f = setupVault();
    expect(
      f.chain.send([proposeLoosenIx({ authority: f.authority.publicKey, vault: f.vault, newVelocityThreshold: $(5_000) })], [f.authority]).ok
    ).toBe(true);
    // calm-you tightens something unrelated an hour later
    f.chain.warp(H);
    expect(f.chain.send([tightenIx({ authority: f.authority.publicKey, vault: f.vault, newEmergencyCap: $(150) })], [f.authority]).ok).toBe(true);
    f.chain.warp(D);
    const r = f.chain.send([executeRuleChangeIx({ authority: f.authority.publicKey, vault: f.vault })], [f.authority]);
    expect(r.shieldError).toBe("ProposalStale");
    expect(f.chain.vault(f.vault).velocityThreshold).toBe($(1_600));
  });

  test("a monitor verdict does NOT invalidate the user's pending proposals (no griefing)", () => {
    const f = setupVault();
    expect(
      f.chain.send([proposeLoosenIx({ authority: f.authority.publicKey, vault: f.vault, newVelocityThreshold: $(5_000) })], [f.authority]).ok
    ).toBe(true);
    expect(applyVerdict(f).ok).toBe(true);
    f.chain.warp(D + 1n);
    expect(f.chain.send([executeRuleChangeIx({ authority: f.authority.publicKey, vault: f.vault })], [f.authority]).ok).toBe(true);
  });

  test("changing or removing the monitor is a delayed weakening change", () => {
    const f = setupVault();
    const instant = f.chain.send(
      [tightenIx({ authority: f.authority.publicKey, vault: f.vault, setRiskVerifier: Keypair.generate().publicKey })],
      [f.authority]
    );
    expect(instant.shieldError).toBe("NotATightening");
    expect(
      f.chain.send([proposeLoosenIx({ authority: f.authority.publicKey, vault: f.vault, newRiskVerifier: PublicKey.default })], [f.authority]).ok
    ).toBe(true);
    f.chain.warp(D + 1n);
    expect(f.chain.send([executeRuleChangeIx({ authority: f.authority.publicKey, vault: f.vault })], [f.authority]).ok).toBe(true);
    expect(f.chain.vault(f.vault).riskVerifier.equals(PublicKey.default)).toBe(true);
  });
});

solanaSuite("destinations: the allow-list", () => {
  test("no such thing as an unregistered destination", () => {
    const f = setupVault();
    const rando = Keypair.generate();
    const randoAta = f.chain.createAta(f.authority, f.mint, rando.publicKey);
    const r = f.chain.send(
      [
        instantTopUpIx({
          authority: f.authority.publicKey,
          vault: f.vault,
          destinationOwner: rando.publicKey,
          destinationTokenAccount: randoAta,
          amount: $(1),
        }),
      ],
      [f.authority]
    );
    expect(r.ok).toBe(false); // registry PDA does not exist
  });

  test("account substitution: a token account owned by someone else is rejected even with a valid registry entry", () => {
    const f = setupVault();
    const rando = Keypair.generate();
    const randoAta = f.chain.createAta(f.authority, f.mint, rando.publicKey);
    const r = f.chain.send(
      [
        instantTopUpIx({
          authority: f.authority.publicKey,
          vault: f.vault,
          destinationOwner: f.execution.publicKey,
          destinationTokenAccount: randoAta,
          amount: $(1),
        }),
      ],
      [f.authority]
    );
    expect(r.ok).toBe(false);
    expect(r.shieldError).toBe("TokenAccountOwnerMismatch");
  });

  test("a cold address cannot receive top-ups; an execution address cannot receive cold transfers", () => {
    const f = setupVault();
    const a = f.chain.send(
      [instantTopUpIx({ authority: f.authority.publicKey, vault: f.vault, destinationOwner: f.cold.publicKey, destinationTokenAccount: f.coldAta, amount: $(1) })],
      [f.authority]
    );
    expect(a.shieldError).toBe("DestinationNotExecution");
    const b = f.chain.send(
      [instantColdTransferIx({ authority: f.authority.publicKey, vault: f.vault, destinationOwner: f.execution.publicKey, destinationTokenAccount: f.executionAta, amount: $(1) })],
      [f.authority]
    );
    expect(b.shieldError).toBe("DestinationNotCold");
  });

  test("once funded, adding a destination is a 24h weakening change (the scam-address case)", () => {
    const f = setupVault();
    const scam = Keypair.generate();
    const instant = f.chain.send(
      [registerOwnerIx({ authority: f.authority.publicKey, vault: f.vault, owner: scam.publicKey, kind: OwnerType.Cold, label: "support" })],
      [f.authority]
    );
    expect(instant.shieldError).toBe("VaultFundedUseDelayedPath");

    expect(
      f.chain.send(
        [proposeLoosenIx({ authority: f.authority.publicKey, vault: f.vault, registerOwner: scam.publicKey, registerKind: OwnerType.Cold, registerLabel: "recovery" })],
        [f.authority]
      ).ok
    ).toBe(true);
    // executing with a different owner than the proposal locked in is rejected
    const substituted = f.chain.send(
      [executeRuleChangeWithRegistrationIx({ authority: f.authority.publicKey, vault: f.vault, owner: Keypair.generate().publicKey })],
      [f.authority]
    );
    expect(substituted.ok).toBe(false);
    f.chain.warp(D + 1n);
    expect(
      f.chain.send([executeRuleChangeWithRegistrationIx({ authority: f.authority.publicKey, vault: f.vault, owner: scam.publicKey })], [f.authority]).ok
    ).toBe(true);
    const entry = f.chain.registry(f.vault, scam.publicKey)!;
    expect(entry.kind).toBe(OwnerType.Cold);
    expect(entry.label).toBe("recovery");
    // even then, only the emergency cap moves instantly
    const scamAta = f.chain.createAta(f.authority, f.mint, scam.publicKey);
    const big = f.chain.send(
      [instantColdTransferIx({ authority: f.authority.publicKey, vault: f.vault, destinationOwner: scam.publicKey, destinationTokenAccount: scamAta, amount: $(201) })],
      [f.authority]
    );
    expect(big.shieldError).toBe("AmountExceedsEmergencyCap");
  });

  test("types are permanent: an execution wallet can never be re-registered as cold", () => {
    const f = setupVault({}, { deposit: 0n });
    const r = f.chain.send(
      [registerOwnerIx({ authority: f.authority.publicKey, vault: f.vault, owner: f.execution.publicKey, kind: OwnerType.Cold, label: "x" })],
      [f.authority]
    );
    expect(r.shieldError).toBe("AlreadyRegisteredDifferentType");
  });

  test("removing a destination is instant and blocks transfers to it", () => {
    const f = setupVault();
    expect(f.chain.send([removeRegistrationIx({ authority: f.authority.publicKey, vault: f.vault, owner: f.execution.publicKey })], [f.authority]).ok).toBe(true);
    expect(topUp(f, $(10)).shieldError).toBe("DestinationNotExecution");
    expect(f.chain.registry(f.vault, f.execution.publicKey)!.active).toBe(false);
  });
});

solanaSuite("cold transfers and the full exit", () => {
  test("capped cold transfer is instant, floor-bound, and shares the 24h accumulator with top-ups", () => {
    const f = setupVault({ velocityThreshold: $(500) });
    expect(topUp(f, $(400)).ok).toBe(true);
    const r = f.chain.send(
      [instantColdTransferIx({ authority: f.authority.publicKey, vault: f.vault, destinationOwner: f.cold.publicKey, destinationTokenAccount: f.coldAta, amount: $(200) })],
      [f.authority]
    );
    expect(r.shieldError).toBe("VelocityThresholdExceeded"); // 400 + 200 > 500
    const ok = f.chain.send(
      [instantColdTransferIx({ authority: f.authority.publicKey, vault: f.vault, destinationOwner: f.cold.publicKey, destinationTokenAccount: f.coldAta, amount: $(100) })],
      [f.authority]
    );
    expect(ok.ok).toBe(true);
  });

  test("above the cap, a cold transfer takes the full-exit path with amount and destination locked", () => {
    const f = setupVault();
    expect(
      f.chain.send([proposeColdTransferAboveCapIx({ authority: f.authority.publicKey, vault: f.vault, destinationOwner: f.cold.publicKey, amount: $(5_000) })], [f.authority]).ok
    ).toBe(true);
    const p = f.chain.proposal(f.vault, ProposalCategory.FullExit)!;
    expect(p.executeAfter - p.createdAt).toBe(7n * D);
    f.chain.warp(7n * D + 1n);
    expect(
      f.chain.send(
        [executeFullExitIx({ authority: f.authority.publicKey, vault: f.vault, destinationOwner: f.cold.publicKey, destinationTokenAccount: f.coldAta })],
        [f.authority]
      ).ok
    ).toBe(true);
    expect(f.chain.tokenBalance(f.coldAta)).toBe($(5_000));
    expect(f.chain.tokenBalance(f.vaultAta)).toBe($(5_000)); // the floor does not apply to the deliberate exit
  });

  test("leaving Shield: whole balance, only to a registered cold address, only after 7 days, no substitution", () => {
    const f = setupVault();
    // to an unregistered address: rejected outright
    const rando = Keypair.generate();
    const bad = f.chain.send([proposeUninstallVaultIx({ authority: f.authority.publicKey, vault: f.vault, destinationOwner: rando.publicKey })], [f.authority]);
    expect(bad.ok).toBe(false);
    // to the execution wallet: rejected (not cold)
    const exec = f.chain.send([proposeUninstallVaultIx({ authority: f.authority.publicKey, vault: f.vault, destinationOwner: f.execution.publicKey })], [f.authority]);
    expect(exec.shieldError).toBe("FullExitDestinationNotRegisteredCold");

    expect(f.chain.send([proposeUninstallVaultIx({ authority: f.authority.publicKey, vault: f.vault, destinationOwner: f.cold.publicKey })], [f.authority]).ok).toBe(true);
    const early = f.chain.send(
      [executeFullExitIx({ authority: f.authority.publicKey, vault: f.vault, destinationOwner: f.cold.publicKey, destinationTokenAccount: f.coldAta })],
      [f.authority]
    );
    expect(early.shieldError).toBe("ProposalNotMatured");

    f.chain.warp(7n * D + 1n);
    // substitution attempt: a token account owned by someone else
    const randoAta = f.chain.createAta(f.authority, f.mint, rando.publicKey);
    const sub = f.chain.send(
      [executeFullExitIx({ authority: f.authority.publicKey, vault: f.vault, destinationOwner: f.cold.publicKey, destinationTokenAccount: randoAta })],
      [f.authority]
    );
    expect(sub.shieldError).toBe("TokenAccountOwnerMismatch");

    expect(
      f.chain.send(
        [executeFullExitIx({ authority: f.authority.publicKey, vault: f.vault, destinationOwner: f.cold.publicKey, destinationTokenAccount: f.coldAta })],
        [f.authority]
      ).ok
    ).toBe(true);
    expect(f.chain.tokenBalance(f.coldAta)).toBe($(10_000));
    expect(f.chain.tokenBalance(f.vaultAta)).toBe(0n);
  });

  test("exit while other restrictions stay meaningful: a pending exit does not unlock top-ups", () => {
    const f = setupVault({ velocityThreshold: $(500) });
    expect(f.chain.send([proposeUninstallVaultIx({ authority: f.authority.publicKey, vault: f.vault, destinationOwner: f.cold.publicKey })], [f.authority]).ok).toBe(true);
    expect(topUp(f, $(600)).shieldError).toBe("VelocityThresholdExceeded");
  });

  test("full exit is invalidated by a later tighten (stale)", () => {
    const f = setupVault();
    expect(f.chain.send([proposeUninstallVaultIx({ authority: f.authority.publicKey, vault: f.vault, destinationOwner: f.cold.publicKey })], [f.authority]).ok).toBe(true);
    f.chain.warp(D);
    expect(f.chain.send([tightenIx({ authority: f.authority.publicKey, vault: f.vault, newProtectedFloor: $(6_500) })], [f.authority]).ok).toBe(true);
    f.chain.warp(7n * D);
    const r = f.chain.send(
      [executeFullExitIx({ authority: f.authority.publicKey, vault: f.vault, destinationOwner: f.cold.publicKey, destinationTokenAccount: f.coldAta })],
      [f.authority]
    );
    expect(r.shieldError).toBe("ProposalStale");
  });
});

solanaSuite("authorization boundaries", () => {
  test("only the authority can move funds, change rules, or execute proposals", () => {
    const f = setupVault({ velocityThreshold: $(6_000) });
    expect(topUp(f, $(10), f.stranger).shieldError).toBe("Unauthorized");
    expect(f.chain.send([tightenIx({ authority: f.stranger.publicKey, vault: f.vault, newEmergencyCap: $(1) })], [f.stranger]).shieldError).toBe("Unauthorized");
    expect(f.chain.send([proposeLoosenIx({ authority: f.stranger.publicKey, vault: f.vault, newVelocityThreshold: $(9_000) })], [f.stranger]).shieldError).toBe("Unauthorized");
    expect(proposeTopUp(f, $(3_000)).ok).toBe(true);
    f.chain.warp(H);
    expect(executeTopUp(f, f.stranger).shieldError).toBe("Unauthorized");
    expect(f.chain.send([cancelProposalIx({ authority: f.stranger.publicKey, vault: f.vault, category: ProposalCategory.TopUp })], [f.stranger]).shieldError).toBe("Unauthorized");
  });

  test("anyone may relay a valid verdict (it can only tighten), but nobody can forge one", () => {
    const f = setupVault();
    expect(applyVerdict(f, { relayer: f.stranger }).ok).toBe(true);
    expect(applyVerdict(f, { nonce: 2n, signer: f.stranger }).shieldError).toBe("InvalidVerifier");
  });

  test("a second vault cannot borrow the first vault's registry entries", () => {
    const f = setupVault();
    const other = Keypair.generate();
    f.chain.airdrop(other.publicKey);
    const { vaultPda } = require("../client/shield-client");
    const [otherVault] = vaultPda(other.publicKey);
    const { initializeVaultIx } = require("../client/shield-client");
    expect(
      f.chain.send(
        [initializeVaultIx({ authority: other.publicKey, usdcMint: f.mint, riskVerifier: PublicKey.default, ...f.params })],
        [other]
      ).ok
    ).toBe(true);
    const r = f.chain.send(
      [instantTopUpIx({ authority: other.publicKey, vault: otherVault, destinationOwner: f.execution.publicKey, destinationTokenAccount: f.executionAta, amount: $(1) })],
      [other]
    );
    expect(r.ok).toBe(false); // registry PDA for (otherVault, execution) doesn't exist
  });
});

solanaSuite("program identity", () => {
  test("program id matches the client constant", () => {
    expect(SHIELD_PROGRAM_ID.toBase58()).toBe("4Z46Kz8ygX5Efw22ABbQ2LTf329N3nD2J81Z3CAY5Hyx");
    expect(getAssociatedTokenAddressSync).toBeDefined();
  });
});
