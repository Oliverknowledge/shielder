import { useCallback, useState } from "react";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  vaultPda,
  vaultTokenAccountPda,
  proposalPda,
  ProposalCategory,
  fetchVault,
  fetchProposal,
  instantTopUpIx,
  proposeTopUpIx,
  proposeLoosenIx,
  proposeUninstallVaultIx,
  type DecodedVault,
} from "../../client/shield-client";

// This dashboard calls the exact same instruction-building code
// (client/shield-client.ts) that client/demo.ts and client/recovery-cli.ts
// use -- the UI and the CLI are provably doing the same thing, not two
// independent implementations that could silently drift apart.

const DEFAULT_RPC = "http://127.0.0.1:8899";
const usd = (raw: bigint) => `$${(Number(raw) / 1_000_000).toFixed(2)}`;

type LogEntry = { text: string; kind: "info" | "ok" | "err" };

function App() {
  const [rpcUrl, setRpcUrl] = useState(DEFAULT_RPC);
  const [keypair, setKeypair] = useState<Keypair | null>(null);
  const [axiomWallet, setAxiomWallet] = useState("");
  const [vault, setVault] = useState<DecodedVault | null>(null);
  const [vaultAddr, setVaultAddr] = useState<PublicKey | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState(false);

  const connection = new Connection(rpcUrl, "confirmed");

  const log = (text: string, kind: LogEntry["kind"] = "info") =>
    setLogs((prev) => [{ text, kind }, ...prev].slice(0, 30));

  const onKeypairFile = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      const raw = JSON.parse(text);
      const kp = Keypair.fromSecretKey(Uint8Array.from(raw));
      setKeypair(kp);
      log(`Loaded keypair: ${kp.publicKey.toBase58()}`, "ok");
      const [v] = vaultPda(kp.publicKey);
      setVaultAddr(v);
    } catch (e) {
      log(`Failed to load keypair: ${e instanceof Error ? e.message : String(e)}`, "err");
    }
  }, []);

  const refreshScoreboard = useCallback(async () => {
    if (!vaultAddr) return;
    const state = await fetchVault(connection, vaultAddr);
    setVault(state);
    if (!state) log("No vault found at that address on this RPC.", "err");
  }, [vaultAddr, rpcUrl]);

  async function runTopUp(amountUsdc: number) {
    if (!keypair || !vaultAddr || !axiomWallet) return;
    setBusy(true);
    try {
      const executionOwner = new PublicKey(axiomWallet);
      const [vaultTokenAccount] = vaultTokenAccountPda(vaultAddr);
      const amountRaw = BigInt(Math.round(amountUsdc * 1_000_000));
      const state = await fetchVault(connection, vaultAddr);
      if (!state) throw new Error("vault not found");

      const destAta = getAssociatedTokenAddressSync(state.usdcMint, executionOwner);

      log(`Attempting ${usd(amountRaw)} instant top-up to ${executionOwner.toBase58().slice(0, 8)}...`);
      try {
        const ix = instantTopUpIx({
          authority: keypair.publicKey,
          vault: vaultAddr,
          vaultTokenAccount,
          destinationOwner: executionOwner,
          destinationTokenAccount: destAta,
          amount: amountRaw,
        });
        const sig = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [keypair]);
        log(`Instant top-up succeeded: ${sig}`, "ok");
      } catch (err) {
        log(`Instant path rejected on-chain (expected above threshold): ${briefError(err)}`, "err");
        log("Falling back to the gated path (propose_top_up, 30m+ cooldown)...");
        const proposeIx = proposeTopUpIx({
          authority: keypair.publicKey,
          vault: vaultAddr,
          destinationOwner: executionOwner,
          amount: amountRaw,
        });
        const sig = await sendAndConfirmTransaction(connection, new Transaction().add(proposeIx), [keypair]);
        const [proposal] = proposalPda(vaultAddr, ProposalCategory.TopUp);
        log(`Top-up PROPOSED (queued, not instant): ${sig}`, "ok");
        const decoded = await fetchProposal(connection, proposal);
        if (decoded) {
          const unlockAt = new Date(Number(decoded.executeAfter) * 1000);
          log(`Unlocks at ${unlockAt.toLocaleString()} — trying to execute before then will fail on-chain.`);
        }
      }
    } catch (e) {
      log(briefError(e), "err");
    } finally {
      setBusy(false);
      refreshScoreboard();
    }
  }

  async function runRaiseLimit(newBps: number) {
    if (!keypair || !vaultAddr) return;
    setBusy(true);
    try {
      log(`Attempting to raise top-up threshold to ${(newBps / 100).toFixed(2)}%...`);
      const ix = proposeLoosenIx({ authority: keypair.publicKey, vault: vaultAddr, newTopUpThresholdBps: newBps });
      const sig = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [keypair]);
      log(`Limit raise QUEUED (24h delay, not applied instantly): ${sig}`, "ok");
    } catch (e) {
      log(briefError(e), "err");
    } finally {
      setBusy(false);
      refreshScoreboard();
    }
  }

  async function runRemoveShield(destination: string) {
    if (!keypair || !vaultAddr) return;
    setBusy(true);
    try {
      const dest = new PublicKey(destination);
      log(`Attempting to remove Shield entirely (full exit to ${dest.toBase58().slice(0, 8)}...)...`);
      const ix = proposeUninstallVaultIx({ authority: keypair.publicKey, vault: vaultAddr, destinationOwner: dest });
      const sig = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [keypair]);
      log(`Full Shield removal QUEUED (7-day delay, not instant): ${sig}`, "ok");
    } catch (e) {
      log(`Rejected on-chain: ${briefError(e)} (expected if the destination isn't a registered cold address yet)`, "err");
    } finally {
      setBusy(false);
      refreshScoreboard();
    }
  }

  return (
    <main>
      <header>
        <h1>Shield</h1>
        <p className="tagline">A treasury vault that gates the reload, not the trade.</p>
      </header>

      <section className="panel">
        <h2>1. Connect</h2>
        <label>
          RPC URL
          <input value={rpcUrl} onChange={(e) => setRpcUrl(e.target.value)} />
        </label>
        <label>
          Authority keypair (Solana CLI JSON, e.g. <code>~/.config/solana/id.json</code>)
          <input type="file" accept="application/json" onChange={(e) => e.target.files && onKeypairFile(e.target.files[0])} />
        </label>
        {keypair && (
          <p className="muted">
            Authority: <code>{keypair.publicKey.toBase58()}</code>
            <br />
            Vault: <code>{vaultAddr?.toBase58()}</code>
          </p>
        )}
        <label>
          Axiom (execution wallet) pubkey
          <input value={axiomWallet} onChange={(e) => setAxiomWallet(e.target.value)} placeholder="registered execution wallet pubkey" />
        </label>
        <button onClick={refreshScoreboard} disabled={!vaultAddr}>
          Load scoreboard
        </button>
      </section>

      {vault && (
        <section className="panel">
          <h2>2. Scoreboard</h2>
          <dl className="scoreboard">
            <dt>Top-up threshold</dt>
            <dd>{(vault.topUpThresholdBps / 100).toFixed(2)}% of vault balance</dd>
            <dt>Emergency cap</dt>
            <dd>{usd(vault.emergencyCap)}</dd>
            <dt>Velocity threshold</dt>
            <dd>{usd(vault.velocityThreshold)} / 24h</dd>
            <dt>Rolling velocity now</dt>
            <dd>{usd(vault.velocityBuckets.reduce((a, b) => a + b, 0n))}</dd>
            <dt>Behavioral cooldown</dt>
            <dd>
              {vault.behavioralCooldownUntil > BigInt(Math.floor(Date.now() / 1000))
                ? `ARMED until ${new Date(Number(vault.behavioralCooldownUntil) * 1000).toLocaleString()}`
                : "not armed"}
            </dd>
            <dt>Config version</dt>
            <dd>{vault.configVersion.toString()}</dd>
          </dl>
        </section>
      )}

      <section className="panel">
        <h2>3. The demo sequence</h2>
        <div className="actions">
          <button disabled={busy || !keypair || !axiomWallet} onClick={() => runTopUp(3800)}>
            Attempt $3,800 top-up
          </button>
          <button disabled={busy || !keypair} onClick={() => runRaiseLimit(5000)}>
            Attempt to raise the limit to 50%
          </button>
          <button
            disabled={busy || !keypair}
            onClick={() => keypair && runRemoveShield(keypair.publicKey.toBase58())}
          >
            Attempt to remove Shield
          </button>
        </div>
        <p className="muted">
          De-risking / reducing exposure is always instant and never gated — there's no button for it here
          because it's just a plain SPL transfer to a registered cold address, not a special Shield action.
        </p>
      </section>

      <section className="panel">
        <h2>Log</h2>
        <ul className="log">
          {logs.map((l, i) => (
            <li key={i} className={l.kind}>
              {l.text}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

function briefError(e: unknown): string {
  const s = e instanceof Error ? e.message : String(e);
  const match = s.match(/Error Message: ([^.]+\.)/);
  return match ? match[1] : s.slice(0, 200);
}

export default App;
