import { useEffect, useState } from "react";
import { useShield, API_URL } from "../lib/shield";
import { Dot, ExplorerLink, Pill, Sheet, Skeleton, useToast } from "../components/ui";
import { usd, ago, dateTime, short, timeOnly, dayLabel, hoursLabel } from "../lib/format";
import { OwnerKind } from "../../../client/views";
import { getJson, type EvidenceJson, type HlProfileJson } from "../lib/api";
import { usePrefs } from "../lib/prefs";
import { VENUE_NAME, HL_NET, useVenue } from "../lib/venue";
import { Link } from "react-router-dom";

const KIND_LABEL: Record<string, string> = {
  TOP_UP_INSTANT: "Released to trading",
  TOP_UP_GATED: "Released after the wait",
  COLD_TRANSFER: "To safe wallet",
  FULL_EXIT: "Exit",
  RETURN: "Came back",
  DEPOSIT: "Deposit",
};

export function Behaviour() {
  const { server, serverError, serverLoading, wallets, vault, now, signer, chain, health } = useShield();
  const toast = useToast();
  const [prefs] = usePrefs(signer?.address ?? null);
  const venue = useVenue();
  // The one genuinely personal thing in the product — how long this trader
  // waits before reloading after a loss, how many of their worst sessions
  // involved a second one — was gated on a localStorage key written once during
  // onboarding. Sign in on another device, or clear storage, and the whole
  // section silently vanished. The address is on chain: it is the registered
  // execution destination, which is the only place Shield can release to.
  const hlAddress = venue.address ?? prefs.hyperliquidAddress ?? null;
  const [hl, setHl] = useState<HlProfileJson | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!hlAddress) { setHl(null); return; }
    getJson<HlProfileJson>(`${API_URL}/api/hyperliquid/${hlAddress}?network=${HL_NET}`).then((p) => { if (!cancelled) setHl(p); }).catch(() => null);
    return () => { cancelled = true; };
  }, [hlAddress]);
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
          <p className="small dim" style={{ marginTop: 4 }}>It isn't reachable{serverError ? ` (${serverError})` : ""}. Your rules keep working without it; this page reads your trading history from the indexer and from the venue.</p>
        </div>
        )}
      </main>
    );
  }

  const p = server.profile;
  const a = server.assessment;
  const sessions = [...p.sessions].sort((x, y) => y.lastActivityAt - x.lastActivityAt);
  const execWallets = p.wallets.filter((w) => wallets.some((x) => x.owner === w.owner && x.kind === OwnerKind.Execution));
  const sent = BigInt(p.totals.sent);
  const returned = BigInt(p.totals.returned);
  const open = execWallets.reduce((acc, w) => acc + BigInt(w.openExposure), 0n);
  const lost = sent > returned + open ? sent - returned - open : 0n;
  const gained = returned > sent ? returned - sent : 0n;
  const tradingLabel = execWallets.map((w) => labelOf(w.owner)).join(" and ") || "your trading wallet";
  const denom = Number(sent > returned ? sent : returned) || 1;
  const w = (x: bigint) => `${(Number(x) / denom) * 100}%`;
  const loss24 = BigInt(server.assessment.realizedLossUsdc);
  const watchedFor = vault ? Math.max(0, now - Number(vault.createdAt)) : 0;
  const releases30d = p.windows.d30.topUpCount;
  /** A verdict that attested more than the current rule would. */
  const supersededVerdict = server.verdicts.find((v) => BigInt(v.verdict.realizedLossUsdc) > loss24) ?? null;

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
            <p className="lead" style={{ marginTop: 8 }}>Once capital is released, Shield watches what comes back and what {VENUE_NAME} settles, and turns both into your loss rule's evidence.</p>
          </>
        ) : (
          <>
            <h2 className="title-l">
              You released <span className="num">{usd(sent)}</span> to {tradingLabel}. <span className={`num ${returned >= sent ? "c-protect" : "c-blocked"}`}>{usd(returned)}</span> came back.
            </h2>
            <div style={{ marginTop: 20 }}>
              <div className="capital" style={{ height: 18 }} role="img" aria-label={`Came back ${usd(returned)}, still out ${usd(open)}, not back yet ${usd(lost)}`}>
                {returned > 0n && <i style={{ flexBasis: w(returned), background: "var(--protect)" }} />}
                {open > 0n && <i style={{ flexBasis: w(open), background: "var(--bankroll-2)" }} />}
                {lost > 0n && <i style={{ flexBasis: w(lost), background: "var(--bankroll-2)" }} />}
              </div>
              <div className="legend">
                <span><i style={{ background: "var(--protect)" }} />Came back <b>{usd(returned)}</b></span>
                {open > 0n && <span><i style={{ background: "var(--bankroll-2)" }} />Still out <b>{usd(open)}</b></span>}
                {lost > 0n && <span><i style={{ background: "var(--bankroll-2)" }} />Still at the venue <b>{usd(lost)}</b></span>}
                {gained > 0n && <span><i style={{ background: "var(--protect)" }} />Came back extra <b>{usd(gained)}</b></span>}
              </div>
            </div>
            {loss24 > 0n && (
              <p className="dim" style={{ marginTop: 16 }}>
                <b className="c-blocked num">{usd(loss24)}</b> of that is a realised loss in the last 24 hours{vault ? `, against your ${usd(vault.lossTriggerUsdc)} trigger` : ""}.
              </p>
            )}
          </>
        )}
      </section>

      {hl && hl.totals.sessions > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Your pattern on {VENUE_NAME}</h2>
            <span className="tiny muted">{short(hl.address, 6)} · {HL_NET} · read from {VENUE_NAME}</span>
          </div>
          {hl.insight && <div className="quote-box" style={{ marginBottom: 14 }}>{hl.insight}</div>}
          <div className="stat-grid">
            <div className="stat"><div className="k">Typical session</div><div className="v">{hl.typicalSessionSize === null ? "—" : usd(hl.typicalSessionSize)} deployed</div></div>
            <div className="stat"><div className="k">Largest losing session</div><div className="v c-blocked">{hl.largestLosingSession ? usd(Math.abs(hl.largestLosingSession.pnl)) : "—"}</div></div>
            <div className="stat"><div className="k">Reload after first loss</div><div className="v">{hl.medianMinutesToReloadAfterLoss === null ? "never" : `${Math.round(hl.medianMinutesToReloadAfterLoss)} min`}</div></div>
            <div className="stat"><div className="k">Sessions with 2+ reloads</div><div className="v">{hl.sessionsWithTwoPlusReloads}</div></div>
          </div>
          {hl.worstSessionsWithReload.worst >= 2 && (
            <p className="dim" style={{ marginTop: 12 }}>{hl.worstSessionsWithReload.withReload} of your {hl.worstSessionsWithReload.worst} worst sessions involved a second reload.</p>
          )}
        </section>
      )}

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
            {/* A clean bill of health for a week that has not happened yet is
                the fastest way to make every other number here look invented. */}
            <span>{p.reloadsAfterLoss7d > 0 ? `You reloaded within 3 hours of a loss ${p.reloadsAfterLoss7d} time${p.reloadsAfterLoss7d === 1 ? "" : "s"} this week.` : watchedFor < 7 * 86400 ? `No reloads within 3 hours of a loss so far. Shield has been watching for ${hoursLabel(watchedFor)}.` : "No reloads within 3 hours of a loss this week."}</span>
          </div>
          {Number(p.medianTopUp30d) > 0 && (
            <div className="notice">
              <Dot tone="neutral" />
              {/* "Typical" from a sample of one is not an observation, and
                  comparing that median to the same single release makes it a
                  tautology dressed as insight. */}
              <span>{releases30d >= 3 ? <>Your typical release is {usd(p.medianTopUp30d)}. {usd(p.velocity24h)} went to trading in the last 24 hours.</> : <>{usd(p.velocity24h)} went to trading in the last 24 hours. That is release {releases30d} — not enough yet to say what is typical for you.</>}</span>
            </div>
          )}
        </div>
        {(p.reloadsAfterLoss7d > 0 || p.lossStreak >= 2 || (hl?.worstSessionsWithReload.withReload ?? 0) >= 2) && (
          <div className="row wrap" style={{ marginTop: 14, gap: 8 }}>
            <Link to="/protection" className="btn btn-protect btn-sm">Protect me from this</Link>
            <span className="tiny muted">Tightening a rule applies the moment you ask.</span>
          </div>
        )}
        {server.verdicts.length > 0 && (
          <div className="list list-tight" style={{ marginTop: 16 }}>
            {server.verdicts.slice(0, 5).map((v) => (
              <div key={v.verdict.nonce} className="list-row">
                <div style={{ minWidth: 0 }}>
                  <div className="small"><b>Verdict #{v.verdict.nonce}</b> · {usd(v.verdict.realizedLossUsdc)} attested · {v.source === "cre" ? "Chainlink CRE enclave" : "Shield monitor"}</div>
                  <div className="tiny muted">{ago(v.issuedAt, now)}{v.signature ? <> · <ExplorerLink sig={v.signature} /></> : v.error ? ` · ${v.error}` : ""}{vault ? ` · paused new capital for ${hoursLabel(vault.lossCooldownSecs)}` : ""}</div>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => void openEvidence(v.verdict.evidenceHash)}>Evidence</button>
              </div>
            ))}
            {/* A verdict is permanent once it is on chain, but the rule that
                produced it is not. Without this, the screen shows "$69.50
                attested" one inch above "$0, below your trigger" and looks like
                it cannot count. Saying which rule armed it is both the honest
                explanation and a better answer than the contradiction. */}
            {supersededVerdict && (
              <p className="tiny muted" style={{ marginTop: 10 }}>
                Verdicts stay on chain once applied, and the pause runs its full length. #{supersededVerdict.verdict.nonce} attested {usd(supersededVerdict.verdict.realizedLossUsdc)} under Shield's earlier rule, which counted money still sitting at the venue as a loss. It doesn't any more: where {VENUE_NAME} answers, its own settlement decides.
              </p>
            )}
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
                    Released {usd(s.sent)} in {s.topUps} move{s.topUps === 1 ? "" : "s"} · {s.realised ? `${usd(s.returned)} came back` : "nothing back yet"}
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
                    {/* labelOf matches the counterparty against the registered
                        destinations, so a deposit the owner made from their own
                        wallet was being labelled "from Hyperliquid" — as if the
                        venue had funded them. A deposit only ever comes from a
                        depositor, and naming the venue there is simply wrong. */}
                    <div className="small"><b>{KIND_LABEL[f.kind] ?? f.kind}</b>{f.kind === "DEPOSIT" ? <> · from {f.counterparty.toLowerCase() === signer?.address.toLowerCase() ? "your wallet" : short(f.counterparty)}</> : <> · {f.outbound ? "to" : "from"} {labelOf(f.counterparty)}</>}</div>
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
        Vault flows above: {server.source.mode === "substreams" ? `live from The Graph Substreams · ${server.source.endpoint}` : `indexed from ${server.network === "anvil" ? "Anvil" : chain === "evm" ? "HyperEVM" : "Solana"} logs at ${server.source.endpoint}.`}
        {server.source.mode !== "substreams" && health?.substreamsAvailable ? ` The Graph Substreams package streams the same flows, but not here — ${health.substreamsAvailable.replace(/^no: /, "")}.` : ""}
        {hl ? ` Fills, positions and PnL above: read from ${VENUE_NAME}'s own API — HyperEVM never sees them.` : ""}
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
