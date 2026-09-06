import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useShield } from "../lib/shield";
import { useAction } from "../lib/actions";
import { Countdown, Dot, Field, Icon, MoneyInput, Pill, Sheet, useToast } from "../components/ui";
import { usd, hoursLabel, duration, short, clockTime } from "../lib/format";
import { RULES, paramFor, fmtRule, isStricter, describeLoosen, type RuleDef } from "../lib/rules";
import { ProposalKind, OwnerKind, Route, COOLDOWN_REASON, usdcToRaw } from "../../../client/views";

export function Protection() {
  const { vault, proposals, registry, wallets, signer, now, health, actions, engine, chain } = useShield();
  const { run, busy } = useAction();
  const toast = useToast();
  const [editing, setEditing] = useState<RuleDef | null>(null);
  const [value, setValue] = useState("");
  const [flash, setFlash] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addAddr, setAddAddr] = useState("");
  const [addLabel, setAddLabel] = useState("");
  const [addKind, setAddKind] = useState<OwnerKind>(OwnerKind.Cold);
  const [exitOpen, setExitOpen] = useState(false);
  const [exitDest, setExitDest] = useState("");
  const [coldOpen, setColdOpen] = useState(false);
  const [coldAmount, setColdAmount] = useState("");
  const [coldDest, setColdDest] = useState("");

  if (!vault || !signer || !actions || !engine) return null;

  const ruleChange = proposals.find((p) => p.category === ProposalKind.RuleChange);
  const exitPending = proposals.find((p) => p.category === ProposalKind.FullExit);
  const cooldownActive = Number(vault.cooldownUntil) > now;
  const coldWallets = registry.filter((r) => r.kind === OwnerKind.Cold && r.active);
  const monitorIsShield = !!health?.monitor.verifier && !!vault.riskVerifier && vault.riskVerifier.toLowerCase() === health.monitor.verifier.toLowerCase();
  const monitorSet = !!vault.riskVerifier;
  const loosenWait = hoursLabel(vault.loosenCooldownSecs);

  const openEdit = (def: RuleDef) => {
    setEditing(def);
    setValue(String(def.current(vault)));
  };

  const applyEdit = async () => {
    if (!editing) return;
    const v = Number(value);
    const cur = editing.current(vault);
    if (!Number.isFinite(v) || v === cur) return setEditing(null);
    const stricter = isStricter(editing, cur, v);
    const params = paramFor(editing.key, v);
    try {
      if (stricter) {
        await run(`${editing.name} tightened to ${fmtRule(editing, v)}`, actions.tighten(params.tighten));
        setFlash(editing.key);
        setTimeout(() => setFlash(null), 1800);
      } else {
        await run(`Change scheduled: activates in ${loosenWait}`, actions.proposeLoosen(params.loosen));
      }
      setEditing(null);
    } catch {
      /* toast shown */
    }
  };

  const pause = (hours: number) =>
    run(`Top-ups paused for ${hours} hours`, actions.tighten({ pauseTopUpsUntil: BigInt(Math.max(Number(vault.cooldownUntil), now) + hours * 3600) })).catch(() => null);

  const executeRuleChange = async () => {
    if (!ruleChange || ruleChange.action.kind !== "loosen") return;
    await run("Change applied", actions.executeRuleChange(ruleChange.action.params.registerOwner)).catch(() => null);
  };

  const addDestination = async () => {
    const owner = addAddr.trim();
    if (!engine.isValidAddress(owner)) return toast.err("That doesn't look like a valid address.");
    try {
      await run(`New wallet scheduled: usable in ${loosenWait}`, actions.proposeLoosen({ registerOwner: owner, registerKind: addKind, registerRoute: addKind === OwnerKind.Execution && chain === "evm" ? Route.HyperCore : Route.Evm, registerLabel: addLabel || (addKind === OwnerKind.Cold ? "Cold" : "Trading") }));
      setAddOpen(false);
      setAddAddr("");
      setAddLabel("");
    } catch {
      /* toast shown */
    }
  };

  const proposeExit = async () => {
    const dest = coldWallets.find((c) => c.owner === exitDest) ?? coldWallets[0];
    if (!dest) return toast.err(`Register a cold wallet first (waits ${loosenWait}).`);
    await run(`Exit scheduled: executes in ${duration(Number(vault.fullExitCooldownSecs))}`, actions.proposeUninstallVault(dest.owner)).catch(() => null);
    setExitOpen(false);
  };

  const executeExit = async () => {
    if (!exitPending || exitPending.action.kind === "loosen" || exitPending.action.kind === "topUp") return;
    await run("Exit executed", actions.executeFullExit(exitPending.action.destinationOwner)).catch(() => null);
  };

  const coldTransfer = async () => {
    const dest = coldWallets.find((c) => c.owner === coldDest) ?? coldWallets[0];
    const amt = usdcToRaw(Number(coldAmount || 0));
    if (!dest || amt <= 0n) return;
    try {
      if (amt <= vault.emergencyCap) {
        await run(`Moved ${usd(amt)} to ${dest.label}`, actions.instantColdTransfer(dest.owner, amt));
      } else {
        await run(`Withdrawal of ${usd(amt)} scheduled (${duration(Number(vault.fullExitCooldownSecs))})`, actions.proposeColdTransferAboveCap(dest.owner, amt));
      }
      setColdOpen(false);
      setColdAmount("");
    } catch {
      /* toast */
    }
  };

  const editValue = Number(value);
  const editCur = editing ? editing.current(vault) : 0;
  const editValid = editing !== null && value !== "" && Number.isFinite(editValue) && editValue !== editCur && editValue >= 0;
  const editStricter = editing ? isStricter(editing, editCur, editValue) : false;

  return (
    <main className="page page-mid fade-in">
      <div className="page-head">
        <p className="eyebrow">Protection</p>
        <h1>Tighten instantly. Loosen slowly.</h1>
        <p>Anything that makes you safer applies now. Anything that makes you less safe waits {loosenWait}, and you can cancel it the whole time.</p>
      </div>

      {cooldownActive && (
        <div className="strip strip-blocked" style={{ marginBottom: 16 }}>
          <Icon name="lock" size={18} />
          <div className="grow">
            <b>{vault.cooldownReason === COOLDOWN_REASON.SELF_PAUSE ? "Top-ups paused by you" : "Loss cooldown active"}</b> until {clockTime(Number(vault.cooldownUntil), now)}. Cold-wallet moves and cancellations still work.
          </div>
          <span className="num right hide-xs" style={{ fontWeight: 600 }}><Countdown until={vault.cooldownUntil} now={now} /></span>
        </div>
      )}

      <AnimatePresence>
        {ruleChange && ruleChange.action.kind === "loosen" && (
          <motion.section key={ruleChange.nonce.toString()} className={`card ${ruleChange.configVersionAtCreation !== vault.configVersion ? "" : "card-tone-pending"}`} style={{ marginBottom: 16 }} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <PendingChange
              lines={describeLoosen(ruleChange.action.params, vault)}
              executeAfter={Number(ruleChange.executeAfter)}
              now={now}
              stale={ruleChange.configVersionAtCreation !== vault.configVersion}
              busy={!!busy}
              onApply={() => void executeRuleChange()}
              onCancel={() => void run("Change cancelled", actions.cancelProposal(ProposalKind.RuleChange)).catch(() => null)}
            />
          </motion.section>
        )}
      </AnimatePresence>

      <section className="section" style={{ marginTop: 8 }}>
        <div className="section-head">
          <h2>Your rules</h2>
          <span className="tiny muted">Enforced by the vault {chain === "evm" ? "contract" : "program"}</span>
        </div>
        <div className="list">
          {RULES.map((def) => (
            <div key={def.key} className="rule">
              <div style={{ minWidth: 0 }}>
                <div className={`s${flash === def.key ? " flash" : ""}`}>
                  {def.before}
                  <b>{fmtRule(def, def.current(vault))}</b>
                  {def.after}
                </div>
                <div className="why">{def.why}</div>
              </div>
              <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => openEdit(def)}>Change</button>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Pause top-ups now</h2>
        </div>
        <div className="panel row-between wrap">
          <p className="small dim">Instant. Extends any pause already running and ends by itself.</p>
          <div className="segmented">
            {[6, 24, 72].map((h) => (
              <button key={h} disabled={!!busy} onClick={() => void pause(h)}>{h}h</button>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Wallets Shield can send to</h2>
          <button className="btn btn-secondary btn-sm" onClick={() => setAddOpen(true)}>Add a wallet</button>
        </div>
        <div className="list">
          {registry.map((r) => {
            const bal = wallets.find((w) => w.owner === r.owner)?.usdc;
            return (
              <div key={r.owner} className="list-row">
                <div style={{ minWidth: 0 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <span style={{ fontWeight: 600 }}>{r.label || short(r.owner)}</span>
                    <Pill tone={r.kind === OwnerKind.Cold ? "protect" : "bankroll"}>{r.kind === OwnerKind.Cold ? "Cold" : r.route === Route.HyperCore ? "Hyperliquid" : "Trading"}</Pill>
                    {!r.active && <Pill tone="neutral">Removed</Pill>}
                  </div>
                  <div className="addr">{short(r.owner, 6)}{bal !== undefined && bal !== null ? ` · ${usd(bal)} there now` : ""}</div>
                </div>
                {r.active && (
                  <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => void run(`${r.label || "Wallet"} removed`, actions.removeRegistration(r.owner)).catch(() => null)}>
                    Remove
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <p className="tiny muted" style={{ marginTop: 10 }}>Removing is instant; adding waits. A wallet's type is permanent, so a trading wallet can never become a cold wallet.</p>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Monitor</h2>
          <Pill tone={monitorSet ? "protect" : "neutral"}>{monitorSet ? (monitorIsShield ? "Shield monitor" : "Custom") : "None"}</Pill>
        </div>
        <div className="panel">
          <p className="small dim">
            {monitorSet
              ? `Watches what comes back from your trading wallet. The only thing it can do is pause top-ups for ${hoursLabel(vault.lossCooldownSecs)} when your loss trigger is met. It can't move money, weaken a rule, or block cold-wallet moves and exits.`
              : "No monitor: your loss rule can't fire. Adding one is an instant tightening."}
          </p>
          <div className="row-between wrap" style={{ marginTop: 10 }}>
            <span className="addr">{monitorSet && vault.riskVerifier ? short(vault.riskVerifier, 6) : "—"}</span>
            {!monitorSet && health?.monitor.verifier && (
              <button className="btn btn-sm" disabled={!!busy} onClick={() => void run("Monitor added", actions.tighten({ setRiskVerifier: health.monitor.verifier! })).catch(() => null)}>Add Shield monitor</button>
            )}
            {monitorSet && (
              <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => void run(`Removal scheduled: ${loosenWait}`, actions.proposeLoosen({ newRiskVerifier: null })).catch(() => null)}>
                Remove · waits {loosenWait}
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Moving money out</h2>
        </div>
        <div className="list">
          <div className="list-row stack-m">
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>To your cold wallet</div>
              <div className="small dim">Up to {usd(vault.emergencyCap)} instantly, even during a cooldown. More waits {duration(Number(vault.fullExitCooldownSecs))}.</div>
            </div>
            <button className="btn btn-secondary btn-sm" disabled={coldWallets.length === 0} onClick={() => { setColdDest(coldWallets[0]?.owner ?? ""); setColdOpen(true); }}>
              {coldWallets.length ? "Move funds" : "No cold wallet"}
            </button>
          </div>
          <div className="list-row stack-m">
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>Leave Shield</div>
              {exitPending ? (
                <div className="small dim">
                  {exitPending.action.kind === "uninstallVault" ? "Full exit" : `Withdrawal of ${exitPending.action.kind === "coldTransferAboveCap" ? usd(exitPending.action.amount) : ""}`} scheduled · {Number(exitPending.executeAfter) <= now ? "ready to execute" : <>executes in <b className="num"><Countdown until={exitPending.executeAfter} now={now} format="compact" /></b></>} · every rule stays in force until then
                </div>
              ) : (
                <div className="small dim">Your whole balance moves to a cold wallet after {duration(Number(vault.fullExitCooldownSecs))}. Nothing else changes in the meantime. Cancel any time.</div>
              )}
            </div>
            {exitPending ? (
              <div className="actions">
                {Number(exitPending.executeAfter) <= now && <button className="btn btn-sm" disabled={!!busy} onClick={() => void executeExit()}>Execute</button>}
                <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => void run("Exit cancelled", actions.cancelProposal(ProposalKind.FullExit)).catch(() => null)}>Cancel</button>
              </div>
            ) : (
              <button className="btn btn-danger btn-sm" onClick={() => { setExitDest(coldWallets[0]?.owner ?? ""); setExitOpen(true); }} disabled={coldWallets.length === 0}>
                {coldWallets.length ? "Start the exit" : "No cold wallet"}
              </button>
            )}
          </div>
        </div>
      </section>

      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing?.name}>
        {editing && (
          <div className="stack">
            <p className="dim">
              {editing.before}
              <b>{fmtRule(editing, editCur)}</b>
              {editing.after}
            </p>
            <Field label={`New value${editing.kind === "usd" ? "" : editing.kind === "pct" ? " (% of treasury)" : editing.kind === "hours" ? " (hours)" : " (days)"}`}>
              {editing.kind === "usd" ? <MoneyInput value={value} onChange={setValue} autoFocus /> : <input className="input" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ""))} autoFocus />}
            </Field>
            {editValid ? (
              <>
                <div className="change-pair">
                  <span className="from">{fmtRule(editing, editCur)}</span>
                  <span className="arrow">→</span>
                  <span>{fmtRule(editing, editValue)}</span>
                </div>
                {editStricter ? (
                  <div className="banner banner-protect small row" style={{ gap: 10 }}>
                    <Icon name="bolt" size={18} />
                    <span><b>Applies instantly.</b> Making yourself safer never waits.</span>
                  </div>
                ) : (
                  <div className="banner banner-pending small row" style={{ gap: 10, alignItems: "flex-start" }}>
                    <Icon name="clock" size={18} />
                    <span><b>Review in {loosenWait}.</b> Your current {fmtRule(editing, editCur)} stays in force until then, and nothing changes until you confirm it again tomorrow. Cancel any time.</span>
                  </div>
                )}
              </>
            ) : (
              <p className="small muted">Enter a different value.</p>
            )}
            <button className={`btn btn-block btn-lg ${editStricter ? "btn-protect" : ""}`} disabled={!!busy || !editValid} onClick={() => void applyEdit()}>
              {busy ? "Confirming…" : editValid ? (editStricter ? "Tighten now" : `Request change · review in ${loosenWait}`) : "Change"}
            </button>
          </div>
        )}
      </Sheet>

      <Sheet open={addOpen} onClose={() => setAddOpen(false)} title="Add a wallet">
        <div className="stack">
          <div className="segmented" style={{ alignSelf: "flex-start" }}>
            <button className={addKind === OwnerKind.Cold ? "active" : ""} onClick={() => setAddKind(OwnerKind.Cold)}>Cold wallet</button>
            <button className={addKind === OwnerKind.Execution ? "active" : ""} onClick={() => setAddKind(OwnerKind.Execution)}>Trading wallet</button>
          </div>
          <Field label="Address" hint="The type is permanent for this address.">
            <input className="input mono" value={addAddr} onChange={(e) => setAddAddr(e.target.value)} placeholder={chain === "evm" ? "0x…" : "Solana address"} />
          </Field>
          <Field label="Label">
            <input className="input" value={addLabel} onChange={(e) => setAddLabel(e.target.value.slice(0, 24))} placeholder={addKind === OwnerKind.Cold ? "Ledger" : "Hyperliquid"} />
          </Field>
          <div className="banner banner-pending small row" style={{ gap: 10, alignItems: "flex-start" }}>
            <Icon name="clock" size={18} />
            <span><b>Usable in {loosenWait}.</b> A new destination is a weakening change. This is what protects you from "send it to this recovery address" messages.</span>
          </div>
          <button className="btn btn-block" disabled={!!busy || !addAddr.trim()} onClick={() => void addDestination()}>Schedule</button>
        </div>
      </Sheet>

      <Sheet open={exitOpen} onClose={() => setExitOpen(false)} title="Leave Shield">
        <div className="stack">
          <p className="dim">Everything in the treasury moves to the cold wallet you pick, after {duration(Number(vault.fullExitCooldownSecs))}. You can cancel until then.</p>
          <div className="chips">
            {coldWallets.map((c) => (
              <button key={c.owner} className={`chip ${exitDest === c.owner ? "active" : ""}`} onClick={() => setExitDest(c.owner)}>{c.label || short(c.owner)}</button>
            ))}
          </div>
          <button className="btn btn-danger btn-block btn-lg" disabled={!!busy} onClick={() => void proposeExit()}>Schedule the exit</button>
        </div>
      </Sheet>

      <Sheet open={coldOpen} onClose={() => setColdOpen(false)} title="Move to cold wallet">
        <div className="stack">
          <div className="chips">
            {coldWallets.map((c) => (
              <button key={c.owner} className={`chip ${coldDest === c.owner ? "active" : ""}`} onClick={() => setColdDest(c.owner)}>{c.label || short(c.owner)}</button>
            ))}
          </div>
          <MoneyInput value={coldAmount} onChange={setColdAmount} autoFocus />
          <div className={`strip ${Number(coldAmount || 0) > 0 && usdcToRaw(Number(coldAmount)) > vault.emergencyCap ? "strip-pending" : "strip-protect"}`}>
            <Icon name={Number(coldAmount || 0) > 0 && usdcToRaw(Number(coldAmount)) > vault.emergencyCap ? "clock" : "check"} size={18} />
            <div className="grow">{Number(coldAmount || 0) > 0 && usdcToRaw(Number(coldAmount)) > vault.emergencyCap ? `Above the ${usd(vault.emergencyCap)} instant cap: scheduled for ${duration(Number(vault.fullExitCooldownSecs))} from now.` : `Instant, up to ${usd(vault.emergencyCap)}. Counts toward your daily limit.`}</div>
          </div>
          <button className="btn btn-block btn-lg" disabled={!!busy || !(Number(coldAmount) > 0)} onClick={() => void coldTransfer()}>{busy ? "Confirming…" : "Move"}</button>
        </div>
      </Sheet>
    </main>
  );
}

function PendingChange({ lines, executeAfter, now, stale, busy, onApply, onCancel }: { lines: { name: string; from: string | null; to: string }[]; executeAfter: number; now: number; stale: boolean; busy: boolean; onApply: () => void; onCancel: () => void }) {
  const matured = executeAfter <= now;
  return (
    <div>
      <div className="row" style={{ gap: 8 }}>
        <Dot tone={stale ? "neutral" : "pending"} />
        <span className={`eyebrow ${stale ? "" : "c-pending"}`}>{stale ? "Superseded change" : matured ? "Change requested · waiting for you" : "Change requested"}</span>
      </div>
      <div className="row-between wrap" style={{ marginTop: 10, alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          {lines.map((l, i) => (
            <div key={i} style={{ marginTop: i ? 8 : 0 }}>
              <div style={{ fontWeight: 600 }}>{l.name}</div>
              <div className="change-pair">
                {l.from && <span className="from">{l.from}</span>}
                {l.from && <span className="arrow">→</span>}
                <span>{l.to}</span>
              </div>
            </div>
          ))}
        </div>
        {!stale && !matured && (
          <div style={{ textAlign: "right" }}>
            <div className="tiny muted">Review in</div>
            <div className="big-count"><Countdown until={executeAfter} now={now} /></div>
          </div>
        )}
      </div>
      <p className="small dim" style={{ marginTop: 10 }}>
        {stale ? "You tightened a rule after requesting this, so the vault will refuse to apply it. Cancel it to clear the slot." : matured ? "The waiting period is over. Nothing changed by itself: still want to?" : lines[0]?.from ? `Your current ${lines[0].from} stays in force until then.` : "Your current protection stays in force until then."}
      </p>
      <div className="row wrap" style={{ marginTop: 12, gap: 6 }}>
        {!stale && matured && <button className="btn btn-protect btn-sm" disabled={busy} onClick={onCancel}>Keep my protection</button>}
        {!stale && matured && <button className="btn btn-secondary btn-sm" disabled={busy} onClick={onApply}>Change it</button>}
        {(stale || !matured) && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={onCancel}>Cancel change</button>}
      </div>
    </div>
  );
}
