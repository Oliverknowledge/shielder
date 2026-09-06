import { useEffect, useRef, useState, type ReactElement } from "react";
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { ShieldProvider, useShield, NETWORK } from "./lib/shield";
import { ToastHost, Icon, Skeleton } from "./components/ui";
import { Welcome } from "./pages/Welcome";
import { Landing } from "./pages/Landing";
import { Setup } from "./pages/Setup";
import { Overview } from "./pages/Overview";
import { AddFunds } from "./pages/TopUp";
import { Behaviour } from "./pages/Behaviour";
import { Protection } from "./pages/Protection";
import { Activity } from "./pages/Activity";
import { short } from "./lib/format";

// Shield is not a trading venue: there is no Trade tab. The user trades on
// Hyperliquid; these four screens are the control layer around that.
const TABS = [
  { to: "/", label: "Home", icon: "home" as const },
  { to: "/behaviour", label: "Behaviour", icon: "behaviour" as const },
  { to: "/protection", label: "Protection", icon: "protection" as const },
  { to: "/activity", label: "Activity", icon: "activity" as const },
];

/** The app knows the vault address from VITE_SHIELD_VAULT_ADDRESS or from the
 *  server's /api/health. With neither, it cannot read the chain at all, and
 *  saying so beats an endless skeleton. */
function ConfigMissing({ error }: { error: string | null }) {
  return (
    <main className="page page-narrow fade-in">
      <div className="page-head">
        <p className="eyebrow">Not connected</p>
        <h1>Shield can't find your vault</h1>
        <p>
          The app needs the vault contract address. It normally comes from the Shield server, which isn't answering
          {error ? ` (${error})` : ""}.
        </p>
      </div>
      <div className="panel">
        <p className="small dim">
          Start the server (<span className="mono">bun run server:evm</span>), or set <span className="mono">VITE_SHIELD_VAULT_ADDRESS</span> and{" "}
          <span className="mono">VITE_USDC_ADDRESS</span> so the app can read the chain on its own. Your vault and every rule in it are unaffected either way.
        </p>
      </div>
    </main>
  );
}

function LoadingPage() {
  // Skeletons alone read as a broken app when the chain is slow, and the public
  // HyperEVM RPC is metered enough to take a few seconds on a cold load.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 4000);
    return () => clearTimeout(t);
  }, []);
  return (
    <main className="page">
      <div className="card card-hero" aria-busy="true" aria-label="Reading your vault">
        <p className="eyebrow">Reading your vault</p>
        <div style={{ marginTop: 14 }}><Skeleton w={260} h={56} /></div>
        <div style={{ marginTop: 14 }}><Skeleton w="60%" h={14} /></div>
        <div style={{ marginTop: 22 }}><Skeleton w="100%" h={14} /></div>
        {slow && (
          <p className="small dim" style={{ marginTop: 18 }}>
            Still reading {NETWORK}. The public RPC rate-limits bursts, so this can take a few seconds on a cold load; Shield keeps retrying.
          </p>
        )}
      </div>
    </main>
  );
}

function AccountMenu() {
  const { signer, disconnect, network, registry } = useShield();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  if (!signer) return null;
  const pk = signer.address;
  const destinations = registry.filter((r) => r.active);
  return (
    <div className="account-wrap" ref={ref}>
      <button className="account" onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}>
        <i />
        <span className="mono ellipsis">{short(pk)}</span>
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="tiny muted">{signer.kind === "privy" ? `Privy · ${signer.label}` : signer.kind === "demo" ? "Demo key" : signer.label} · {network}</div>
          <div className="addr" style={{ marginTop: 4 }}>{pk}</div>
          {destinations.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div className="tiny muted">Where Shield can send</div>
              {destinations.map((r) => (
                <div key={r.owner} className="row-between" style={{ marginTop: 4, gap: 8 }}>
                  <span className="small">{r.label || short(r.owner)}</span>
                  <span className="addr">{short(r.owner)}</span>
                </div>
              ))}
            </div>
          )}
          <div className="row" style={{ marginTop: 12, gap: 6 }}>
            <button className="btn btn-secondary btn-sm" onClick={() => { void navigator.clipboard?.writeText(pk); setOpen(false); }}>Copy address</button>
            <button className="btn btn-ghost btn-sm" onClick={() => { setOpen(false); void disconnect(); }}>Sign out</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Shell() {
  const { signer, vault, loading, now, engine, serverError, chain, vaultKnown } = useShield();
  const location = useLocation();
  const hasVault = !!vault;
  const cooldownActive = vault ? Number(vault.cooldownUntil) > now : false;

  const gate = (el: ReactElement) => {
    if (!signer) return <Navigate to="/welcome" replace />;
    if (!engine && chain === "evm") return <ConfigMissing error={serverError} />;
    // Only send someone to onboarding once a read has actually said "no vault".
    // A rate-limited or dropped RPC call must never look like a missing vault.
    if (loading || !vaultKnown) return <LoadingPage />;
    if (!hasVault) return <Navigate to="/setup" replace />;
    return el;
  };

  const landing = !signer && (location.pathname === "/" || location.pathname === "/landing");
  if (landing) return <Landing />;

  return (
    <div className="shell">
      <header className="topbar">
        <NavLink to={signer && hasVault ? "/" : "/welcome"} className="brand" aria-label="Shield home">
          <Icon name="shield" size={22} />
          <span>Shield</span>
          {NETWORK !== "mainnet-beta" && <span className="net">{NETWORK}</span>}
        </NavLink>
        {signer && hasVault && (
          <nav className="nav" aria-label="Primary">
            {TABS.map((t) => (
              <NavLink key={t.to} to={t.to} end={t.to === "/"} className={({ isActive }) => (isActive ? "active" : "")}>
                {t.label}
              </NavLink>
            ))}
          </nav>
        )}
        <div className="topbar-right">
          <AccountMenu />
        </div>
      </header>

      <Routes>
        <Route path="/welcome" element={<Welcome />} />
        <Route path="/landing" element={<Landing />} />
        <Route path="/setup" element={!signer ? <Navigate to="/welcome" replace /> : !engine && chain === "evm" ? <ConfigMissing error={serverError} /> : <Setup />} />
        <Route path="/" element={gate(<Overview />)} />
        <Route path="/add-funds" element={gate(<AddFunds />)} />
        <Route path="/top-up" element={<Navigate to="/add-funds" replace />} />
        <Route path="/trade" element={<Navigate to="/" replace />} />
        <Route path="/behaviour" element={gate(<Behaviour />)} />
        <Route path="/protection" element={gate(<Protection />)} />
        <Route path="/activity" element={gate(<Activity />)} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {signer && hasVault && (
        <nav className="tabbar" aria-label="Primary">
          {TABS.map((t) => (
            <NavLink key={t.to} to={t.to} end={t.to === "/"} className={({ isActive }) => (isActive ? "active" : "")}>
              <Icon name={t.icon} />
              <span>{t.label}</span>
              {t.to === "/" && cooldownActive && <span className="dot" aria-label="New capital paused" />}
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}

export default function App() {
  return (
    <ShieldProvider>
      <ToastHost>
        <BrowserRouter>
          <Shell />
        </BrowserRouter>
      </ToastHost>
    </ShieldProvider>
  );
}
