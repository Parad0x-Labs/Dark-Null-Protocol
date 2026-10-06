// Dark NULL v2 reference helpers for vector generation (JS implementation 1 of 2; the Rust crate
// crates/dark-null-transcript is implementation 2). Normative source: docs/spec/V2_SPEC.md.
// Poseidon / BabyJubJub: circomlibjs. sha256 / sha512 / HKDF / X25519: node:crypto.
// ed25519 point arithmetic: @noble/curves. bech32m: @scure/base.
import crypto from "node:crypto";
import { buildPoseidon, buildBabyjub, buildEddsa } from "circomlibjs";
import { ed25519 } from "@noble/curves/ed25519";
import { bech32m } from "@scure/base";

export const R = 21888242871839275222246405745257275088548364400416034343698204186575808495617n; // BN254 Fr
export const ED_L = 2n ** 252n + 27742317777372353535851937790883648493n; // ed25519 group order

const poseidon = await buildPoseidon();
export const babyJub = await buildBabyjub();
export const eddsa = await buildEddsa();
const F = poseidon.F;
export const BJJ_L = babyJub.subOrder; // BabyJubJub prime subgroup order l

// ---------------- encodings ----------------
export const hex = (x) => "0x" + BigInt(x).toString(16).padStart(64, "0");
export const be32 = (x) => { const v = BigInt(x); if (v < 0n || v >= 2n ** 256n) throw new Error("be32 range"); return Buffer.from(v.toString(16).padStart(64, "0"), "hex"); };
export const fromBE = (b) => (b.length ? BigInt("0x" + Buffer.from(b).toString("hex")) : 0n);
export const fromLE = (b) => fromBE(Buffer.from(b).reverse());
export const le32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
export const u64le = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
export const u16le = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
export const leScalar32 = (x) => be32(x).reverse();
export const bhex = (b) => Buffer.from(b).toString("hex");
export const ascii = (s) => Buffer.from(s, "ascii");
export const tagFr = (s) => fromBE(ascii(s)); // DS_x = big-endian integer of the ASCII tag
export const h248 = (b32) => fromBE(Buffer.from(b32).subarray(0, 31)); // first 31 bytes, big-endian
export const pubkeyFields = (pk) => [fromBE(pk.subarray(0, 16)), fromBE(pk.subarray(16, 32))];
export const signedAmountFr = (deposit, withdraw) => {
  if (deposit !== 0n && withdraw !== 0n) throw new Error("both legs non-zero");
  return deposit !== 0n ? deposit : withdraw !== 0n ? R - withdraw : 0n;
};

// ---------------- hashes ----------------
export const sha256 = (...parts) => { const h = crypto.createHash("sha256"); for (const p of parts) h.update(p); return h.digest(); };
export const sha512 = (...parts) => { const h = crypto.createHash("sha512"); for (const p of parts) h.update(p); return h.digest(); };
export const KDF_SALT = ascii("dark-null-keys-v1");
export const hkdf = (ikm, info, len) => Buffer.from(crypto.hkdfSync("sha256", ikm, KDF_SALT, info, len));

export const CALLS = []; // every Poseidon call made through H (for the on-chain probe and reviews)
export function H(xs, label = "") {
  for (const x of xs) if (BigInt(x) < 0n || BigInt(x) >= R) throw new Error("non-canonical Poseidon input");
  const out = F.toObject(poseidon(xs.map((x) => F.e(BigInt(x)))));
  CALLS.push({ label, inputs: xs.map(hex), output: hex(out) });
  return out;
}

// ---------------- domain tags ----------------
export const DS_NAMES = {
  DS_ASSET: "dark-null-asset-v1", DS_NOTE: "dark-null-note-v1", DS_NF: "dark-null-nf-v1", DS_PK: "dark-null-pk-v1",
  DS_NK: "dark-null-nk-v1", DS_SIGHASH: "dark-null-sighash-v1", DS_PI: "dark-null-pi-v1", DS_LABEL: "dark-null-label-v1",
  DS_OWNER: "dark-null-owner-v1", DS_POLICY: "dark-null-policy-v1", DS_CHAN: "dark-null-chan-v1", DS_NK_CH: "dark-null-nk-ch-v1",
  DS_VOUCHER: "dark-null-voucher-v1", DS_MERGED: "dark-null-merged-v1", DS_RCPT: "dark-null-rcpt-v1",
};
export const DS = Object.fromEntries(Object.entries(DS_NAMES).map(([k, v]) => [k, tagFr(v)]));
export const BYTE_TAGS = {
  EXTDATA: "dark-null-extdata-v1", POOL_ID: "dark-null-pool-id-v1", QUOTE: "dark-null-x402-quote-v1",
  RCPT_CHAIN: "dark-null-rcpt-chain-v1", EDDSA_NONCE: "dark-null-eddsa-nonce-v1", KDF_SALT: "dark-null-keys-v1",
};
export const KDF_INFO = {
  ASK: "dark-null-kdf-ask-v1", ASK_NONCE: "dark-null-kdf-ask-nonce-v1", NK: "dark-null-kdf-nk-v1", IVK: "dark-null-kdf-ivk-v1",
  IVK_D: "dark-null-kdf-ivk-d-v1", OVK: "dark-null-kdf-ovk-v1", CHAN: "dark-null-kdf-chan-v1", CHAN_NONCE: "dark-null-kdf-chan-nonce-v1",
  STEALTH: "dark-null-kdf-stealth-v1",
};

// ---------------- deterministic fixture randomness ----------------
export const drbg = (label, n = 32) => {
  const out = [];
  for (let i = 0; out.length * 32 < n; i++) out.push(sha256(ascii("dark-null-v2-vector-drbg"), ascii(label), le32(i)));
  return Buffer.concat(out).subarray(0, n);
};
export const drbgFr = (label) => fromBE(drbg(label, 64)) % R;

// ---------------- BabyJubJub EdDSA-Poseidon (spec section 4.4) ----------------
export const B8 = babyJub.Base8;
export const bjjMul = (P, e) => babyJub.mulPointEscalar(P, e);
export const bjjPub = (a) => bjjMul(B8, a).map((c) => babyJub.F.toObject(c));
export const bjjPack = (P) => Buffer.from(babyJub.packPoint(P.map((c) => babyJub.F.e(c))));
export function bjjSign(a, nonceKey, M) {
  const r = fromBE(sha512(ascii(BYTE_TAGS.EDDSA_NONCE), nonceKey, be32(M))) % BJJ_L;
  const R8 = bjjMul(B8, r).map((c) => babyJub.F.toObject(c));
  const A = bjjPub(a);
  const hm = H([R8[0], R8[1], A[0], A[1], M], "eddsa-hm");
  const S = (r + 8n * hm * a) % BJJ_L;
  const ok = eddsa.verifyPoseidon(F.e(M), { R8: R8.map((c) => babyJub.F.e(c)), S }, A.map((c) => babyJub.F.e(c)));
  if (!ok) throw new Error("circomlibjs verifyPoseidon rejected spec signature");
  return { R8, S, hm, packed: Buffer.concat([bjjPack(R8), leScalar32(S)]) };
}

// ---------------- key derivation (spec section 4.2) ----------------
export function x25519Pub(scalar32) {
  const key = crypto.createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b656e04220420", "hex"), scalar32]), format: "der", type: "pkcs8" });
  return crypto.createPublicKey(key).export({ format: "der", type: "spki" }).subarray(-32);
}
export function deriveAccount(seed, account, diversifier = 0) {
  const a = le32(account);
  const ask = fromBE(hkdf(seed, Buffer.concat([ascii(KDF_INFO.ASK), a]), 64)) % BJJ_L;
  if (ask === 0n) throw new Error("ask = 0");
  const askNonceKey = hkdf(seed, Buffer.concat([ascii(KDF_INFO.ASK_NONCE), a]), 32);
  const ak = bjjPub(ask);
  const nkSeed = fromBE(hkdf(seed, Buffer.concat([ascii(KDF_INFO.NK), a]), 64)) % R;
  const nk = H([DS.DS_NK, nkSeed], "nk");
  const pk = H([DS.DS_PK, ak[0], ak[1], nk], "pk");
  const ivkRoot = hkdf(seed, Buffer.concat([ascii(KDF_INFO.IVK), a]), 32);
  const ivkD = Buffer.from(crypto.hkdfSync("sha256", ivkRoot, KDF_SALT, Buffer.concat([ascii(KDF_INFO.IVK_D), le32(diversifier)]), 32));
  const ivkPub = x25519Pub(ivkD);
  const ovk = hkdf(seed, Buffer.concat([ascii(KDF_INFO.OVK), a]), 32);
  const stealthSeed = hkdf(seed, Buffer.concat([ascii(KDF_INFO.STEALTH), a]), 32);
  const payload = Buffer.concat([Buffer.from([0x01]), be32(pk), ivkPub, le32(diversifier)]);
  const address = bech32m.encode("dnull", bech32m.toWords(payload), 200);
  return { account, diversifier, ask, askNonceKey, ak, nkSeed, nk, pk, ivkRoot, ivkD, ivkPub, ovk, stealthSeed, payload, address };
}

// ---------------- ed25519 stealth (DNA x402 dark-stealth-ed25519 scheme, spec section 9.3) ----------------
const EP = ed25519.ExtendedPoint;
const modL = (x) => ((x % ED_L) + ED_L) % ED_L;
export const STEALTH_TAG_VIEW = "nullpay-ed25519-view-key-v1";
export const STEALTH_TAG_SHARED = "nullpay-ed25519-shared-v1";
export function stealthKeys(spendSeed) {
  const s = modL(fromLE(spendSeed));
  const v = modL(fromLE(sha512(ascii(STEALTH_TAG_VIEW), leScalar32(s))));
  return { s, v, S: Buffer.from(EP.BASE.multiply(s).toRawBytes()), V: Buffer.from(EP.BASE.multiply(v).toRawBytes()) };
}
export function stealthDerive(S, V, ephemSeed) {
  const r = modL(fromLE(ephemSeed));
  const Rpt = Buffer.from(EP.BASE.multiply(r).toRawBytes());
  const shared = modL(fromLE(sha512(ascii(STEALTH_TAG_SHARED), Buffer.from(EP.fromHex(V).multiply(r).toRawBytes()))));
  const P = Buffer.from(EP.fromHex(S).add(EP.BASE.multiply(shared)).toRawBytes());
  return { r, R: Rpt, shared, P };
}
export const stealthRecover = (s, shared) => modL(s + shared);
export const edMulBase = (x) => Buffer.from(EP.BASE.multiply(x).toRawBytes());

// ---------------- Solana PDAs ----------------
export function isOnCurve(b) { try { EP.fromHex(Buffer.from(b)); return true; } catch { return false; } }
export function findPda(seeds, programId) {
  for (let bump = 255; bump >= 0; bump--) {
    const a = sha256(...seeds, Buffer.from([bump]), programId, ascii("ProgramDerivedAddress"));
    if (!isOnCurve(a)) return { address: a, bump };
  }
  throw new Error("no pda");
}
export const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function b58enc(buf) {
  let n = fromBE(buf); let s = "";
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of buf) { if (b === 0) s = "1" + s; else break; }
  return s;
}
export function b58dec(s) {
  let n = 0n; for (const c of s) n = n * 58n + BigInt(B58.indexOf(c));
  let h = n.toString(16); if (h.length % 2) h = "0" + h;
  let b = n === 0n ? Buffer.alloc(0) : Buffer.from(h, "hex");
  let lead = 0; for (const c of s) { if (c === "1") lead++; else break; }
  b = Buffer.concat([Buffer.alloc(lead), b]);
  return Buffer.concat([Buffer.alloc(32 - b.length), b]);
}
export const discriminator = (name) => sha256(ascii(`global:${name}`)).subarray(0, 8);

// ---------------- Merkle tree (spec section 6) ----------------
export const DEPTH = 32;
export const ZEROS = [0n];
for (let i = 0; i < DEPTH; i++) ZEROS.push(H([ZEROS[i], ZEROS[i]], "tree-zero"));
export class Tree {
  constructor() { this.leaves = []; this.filled = Array(DEPTH + 1).fill(0n); this.roots = [ZEROS[DEPTH]]; this.next = 0; }
  // on-chain insertion algorithm: one aligned depth-1 subtree (cm0 at even index i, cm1 at i + 1), 32 Poseidon(2) calls
  insertPair(cm0, cm1) {
    const i = this.next;
    if (i % 2 !== 0) throw new Error("odd next index");
    let node = H([cm0, cm1], "tree-insert");
    let idx = i >> 1;
    for (let level = 1; level < DEPTH; level++) {
      let left, right;
      if ((idx & 1) === 0) { this.filled[level] = node; left = node; right = ZEROS[level]; } else { left = this.filled[level]; right = node; }
      node = H([left, right], "tree-insert");
      idx >>= 1;
    }
    this.leaves.push(cm0, cm1);
    this.next += 2;
    this.roots.push(node);
    return { leafIndex: i, root: node, rootHint: (this.roots.length - 1) % 256 };
  }
  root() { return this.roots[this.roots.length - 1]; }
  // full recomputation (independent of insertPair) for membership paths
  path(index) {
    let level = new Map(this.leaves.map((v, i) => [BigInt(i), v]));
    const sib = [];
    let i = BigInt(index);
    for (let d = 0; d < DEPTH; d++) {
      sib.push(level.get(i ^ 1n) ?? ZEROS[d]);
      const next = new Map();
      for (const k of level.keys()) { const p = k >> 1n; if (next.has(p)) continue; next.set(p, H([level.get(p * 2n) ?? ZEROS[d], level.get(p * 2n + 1n) ?? ZEROS[d]], "tree-path")); }
      level = next; i >>= 1n;
    }
    return { siblings: sib, root: level.get(0n) };
  }
}
