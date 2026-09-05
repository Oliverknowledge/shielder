import { useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { AnimatePresence, motion } from "motion/react";
import { useShield } from "../lib/shield";
import { useAction } from "../lib/actions";
import { Countdown, Field, MoneyInput, Pill, Sheet, useToast } from "../components/ui";
import { usd, hoursLabel, duration, short, rawToNumber } from "../lib/format-extra";
import {
  ProposalCategory,
  OwnerType,
  COOLDOWN_REASON,
  cancelProposalIx,
  executeFullExitIx,
  executeRuleChangeIx,
  executeRuleChangeWithRegistrationIx,
  proposeLoosenIx,
  proposeUninstallVaultIx,
  proposeColdTransferAboveCapIx,
  instantColdTransferIx,
  removeRegistrationIx,
  tightenIx,
  usdcToRaw,
  type LoosenParams,
  type TightenParams,
} from "../../../client/shield-client";

type RuleKey = "floor" | "daily" | "threshold" | "lossTrigger" | "lossCooldown" | "cap" | "loosenDelay" | "exitDelay";

interface RuleDef {
  key: RuleKey;
  name: string;
  explain: string;
  kind: "usd" | "pct" | "hours" | "days";
  strictIsHigher: boolean; // is a higher value stricter?
  current: (v: NonNullable<ReturnType<typeof useShield>["vault"]>) => number;
}

const RULES: RuleDef[] = [
  { key: "floor", name: "Protected floor", explain: "Top-ups can never take the treasury below this amount. Only a 7-day exit can.", kind: "usd", strictIsHigher: true, current: (v) => rawToNumber(v.protectedFloor) },
  { key: "daily", name: "Daily top-up limit", explain: "Everything sent to trading wallets in any rolling 24 hours, added together. Splitting a top-up doesn't help.", kind: "usd", strictIsHigher: false, current: (v) => rawToNumber(v.velocityThreshold) },
  { key: "threshold", name: "Large top-ups wait 30 min above", explain: "A single top-up at or above this share of the treasury waits before it can move.", kind: "pct", strictIsHigher: false, current: (v) => v.topUpThresholdBps / 100 },
  { key: "lossTrigger", name: "Loss trigger", explain: "When this much doesn't come back from your trading wallet within 24 hours, the monitor's verdict is accepted and top-ups pause.", kind: "usd", strictIsHigher: false, current: (v) => rawToNumber(v.lossTriggerUsdc) },
  { key: "lossCooldown", name: "Pause after losses", explain: "How long top-ups stay paused once your loss trigger is met. The vault computes this itself; the monitor never chooses it.", kind: "hours", strictIsHigher: true, current: (v) => Number(v.lossCooldownSecs) / 3600 },
  { key: "cap", name: "Instant cold-wallet cap", explain: "The most that can move to a cold wallet instantly. Larger amounts take the 7-day exit path.", kind: "usd", strictIsHigher: false, current: (v) => rawToNumber(v.emergencyCap) },
  { key: "loosenDelay", name: "Weakening delay", explain: "How long any weakening change waits before it applies. Can never go below 1 hour.", kind: "hours", strictIsHigher: true, current: (v) => Number(v.loosenCooldownSecs) / 3600 },
  { key: "exitDelay", name: "Exit delay", explain: "How long leaving Shield (or any large cold withdrawal) waits.", kind: "days", strictIsHigher: true, current: (v) => Number(v.fullExitCooldownSecs) / 86400 },
];

function paramFor(key: RuleKey, value: number): { tighten: TightenParams; loosen: LoosenParams } {
  switch (key) {
    case "floor": return { tighten: { newProtectedFloor: usdcToRaw(value) }, loosen: { newProtectedFloor: usdcToRaw(value) } };
    case "daily": return { tighten: { newVelocityThreshold: usdcToRaw(value) }, loosen: { newVelocityThreshold: usdcToRaw(value) } };
    case "threshold": return { tighten: { newTopUpThresholdBps: Math.round(value * 100) }, loosen: { newTopUpThresholdBps: Math.round(value * 100) } };
    case "lossTrigger": return { tighten: { newLossTriggerUsdc: usdcToRaw(value) }, loosen: { newLossTriggerUsdc: usdcToRaw(value) } };
    case "lossCooldown": return { tighten: { newLossCooldownSecs: BigInt(Math.round(value * 3600)) }, loosen: { newLossCooldownSecs: BigInt(Math.round(value * 3600)) } };
    case "cap": return { tighten: { newEmergencyCap: usdcToRaw(value) }, loosen: { newEmergencyCap: usdcToRaw(value) } };
    case "loosenDelay": return { tighten: { newLoosenCooldownSecs: BigInt(Math.round(value * 3600)) }, loosen: { newLoosenCooldownSecs: BigInt(Math.round(value * 3600)) } };
    case "exitDelay": return { tighten: { newFullExitCooldownSecs: BigInt(Math.round(value * 86400)) }, loosen: { newFullExitCooldownSecs: BigInt(Math.round(value * 86400)) } };
  }
}

function fmtRule(def: RuleDef, value: number): string {
  if (def.kind === "usd") return usd(value);
  if (def.kind === "pct") return `${value}%`;
  if (def.kind === "hours") return hoursLabel(value * 3600);
  return `${value} day${value === 1 ? "" : "s"}`;
}

export function Protection() {
  const { vault, proposals, registry, wallets, signer, vaultAddress, now, health } = useShield();
  const { run, busy } = useAction();
  const toast = useToast();
  const [editing, setEditing] = useState<RuleDef | null>(null);
  const [value, setValue] = useState("");
  const [scheduled, setScheduled] = useState<{ name: string; from: string; to: string } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addAddr, setAddAddr] = useState("");
  const [addLabel, setAddLabel] = useState("");
  const [addKind, setAddKind] = useState<OwnerType>(OwnerType.Cold);
  const [exitOpen, setExitOpen] = useState(false);
  const [exitDest, setExitDest] = useState("");
  const [coldOpen, setColdOpen] = useState(false);
  const [coldAmount, setColdAmount] = useState("");
  const [coldDest, setColdDest] = useState("");

  if (!vault || !signer || !vaultAddress) return null;

  const ruleChange = proposals.find((p) => p.category === ProposalCategory.RuleChange);
  const exitPending = proposals.find((p) => p.category === ProposalCategory.FullExit);
  const cooldownActive = Number(vault.cooldownUntil) > now;
  const coldWallets = registry.filter((r) => r.kind === OwnerType.Cold && r.active);
  const monitorIsShield = health?.monitor.verifier && vault.riskVerifier.toBase58() === health.monitor.verifier;
  const monitorSet = !vault.riskVerifier.equals(PublicKey.default);

  const openEdit = (def: RuleDef) => {
    setEditing(def);
    setValue(String(def.current(vault)));
  };

  const applyEdit = async () => {
    if (!editing) return;
    const v = Number(value);
    const cur = editing.current(vault);
    if (!Number.isFinite(v) || v === cur) return setEditing(null);
    const stricter = editing.strictIsHigher ? v > cur : v < cur;
    const params = paramFor(editing.key, v);
    try {
      if (stricter) {
        await run(`${editing.name} tightened`, [tightenIx({ authority: signer.publicKey, vault: vaultAddress, ...params.tighten })]);
      } else {
        await run(`Change scheduled`, [proposeLoosenIx({ authority: signer.publicKey, vault: vaultAddress, ...params.loosen })], { silent: true });
        setScheduled({ name: editing.name, from: fmtRule(editing, cur), to: fmtRule(editing, v) });
      }
      setEditing(null);
    } catch {
      /* toast shown */
    }
  };

  const pause = (hours: number) =>
    run(`Top-ups paused for ${hours}h`, [tightenIx({ authority: signer.publicKey, vault: vaultAddress, pauseTopUpsUntil: BigInt(now + hours * 3600) })]).catch(() => null);

  const executeRuleChange = async () => {
    if (!ruleChange || ruleChange.action.kind !== "loosen") return;
    const owner = ruleChange.action.params.registerOwner;
    const ix = owner
      ? executeRuleChangeWithRegistrationIx({ authority: signer.publicKey, vault: vaultAddress, owner })
      : executeRuleChangeIx({ authority: signer.publicKey, vault: vaultAddress });
    await run("Change applied", [ix]).catch(() => null);
  };

  const addDestination = async () => {
    try {
      const owner = new PublicKey(addAddr.trim());
      await run("Destination scheduled", [proposeLoosenIx({ authority: signer.publicKey, vault: vaultAddress, registerOwner: owner, registerKind: addKind, registerLabel: addLabel || (addKind === OwnerType.Cold ? "Cold" : "Trading") })], { silent: true });
      setScheduled({ name: `New ${addKind === OwnerType.Cold ? "cold" : "trading"} wallet`, from: "not allowed", to: `${addLabel || short(owner.toBase58())}` });
      setAddOpen(false);
      setAddAddr("");
      setAddLabel("");
    } catch (e) {
      toast.err(e instanceof Error ? e.message : String(e));
    }
  };

  const proposeExit = async () => {
    const dest = coldWallets.find((c) => c.owner.toBase58() === exitDest) ?? coldWallets[0];
    if (!dest) return toast.err("Register a cold wallet first (24h).");
    await run("Exit scheduled (7 days)", [proposeUninstallVaultIx({ authority: signer.publicKey, vault: vaultAddress, destinationOwner: dest.owner })]).catch(() => null);
    setExitOpen(false);
  };

  const executeExit = async () => {
    if (!exitPending || exitPending.action.kind === "loosen" || exitPending.action.kind === "topUp") return;
    const owner = exitPending.action.destinationOwner;
    const ata = getAssociatedTokenAddressSync(vault.usdcMint, owner, true);
    await run("Exit executed", [
      createAssociatedTokenAccountIdempotentInstruction(signer.publicKey, ata, owner, vault.usdcMint),
      executeFullExitIx({ authority: signer.publicKey, vault: vaultAddress, destinationOwner: owner, destinationTokenAccount: ata }),
    ]).catch(() => null);
  };

  const coldTransfer = async () => {
    const dest = coldWallets.find((c) => c.owner.toBase58() === coldDest) ?? coldWallets[0];
    const amt = usdcToRaw(Number(coldAmount || 0));
    if (!dest || amt <= 0n) return;
    const ata = getAssociatedTokenAddressSync(vault.usdcMint, dest.owner, true);
    const ensure = createAssociatedTokenAccountIdempotentInstruction(signer.publicKey, ata, dest.owner, vault.usdcMint);
    try {
      if (amt <= vault.emergencyCap) {
        await run(`Moved ${usd(amt)} to ${dest.label}`, [ensure, instantColdTransferIx({ authority: signer.publicKey, vault: vaultAddress, destinationOwner: dest.owner, destinationTokenAccount: ata, amount: amt })]);
      } else {
        await run(`Withdrawal of ${usd(amt)} scheduled (7 days)`, [proposeColdTransferAboveCapIx({ authority: signer.publicKey, vault: vaultAddress, destinationOwner: dest.owner, amount: amt })]);
      }
      setColdOpen(false);
      setColdAmount("");
    } catch {
      /* toast */
    }
  };

  return (
    <main className="page fade-in">
      <div style={{ marginBottom: 12 }}>
        <p className="eyebrow">Protection</p>
        <h1 className="title" style={{ marginTop: 4 }}>Tighten instantly. Loosen slowly.</h1>
        <p className="dim" style={{ marginTop: 4 }}>Any change that makes you safer applies now. Any change that makes you less safe waits {hoursLabel(vault.loosenCooldownSecs)} and can be cancelled the whole time.</p>
      </div>

      <AnimatePresence>
        {scheduled && (
          <motion.section className="banner banner-pending" style={{ marginBottom: 16 }} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <p className="eyebrow" style={{ color: "inherit" }}>Change scheduled</p>
            <div className="row-between" style={{ marginTop: 6, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontWeight: 600 }}>{scheduled.name}</div>
                <div className="num">{scheduled.from} → {scheduled.to}</div>
              </div>
              {ruleChange && (
                <div style={{ textAlign: "right" }}>
                  <div className="tiny">Activates in</div>
                  <div className="money-m"><Countdown until={ruleChange.executeAfter} now={now} /></div>
                </div>
              )}
            </div>
            <p className="small" style={{ marginTop: 8 }}>Your current protection remains active until then.</p>
            <button className="btn btn-ghost btn-sm" style={{ marginTop: 6 }} onClick={() => setScheduled(null)}>Dismiss</button>
          </motion.section>
        )}
      </AnimatePresence>

      {cooldownActive && (
        <section className="banner banner-blocked" style={{ marginBottom: 16 }}>
          <div className="row-between" style={{ flexWrap: "wrap" }}>
            <div>
              <p className="eyebrow" style={{ color: "inherit" }}>{vault.cooldownReason === COOLDOWN_REASON.SELF_PAUSE ? "Paused by you" : "Loss cooldown active"}</p>
              <p className="small" style={{ marginTop: 4 }}>No top-up can move until it ends. Cold-wallet transfers and cancellations still work.</p>
            </div>
            <div className="money-m"><Countdown until={vault.cooldownUntil} now={now} /></div>
          </div>
        </section>
      )}

      <div className="grid-2">
        <section className="card">
          <p className="eyebrow">Pause top-ups now</p>
          <p className="small dim" style={{ marginTop: 6 }}>Instant. It only ever extends an existing pause and clears by itself.</p>
          <div className="chips" style={{ marginTop: 12 }}>
            {[6, 24, 72].map((h) => (
              <button key={h} className="chip" disabled={!!busy} onClick={() => void pause(h)}>{h}h</button>
            ))}
          </div>
        </section>
        <section className="card">
          <p className="eyebrow">Move to cold wallet</p>
          <p className="small dim" style={{ marginTop: 6 }}>Up to {usd(vault.emergencyCap)} instantly (shares the daily limit). More takes the {duration(Number(vault.fullExitCooldownSecs))} path.</p>
          <button className="btn btn-secondary btn-sm" style={{ marginTop: 12 }} disabled={coldWallets.length === 0} onClick={() => { setColdDest(coldWallets[0]?.owner.toBase58() ?? ""); setColdOpen(true); }}>
            {coldWallets.length ? "Move funds" : "No cold wallet yet"}
          </button>
        </section>
      </div>

      {ruleChange && ruleChange.action.kind === "loosen" && (
        <section className="card" style={{ marginTop: 16 }}>
          <div className="row-between" style={{ flexWrap: "wrap" }}>
            <div>
              <p className="eyebrow">Pending weakening change</p>
              <p className="small" style={{ marginTop: 4 }}>{describeLoosen(ruleChange.action.params)}</p>
              <p className="tiny muted">
                {ruleChange.configVersionAtCreation !== vault.configVersion
                  ? "Superseded: you tightened something after proposing this, so the vault will refuse to apply it. Cancel it to clear the slot."
                  : `Created under configuration v${ruleChange.configVersionAtCreation.toString()}; tightening anything before it activates cancels it.`}
              </p>
            </div>
            <div className="row" style={{ gap: 6 }}>
              {Number(ruleChange.executeAfter) <= now ? (
                <button className="btn btn-sm" disabled={!!busy} onClick={() => void executeRuleChange()}>Apply now</button>
              ) : (
                <Pill tone="pending"><Countdown until={ruleChange.executeAfter} now={now} format="compact" /></Pill>
              )}
              <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => void run("Change cancelled", [cancelProposalIx({ authority: signer.publicKey, vault: vaultAddress, category: ProposalCategory.RuleChange })]).catch(() => null)}>Cancel</button>
            </div>
          </div>
        </section>
      )}

      <section className="card" style={{ marginTop: 16 }}>
        <p className="eyebrow">Your rules</p>
        <div className="list" style={{ marginTop: 8 }}>
          {RULES.map((def) => (
            <div key={def.key} className="list-row" style={{ alignItems: "flex-start" }}>
              <div style={{ flex: 1 }}>
                <div className="row-between">
                  <span style={{ fontWeight: 600 }}>{def.name}</span>
                </div>
                <p className="rule-explain">{def.explain}</p>
              </div>
              <div style={{ textAlign: "right", minWidth: 120 }}>
                <div className="num" style={{ fontWeight: 600 }}>{fmtRule(def, def.current(vault))}</div>
                <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => openEdit(def)}>Change</button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <div className="row-between">
          <p className="eyebrow">Destinations</p>
          <button className="btn btn-secondary btn-sm" onClick={() => setAddOpen(true)}>Add (waits {hoursLabel(vault.loosenCooldownSecs)})</button>
        </div>
        <div className="list" style={{ marginTop: 8 }}>
          {registry.map((r) => {
            const bal = wallets.find((w) => w.owner === r.owner.toBase58())?.usdc;
            return (
              <div key={r.owner.toBase58()} className="list-row">
                <div>
                  <div className="row" style={{ gap: 8 }}>
                    <span style={{ fontWeight: 600 }}>{r.label || short(r.owner.toBase58())}</span>
                    <Pill tone={r.kind === OwnerType.Cold ? "protect" : "bankroll"}>{r.kind === OwnerType.Cold ? "Cold" : "Trading"}</Pill>
                    {!r.active && <Pill tone="neutral">Removed</Pill>}
                  </div>
                  <div className="addr">{r.owner.toBase58()}{bal !== undefined && bal !== null ? ` · ${usd(bal)} USDC` : ""}</div>
                </div>
                {r.active && (
                  <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => void run(`${r.label || "Destination"} removed`, [removeRegistrationIx({ authority: signer.publicKey, vault: vaultAddress, owner: r.owner })]).catch(() => null)}>
                    Remove
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <p className="tiny muted" style={{ marginTop: 10 }}>Shield can only send to these addresses. Types are permanent: a trading wallet can never become a cold wallet. Removing is instant; adding waits.</p>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <div className="row-between">
          <p className="eyebrow">Monitor</p>
          <Pill tone={monitorSet ? "protect" : "neutral"}>{monitorSet ? (monitorIsShield ? "Shield monitor" : "Custom verifier") : "None"}</Pill>
        </div>
        <p className="small dim" style={{ marginTop: 6 }}>
          {monitorSet
            ? "A verdict signed by this key, attesting a realised loss at or above your trigger, is the only external thing that can change your vault, and it can only pause top-ups for the length you set. It can't move money, loosen a rule, or block cold transfers and exits."
            : "No monitor: the loss rule can't fire. Adding one is an instant tightening."}
        </p>
        <p className="addr" style={{ marginTop: 6 }}>{monitorSet ? vault.riskVerifier.toBase58() : "—"}</p>
        <div className="row" style={{ marginTop: 10 }}>
          {!monitorSet && health?.monitor.verifier && (
            <button className="btn btn-sm" disabled={!!busy} onClick={() => void run("Monitor added", [tightenIx({ authority: signer.publicKey, vault: vaultAddress, setRiskVerifier: new PublicKey(health.monitor.verifier!) })]).catch(() => null)}>Add Shield monitor</button>
          )}
          {monitorSet && (
            <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => void run("Removal scheduled", [proposeLoosenIx({ authority: signer.publicKey, vault: vaultAddress, newRiskVerifier: PublicKey.default })], { silent: true }).then(() => setScheduled({ name: "Monitor", from: "on", to: "off" })).catch(() => null)}>
              Remove (waits {hoursLabel(vault.loosenCooldownSecs)})
            </button>
          )}
        </div>
      </section>

      <section className="card" style={{ marginTop: 16, borderColor: "#efc9c5" }}>
        <p className="eyebrow" style={{ color: "var(--blocked)" }}>Leave Shield</p>
        {exitPending ? (
          <div className="row-between" style={{ marginTop: 6, flexWrap: "wrap" }}>
            <div>
              <p style={{ fontWeight: 600 }}>{exitPending.action.kind === "uninstallVault" ? "Full exit scheduled" : `Withdrawal of ${exitPending.action.kind === "coldTransferAboveCap" ? usd(exitPending.action.amount) : ""} scheduled`}</p>
              <p className="small dim">
                {Number(exitPending.executeAfter) <= now ? "Ready to execute." : <>Executes in <Countdown until={exitPending.executeAfter} now={now} format="compact" /></>} · every other rule stays in force until then.
              </p>
            </div>
            <div className="row" style={{ gap: 6 }}>
              {Number(exitPending.executeAfter) <= now && <button className="btn btn-sm" disabled={!!busy} onClick={() => void executeExit()}>Execute</button>}
              <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => void run("Exit cancelled", [cancelProposalIx({ authority: signer.publicKey, vault: vaultAddress, category: ProposalCategory.FullExit })]).catch(() => null)}>Cancel</button>
            </div>
          </div>
        ) : (
          <>
            <p className="small dim" style={{ marginTop: 6 }}>
              Your whole balance moves to a cold wallet you registered, after {duration(Number(vault.fullExitCooldownSecs))}. Nothing else changes in the meantime: limits, floor and cooldowns keep working, and you can cancel any time. Shield never traps funds; it just makes leaving a decision rather than a reflex.
            </p>
            <button className="btn btn-danger btn-sm" style={{ marginTop: 12 }} onClick={() => { setExitDest(coldWallets[0]?.owner.toBase58() ?? ""); setExitOpen(true); }} disabled={coldWallets.length === 0}>
              {coldWallets.length ? "Start the exit" : "Register a cold wallet first"}
            </button>
          </>
        )}
      </section>

      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing?.name}>
        {editing && (
          <div className="stack">
            <p className="small dim">{editing.explain}</p>
            <Field label={`New value (${editing.kind === "usd" ? "USD" : editing.kind === "pct" ? "% of treasury" : editing.kind})`}>
              {editing.kind === "usd" ? <MoneyInput value={value} onChange={setValue} autoFocus /> : <input className="input" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ""))} autoFocus />}
            </Field>
            {(() => {
              const v = Number(value);
              const cur = editing.current(vault);
              if (!Number.isFinite(v) || v === cur || value === "") return <p className="small muted">Enter a different value.</p>;
              const stricter = editing.strictIsHigher ? v > cur : v < cur;
              return stricter ? (
                <div className="banner banner-protect small">Stricter than now. Applies immediately.</div>
              ) : (
                <div className="banner banner-pending small">Weaker than now. Scheduled: activates in {hoursLabel(vault.loosenCooldownSecs)}. Your current rule stays in force until then and you can cancel any time.</div>
              );
            })()}
            <button className="btn btn-block" disabled={!!busy || value === "" || Number(value) === editing.current(vault)} onClick={() => void applyEdit()}>
              {busy ? "Confirming…" : (editing.strictIsHigher ? Number(value) > editing.current(vault) : Number(value) < editing.current(vault)) ? "Apply now" : "Schedule change"}
            </button>
          </div>
        )}
      </Sheet>

      <Sheet open={addOpen} onClose={() => setAddOpen(false)} title="Add a destination">
        <div className="stack">
          <div className="chips">
            <button className={`chip ${addKind === OwnerType.Cold ? "active" : ""}`} onClick={() => setAddKind(OwnerType.Cold)}>Cold wallet</button>
            <button className={`chip ${addKind === OwnerType.Execution ? "active" : ""}`} onClick={() => setAddKind(OwnerType.Execution)}>Trading wallet</button>
          </div>
          <Field label="Address" hint="The type is permanent for this address.">
            <input className="input mono" value={addAddr} onChange={(e) => setAddAddr(e.target.value)} placeholder="Solana address" />
          </Field>
          <Field label="Label">
            <input className="input" value={addLabel} onChange={(e) => setAddLabel(e.target.value.slice(0, 24))} />
          </Field>
          <div className="banner banner-pending small">Because your vault is funded, a new destination is a weakening change. It activates in {hoursLabel(vault.loosenCooldownSecs)}. This is what protects you from “send it to this recovery address” messages.</div>
          <button className="btn btn-block" disabled={!!busy || !addAddr.trim()} onClick={() => void addDestination()}>Schedule</button>
        </div>
      </Sheet>

      <Sheet open={exitOpen} onClose={() => setExitOpen(false)} title="Leave Shield">
        <div className="stack">
          <p className="small dim">Everything in the treasury moves to the cold wallet you pick, after {duration(Number(vault.fullExitCooldownSecs))}. You can cancel until then.</p>
          <div className="chips">
            {coldWallets.map((c) => (
              <button key={c.owner.toBase58()} className={`chip ${exitDest === c.owner.toBase58() ? "active" : ""}`} onClick={() => setExitDest(c.owner.toBase58())}>{c.label || short(c.owner.toBase58())}</button>
            ))}
          </div>
          <button className="btn btn-danger btn-block" disabled={!!busy} onClick={() => void proposeExit()}>Schedule the exit</button>
        </div>
      </Sheet>

      <Sheet open={coldOpen} onClose={() => setColdOpen(false)} title="Move to cold wallet">
        <div className="stack">
          <div className="chips">
            {coldWallets.map((c) => (
              <button key={c.owner.toBase58()} className={`chip ${coldDest === c.owner.toBase58() ? "active" : ""}`} onClick={() => setColdDest(c.owner.toBase58())}>{c.label || short(c.owner.toBase58())}</button>
            ))}
          </div>
          <MoneyInput value={coldAmount} onChange={setColdAmount} autoFocus />
          <p className="small dim">{Number(coldAmount || 0) > 0 && usdcToRaw(Number(coldAmount)) > vault.emergencyCap ? `Above the ${usd(vault.emergencyCap)} instant cap: this will be scheduled for ${duration(Number(vault.fullExitCooldownSecs))}.` : `Instant, up to ${usd(vault.emergencyCap)}. Counts toward your daily limit.`}</p>
          <button className="btn btn-block" disabled={!!busy || !(Number(coldAmount) > 0)} onClick={() => void coldTransfer()}>{busy ? "Confirming…" : "Move"}</button>
        </div>
      </Sheet>
    </main>
  );
}

function describeLoosen(p: LoosenParams): string {
  const parts: string[] = [];
  if (p.newProtectedFloor !== undefined) parts.push(`floor → ${usd(p.newProtectedFloor)}`);
  if (p.newVelocityThreshold !== undefined) parts.push(`daily limit → ${usd(p.newVelocityThreshold)}`);
  if (p.newTopUpThresholdBps !== undefined) parts.push(`large top-up threshold → ${p.newTopUpThresholdBps / 100}%`);
  if (p.newLossTriggerUsdc !== undefined) parts.push(`loss trigger → ${usd(p.newLossTriggerUsdc)}`);
  if (p.newLossCooldownSecs !== undefined) parts.push(`loss pause → ${hoursLabel(p.newLossCooldownSecs)}`);
  if (p.newEmergencyCap !== undefined) parts.push(`cold cap → ${usd(p.newEmergencyCap)}`);
  if (p.newLoosenCooldownSecs !== undefined) parts.push(`weakening delay → ${hoursLabel(p.newLoosenCooldownSecs)}`);
  if (p.newFullExitCooldownSecs !== undefined) parts.push(`exit delay → ${hoursLabel(p.newFullExitCooldownSecs)}`);
  if (p.newRiskVerifier !== undefined) parts.push(p.newRiskVerifier.equals(PublicKey.default) ? "remove monitor" : `monitor → ${short(p.newRiskVerifier.toBase58())}`);
  if (p.registerOwner) parts.push(`add ${p.registerKind === OwnerType.Cold ? "cold" : "trading"} wallet ${p.registerLabel || short(p.registerOwner.toBase58())}`);
  return parts.join(" · ") || "rule change";
}
