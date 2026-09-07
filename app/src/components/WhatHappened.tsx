/**
 * "See what happened": the factual timeline of this session.
 *
 * Every row comes from something that actually happened — a vault flow the
 * indexer saw, a verdict the monitor signed, a rejection the app made — with
 * its time and its on-chain reference. No narration is added that the data
 * does not support; the one closing line is derived from the same numbers.
 */
import { useMemo } from "react";
import { useShield } from "../lib/shield";
import { useAttempts } from "../lib/attempts";
import { useVenue } from "../lib/venue";
import { ExplorerLink, Sheet } from "./ui";
import { usd, timeOnly, hoursLabel } from "../lib/format";
import { COOLDOWN_REASON } from "../../../client/views";

interface Row {
  ts: number;
  title: string;
  body?: string;
  tone: "" | "hit" | "good";
  sig?: string | null;
}

export function WhatHappened({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { vault, balance, server, vaultKey, now } = useShield();
  const attempts = useAttempts(vaultKey);
  const venue = useVenue();

  const since = now - 86_400;
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const f of server?.profile.timeline ?? []) {
      if (f.blockTime < since) continue;
      if (f.kind === "TOP_UP_INSTANT" || f.kind === "TOP_UP_GATED") {
        out.push({ ts: f.blockTime, title: `${usd(f.amount)} released to ${venue.label}`, body: f.kind === "TOP_UP_GATED" ? "After the 30-minute wait on large top-ups" : "Within your plan", tone: "", sig: f.signature });
      } else if (f.kind === "RETURN") {
        out.push({ ts: f.blockTime, title: `${usd(f.amount)} came back to the treasury`, tone: "good", sig: f.signature });
      } else if (f.kind === "DEPOSIT") {
        out.push({ ts: f.blockTime, title: `${usd(f.amount)} deposited into the treasury`, tone: "good", sig: f.signature });
      } else if (f.kind === "COLD_TRANSFER") {
        out.push({ ts: f.blockTime, title: `${usd(f.amount)} moved to your safe wallet`, tone: "good", sig: f.signature });
      }
    }
    for (const v of server?.verdicts ?? []) {
      if (v.issuedAt < since) continue;
      out.push({
        ts: v.issuedAt,
        title: `Loss threshold crossed · ${usd(v.verdict.realizedLossUsdc)} realised`,
        body: `${v.source === "cre" ? "Evaluated inside the Chainlink CRE enclave" : "Evaluated by the Shield monitor"}${vault ? ` · new capital paused for ${hoursLabel(vault.lossCooldownSecs)}` : ""}`,
        tone: "hit",
        sig: v.signature,
      });
    }
    for (const a of attempts) {
      if (a.ts < since) continue;
      out.push({ ts: a.ts, title: `You asked for another ${usd(a.amount)}`, body: "Shield blocked the release. The money never left the treasury.", tone: "hit", sig: a.sig });
    }
    return out.sort((x, y) => x.ts - y.ts);
  }, [server?.profile.timeline, server?.verdicts, attempts, since, venue.label, vault]);

  const h24 = server?.profile.windows.h24;
  const sent = h24 ? BigInt(h24.sent) : 0n;
  // The number the rule acts on, not the raw shortfall — see Overview.tsx.
  const loss = server ? BigInt(server.assessment.realizedLossUsdc) : 0n;
  const blocked = attempts.filter((a) => a.ts >= since).reduce((a, b) => a + BigInt(b.amount), 0n);
  const byRule = vault?.cooldownReason === COOLDOWN_REASON.RISK_VERDICT;

  return (
    <Sheet open={open} onClose={onClose} title="What happened">
      <div className="stack">
        {rows.length === 0 ? (
          <p className="dim">Nothing has moved in the last 24 hours.</p>
        ) : (
          <div className="wh">
            {rows.map((r, i) => (
              <div key={`${r.ts}-${i}`} style={{ display: "contents" }}>
                <div className="wh-time">{timeOnly(r.ts)}</div>
                <div className={`wh-body ${r.tone}`}>
                  <div className="t">{r.title}</div>
                  {r.body && <div className="b">{r.body}</div>}
                  {r.sig && <div className="tiny muted" style={{ marginTop: 4 }}><ExplorerLink sig={r.sig} /></div>}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="divider" />
        <div className="two-up">
          <div><div className="k">Released to {venue.label}, 24h</div><div className="v">{usd(sent)}</div></div>
          <div><div className="k">Realised loss</div><div className="v" style={loss > 0n ? { color: "var(--blocked)" } : undefined}>{usd(loss)}</div></div>
          {blocked > 0n && <div><div className="k">Blocked</div><div className="v">{usd(blocked)}</div></div>}
          <div><div className="k">Still protected</div><div className="v c-protect">{usd(balance)}</div></div>
        </div>
        {loss > 0n && vault && (
          <p className="dim">
            {byRule ? (
              <>Your loss rule fired at <b>{usd(vault.lossTriggerUsdc)}</b>, which is the number you chose while calm. It pauses new capital for {hoursLabel(vault.lossCooldownSecs)} and nothing else: what is already in {venue.label} is still yours to trade.</>
            ) : (
              <>You are <b>{usd(loss < vault.lossTriggerUsdc ? vault.lossTriggerUsdc - loss : 0n)}</b> away from the {usd(vault.lossTriggerUsdc)} loss trigger you set.</>
            )}
          </p>
        )}
      </div>
    </Sheet>
  );
}
