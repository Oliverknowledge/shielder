import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { PublicKey } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { motion } from "motion/react";
import { useShield, API_URL, NETWORK } from "../lib/shield";
import { useAction } from "../lib/actions";
import { Field, MoneyInput, Stepper, useToast } from "../components/ui";
import { usd, hoursLabel } from "../lib/format";
import { depositIx, initializeVaultIx, registerOwnerIx, usdcToRaw, vaultPda, OwnerType } from "../../../client/shield-client";
import { getJson } from "../lib/api";

const STEPS = ["Wallets", "Protection", "Review", "Activate"];

interface Draft {
  executionAddress: string;
  executionLabel: string;
  coldAddress: string;
  coldLabel: string;
  deposit: string;
  floor: string;
  daily: string;
  lossTrigger: string;
  lossCooldownHours: number;
  thresholdPct: number;
  monitor: boolean;
}

function isPubkey(s: string): boolean {
  try {
    new PublicKey(s);
    return s.length >= 32;
  } catch {
    return false;
  }
}

export function Setup() {
  const { signer, vault, loading, health, walletUsdc, refresh, vaultAddress } = useShield();
  const navigate = useNavigate();
  const toast = useToast();
  const { run, busy } = useAction();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>({
    executionAddress: "",
    executionLabel: "Axiom",
    coldAddress: "",
    coldLabel: "Ledger",
    deposit: "10000",
    floor: "6000",
    daily: "2000",
    lossTrigger: "1000",
    lossCooldownHours: 18,
    thresholdPct: 20,
    monitor: true,
  });
  const [activated, setActivated] = useState(false);
  const [deposited, setDeposited] = useState(false);
  const [faucetBusy, setFaucetBusy] = useState(false);

  useEffect(() => {
    if (health?.executionWallet && !draft.executionAddress) setDraft((d) => ({ ...d, executionAddress: health.executionWallet! }));
  }, [health?.executionWallet]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const n = (s: string) => Number(s || 0);

  const valid = useMemo(() => {
    if (step === 0) return isPubkey(draft.executionAddress) && (draft.coldAddress === "" || isPubkey(draft.coldAddress));
    if (step === 1) return n(draft.floor) >= 0 && n(draft.daily) > 0 && n(draft.lossTrigger) > 0 && draft.thresholdPct > 0 && draft.thresholdPct <= 100;
    return true;
  }, [step, draft]);

  if (!signer) return <Navigate to="/welcome" replace />;
  if (vault && !activated) return <Navigate to="/" replace />;

  const usdcMint = health?.usdcMint ?? (import.meta.env.VITE_USDC_MINT as string | undefined) ?? null;
  const verifier = draft.monitor && health?.monitor.verifier ? new PublicKey(health.monitor.verifier) : PublicKey.default;

  const activate = async () => {
    if (!usdcMint) {
      toast.err("No USDC mint configured. Start the Shield server or set VITE_USDC_MINT.");
      return;
    }
    const mint = new PublicKey(usdcMint);
    const [vaultPk] = vaultPda(signer.publicKey);
    const ixs = [
      initializeVaultIx({
        authority: signer.publicKey,
        usdcMint: mint,
        riskVerifier: verifier,
        protectedFloor: usdcToRaw(n(draft.floor)),
        topUpThresholdBps: Math.round(draft.thresholdPct * 100),
        emergencyCap: usdcToRaw(200),
        velocityThreshold: usdcToRaw(n(draft.daily)),
        lossTriggerUsdc: usdcToRaw(n(draft.lossTrigger)),
        lossCooldownSecs: BigInt(Math.round(draft.lossCooldownHours * 3600)),
      }),
      registerOwnerIx({ authority: signer.publicKey, vault: vaultPk, owner: new PublicKey(draft.executionAddress), kind: OwnerType.Execution, label: draft.executionLabel || "Trading" }),
    ];
    if (draft.coldAddress) {
      ixs.push(registerOwnerIx({ authority: signer.publicKey, vault: vaultPk, owner: new PublicKey(draft.coldAddress), kind: OwnerType.Cold, label: draft.coldLabel || "Cold" }));
    }
    // make sure the execution wallet can receive USDC
    const execAta = getAssociatedTokenAddressSync(mint, new PublicKey(draft.executionAddress), true);
    ixs.push(createAssociatedTokenAccountIdempotentInstruction(signer.publicKey, execAta, new PublicKey(draft.executionAddress), mint));
    // Mark as activated before sending: the provider refreshes the vault as
    // soon as the transaction confirms, and the redirect guard must not fire
    // before the deposit step has been shown.
    setActivated(true);
    try {
      await run("Shield activated", ixs);
      await refresh();
    } catch {
      setActivated(false);
    }
  };

  const deposit = async () => {
    if (!usdcMint || !vaultAddress) return;
    const mint = new PublicKey(usdcMint);
    const ata = getAssociatedTokenAddressSync(mint, signer.publicKey, true);
    try {
      await run(`Deposited ${usd(usdcToRaw(n(draft.deposit)))}`, [depositIx({ depositor: signer.publicKey, vault: vaultAddress, sourceTokenAccount: ata, amount: usdcToRaw(n(draft.deposit)) })]);
      setDeposited(true);
      setTimeout(() => navigate("/"), 600);
    } catch {
      /* toast shown */
    }
  };

  const faucet = async () => {
    setFaucetBusy(true);
    try {
      await getJson(`${API_URL}/api/demo/faucet`, { method: "POST", body: JSON.stringify({ owner: signer.publicKey.toBase58(), amountUsdc: n(draft.deposit) || 10000 }) });
      toast.ok(`Test USDC minted to your wallet`);
      await refresh();
    } catch (e) {
      toast.err(`Faucet failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setFaucetBusy(false);
    }
  };

  const floorPct = n(draft.deposit) > 0 ? Math.min(100, Math.round((n(draft.floor) / n(draft.deposit)) * 100)) : 0;

  return (
    <main className="page page-narrow fade-in">
      <div className="row-between" style={{ marginBottom: 8 }}>
        <p className="eyebrow">Set up Shield · {STEPS[step]}</p>
        <span className="tiny muted">{step + 1} / {STEPS.length}</span>
      </div>
      <Stepper step={step + 1} total={STEPS.length} />

      <motion.div key={step} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2 }} style={{ marginTop: 24 }}>
        {step === 0 && (
          <div className="stack">
            <div>
              <h1 className="title">Where does your money go?</h1>
              <p className="dim" style={{ marginTop: 6 }}>Shield can only send to addresses you register. Your trading wallet gets top-ups under your rules. A cold wallet is where you exit to.</p>
            </div>
            <div className="card stack">
              <p className="eyebrow">Trading wallet (execution)</p>
              <Field label="Address" hint="Axiom, a Telegram bot, an exchange deposit address: wherever you actually trade from.">
                <input className="input mono" value={draft.executionAddress} onChange={(e) => set({ executionAddress: e.target.value.trim() })} placeholder="Solana address" />
              </Field>
              <Field label="Label">
                <input className="input" value={draft.executionLabel} onChange={(e) => set({ executionLabel: e.target.value.slice(0, 24) })} />
              </Field>
            </div>
            <div className="card stack">
              <p className="eyebrow">Cold wallet (optional now, 24h to add later)</p>
              <Field label="Address" hint="A wallet you control and don't trade from. Small emergency amounts can move here instantly; a full exit takes 7 days.">
                <input className="input mono" value={draft.coldAddress} onChange={(e) => set({ coldAddress: e.target.value.trim() })} placeholder="Solana address" />
              </Field>
              <Field label="Label">
                <input className="input" value={draft.coldLabel} onChange={(e) => set({ coldLabel: e.target.value.slice(0, 24) })} />
              </Field>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="stack">
            <div>
              <h1 className="title">Choose your protection</h1>
              <p className="dim" style={{ marginTop: 6 }}>Set these while you’re calm. You can always tighten them instantly. Loosening any of them waits 24 hours.</p>
            </div>
            <div className="card stack">
              <Field label="Capital you'll deposit">
                <MoneyInput value={draft.deposit} onChange={(v) => set({ deposit: v })} />
              </Field>
              <Field label="Protected floor" hint={`Top-ups can never take the treasury below this. ${floorPct}% of your deposit stays untouchable.`}>
                <MoneyInput value={draft.floor} onChange={(v) => set({ floor: v })} />
                <div className="chips" style={{ marginTop: 8 }}>
                  {[50, 60, 70, 80].map((p) => (
                    <button key={p} className={`chip ${floorPct === p ? "active" : ""}`} onClick={() => set({ floor: String(Math.round((n(draft.deposit) * p) / 100)) })}>
                      {p}%
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Daily top-up limit" hint="Everything that leaves for trading in any rolling 24 hours, added together. Four $500 top-ups count as $2,000.">
                <MoneyInput value={draft.daily} onChange={(v) => set({ daily: v })} />
              </Field>
            </div>
            <div className="card stack">
              <p className="eyebrow">After losses</p>
              <Field label="Loss trigger" hint="When money that comes back from your trading wallet is this much short of what you sent (in 24 hours), Shield pauses top-ups.">
                <MoneyInput value={draft.lossTrigger} onChange={(v) => set({ lossTrigger: v })} />
              </Field>
              <Field label="Pause length">
                <div className="chips">
                  {[6, 12, 18, 24, 48].map((h) => (
                    <button key={h} className={`chip ${draft.lossCooldownHours === h ? "active" : ""}`} onClick={() => set({ lossCooldownHours: h })}>
                      {h}h
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Large top-ups wait 30 minutes above" hint="A single top-up at or above this share of the treasury waits half an hour before it can move.">
                <div className="chips">
                  {[10, 20, 30, 50].map((p) => (
                    <button key={p} className={`chip ${draft.thresholdPct === p ? "active" : ""}`} onClick={() => set({ thresholdPct: p })}>
                      {p}%
                    </button>
                  ))}
                </div>
              </Field>
            </div>
            <div className="card">
              <div className="row-between">
                <div>
                  <p style={{ fontWeight: 600 }}>Shield monitor</p>
                  <p className="small dim">Watches your trading wallet’s real on-chain flows and can only ever pause top-ups by your rule above. It can’t move money or loosen anything.</p>
                  {!health?.monitor.verifier && <p className="tiny" style={{ color: "var(--pending)", marginTop: 4 }}>Server not reachable: the monitor can be added later.</p>}
                </div>
                <button className={`switch ${draft.monitor && health?.monitor.verifier ? "on" : ""}`} onClick={() => set({ monitor: !draft.monitor })} aria-label="Toggle monitor" disabled={!health?.monitor.verifier} />
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="stack">
            <div>
              <h1 className="title">Your rules, in plain English</h1>
              <p className="dim" style={{ marginTop: 6 }}>These are enforced by the vault program itself. Read them like a contract with yourself.</p>
            </div>
            <div className="card">
              <ol className="stack-s" style={{ margin: 0, paddingLeft: 20, lineHeight: 1.6 }}>
                <li>Of the <b>{usd(n(draft.deposit))}</b> I deposit, <b>{usd(n(draft.floor))}</b> is protected. Top-ups can never touch it.</li>
                <li>I can send at most <b>{usd(n(draft.daily))}</b> to my trading wallet in any 24 hours, however I split it.</li>
                <li>Any single top-up worth <b>{draft.thresholdPct}%</b> or more of the treasury waits <b>30 minutes</b>.</li>
                <li>If <b>{usd(n(draft.lossTrigger))}</b> or more doesn’t come back from my trading wallet within 24 hours, top-ups pause for <b>{hoursLabel(draft.lossCooldownHours * 3600)}</b>.</li>
                <li>Making any rule stricter is instant. Making any rule weaker waits <b>24 hours</b>, and I can cancel it any time.</li>
                <li>Up to <b>$200</b> can move instantly to a cold wallet. Leaving Shield entirely takes <b>7 days</b>.</li>
                <li>Only my wallet can move funds. Shield’s monitor can pause top-ups by rule 4, and nothing else.</li>
              </ol>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="stack">
            <div>
              <h1 className="title">{activated ? "Shield is active" : "Activate Shield"}</h1>
              <p className="dim" style={{ marginTop: 6 }}>
                {activated ? "Now move capital into the treasury. Deposits are always allowed; only what leaves is governed." : "One transaction creates your vault and registers your wallets."}
              </p>
            </div>
            {!activated ? (
              <div className="card stack-s">
                <p className="small dim">Program: <span className="mono">{health?.programId ?? "…"}</span></p>
                <p className="small dim">USDC mint: <span className="mono">{usdcMint ?? "not configured"}</span></p>
                <button className="btn btn-lg btn-block" onClick={() => void activate()} disabled={!!busy || !usdcMint}>
                  {busy ? "Confirming…" : "Create my vault"}
                </button>
              </div>
            ) : (
              <div className="card stack">
                <Field label="Deposit into the treasury" hint={`Wallet balance: ${walletUsdc === null ? "…" : usd(walletUsdc)} test USDC`}>
                  <MoneyInput value={draft.deposit} onChange={(v) => set({ deposit: v })} />
                </Field>
                {walletUsdc !== null && walletUsdc < usdcToRaw(n(draft.deposit)) && NETWORK !== "mainnet-beta" && health?.demo && (
                  <div className="warn-box row-between">
                    <span>You need test USDC first.</span>
                    <button className="btn btn-secondary btn-sm" onClick={() => void faucet()} disabled={faucetBusy}>
                      {faucetBusy ? "Minting…" : `Mint ${usd(n(draft.deposit) || 10000)} test USDC`}
                    </button>
                  </div>
                )}
                <button className="btn btn-lg btn-block btn-protect" onClick={() => void deposit()} disabled={!!busy || deposited || (walletUsdc !== null && walletUsdc < usdcToRaw(n(draft.deposit)))}>
                  {deposited ? "Deposited" : busy ? "Confirming…" : `Deposit ${usd(n(draft.deposit))}`}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => navigate("/")}>Skip for now</button>
              </div>
            )}
          </div>
        )}
      </motion.div>

      {step < 3 && (
        <div className="row-between" style={{ marginTop: 24 }}>
          <button className="btn btn-ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
            Back
          </button>
          <button className="btn" onClick={() => setStep((s) => s + 1)} disabled={!valid || loading}>
            {step === 2 ? "Looks right" : "Continue"}
          </button>
        </div>
      )}
    </main>
  );
}
