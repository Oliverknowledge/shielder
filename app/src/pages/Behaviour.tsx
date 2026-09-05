import { useState } from "react";
import { useShield, API_URL } from "../lib/shield";
import { Dot, ExplorerLink, Pill, Sheet, Skeleton, useToast } from "../components/ui";
import { usd, ago, dateTime, short, timeOnly, dayLabel, hoursLabel } from "../lib/format";
import { OwnerType } from "../../../client/shield-client";
import { getJson, type EvidenceJson } from "../lib/api";

const KIND_LABEL: Record<string, string> = {
  TOP_UP_INSTANT: "Top-up",
  TOP_UP_GATED: "Top-up after the pause",
  COLD_TRANSFER: "To cold wallet",
  FULL_EXIT: "Exit",
  RETURN: "Came back",
  DEPOSIT: "Deposit",
};

export function Behaviour() {
  const { server, serverError, serverLoading, wallets, vault, now } = useShield();
  const toast = useToast();
  const [evidence, setEvidence] = useState<EvidenceJson | null>(null);
  const [showAllFlows, setShowAllFlows] = useState(false);
  const labelOf = (owner: string) => wallets.find((w) => w.owner === owner)?.label ?? short(owner);

  if (!server) {
    return (
      <main className="page page-mid fade-in">
        <div className="page-head">
          <p className="eyebrow">Behaviour</p>
          <h1>What actually came back</h1>
        </div>
        {serverLoading && !serverError ? (
          <div className="card card-hero" aria-busy="true">
            <Skeleton w="70%" h={28} />
            <div style={{ marginTop: 20 }}><Skeleton w="100%" h={18} /></div>
            <div style={{ marginTop: 12 }}><Skeleton w="50%" h={14} /></div>
          </div>
        ) : (
        <div className="panel">
          <p style={{ fontWeight: 600 }}>Behaviour needs the Shield server</p>
          <p className="small dim" style={{ marginTop: 4 }}>It isn't reachable{serverError ? ` (${serverError})` : ""}. Your rules keep working without it; this page reads your trading wallet's history from the indexer.</p>
        </div>
        )}
      </main>
    );
  }

  const p = server.profile;
  const a = server.assessment;
  const sessions = [...p.sessions].sort((x, y) => y.lastActivityAt - x.lastActivityAt);
  const execWallets = p.wallets.filter((w) => wallets.some((x) => x.owner === w.owner && x.kind === OwnerType.Execution));
  const sent = BigInt(p.totals.sent);
  const returned = BigInt(p.totals.returned);
  const open = execWallets.reduce((acc, w) => acc + BigInt(w.openExposure), 0n);
  const lost = sent > returned + open ? sent - returned - open : 0n;
  const gained = returned > sent ? returned - sent : 0n;
  const tradingLabel = execWallets.map((w) => labelOf(w.owner)).join(" and ") || "your trading wallet";
  const denom = Number(sent > returned ? sent : returned) || 1;
  const w = (x: bigint) => `${(Number(x) / denom) * 100}%`;
  const loss24 = BigInt(p.windows.h24.realisedLoss);

  const openEvidence = async (hash: string) => {
    try {
      setEvidence(await getJson<EvidenceJson>(`${API_URL}/api/evidence/${hash}`));
    } catch {
      toast.err("Evidence bundle not found on the server");
    }
  };

  const flows = showAllFlows ? p.timeline : p.timeline.slice(0, 8);

  return (
    <main className="page page-mid fade-in">
      <div className="page-head">
        <p className="eyebrow">Behaviour</p>
        <h1>What actually came back</h1>
      </div>

      <section className="card card-hero">
        {sent === 0n ? (
          <>
            <h2 className="title-l">Nothing has left the treasury yet.</h2>
            <p className="lead" style={{ marginTop: 8 }}>Once you top up, Shield watches what your trading wallet sends back and turns it into your loss rule's evidence.</p>
          </>
        ) : (
          <>
            <h2 className="title-l">
              You sent <span className="num">{usd(sent)}</span> to {tradingLabel}. <span className={`num ${returned >= sent ? "c-protect" : "c-blocked"}`}>{usd(returned)}</span> came back.
            </h2>
            <div style={{ marginTop: 20 }}>
              <div className="capital" style={{ height: 18 }} role="img" aria-label={`Came back ${usd(returned)}, still out ${usd(open)}, lost ${usd(lost)}`}>
                {returned > 0n && <i style={{ flexBasis: w(returned), background: "var(--protect)" }} />}
                {open > 0n && <i style={{ flexBasis: w(open), background: "var(--bankroll-2)" }} />}
                {lost > 0n && <i style={{ flexBasis: w(lost), background: "var(--blocked)" }} />}
              </div>
              <div className="legend">
                <span><i style={{ background: "var(--protect)" }} />Came back <b>{usd(returned)}</b></span>
                {open > 0n && <span><i style={{ background: "var(--bankroll-2)" }} />Still out <b>{usd(open)}</b></span>}
                {lost > 0n && <span><i style={{ background: "var(--blocked)" }} />Realised loss <b>{usd(lost)}</b></span>}
                {gained > 0n && <span><i style={{ background: "var(--protect)" }} />Realised gain <b>{usd(gained)}</b></span>}
              </div>
            </div>
            {loss24 > 0n && (
              <p className="dim" style={{ marginTop: 16 }}>
                <b className="c-blocked num">{usd(loss24)}</b> of that was lost in the last 24 hours{vault ? `, against your ${usd(vault.lossTriggerUsdc)} trigger` : ""}.
              </p>
            )}
          </>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>What Shield noticed</h2>
          <Pill tone={a.triggered ? "blocked" : "protect"}>{a.triggered ? "Loss rule met" : "Below trigger"}</Pill>
        </div>
        <div className="notice-list">
          <div className="notice">
            <Dot tone={a.triggered ? "blocked" : "protect"} />
            <span>{a.headline}</span>
          </div>
          {p.lossStreak >= 2 && (
            <div className="notice">
              <Dot tone="pending" />
              <span>{p.lossStreak} losing sessions in a row.</span>
            </div>
          )}
          <div className="notice">
            <Dot tone={p.reloadsAfterLoss7d > 0 ? "blocked" : "protect"} />
            <span>{p.reloadsAfterLoss7d > 0 ? `You reloaded within 3 hours of a loss ${p.reloadsAfterLoss7d} time${p.reloadsAfterLoss7d === 1 ? "" : "s"} this week.` : "No reloads within 3 hours of a loss this week."}</span>
          </div>
          {Number(p.medianTopUp30d) > 0 && (
            <div className="notice">
              <Dot tone="neutral" />
              <span>Your typical top-up is {usd(p.medianTopUp30d)}. {usd(p.velocity24h)} went to trading in the last 24 hours.</span>
            </div>
          )}
        </div>
        {server.verdicts.length > 0 && (
          <div className="list list-tight" style={{ marginTop: 16 }}>
            {server.verdicts.slice(0, 5).map((v) => (
              <div key={v.verdict.nonce} className="list-row">
                <div style={{ minWidth: 0 }}>
                  <div className="small"><b>Verdict #{v.verdict.nonce}</b> · {usd(v.verdict.realizedLossUsdc)} attested · {v.source === "cre" ? "Chainlink CRE enclave" : "Shield monitor"}</div>
                  <div className="tiny muted">{ago(v.issuedAt, now)}{v.signature ? <> · <ExplorerLink sig={v.signature} /></> : v.error ? ` · ${v.error}` : ""}{vault ? ` · paused top-ups for ${hoursLabel(vault.lossCooldownSecs)}` : ""}</div>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => void openEvidence(v.verdict.evidenceHash)}>Evidence</button>
              </div>
            ))}
          </div>
        )}
      </section>

      {sessions.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Trading sessions</h2>
            <span className="tiny muted">A session ends when money comes back</span>
          </div>
          <div className="list">
            {sessions.slice(0, 8).map((s, i) => (
              <div key={i} className="list-row">
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>
                    {labelOf(s.wallet)} · {dayLabel(s.openedAt, now)} {timeOnly(s.openedAt)}{s.realised && s.lastActivityAt !== s.openedAt ? ` → ${timeOnly(s.lastActivityAt)}` : ""}
                  </div>
                  <div className="small dim">
                    Sent {usd(s.sent)} in {s.topUps} top-up{s.topUps === 1 ? "" : "s"} · {s.realised ? `${usd(s.returned)} came back` : "nothing back yet"}
                  </div>
                  <div className="tiny muted">{s.signatures.length > 0 && <ExplorerLink sig={s.signatures[s.signatures.length - 1]} />}</div>
                </div>
                {s.realised ? <b className={`num ${s.isLoss ? "c-blocked" : "c-protect"}`} style={{ fontSize: 17, whiteSpace: "nowrap" }}>{usd(s.net, { sign: true })}</b> : <Pill tone="bankroll">Open</Pill>}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <div className="section-head">
          <h2>Every flow</h2>
          {p.timeline.length > 8 && <button className="btn btn-ghost btn-sm" onClick={() => setShowAllFlows((v) => !v)}>{showAllFlows ? "Show fewer" : `Show all ${p.timeline.length}`}</button>}
        </div>
        {p.timeline.length === 0 ? (
          <p className="small muted">No flows indexed yet.</p>
        ) : (
          <div className="timeline">
            {flows.map((f) => (
              <div key={`${f.signature}-${f.kind}-${f.amount}`} className={`tl-item ${f.outbound ? "out" : "in"}`}>
                <div className="row-between">
                  <div style={{ minWidth: 0 }}>
                    <div className="small"><b>{KIND_LABEL[f.kind] ?? f.kind}</b> · {f.outbound ? "to" : "from"} {labelOf(f.counterparty)}</div>
                    <div className="tiny muted">{dateTime(f.blockTime)} · <ExplorerLink sig={f.signature} /></div>
                  </div>
                  <b className="num" style={{ whiteSpace: "nowrap" }}>{f.outbound ? "−" : "+"}{usd(f.amount)}</b>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <p className="tiny muted" style={{ marginTop: 32 }}>
        {server.source.mode === "substreams" ? `Live from The Graph Substreams · ${server.source.endpoint}` : "Indexed from Solana RPC. The Graph Substreams package streams the same flows when a Graph Market key is configured."}
      </p>

      <Sheet open={!!evidence} onClose={() => setEvidence(null)} title="Evidence behind the verdict">
        {evidence && (
          <div className="stack-s small">
            <div className="row-between"><span className="dim">Window</span><b>{evidence.window}</b></div>
            <div className="row-between"><span className="dim">Realised loss</span><b className="num">{usd(evidence.realisedLossUsdc)}</b></div>
            <div className="row-between"><span className="dim">Your trigger</span><b className="num">{usd(evidence.policy.lossTriggerUsdc)}</b></div>
            <div className="row-between"><span className="dim">Losing sessions</span><b>{evidence.lossSessions}</b></div>
            <div className="row-between"><span className="dim">Loss streak</span><b>{evidence.lossStreak}</b></div>
            <div className="divider" />
            {evidence.sessions.map((s, i) => (
              <div key={i}>
                <div><b>{labelOf(s.wallet)}</b> · sent {usd(s.sent)}, {usd(s.returned)} back · <span className={Number(s.net) < 0 ? "c-blocked" : "c-protect"}>{usd(s.net, { sign: true })}</span></div>
                <div className="tiny muted" style={{ marginTop: 2 }}>{s.signatures.map((sig) => <span key={sig} style={{ marginRight: 8 }}><ExplorerLink sig={sig} /></span>)}</div>
              </div>
            ))}
            <p className="tiny muted" style={{ marginTop: 8 }}>The hash of this bundle is stored in your vault with the verdict. Evaluated {dateTime(evidence.asOf)}.</p>
          </div>
        )}
      </Sheet>
    </main>
  );
}
