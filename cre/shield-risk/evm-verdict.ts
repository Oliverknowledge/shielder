/**
 * EIP-712 verdict signing for ShieldVault.sol, dependency-light so it runs
 * inside the CRE enclave (QuickJS) as well as under Bun. Verified against
 * the contract's own `hashVerdict` (see .shield/eip712-check.ts pattern).
 */
import { keccak_256 } from "@noble/hashes/sha3.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";

const enc = new TextEncoder();
const hex = (b: Uint8Array) => "0x" + Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
const fromHex = (h: string): Uint8Array => {
  const s = h.replace(/^0x/, "");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
};
const pad32 = (b: Uint8Array) => { const o = new Uint8Array(32); o.set(b, 32 - b.length); return o; };
const uint = (n: bigint) => { let h = n.toString(16); if (h.length % 2) h = "0" + h; return pad32(fromHex(h || "00")); };
const addr = (a: string) => pad32(fromHex(a));
const cat = (...parts: Uint8Array[]) => { const o = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let i = 0; for (const p of parts) { o.set(p, i); i += p.length; } return o; };
const kk = (b: Uint8Array) => keccak_256(b);
const kstr = (s: string) => kk(enc.encode(s));

const DOMAIN_TYPEHASH = kstr("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
const VERDICT_TYPEHASH = kstr("RiskVerdict(address vault,uint64 nonce,uint64 issuedAt,uint64 expiry,uint8 reasonCode,uint64 realizedLossUsdc,bytes32 evidenceHash)");

export interface EvmVerdict {
  vault: string; // authority address the verdict binds to
  nonce: bigint;
  issuedAt: bigint;
  expiry: bigint;
  reasonCode: number;
  realizedLossUsdc: bigint;
  evidenceHash: string; // 0x + 32 bytes
}

export function verdictDigest(chainId: bigint, verifyingContract: string, v: EvmVerdict): Uint8Array {
  const domain = kk(cat(DOMAIN_TYPEHASH, kstr("ShieldVault"), kstr("1"), uint(chainId), addr(verifyingContract)));
  const structHash = kk(cat(VERDICT_TYPEHASH, addr(v.vault), uint(v.nonce), uint(v.issuedAt), uint(v.expiry), uint(BigInt(v.reasonCode)), uint(v.realizedLossUsdc), fromHex(v.evidenceHash)));
  return kk(cat(Uint8Array.from([0x19, 0x01]), domain, structHash));
}

/** Returns the 65-byte r||s||v signature (v = 27/28) as hex. */
export function signEvmVerdict(chainId: bigint, verifyingContract: string, v: EvmVerdict, privateKeyHex: string): string {
  const digest = verdictDigest(chainId, verifyingContract, v);
  const sig = secp256k1.sign(digest, fromHex(privateKeyHex), { prehash: false, lowS: true, format: "recovered" } as never) as unknown as Uint8Array;
  // noble v2 "recovered" = recovery byte first, then r||s
  const rs = sig[0] < 4 ? sig.slice(1) : sig.slice(0, 64);
  const rec = sig[0] < 4 ? sig[0] : sig[64];
  return hex(cat(rs, Uint8Array.from([27 + (rec & 1)])));
}

export function evmAddressOf(privateKeyHex: string): string {
  const pub = secp256k1.getPublicKey(fromHex(privateKeyHex), false).slice(1);
  return "0x" + hex(kk(pub)).slice(-40);
}

export function evmVerdictToJson(v: EvmVerdict, signature: string, verifier: string) {
  return { vault: v.vault, nonce: v.nonce.toString(), issuedAt: v.issuedAt.toString(), expiry: v.expiry.toString(), reasonCode: v.reasonCode, realizedLossUsdc: v.realizedLossUsdc.toString(), evidenceHash: v.evidenceHash, signature, verifier };
}
