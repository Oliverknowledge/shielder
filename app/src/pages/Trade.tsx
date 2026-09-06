/**
 * Trade: the session screen. Inside the plan, Shield gets out of the way.
 * Market data is live from Hyperliquid's public API on every build. Orders
 * are real when an agent key has been approved for the trading account on a
 * real Hyperliquid network; on the local Anvil demo the account is simulated
 * and the ticket says so instead of pretending.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useShield } from "../lib/shield";
import { Countdown, Dot, Icon, Pill, Sheet, useToast, type Tone } from "../components/ui";
import { GetMeSafe } from "../components/Safety";
import { usd, clockTime, hoursLabel } from "../lib/format";
import { OwnerKind, Route, COOLDOWN_REASON, rollingVelocity } from "../../../client/views";
import { agentAddress, getAgentKey, loadAccount, loadMarkets, loadRecentPnl, placeOrder, setAgentKey, updateLeverage, type AccountView, type HlNet, type Market } from "../lib/hyperliquid";
import type { Hex } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

const NET: HlNet = ((import.meta.env.VITE_HL_NETWORK as string | undefined) === "mainnet" ? "mainnet" : "testnet");

export function Trade() {
  const { vault, balance, wallets, now, chain, network, signer } = useShield();
  const toast = useToast();
  const exec = wallets.find((w) => w.kind === OwnerKind.Execution && w.active);
  const isHyperCore = chain === "evm" && exec?.route === Route.HyperCore;
  const realNetwork = chain === "evm" && (network === "hyperevm" || network === "hyperevm-testnet");
  const [markets, setMarkets] = useState<Market[]>([]);
  const [marketsError, setMarketsError] = useState<string | null>(null);
  const [account, setAccount] = useState<AccountView | null>(null);
  const [pnl24, setPnl24] = useState<{ closedPnl: number; fills: number } | null>(null);
  const [coin, setCoin] = useState("ETH");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [sizeUsd, setSizeUsd] = useState("100");
  const [lev, setLev] = useState(3);
  const [busy, setBusy] = useState(false);
  const [safeOpen, setSafeOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [agentKeyInput, setAgentKeyInput] = useState("");
  const [agent, setAgent] = useState<string | null>(() => agentAddress());

  useEffect(() => {
    let alive = true;
    const load = () => loadMarkets(NET).then((m) => alive && setMarkets(m)).catch((e) => alive && setMarketsError(e instanceof Error ? e.message : String(e)));
    load();
    const t = setInterval(load, 4000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  useEffect(() => {
    if (!exec || !realNetwork) return;
    let alive = true;
    const load = () => {
      loadAccount(NET, exec.owner).then((a) => alive && setAccount(a)).catch(() => null);
      loadRecentPnl(NET, exec.owner, Date.now() - 86_400_000).then((p) => alive && setPnl24(p)).catch(() => null);
    };
    load();
    const t = setInterval(load, 6000);
    return () => { alive = false; clearInterval(t); };
  }, [exec?.owner, realNetwork]);

  if (!vault) return null;
  const cooldownActive = Number(vault.cooldownUntil) > now;
  const velocity = rollingVelocity(vault, BigInt(now));
  const remainingToday = vault.velocityThreshold > velocity ? vault.velocityThreshold - velocity : 0n;
  const approaching = !cooldownActive && vault.velocityThreshold > 0n && remainingToday * 4n <= vault.velocityThreshold;
  const bankroll = exec?.usdc ?? null;
  const market = markets.find((m) => m.coin === coin) ?? markets[0];
  const sizeCoins = market && Number(sizeUsd) > 0 ? Number(sizeUsd) / market.mid : 0;
  const canTrade = !!agent && realNetwork && !!market;

  const status: { tone: Tone; text: string } = cooldownActive
    ? { tone: "blocked", text: `${vault.cooldownReason === COOLDOWN_REASON.SELF_PAUSE ? "Funding paused by you" : "Loss cooldown active"} · trade what's in your account, no new funding until ${clockTime(Number(vault.cooldownUntil), now)}` }
    : approaching
      ? { tone: "pending", text: `${usd(remainingToday)} until your reload protection` }
      : { tone: "protect", text: `Within your plan · ${usd(remainingToday)} more can be added today` };

  const submit = async () => {
    if (!market || !canTrade) return;
    setBusy(true);
    try {
      const res = await placeOrder(NET, market, side === "buy", sizeCoins);
      const statuses = (res as { response?: { data?: { statuses?: unknown[] } } }).response?.data?.statuses ?? [];
      const first = statuses[0] as { filled?: { totalSz: string; avgPx: string }; resting?: unknown; error?: string } | undefined;
      if (first?.error) throw new Error(first.error);
      toast.ok(first?.filled ? `${side === "buy" ? "Bought" : "Sold"} ${first.filled.totalSz} ${market.coin} at ${first.filled.avgPx}` : "Order placed");
    } catch (e) {
      toast.err(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const setLeverage = async (l: number) => {
    setLev(l);
    if (!market || !canTrade) return;
    try { await updateLeverage(NET, market, l); } catch (e) { toast.err(e instanceof Error ? e.message : String(e)); }
  };

  const useAgentKey = () => {
    try {
      const k = agentKeyInput.trim() as Hex;
      privateKeyToAccount(k);
      setAgentKey(k);
      setAgent(privateKeyToAccount(k).address);
      setAgentOpen(false);
      toast.ok("Agent key ready. Orders will not prompt.");
    } catch {
      toast.err("That isn't a valid private key.");
    }
  };

  const newAgentKey = () => {
    const k = generatePrivateKey();
    setAgentKeyInput(k);
  };

  return (
    <main className="page page-mid fade-in">
      <div className="page-head">
        <p className="eyebrow">Trade</p>
        <h1>{isHyperCore ? "Hyperliquid" : exec ? exec.label : "Your trading wallet"}</h1>
      </div>

      <div className={`strip strip-${status.tone}`} style={{ marginBottom: 16 }}>
        <Dot tone={status.tone} />
        <div className="grow">{status.text}</div>
        {cooldownActive && <span className="num right hide-xs" style={{ fontWeight: 600 }}><Countdown until={vault.cooldownUntil} now={now} format="compact" /></span>}
      </div>

      <section className="card card-hero">
        <div className="row-between wrap" style={{ alignItems: "flex-start" }}>
          <div>
            <p className="eyebrow">{isHyperCore ? "In your Hyperliquid account" : `In ${exec?.label ?? "your trading wallet"}`}</p>
            <div className="money-xl" style={{ marginTop: 8 }}>{account ? usd(account.accountValue) : bankroll === null ? "—" : usd(bankroll)}</div>
            <p className="dim" style={{ marginTop: 8 }}>
              {pnl24 ? <><span className={pnl24.closedPnl < 0 ? "c-blocked" : "c-protect"}>{usd(pnl24.closedPnl, { sign: true })}</span> realised in the last 24h over {pnl24.fills} fill{pnl24.fills === 1 ? "" : "s"}</> : `${usd(balance)} stays protected in the vault`}
            </p>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <Link to="/top-up" className="btn btn-secondary">Add funds</Link>
            <button className="btn btn-ghost" onClick={() => setSafeOpen(true)}><Icon name="protection" size={16} /> Get me safe</button>
          </div>
        </div>
        {account && account.positions.length > 0 && (
          <div className="list list-tight" style={{ marginTop: 18 }}>
            {account.positions.map((p) => (
              <div key={p.coin} className="list-row">
                <div><span style={{ fontWeight: 600 }}>{p.coin}</span> <span className="dim">{p.size > 0 ? "long" : "short"} {Math.abs(p.size)} · {p.leverage}x{p.entry ? ` · entry ${p.entry}` : ""}</span></div>
                <b className={`num ${p.unrealisedPnl < 0 ? "c-blocked" : "c-protect"}`}>{usd(p.unrealisedPnl, { sign: true })}</b>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="grid-main" style={{ marginTop: 8 }}>
        <section className="section">
          <div className="section-head">
            <h2>Markets</h2>
            <span className="tiny muted">Live from Hyperliquid {NET}{marketsError ? " · unavailable" : ""}</span>
          </div>
          <div className="list list-tight">
            {markets.map((m) => (
              <button key={m.coin} className="list-row" style={{ width: "100%", background: "none", border: 0, cursor: "pointer", textAlign: "left", padding: "10px 0" }} onClick={() => setCoin(m.coin)}>
                <div className="row" style={{ gap: 10 }}>
                  <Dot tone={coin === m.coin ? "bankroll" : "neutral"} />
                  <span style={{ fontWeight: 600 }}>{m.coin}</span>
                  <span className="tiny muted">up to {m.maxLeverage}x</span>
                </div>
                <b className="num">${m.mid.toLocaleString("en-US", { maximumFractionDigits: m.mid > 100 ? 1 : 4 })}</b>
              </button>
            ))}
            {markets.length === 0 && !marketsError && <p className="small muted">Loading prices…</p>}
            {marketsError && <p className="small muted">Prices unavailable: {marketsError}</p>}
          </div>
        </section>

        <section className="section">
          <div className="section-head">
            <h2>Order</h2>
            {agent ? <Pill tone="protect">Agent ready</Pill> : <Pill tone="neutral">No agent key</Pill>}
          </div>
          <div className="panel stack">
            <div className="segmented" style={{ alignSelf: "stretch", display: "flex" }}>
              <button className={side === "buy" ? "active" : ""} style={{ flex: 1 }} onClick={() => setSide("buy")}>Buy / long</button>
              <button className={side === "sell" ? "active" : ""} style={{ flex: 1 }} onClick={() => setSide("sell")}>Sell / short</button>
            </div>
            <div className="field">
              <label>Size (USD)</label>
              <input className="input" inputMode="decimal" value={sizeUsd} onChange={(e) => setSizeUsd(e.target.value.replace(/[^0-9.]/g, ""))} />
              <span className="hint">{market ? `≈ ${sizeCoins.toFixed(market.szDecimals)} ${market.coin} at $${market.mid.toLocaleString("en-US")}` : ""}</span>
            </div>
            <div className="field">
              <label>Leverage</label>
              <div className="chips">
                {[1, 2, 3, 5, 10].filter((l) => !market || l <= market.maxLeverage).map((l) => (
                  <button key={l} className={`chip ${lev === l ? "active" : ""}`} onClick={() => void setLeverage(l)}>{l}x</button>
                ))}
              </div>
            </div>
            {canTrade ? (
              <button className="btn btn-lg btn-block" disabled={busy || sizeCoins <= 0} onClick={() => void submit()}>{busy ? "Sending…" : `${side === "buy" ? "Buy" : "Sell"} ${market?.coin ?? ""} · ${usd(Number(sizeUsd) || 0)}`}</button>
            ) : !realNetwork ? (
              <div className="strip strip-neutral">
                <Icon name="clock" size={18} />
                <div className="grow">
                  <b>Local demo.</b> On {network}, your Hyperliquid account is simulated by the mock deposit contract, so orders can't be placed. Prices above are real. The HyperEVM build of Shield trades for real; see HUMAN_ACTIONS.md.
                </div>
              </div>
            ) : (
              <div className="stack-s">
                <div className="strip strip-pending">
                  <Icon name="bolt" size={18} />
                  <div className="grow"><b>Approve an agent key once</b> and trading never prompts again. Agent keys can only trade: they cannot withdraw, send, or touch the vault.</div>
                </div>
                <button className="btn btn-block" onClick={() => setAgentOpen(true)}>Set up trading</button>
              </div>
            )}
            <p className="tiny muted">Shield never gates trades. It only governs what can be added to this account.</p>
          </div>
        </section>
      </div>

      <GetMeSafe open={safeOpen} onClose={() => setSafeOpen(false)} context="home" />

      <Sheet open={agentOpen} onClose={() => setAgentOpen(false)} title="Trading without prompts">
        <div className="stack">
          <p className="dim">Hyperliquid lets your account approve an <b>agent key</b> that can place and cancel orders but can never move funds. Approve one with your account wallet (a user-signed action), then paste it here. Shield keeps it in this tab's session only.</p>
          <div className="notice-list">
            <div className="notice"><Dot tone="neutral" /><span>1. Generate a key below, or use one you already approved.</span></div>
            <div className="notice"><Dot tone="neutral" /><span>2. Approve it from your Hyperliquid account ({exec ? `${exec.owner.slice(0, 6)}…${exec.owner.slice(-4)}` : "your trading address"}) under API wallets, or via the SDK's approveAgent.</span></div>
            <div className="notice"><Dot tone="neutral" /><span>3. Paste the key here. Orders then sign locally without prompts.</span></div>
          </div>
          <div className="field">
            <label>Agent private key</label>
            <div className="row" style={{ gap: 8 }}>
              <input className="input mono" value={agentKeyInput} onChange={(e) => setAgentKeyInput(e.target.value)} placeholder="0x…" />
              <button className="btn btn-secondary" onClick={newAgentKey}>Generate</button>
            </div>
            {agentKeyInput && /^0x[0-9a-fA-F]{64}$/.test(agentKeyInput.trim()) && <span className="hint">Agent address: {privateKeyToAccount(agentKeyInput.trim() as Hex).address}</span>}
          </div>
          <button className="btn btn-block" disabled={!agentKeyInput.trim()} onClick={useAgentKey}>Use this agent key</button>
          {signer?.kind === "privy" && <p className="tiny muted">With Privy, approving happens with your embedded wallet's signature; the HyperEVM build calls approveAgent for you.</p>}
          {agent && <button className="btn btn-ghost btn-sm" onClick={() => { setAgentKey(null); setAgent(null); setAgentOpen(false); }}>Forget the current agent key</button>}
        </div>
      </Sheet>
    </main>
  );
}
