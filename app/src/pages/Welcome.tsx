import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import { motion } from "motion/react";
import { useShield, NETWORK, IS_MAINNET, CHAIN } from "../lib/shield";
import { CapitalBar, Dot, Icon } from "../components/ui";

export function Welcome() {
  const { signer, vault, loading, connectDemo, privy } = useShield();
  const wallet = useWallet();
  const [showDemo, setShowDemo] = useState(false);
  const [demoJson, setDemoJson] = useState("");
  const [demoError, setDemoError] = useState<string | null>(null);

  useEffect(() => {
    if (wallet.wallet && !wallet.connected && !wallet.connecting) void wallet.connect().catch(() => null);
  }, [wallet.wallet]); // eslint-disable-line react-hooks/exhaustive-deps

  if (signer && !loading) return <Navigate to={vault ? "/" : "/setup"} replace />;

  const installed = wallet.wallets.filter((w) => w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable);

  const tryDemo = () => {
    try {
      if (CHAIN === "evm") {
        const hex = demoJson.trim();
        if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) throw new Error("Expected a 0x-prefixed 32-byte private key");
        connectDemo(hex);
        return;
      }
      const arr = JSON.parse(demoJson) as number[];
      if (!Array.isArray(arr) || arr.length !== 64) throw new Error("Expected a 64-number Solana keypair array");
      connectDemo(arr);
    } catch (e) {
      setDemoError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <main className="page page-narrow fade-in">
      <div style={{ padding: "36px 0 28px" }}>
        <p className="eyebrow" style={{ marginBottom: 14 }}>Self-custodial · {CHAIN === "evm" ? "Hyperliquid · HyperEVM" : "Solana"}</p>
        <h1 className="display" style={{ maxWidth: "14ch" }}>
          Wallets protect your keys. <span className="serif" style={{ fontStyle: "italic", fontWeight: 400 }}>Shield protects you from your own decisions.</span>
        </h1>
        <p className="lead" style={{ marginTop: 18, maxWidth: "46ch" }}>
          Keep most of your capital in a treasury that future-you can't rage-click open. Trade from a bankroll. Refill it only by rules you set while calm.
        </p>
      </div>

      <section className="card card-hero" aria-label="How Shield splits your capital">
        <div className="row-between">
          <p className="eyebrow">Say you put in $10,000</p>
          <span className="tiny muted">example</span>
        </div>
        <div style={{ marginTop: 14 }}>
          <CapitalBar floor={6_000_000_000n} room={2_000_000_000n} trade={2_000_000_000n} />
          <div className="legend">
            <span><i style={{ background: "var(--protect)" }} />Never touched <b>$6,000</b></span>
            <span><i style={{ background: "var(--protect-2)" }} />Refillable by rule <b>$2,000</b></span>
            <span><i style={{ background: "var(--bankroll-2)" }} />Trading now <b>$2,000</b></span>
          </div>
        </div>
        <p className="title" style={{ marginTop: 20, fontSize: 19 }}>
          It doesn't stop you trading. <span className="dim" style={{ fontWeight: 500 }}>It stops you topping up after a bad day.</span>
        </p>
      </section>

      <div className="notice-list" style={{ margin: "24px 4px 28px" }}>
        <div className="notice"><Dot tone="protect" /><span><b>Real enforcement.</b> Not a notification, not a setting. When a top-up is blocked, the money cannot move.</span></div>
        <div className="notice"><Dot tone="pending" /><span><b>Tighten fast, loosen slowly.</b> Making yourself safer is instant. Making yourself less safe waits 24 hours.</span></div>
        <div className="notice"><Dot tone="bankroll" /><span><b>Your history, your rules.</b> Shield watches what actually came back from your trading wallet and pauses reloads after real losses.</span></div>
      </div>

      <div className="card">
        <h2 className="title" style={{ marginBottom: 4 }}>Connect a wallet</h2>
        <p className="small muted" style={{ marginBottom: 16 }}>Your wallet is the only authority over the vault. Shield never holds keys.</p>
        <div className="stack-s">
          {privy.available && (
            <button className="btn btn-block btn-lg" disabled={!privy.ready} onClick={() => privy.login()}>
              {privy.ready ? "Continue with email, passkey or wallet" : "Loading…"}
            </button>
          )}
          {privy.available && <p className="tiny muted">Powered by Privy: a self-custodial wallet is created for you on {NETWORK}. No seed phrase ceremony.</p>}
          {CHAIN === "solana" && installed.length === 0 && <p className="small dim">No Solana wallet detected. Install Phantom, Solflare or Backpack{!IS_MAINNET ? ", or continue with a demo key below" : ""}.</p>}
          {CHAIN === "evm" && !privy.available && <p className="small dim">Sign in with a local key for the {NETWORK} demo. With a Privy app ID configured, this becomes email or passkey sign-in with an embedded wallet.</p>}
          {CHAIN === "solana" && installed.map((w) => (
            <motion.button
              key={w.adapter.name}
              className="btn btn-secondary btn-block"
              style={{ justifyContent: "space-between" }}
              whileTap={{ scale: 0.99 }}
              onClick={() => {
                wallet.select(w.adapter.name);
              }}
            >
              <span className="row">
                <img src={w.adapter.icon} alt="" width={20} height={20} style={{ borderRadius: 6 }} />
                {w.adapter.name}
              </span>
              <Icon name="arrow" size={18} />
            </motion.button>
          ))}
        </div>

        {!IS_MAINNET && (
          <div style={{ marginTop: 14 }}>
            {!showDemo ? (
              <button className={`btn ${installed.length === 0 && !privy.available ? "btn-secondary btn-block" : "btn-ghost btn-sm"}`} onClick={() => setShowDemo(true)}>
                Continue with a demo key ({NETWORK})
              </button>
            ) : (
              <div className="stack-s fade-in">
                <p className="tiny muted">{CHAIN === "evm" ? "Paste a hex private key (an Anvil dev key on the local demo). Kept in this tab's session only. Never do this with a real key." : "Paste a Solana CLI keypair JSON (the 64-number array). Kept in this tab's session only. Never do this with a real key."}</p>
                <textarea className="input mono" rows={3} value={demoJson} onChange={(e) => setDemoJson(e.target.value)} placeholder={CHAIN === "evm" ? "0x…" : "[12,34,…]"} />
                {demoError && <p className="tiny c-blocked">{demoError}</p>}
                <div className="row">
                  <button className="btn btn-sm" onClick={tryDemo} disabled={!demoJson.trim()}>
                    Use demo key
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setShowDemo(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <p className="tiny muted" style={{ marginTop: 20 }}>
        {CHAIN === "evm" ? "A vault contract on HyperEVM enforces the rules and funds your Hyperliquid account directly." : "A Solana program enforces the rules."} The Graph Substreams remembers what came back. A Chainlink CRE confidential workflow signs the loss verdicts. All of it is code you can read.
      </p>
    </main>
  );
}
