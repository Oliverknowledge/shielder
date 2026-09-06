import { useEffect, useRef, useState, type ReactElement } from "react";
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { ShieldProvider, useShield, NETWORK } from "./lib/shield";
import { ToastHost, Icon, Skeleton } from "./components/ui";
import { Welcome } from "./pages/Welcome";
import { Landing } from "./pages/Landing";
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

function AccountMenu() {
  const { signer, disconnect, network } = useShield();
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
  const pk = signer.publicKey.toBase58();
  return (
    <div className="account-wrap" ref={ref}>
      <button className="account" onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}>
        <i />
        <span className="mono ellipsis">{short(pk)}</span>
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="tiny muted">{signer.kind === "demo" ? "Demo key" : signer.label} · {network}</div>
          <div className="addr" style={{ marginTop: 4 }}>{pk}</div>
          <div className="row" style={{ marginTop: 10, gap: 6 }}>
            <button className="btn btn-secondary btn-sm" onClick={() => { void navigator.clipboard?.writeText(pk); setOpen(false); }}>Copy address</button>
            <button className="btn btn-ghost btn-sm" onClick={() => { setOpen(false); void disconnect(); }}>Sign out</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Shell() {
  const { signer, vault, loading, now } = useShield();
  const location = useLocation();
  const hasVault = !!vault;
  const cooldownActive = vault ? Number(vault.cooldownUntil) > now : false;

  const gate = (el: ReactElement) => {
    if (!signer) return <Navigate to="/welcome" replace />;
    if (loading) return <LoadingPage />;
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
