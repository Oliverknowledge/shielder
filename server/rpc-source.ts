/**
 * RPC-based flow indexer: the fallback source when no Graph Market token
 * is configured. Produces exactly the same `Flow` records as the
 * Substreams `map_vault_flows` module (same classification rules), by
 * walking the vault's transaction history through Solana JSON-RPC.
 *
 * It is clearly labelled as the fallback in /api/health; the Substreams
 * source is the primary, load-bearing path.
 */
import { Connection, PublicKey, type ParsedInstruction, type ParsedTransactionWithMeta, type PartiallyDecodedInstruction } from "@solana/web3.js";
import { decodeEventsFromLogs, type RegistryEntryState, OwnerType, type ShieldEvent } from "../client/shield-client";
import type { Flow } from "./behaviour";

export interface ActivityEvent extends ShieldEvent {
  signature: string;
  slot: number;
  blockTime: number;
}

export interface RpcSyncResult {
  flows: Flow[];
  events: ActivityEvent[];
  newestSignature: string | null;
}

function isParsed(ix: ParsedInstruction | PartiallyDecodedInstruction): ix is ParsedInstruction {
  return (ix as ParsedInstruction).parsed !== undefined;
}

function* allInstructions(tx: ParsedTransactionWithMeta): Generator<ParsedInstruction | PartiallyDecodedInstruction> {
  for (const ix of tx.transaction.message.instructions) yield ix;
  for (const inner of tx.meta?.innerInstructions ?? []) for (const ix of inner.instructions) yield ix;
}

/** Fetch transactions newer than `untilSignature` for `address` (newest first from RPC; returned oldest first). */
async function fetchNewTransactions(connection: Connection, address: PublicKey, untilSignature: string | null): Promise<ParsedTransactionWithMeta[]> {
  const sigs = await connection.getSignaturesForAddress(address, { until: untilSignature ?? undefined, limit: 1000 }, "confirmed");
  if (sigs.length === 0) return [];
  const out: ParsedTransactionWithMeta[] = [];
  for (let i = 0; i < sigs.length; i += 50) {
    const batch = sigs.slice(i, i + 50).map((s) => s.signature);
    const txs = await connection.getParsedTransactions(batch, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
    for (const tx of txs) if (tx && !tx.meta?.err) out.push(tx);
  }
  return out.sort((a, b) => (a.slot - b.slot) || 0);
}

export async function syncVaultViaRpc(
  connection: Connection,
  vault: PublicKey,
  vaultTokenAccount: PublicKey,
  registry: RegistryEntryState[],
  cursor: { vaultSig: string | null; tokenSig: string | null }
): Promise<RpcSyncResult & { cursor: { vaultSig: string | null; tokenSig: string | null } }> {
  const [vaultTxs, tokenTxs] = await Promise.all([
    fetchNewTransactions(connection, vault, cursor.vaultSig),
    fetchNewTransactions(connection, vaultTokenAccount, cursor.tokenSig),
  ]);
  const seen = new Set<string>();
  const txs: ParsedTransactionWithMeta[] = [];
  for (const tx of [...vaultTxs, ...tokenTxs]) {
    const sig = tx.transaction.signatures[0];
    if (seen.has(sig)) continue;
    seen.add(sig);
    txs.push(tx);
  }
  txs.sort((a, b) => a.slot - b.slot);

  const execOwners = new Set(registry.filter((r) => r.kind === OwnerType.Execution && r.active).map((r) => r.owner.toBase58()));
  const vaultB58 = vault.toBase58();
  const ataB58 = vaultTokenAccount.toBase58();
  const flows: Flow[] = [];
  const events: ActivityEvent[] = [];

  for (const tx of txs) {
    const signature = tx.transaction.signatures[0];
    const blockTime = tx.blockTime ?? 0;
    const slot = tx.slot;

    for (const ev of decodeEventsFromLogs(tx.meta?.logMessages ?? [])) {
      if (ev.data.vault !== vaultB58) continue;
      events.push({ ...ev, signature, slot, blockTime });
      const d = ev.data as Record<string, string | boolean>;
      if (ev.name === "TopUpExecuted") {
        flows.push({
          slot,
          signature,
          blockTime,
          vault: vaultB58,
          kind: d.instant ? "TOP_UP_INSTANT" : "TOP_UP_GATED",
          outbound: true,
          counterparty: String(d.destinationOwner),
          amount: BigInt(String(d.amount)),
          counterpartyIsExecution: true,
        });
      } else if (ev.name === "ColdTransferExecuted" || ev.name === "FullExitExecuted") {
        flows.push({
          slot,
          signature,
          blockTime,
          vault: vaultB58,
          kind: ev.name === "ColdTransferExecuted" ? "COLD_TRANSFER" : "FULL_EXIT",
          outbound: true,
          counterparty: String(d.destinationOwner),
          amount: BigInt(String(d.amount)),
          counterpartyIsExecution: false,
        });
      }
    }

    // Inflows at the SPL Token level: anything landing in the vault token account.
    for (const ix of allInstructions(tx)) {
      if (!isParsed(ix) || ix.program !== "spl-token") continue;
      const p = ix.parsed as { type: string; info: Record<string, unknown> };
      if (p.type !== "transfer" && p.type !== "transferChecked") continue;
      if (p.info.destination !== ataB58) continue;
      const authority = String(p.info.authority ?? p.info.multisigAuthority ?? "");
      const amountRaw = p.type === "transfer" ? String(p.info.amount) : String((p.info.tokenAmount as { amount: string }).amount);
      const fromExec = execOwners.has(authority);
      flows.push({
        slot,
        signature,
        blockTime,
        vault: vaultB58,
        kind: fromExec ? "RETURN" : "DEPOSIT",
        outbound: false,
        counterparty: authority,
        amount: BigInt(amountRaw),
        counterpartyIsExecution: fromExec,
      });
    }
  }

  const newestVault = vaultTxs.length ? vaultTxs[vaultTxs.length - 1].transaction.signatures[0] : cursor.vaultSig;
  const newestToken = tokenTxs.length ? tokenTxs[tokenTxs.length - 1].transaction.signatures[0] : cursor.tokenSig;
  return { flows, events, newestSignature: newestVault, cursor: { vaultSig: newestVault, tokenSig: newestToken } };
}
