/**
 * The Graph / Substreams source: streams `map_vault_flows` from a Graph
 * Market endpoint (devnet.sol.streamingfast.io:443 by default) using the
 * official JS SDK, keeps a resumable cursor, and hands flows to the
 * server. This is the load-bearing data path; `rpc-source.ts` is the
 * fallback when no SUBSTREAMS_API_TOKEN is configured.
 */
import { readFileSync } from "node:fs";
import { Package } from "@substreams/core/proto";
import { createAuthInterceptor, createRegistry, createRequest, streamBlocks, unpackMapOutput } from "@substreams/core";
import { createGrpcTransport } from "@connectrpc/connect-node";
import type { Flow, FlowKind } from "./behaviour";

export interface SubstreamsSourceOptions {
  token: string;
  endpoint: string; // host:port
  spkgPath: string;
  module: string;
  startBlock: bigint;
  cursor: string | null;
  onFlows: (flows: Flow[], cursor: string, slot: bigint) => void;
  onUndo: (lastValidSlot: bigint, cursor: string) => void;
  onStatus: (status: { connected: boolean; headSlot?: bigint; error?: string }) => void;
  log: (msg: string) => void;
}

const KIND_MAP: Record<string, FlowKind> = {
  TOP_UP_INSTANT: "TOP_UP_INSTANT",
  TOP_UP_GATED: "TOP_UP_GATED",
  COLD_TRANSFER: "COLD_TRANSFER",
  FULL_EXIT: "FULL_EXIT",
  RETURN: "RETURN",
  DEPOSIT: "DEPOSIT",
};

interface FlowJson {
  slot?: string | number;
  signature?: string;
  blockTime?: string | number;
  vault?: string;
  kind?: string;
  outbound?: boolean;
  counterparty?: string;
  amount?: string | number;
  counterpartyIsExecution?: boolean;
}

export function flowsFromMapOutput(json: { flows?: FlowJson[] }): Flow[] {
  return (json.flows ?? [])
    .filter((f) => f.kind && KIND_MAP[f.kind])
    .map((f) => ({
      slot: Number(f.slot ?? 0),
      signature: f.signature ?? "",
      blockTime: Number(f.blockTime ?? 0),
      vault: f.vault ?? "",
      kind: KIND_MAP[f.kind!],
      outbound: Boolean(f.outbound),
      counterparty: f.counterparty ?? "",
      amount: BigInt(f.amount ?? 0),
      counterpartyIsExecution: Boolean(f.counterpartyIsExecution),
    }));
}

export async function runSubstreamsSource(opts: SubstreamsSourceOptions, signal: AbortSignal): Promise<void> {
  const pkg = Package.fromBinary(new Uint8Array(readFileSync(opts.spkgPath)));
  const registry = createRegistry(pkg);
  const transport = createGrpcTransport({
    baseUrl: `https://${opts.endpoint}`,
    httpVersion: "2",
    interceptors: [createAuthInterceptor(opts.token)],
    jsonOptions: { typeRegistry: registry },
  });

  let cursor = opts.cursor;
  let backoff = 1000;
  while (!signal.aborted) {
    try {
      const request = createRequest({
        substreamPackage: pkg,
        outputModule: opts.module,
        productionMode: true,
        startBlockNum: cursor ? undefined : opts.startBlock,
        startCursor: cursor ?? undefined,
      });
      opts.log(`connecting to ${opts.endpoint} module=${opts.module} ${cursor ? "(resuming from cursor)" : `from slot ${opts.startBlock}`}`);
      for await (const response of streamBlocks(transport, request, { signal })) {
        const message = response.message;
        switch (message.case) {
          case "blockScopedData": {
            const data = message.value;
            const out = unpackMapOutput(response, registry);
            const slot = data.clock?.number ?? 0n;
            cursor = data.cursor;
            if (out) {
              const flows = flowsFromMapOutput(out.toJson({ typeRegistry: registry }) as { flows?: FlowJson[] });
              opts.onFlows(flows, data.cursor, slot);
            } else {
              opts.onFlows([], data.cursor, slot);
            }
            opts.onStatus({ connected: true, headSlot: slot });
            backoff = 1000;
            break;
          }
          case "blockUndoSignal": {
            const s = message.value;
            cursor = s.lastValidCursor;
            opts.onUndo(s.lastValidBlock?.number ?? 0n, s.lastValidCursor);
            break;
          }
          case "fatalError":
            throw new Error(`fatal error in module ${message.value.module}: ${message.value.reason}`);
          default:
            break;
        }
      }
      opts.log("stream ended; reconnecting");
    } catch (e) {
      if (signal.aborted) return;
      const msg = e instanceof Error ? e.message : String(e);
      opts.onStatus({ connected: false, error: msg });
      opts.log(`stream error: ${msg}; retrying in ${backoff}ms`);
      await new Promise((r) => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, 30_000);
    }
  }
}
