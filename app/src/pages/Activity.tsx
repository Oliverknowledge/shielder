import { useShield } from "../lib/shield";
import { ExplorerLink, Pill } from "../components/ui";
import { usd, dateTime, short, hoursLabel } from "../lib/format";
import type { EventJson } from "../lib/api";

function describe(e: EventJson, labelOf: (owner: string) => string): { title: string; body: string; tone: "protect" | "pending" | "blocked" | "neutral" | "bankroll" } {
  const d = e.data;
  switch (e.name) {
    case "VaultInitialized":
      return { title: "Shield activated", body: `Floor ${usd(String(d.protectedFloor))}, daily limit ${usd(String(d.velocityThreshold))}`, tone: "protect" };
    case "Deposited":
      return { title: `Deposited ${usd(String(d.amount))}`, body: `Treasury now ${usd(String(d.newBalance))}`, tone: "protect" };
    case "RegistrationChanged":
      return { title: `${d.active ? "Registered" : "Removed"} ${d.kind === 1 ? "cold" : "trading"} wallet`, body: `${d.label || short(String(d.owner))}`, tone: d.active ? "neutral" : "protect" };
    case "PolicyTightened":
      return { title: "Protection tightened", body: `Applied instantly · config v${d.configVersion}${Number(d.cooldownUntil) > 0 ? ` · pause until ${dateTime(Number(d.cooldownUntil))}` : ""}`, tone: "protect" };
    case "LoosenProposed":
      return { title: "Weakening change scheduled", body: `Activates ${dateTime(Number(d.executeAfter))}`, tone: "pending" };
    case "LoosenExecuted":
      return { title: "Weakening change applied", body: `Proposal #${d.nonce} matured and was executed`, tone: "neutral" };
    case "ProposalCancelled":
      return { title: "Change cancelled", body: `Proposal #${d.nonce}`, tone: "protect" };
    case "TopUpExecuted":
      return { title: `Top-up ${usd(String(d.amount))} to ${labelOf(String(d.destinationOwner))}`, body: `${d.instant ? "Instant" : "After the pause"} · ${usd(String(d.velocityAfter))} used of today's limit`, tone: "bankroll" };
    case "TopUpProposed":
      return { title: `Large top-up ${usd(String(d.amount))} scheduled`, body: `Can move ${dateTime(Number(d.executeAfter))}`, tone: "pending" };
    case "ColdTransferExecuted":
      return { title: `${usd(String(d.amount))} to cold wallet`, body: labelOf(String(d.destinationOwner)), tone: "protect" };
    case "FullExitProposed":
      return { title: d.uninstall ? "Exit from Shield scheduled" : `Withdrawal ${usd(String(d.amount))} scheduled`, body: `Executes ${dateTime(Number(d.executeAfter))}`, tone: "blocked" };
    case "FullExitExecuted":
      return { title: `Exited ${usd(String(d.amount))}`, body: labelOf(String(d.destinationOwner)), tone: "blocked" };
    case "RiskVerdictApplied":
      return { title: `Loss rule fired: ${usd(String(d.realizedLossUsdc))} attested`, body: `${d.extended ? "Top-ups paused until" : "Already paused until"} ${dateTime(Number(d.cooldownUntil))} · verdict #${d.nonce}`, tone: "blocked" };
    default:
      return { title: e.name, body: "", tone: "neutral" };
  }
}

export function Activity() {
  const { server, serverError, wallets, vault } = useShield();
  const labelOf = (owner: string) => wallets.find((w) => w.owner === owner)?.label ?? short(owner);

  return (
    <main className="page page-narrow fade-in">
      <div style={{ marginBottom: 12 }}>
        <p className="eyebrow">Activity</p>
        <h1 className="title" style={{ marginTop: 4 }}>Everything the vault did, on-chain</h1>
        {vault && <p className="small muted" style={{ marginTop: 4 }}>Config version {vault.configVersion.toString()} · {vault.lastVerdictNonce.toString()} verdict{vault.lastVerdictNonce === 1n ? "" : "s"} accepted · weakening waits {hoursLabel(vault.loosenCooldownSecs)}</p>}
      </div>
      {!server ? (
        <div className="card">
          <p className="dim">Activity needs the indexer{serverError ? ` (${serverError})` : ""}. The vault itself is unaffected.</p>
        </div>
      ) : server.events.length === 0 ? (
        <div className="card"><p className="muted">No events yet.</p></div>
      ) : (
        <div className="card">
          <div className="list">
            {server.events.map((e, i) => {
              const d = describe(e, labelOf);
              return (
                <div key={`${e.signature}-${i}`} className="list-row" style={{ alignItems: "flex-start" }}>
                  <div>
                    <div className="row" style={{ gap: 8 }}>
                      <span style={{ fontWeight: 600 }}>{d.title}</span>
                    </div>
                    <div className="small dim">{d.body}</div>
                    <div className="tiny muted">{dateTime(e.blockTime)} · slot {e.slot} · <ExplorerLink sig={e.signature} /></div>
                  </div>
                  <Pill tone={d.tone}>{e.name.replace(/([a-z])([A-Z])/g, "$1 $2")}</Pill>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </main>
  );
}
