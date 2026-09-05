import type { ReactElement } from "react";
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { ShieldProvider, useShield, NETWORK } from "./lib/shield";
import { ToastHost, Icon, Pill } from "./components/ui";
import { Welcome } from "./pages/Welcome";
import { Setup } from "./pages/Setup";
import { Overview } from "./pages/Overview";
import { TopUp } from "./pages/TopUp";
import { Behaviour } from "./pages/Behaviour";
import { Protection } from "./pages/Protection";
import { Activity } from "./pages/Activity";
import { short } from "./lib/format";

const TABS = [
  { to: "/", label: "Overview", icon: "home" as const },
  { to: "/top-up", label: "Top up", icon: "topup" as const },
  { to: "/behaviour", label: "Behaviour", icon: "behaviour" as const },
  { to: "/protection", label: "Protection", icon: "protection" as const },
  { to: "/activity", label: "Activity", icon: "activity" as const },
];

function Shell() {
  const { signer, vault, loading, disconnect, now } = useShield();
  const location = useLocation();
  const hasVault = !!vault;
  const cooldownActive = vault ? Number(vault.cooldownUntil) > now : false;

  const gate = (el: ReactElement) => {
    if (!signer) return <Navigate to="/welcome" replace />;
    if (loading) return <div className="page"><p className="muted">Loading your vault…</p></div>;
    if (!hasVault) return <Navigate to="/setup" replace />;
    return el;
  };

  return (
    <div className="shell">
      <header className="topbar">
        <NavLink to={signer && hasVault ? "/" : "/welcome"} className="brand">
          <Icon name="shield" size={22} />
          <span>Shield</span>
          {NETWORK !== "mainnet-beta" && <span className="pill pill-neutral" style={{ marginLeft: 4 }}>{NETWORK}</span>}
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
        <div className="row" style={{ gap: 8 }}>
          {signer && hasVault && cooldownActive && location.pathname !== "/top-up" && <Pill tone="blocked">Cooldown</Pill>}
          {signer ? (
            <button className="btn btn-ghost btn-sm" onClick={() => void disconnect()} title={signer.publicKey.toBase58()}>
              <span className="mono">{short(signer.publicKey.toBase58())}</span>
            </button>
          ) : null}
        </div>
      </header>

      <Routes>
        <Route path="/welcome" element={<Welcome />} />
        <Route path="/setup" element={signer ? <Setup /> : <Navigate to="/welcome" replace />} />
        <Route path="/" element={gate(<Overview />)} />
        <Route path="/top-up" element={gate(<TopUp />)} />
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
