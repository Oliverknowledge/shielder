import { useMemo } from "react";
import { useShield } from "../lib/shield";
import { Dot, ExplorerLink, Skeleton, type Tone } from "../components/ui";
import { usd, short, timeOnly, dayLabel, clockTime } from "../lib/format";
import { describeEvents } from "../lib/events";
import { useAttempts } from "../lib/attempts";
import { COOLDOWN_REASON } from "../../../client/views";

interface Item {
  ts: number;
  key: string;
  title: string;
  body: string;
  tone: Tone;
  category: string;
  sig: string | null;
  amount?: { text: string; tone: Tone };
}

export function Activity() {
  const { server, serverError, serverLoading, wallets, vault, vaultKey, now, chain, network } = useShield();
  const attempts = useAttempts(vaultKey);
  const labelOf = (owner: string) => wallets.find((w) => w.owner === owner)?.label ?? short(owner);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    const evs = server?.events ?? [];
    const views = describeEvents(evs, labelOf, now);
    evs.forEach((e, i) => {
      const v = views[i];
      out.push({ ts: e.blockTime, key: `${e.signature}-${e.name}-${out.length}`, title: v.title, body: v.body, tone: v.tone, category: v.category, sig: e.signature, amount: v.amount });
    });
    for (const a of attempts) {
      const why =
        a.reason === "CooldownActive"
          ? vault && vault.cooldownReason === COOLDOWN_REASON.SELF_PAUSE
            ? "You had paused new capital"
            : "Loss cooldown was active"
          : a.reason === "VelocityThresholdExceeded"
            ? "Over your daily limit"
            : a.reason === "ProtectedFloorBreached"
              ? "Would have breached your floor"
              : a.reason ?? "Rejected by the vault";
      out.push({ ts: a.ts, key: `attempt-${a.ts}-${a.amount}`, title: `Release of ${usd(a.amount)} to ${a.destinationLabel} blocked`, body: `${why} · the money never left the treasury`, tone: "blocked", category: "Blocked", sig: a.sig, amount: { text: usd(a.amount), tone: "blocked" } });
    }
    return out.sort((x, y) => y.ts - x.ts);
  }, [server?.events, attempts, wallets, vault, now]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => {
    const g: { label: string; items: Item[] }[] = [];
    for (const it of items) {
      const label = dayLabel(it.ts, now);
      const last = g[g.length - 1];
      if (last && last.label === label) last.items.push(it);
      else g.push({ label, items: [it] });
    }
    return g;
  }, [items, now]);

  return (
    <main className="page page-mid fade-in">
      <div className="page-head">
        <p className="eyebrow">Activity</p>
        <h1>Proof of everything Shield did</h1>
        <p>Every line is a {network === "anvil" ? "local" : chain === "evm" ? "HyperEVM" : "Solana"} transaction you can open. A blocked release never moved money, but the rejection is on-chain too.</p>
      </div>

      {vault && Number(vault.cooldownUntil) > now && (
        <div className="strip strip-blocked" style={{ marginBottom: 20 }}>
          <div className="grow">New capital paused until <b>{clockTime(Number(vault.cooldownUntil), now)}</b>{vault.cooldownReason === COOLDOWN_REASON.RISK_VERDICT ? " by your loss rule" : " by you"}.</div>
        </div>
      )}

      {!server && serverLoading && !serverError ? (
        <div className="feed" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="feed-item">
              <Dot tone="neutral" />
              <div><Skeleton w={220} h={16} /><div style={{ marginTop: 6 }}><Skeleton w={160} h={12} /></div></div>
              <span />
            </div>
          ))}
        </div>
      ) : !server && attempts.length === 0 ? (
        <div className="panel">
          <p className="dim">Activity needs the Shield server{serverError ? ` (${serverError})` : ""}. The vault itself is unaffected.</p>
        </div>
      ) : items.length === 0 ? (
        <div className="panel"><p className="muted">Nothing yet.</p></div>
      ) : (
        <div className="feed">
          {groups.map((g) => (
            <div key={g.label} className="feed-day">
              <p className="eyebrow">{g.label}</p>
              {g.items.map((it) => (
                <div key={it.key} className="feed-item">
                  <Dot tone={it.tone} />
                  <div style={{ minWidth: 0 }}>
                    <div className="t">{it.title}</div>
                    {it.body && <div className="b">{it.body}</div>}
                    <div className="m">
                      {timeOnly(it.ts)} · {it.category}
                      {it.sig && <> · <ExplorerLink sig={it.sig} /></>}
                    </div>
                  </div>
                  {it.amount ? <div className={`amt ${it.amount.tone === "protect" ? "c-protect" : it.amount.tone === "blocked" ? "c-blocked" : ""}`} style={it.amount.tone === "blocked" ? { textDecoration: "line-through", textDecorationThickness: 1.5 } : undefined}>{it.amount.text}</div> : <span />}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
