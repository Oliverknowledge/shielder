import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import { motion } from "motion/react";
import { useShield, NETWORK } from "../lib/shield";
import { Icon } from "../components/ui";

export function Welcome() {
  const { signer, vault, loading, connectDemo } = useShield();
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
      const arr = JSON.parse(demoJson) as number[];
      if (!Array.isArray(arr) || arr.length !== 64) throw new Error("expected a 64-number Solana keypair array");
      connectDemo(arr);
    } catch (e) {
      setDemoError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <main className="page page-narrow fade-in">
      <div style={{ padding: "40px 0 28px" }}>
        <p className="eyebrow" style={{ marginBottom: 14 }}>Self-custodial commitment layer · Solana</p>
        <h1 className="display" style={{ maxWidth: "14ch" }}>
          Wallets protect your keys. <span className="serif" style={{ fontStyle: "italic", fontWeight: 400 }}>Shield protects you from your own decisions.</span>
        </h1>
        <p className="lead" style={{ marginTop: 18, maxWidth: "44ch" }}>
          Keep most of your capital in a treasury that future-you can’t rage-click open. Trade freely from a bankroll. Refill it only by rules you set while calm.
        </p>
      </div>

      <div className="grid-3" style={{ marginBottom: 28 }}>
        {[
          ["Protected treasury", "Real on-chain enforcement. Not a notification, not a setting: the money cannot move."],
          ["Tighten fast, loosen slowly", "Making yourself safer is instant. Making yourself less safe waits 24 hours."],
          ["Your history, your rules", "Shield watches what actually came back from your trading wallet and pauses reloads after real losses."],
        ].map(([t, b]) => (
          <div key={t} className="card-plain">
            <h3 style={{ fontSize: 15, marginBottom: 6 }}>{t}</h3>
            <p className="small dim">{b}</p>
          </div>
        ))}
      </div>

      <div className="card">
        <h2 className="title" style={{ marginBottom: 4 }}>Connect a wallet</h2>
        <p className="small muted" style={{ marginBottom: 16 }}>Your wallet is the only authority over the vault. Shield never holds keys.</p>
        <div className="stack-s">
          {installed.length === 0 && <p className="small dim">No Solana wallet detected. Install Phantom, Solflare or Backpack, or use a demo key below.</p>}
          {installed.map((w) => (
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

        {NETWORK !== "mainnet-beta" && (
          <div style={{ marginTop: 18 }}>
            {!showDemo ? (
              <button className="btn btn-ghost btn-sm" onClick={() => setShowDemo(true)}>
                Continue with a demo key ({NETWORK})
              </button>
            ) : (
              <div className="stack-s fade-in">
                <p className="tiny muted">Paste a Solana CLI keypair JSON (the 64-number array). Kept in this tab’s session only. Never do this with a real key.</p>
                <textarea className="input mono" rows={3} value={demoJson} onChange={(e) => setDemoJson(e.target.value)} placeholder="[12,34,…]" />
                {demoError && <p className="tiny" style={{ color: "var(--blocked)" }}>{demoError}</p>}
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
        Built on a Solana program (immutable enforcement), The Graph Substreams (behavioural memory) and a Chainlink CRE confidential workflow (tamper-resistant monitor). Rules are enforced by code you can read.
      </p>
    </main>
  );
}
