import type { ReactElement } from "react";
import { BrowserRouter, Navigate, NavLink, Route, Routes } from "react-router-dom";
import { ShieldProvider, useShield, NETWORK } from "./lib/shield";
import { ToastHost, Icon, Skeleton } from "./components/ui";
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

function LoadingPage() {
  return (
    <main className="page">
      <div className="card card-hero" aria-busy="true" aria-label="Loading your vault">
        <Skeleton w={140} h={12} />
        <div style={{ marginTop: 14 }}><Skeleton w={260} h={56} /></div>
        <div style={{ marginTop: 14 }}><Skeleton w="60%" h={14} /></div>
        <div style={{ marginTop: 22 }}><Skeleton w="100%" h={14} /></div>
      </div>
    </main>
  );
}

function Shell() {
  const { signer, vault, loading, disconnect, now } = useShield();
  const hasVault = !!vault;
  const cooldownActive = vault ? Number(vault.cooldownUntil) > now : false;

  const gate = (el: ReactElement) => {
    if (!signer) return <Navigate to="/welcome" replace />;
    if (loading) return <LoadingPage />;
    if (!hasVault) return <Navigate to="/setup" replace />;
    return el;
  };

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
          {signer ? (
            <button className="account" onClick={() => void disconnect()} title={`${signer.publicKey.toBase58()} · click to sign out`}>
              <i />
              <span className="mono ellipsis">{short(signer.publicKey.toBase58())}</span>
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
              {t.to === "/top-up" && cooldownActive && <span className="dot" aria-label="Top-ups paused" />}
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
