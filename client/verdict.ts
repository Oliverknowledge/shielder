/**
 * Risk verdict wire format — dependency-light on purpose so the Chainlink
 * CRE workflow (QuickJS/WASM, no Node built-ins) can import it as-is.
 *
 * The bytes signed by the verifier are the Borsh encoding of `RiskVerdict`
 * (programs/shield-vault/src/state.rs) with the signature zeroed. The
 * program rebuilds exactly these bytes and checks them against the
 * Ed25519 precompile, so field order and widths here are load-bearing.
 */
import * as borsh from "borsh";
import { sha256 } from "@noble/hashes/sha2.js";

export const VERDICT_TTL_SECS = 15 * 60;

export const RISK_VERDICT_SCHEMA: borsh.Schema = {
  struct: {
    vault: { array: { type: "u8", len: 32 } },
    programId: { array: { type: "u8", len: 32 } },
    nonce: "u64",
    issuedAt: "i64",
    expiry: "i64",
    reasonCode: "u8",
    realizedLossUsdc: "u64",
    evidenceHash: { array: { type: "u8", len: 32 } },
    signature: { array: { type: "u8", len: 64 } },
  },
};

export interface UnsignedVerdict {
  vault: Uint8Array; // 32
  programId: Uint8Array; // 32
  nonce: bigint;
  issuedAt: bigint;
  expiry: bigint;
  reasonCode: number;
  realizedLossUsdc: bigint;
  evidenceHash: Uint8Array; // 32
}

export interface SignedVerdict extends UnsignedVerdict {
  signature: Uint8Array; // 64
}

export function encodeVerdictMessage(v: UnsignedVerdict): Uint8Array {
  return borsh.serialize(RISK_VERDICT_SCHEMA, { ...v, signature: new Uint8Array(64) });
}

/** JSON transport shape (bigint/bytes as strings) used between CRE, the relayer and the app. */
export interface VerdictJson {
  vault: string; // base58
  programId: string; // base58
  nonce: string;
  issuedAt: string;
  expiry: string;
  reasonCode: number;
  realizedLossUsdc: string;
  evidenceHash: string; // hex
  signature: string; // hex
  verifier: string; // base58 pubkey that signed
}

export function verdictToJson(v: SignedVerdict, verifier: Uint8Array): VerdictJson {
  return {
    vault: bs58Encode(v.vault),
    programId: bs58Encode(v.programId),
    nonce: v.nonce.toString(),
    issuedAt: v.issuedAt.toString(),
    expiry: v.expiry.toString(),
    reasonCode: v.reasonCode,
    realizedLossUsdc: v.realizedLossUsdc.toString(),
    evidenceHash: toHex(v.evidenceHash),
    signature: toHex(v.signature),
    verifier: bs58Encode(verifier),
  };
}

export function verdictFromJson(j: VerdictJson): SignedVerdict & { verifier: Uint8Array } {
  return {
    vault: bs58Decode(j.vault),
    programId: bs58Decode(j.programId),
    nonce: BigInt(j.nonce),
    issuedAt: BigInt(j.issuedAt),
    expiry: BigInt(j.expiry),
    reasonCode: j.reasonCode,
    realizedLossUsdc: BigInt(j.realizedLossUsdc),
    evidenceHash: fromHex(j.evidenceHash),
    signature: fromHex(j.signature),
    verifier: bs58Decode(j.verifier),
  };
}

// ---------------------------------------------------------------------
// Evidence hashing: canonical JSON (sorted keys, bigint as string) -> sha256
// ---------------------------------------------------------------------

export function canonicalJson(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (typeof v === "bigint") return v.toString();
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as object).sort()) out[k] = norm((v as Record<string, unknown>)[k]);
      return out;
    }
    return v;
  };
  return JSON.stringify(norm(value));
}

export function evidenceHashOf(bundle: unknown): Uint8Array {
  return sha256(new TextEncoder().encode(canonicalJson(bundle)));
}

// ---------------------------------------------------------------------
// Small codecs (no Node built-ins)
// ---------------------------------------------------------------------

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function bs58Encode(bytes: Uint8Array): string {
  let x = 0n;
  for (const b of bytes) x = (x << 8n) | BigInt(b);
  let out = "";
  while (x > 0n) {
    out = B58[Number(x % 58n)] + out;
    x /= 58n;
  }
  for (const b of bytes) {
    if (b === 0) out = "1" + out;
    else break;
  }
  return out;
}

export function bs58Decode(s: string): Uint8Array {
  let x = 0n;
  for (const ch of s) {
    const i = B58.indexOf(ch);
    if (i < 0) throw new Error(`invalid base58 character '${ch}'`);
    x = x * 58n + BigInt(i);
  }
  const bytes: number[] = [];
  while (x > 0n) {
    bytes.unshift(Number(x & 0xffn));
    x >>= 8n;
  }
  for (const ch of s) {
    if (ch === "1") bytes.unshift(0);
    else break;
  }
  return Uint8Array.from(bytes);
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}
