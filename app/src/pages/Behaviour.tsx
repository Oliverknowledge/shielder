import { useState } from "react";
import { useShield, API_URL } from "../lib/shield";
import { ExplorerLink, Money, Pill, Sheet, useToast } from "../components/ui";
import { usd, ago, dateTime, short } from "../lib/format";
import { OwnerType } from "../../../client/shield-client";
import { getJson, type EvidenceJson } from "../lib/api";

const KIND_LABEL: Record<string, string> = {
  TOP_UP_INSTANT: "Top-up",
  TOP_UP_GATED: "Top-up (after pause)",
  COLD_TRANSFER: "To cold wallet",
  FULL_EXIT: "Exit",
  RETURN: "Came back",
  DEPOSIT: "Deposit",
};

export function Behaviour() {
  const { server, serverError, wallets, vault, now, health } = useShield();
  const toast = useToast();
  const [evidence, setEvidence] = useState<EvidenceJson | null>(null);
  const labelOf = (owner: string) => wallets.find((w) => w.owner === owner)?.label ?? short(owner);

  if (!server) {
    return (
      <main className="page page-narrow">
        <p className="eyebrow">Behaviour</p>
        <div className="card" style={{ marginTop: 12 }}>
          <h2 className="title">Behavioural data unavailable</h2>
          <p className="dim" style={{ marginTop: 6 }}>The Shield server isn’t reachable{serverError ? ` (${serverError})` : ""}. Your vault’s rules keep working without it; this page needs the indexer to read your trading wallet’s history.</p>
        </div>
      </main>
    );
  }

  const p = server.profile;
  const a = server.assessment;
  const sessions = [...p.sessions].sort((x, y) => y.lastActivityAt - x.lastActivityAt);
  const realised = sessions.filter((s) => s.realised);
  const maxAbs = Math.max(1, ...realised.map((s) => Math.abs(Number(s.net))));
  const execWallets = p.wallets.filter((w) => wallets.some((x) => x.owner === w.owner && x.kind === OwnerType.Execution));
  const sourceLabel =
    server.source.mode === "substreams"
      ? `Live from The Graph · Substreams · ${server.source.endpoint}`
      : `Indexed from Solana RPC (fallback) · set SUBSTREAMS_API_TOKEN to stream from The Graph (${health?.substreamsEndpoint ?? "devnet.sol.streamingfast.io"})`;

  const openEvidence = async (hash: string) => {
    try {
      setEvidence(await getJson<EvidenceJson>(`${API_URL}/api/evidence/${hash}`));
    } catch {
      toast.err("Evidence bundle not found on the server");
    }
  };

  return (
    <main className="page fade-in">
      <div className="row-between" style={{ marginBottom: 12, flexWrap: "wrap" }}>
        <div>
          <p className="eyebrow">Behaviour</p>
          <h1 className="title" style={{ marginTop: 4 }}>What actually came back</h1>
        </div>
        <span className="tiny muted">{sourceLabel}</span>
      </div>

      <section className="card">
        <div className="grid-3">
          <div>
            <p className="eyebrow">Sent to trading wallets</p>
            <Money raw={p.totals.sent} size="l" />
          </div>
          <div>
            <p className="eyebrow">Came back</p>
            <Money raw={p.totals.returned} size="l" />
          </div>
          <div>
            <p className="eyebrow">Net realised flow</p>
            <div className="money-l" style={{ color: Number(p.totals.net) < 0 ? "var(--blocked)" : "var(--protect)" }}>{usd(p.totals.net, { sign: true })}</div>
          </div>
        </div>
        {execWallets.map((w) => (
          <p key={w.owner} className="small dim" style={{ marginTop: 12 }}>
            <b>{labelOf(w.owner)}</b>: {w.topUpCount} top-up{w.topUpCount === 1 ? "" : "s"}, median {usd(w.medianTopUp)} · {w.returnCount} return{w.returnCount === 1 ? "" : "s"}
            {Number(w.openExposure) > 0 ? ` · ${usd(w.openExposure)} still out there` : ""}
          </p>
        ))}
      </section>

      <div className="grid-2" style={{ marginTop: 16 }}>
        <section className="card">
          <p className="eyebrow">Last 24 hours</p>
          <div className="list" style={{ marginTop: 8 }}>
            <div className="list-row"><span className="dim">Realised loss</span><b className="num" style={{ color: Number(p.windows.h24.realisedLoss) > 0 ? "var(--blocked)" : undefined }}>{usd(p.windows.h24.realisedLoss)}</b></div>
            <div className="list-row"><span className="dim">Realised gain</span><b className="num">{usd(p.windows.h24.realisedGain)}</b></div>
            <div className="list-row"><span className="dim">Losing sessions</span><b className="num">{p.windows.h24.lossSessions}</b></div>
            <div className="list-row"><span className="dim">Sent out</span><b className="num">{usd(p.windows.h24.sent)}</b></div>
          </div>
        </section>
        <section className="card">
          <p className="eyebrow">Patterns (7 days)</p>
          <div className="list" style={{ marginTop: 8 }}>
            <div className="list-row"><span className="dim">Loss streak</span><b className="num">{p.lossStreak}</b></div>
            <div className="list-row"><span className="dim">Reloads within 3h of a loss</span><b className="num">{p.reloadsAfterLoss7d}</b></div>
            <div className="list-row"><span className="dim">Realised loss</span><b className="num">{usd(p.windows.d7.realisedLoss)}</b></div>
            <div className="list-row"><span className="dim">Median top-up (30d)</span><b className="num">{usd(p.medianTopUp30d)}</b></div>
          </div>
        </section>
      </div>

      <section className="card" style={{ marginTop: 16 }}>
        <div className="row-between">
          <p className="eyebrow">Shield monitor</p>
          <Pill tone={a.triggered ? "blocked" : "protect"}>{a.triggered ? "Rule met" : "Below trigger"}</Pill>
        </div>
        <p style={{ marginTop: 8, fontWeight: 500 }}>{a.headline}</p>
        {a.lines.length > 0 && (
          <ul className="small dim" style={{ margin: "8px 0 0", paddingLeft: 18 }}>
            {a.lines.map((l, i) => <li key={i}>{l}</li>)}
          </ul>
        )}
        {server.verdicts.length > 0 && (
          <div className="list" style={{ marginTop: 12 }}>
            {server.verdicts.slice(0, 5).map((v) => (
              <div key={v.verdict.nonce} className="list-row">
                <div>
                  <div className="small"><b>Verdict #{v.verdict.nonce}</b> · {usd(v.verdict.realizedLossUsdc)} attested · {v.source === "cre" ? "Chainlink CRE" : "Shield monitor"}</div>
                  <div className="tiny muted">{ago(v.issuedAt, now)}{v.signature ? <> · <ExplorerLink sig={v.signature} /></> : v.error ? ` · ${v.error}` : ""}</div>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => void openEvidence(v.verdict.evidenceHash)}>Evidence</button>
              </div>
            ))}
          </div>
        )}
        {vault && vault.lastVerdictNonce > 0n && (
          <p className="tiny muted" style={{ marginTop: 10 }}>The vault stores the hash of the evidence behind each verdict, so every pause can be traced to specific transactions.</p>
        )}
      </section>

      {realised.length > 0 && (
        <section className="card" style={{ marginTop: 16 }}>
          <p className="eyebrow">Sessions</p>
          <div className="bar-chart" style={{ marginTop: 12 }}>
            {[...realised].reverse().slice(-16).map((s, i) => (
              <div key={i} title={`${usd(s.net, { sign: true })} · ${dateTime(s.lastActivityAt)}`}>
                <i className={Number(s.net) < 0 ? "loss" : "gain"} style={{ height: `${Math.max(4, (Math.abs(Number(s.net)) / maxAbs) * 100)}%` }} />
              </div>
            ))}
          </div>
          <div className="list" style={{ marginTop: 12 }}>
            {sessions.slice(0, 8).map((s, i) => (
              <div key={i} className="list-row">
                <div>
                  <div className="small">
                    <b>{labelOf(s.wallet)}</b> · sent {usd(s.sent)}, {s.realised ? `${usd(s.returned)} came back` : "nothing back yet"}
                  </div>
                  <div className="tiny muted">{ago(s.lastActivityAt, now)} · {s.topUps} top-up{s.topUps === 1 ? "" : "s"}{s.signatures[0] ? <> · <ExplorerLink sig={s.signatures[s.signatures.length - 1]} /></> : null}</div>
                </div>
                {s.realised ? <b className="num" style={{ color: s.isLoss ? "var(--blocked)" : "var(--protect)" }}>{usd(s.net, { sign: true })}</b> : <Pill tone="neutral">Open</Pill>}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card" style={{ marginTop: 16 }}>
        <p className="eyebrow">Capital flows</p>
        {p.timeline.length === 0 ? (
          <p className="small muted" style={{ marginTop: 8 }}>No flows indexed yet.</p>
        ) : (
          <div className="timeline" style={{ marginTop: 10 }}>
            {p.timeline.slice(0, 30).map((f) => (
              <div key={`${f.signature}-${f.kind}-${f.amount}`} className={`tl-item ${f.outbound ? "out" : "in"}`}>
                <div className="row-between">
                  <div>
                    <div className="small"><b>{KIND_LABEL[f.kind] ?? f.kind}</b> · {f.outbound ? "to" : "from"} {labelOf(f.counterparty)}</div>
                    <div className="tiny muted">{dateTime(f.blockTime)} · <ExplorerLink sig={f.signature} /></div>
                  </div>
                  <b className="num">{f.outbound ? "−" : "+"}{usd(f.amount)}</b>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

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
                <div><b>{labelOf(s.wallet)}</b> · sent {usd(s.sent)}, {usd(s.returned)} back · <span style={{ color: Number(s.net) < 0 ? "var(--blocked)" : "var(--protect)" }}>{usd(s.net, { sign: true })}</span></div>
                <div className="tiny muted">{s.signatures.map((sig) => <span key={sig} style={{ marginRight: 8 }}><ExplorerLink sig={sig} /></span>)}</div>
              </div>
            ))}
            <p className="tiny muted" style={{ marginTop: 8 }}>Hash of this bundle is stored in your vault with the verdict. Evaluated {dateTime(evidence.asOf)}.</p>
          </div>
        )}
      </Sheet>
    </main>
  );
}
