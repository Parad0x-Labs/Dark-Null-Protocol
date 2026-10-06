// Shared helpers for the transact_v2 tests (sandbox only).
// Circuit inputs come from vectors/v2/V-E2E.json; signing keys for re-signed tamper cases from V-ADDR.json.
import fs from "node:fs";
import crypto from "node:crypto";
import { buildPoseidon, buildBabyjub } from "circomlibjs";

export const R = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const poseidon = await buildPoseidon();
export const babyJub = await buildBabyjub();
const F = poseidon.F;
export const L = babyJub.subOrder;

export const H = (xs) => F.toObject(poseidon(xs.map((x) => F.e(BigInt(x)))));
export const hex = (x) => "0x" + BigInt(x).toString(16).padStart(64, "0");
export const tagFr = (s) => BigInt("0x" + Buffer.from(s, "ascii").toString("hex"));
export const DS = {
  NOTE: tagFr("dark-null-note-v1"),
  NF: tagFr("dark-null-nf-v1"),
  PK: tagFr("dark-null-pk-v1"),
  SIGHASH: tagFr("dark-null-sighash-v1"),
  PI: tagFr("dark-null-pi-v1"),
};
export const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

// V2_SPEC 7.4 witness for one V-E2E step. Values are decimal strings (circom input format).
export function inputsFor(e2e, step) {
  const key = e2e.keys[step.spender];
  const pub = step.public;
  const ins = step.private.inputs;
  const outs = step.private.outputs;
  const d = (x) => BigInt(x).toString();
  return {
    root: d(pub.root),
    public_amount: d(pub.public_amount),
    public_asset: d(pub.public_asset),
    ext_data_hash: d(pub.ext_data_hash),
    now_epoch: d(pub.claimed_epoch),
    deposit_label: d(pub.deposit_label),
    assoc_root: d(pub.assoc_root),
    asset: d(e2e.pool.asset),
    ak: key.ak.map(d),
    nk: d(key.nk),
    sig_R8: step.private.sig.R8.map(d),
    sig_S: d(step.private.sig.S),
    in_value: ins.map((x) => d(x.value)),
    in_salt: ins.map((x) => d(x.salt)),
    in_label: ins.map((x) => d(x.label)),
    in_leaf_index: ins.map((x) => d(x.leaf_index)),
    in_path: ins.map((x) => x.path.map(d)),
    out_value: outs.map((x) => d(x.value)),
    out_owner: outs.map((x) => d(x.owner)),
    out_salt: outs.map((x) => d(x.salt)),
    out_label: outs.map((x) => d(x.label)),
  };
}

// Statement recomputation in JS (V2_SPEC 5.1, 7.1, 7.2) from a witness object.
export function statement(w) {
  const B = (x) => BigInt(x);
  const pk = H([DS.PK, B(w.ak[0]), B(w.ak[1]), B(w.nk)]);
  const cmIn = [0, 1].map((i) => H([DS.NOTE, B(w.in_value[i]), B(w.asset), pk, B(w.in_salt[i]), B(w.in_label[i])]));
  const nf = [0, 1].map((i) => H([DS.NF, B(w.nk), cmIn[i], B(w.in_leaf_index[i])]));
  const cm = [0, 1].map((j) => H([DS.NOTE, B(w.out_value[j]), B(w.asset), B(w.out_owner[j]), B(w.out_salt[j]), B(w.out_label[j])]));
  const sighash = H([DS.SIGHASH, nf[0], nf[1], cm[0], cm[1], B(w.public_amount), B(w.public_asset), B(w.ext_data_hash), B(w.now_epoch)]);
  const pi = H([DS.PI, B(w.root), nf[0], nf[1], cm[0], cm[1], B(w.public_amount), B(w.public_asset), B(w.ext_data_hash), B(w.now_epoch), B(w.deposit_label), B(w.assoc_root)]);
  return { pk, cmIn, nf, cm, sighash, pi };
}

// EdDSA-Poseidon per V2_SPEC 4.4 (S = r + 8*hm*a mod l), used to re-sign tampered witnesses so that a case
// isolates the constraint under test instead of failing on the signature.
export function sign(ask, nonceKeyHex, M) {
  const a = BigInt(ask);
  const r = BigInt("0x" + crypto.createHash("sha512")
    .update(Buffer.from("dark-null-eddsa-nonce-v1", "ascii"))
    .update(Buffer.from(nonceKeyHex.replace(/^0x/, ""), "hex"))
    .update(Buffer.from(BigInt(M).toString(16).padStart(64, "0"), "hex"))
    .digest("hex")) % L;
  const R8 = babyJub.mulPointEscalar(babyJub.Base8, r).map((c) => babyJub.F.toObject(c));
  const A = babyJub.mulPointEscalar(babyJub.Base8, a).map((c) => babyJub.F.toObject(c));
  const hm = H([R8[0], R8[1], A[0], A[1], BigInt(M)]);
  const S = (r + 8n * hm * a) % L;
  return { R8, S, A };
}

export function resign(w, acct) {
  const st = statement(w);
  const sig = sign(acct.ask, acct.ask_nonce_key, st.sighash);
  w.sig_R8 = sig.R8.map(String);
  w.sig_S = sig.S.toString();
  return st;
}

// A BabyJubJub point of order 8: l * P for a curve point P outside the prime-order subgroup.
export function smallOrderPoint() {
  const Fb = babyJub.F;
  const modpow = (b, e) => { let r = 1n; b %= R; while (e > 0n) { if (e & 1n) r = (r * b) % R; b = (b * b) % R; e >>= 1n; } return r; };
  for (let y = 2n; y < 1000n; y++) {
    // x^2 = (1 - y^2) / (a - d*y^2); skip non-residues (Euler criterion) before taking the square root.
    const y2 = (y * y) % R;
    const x2 = ((1n - y2 + R) % R) * modpow((168700n - 168696n * y2 % R + R) % R, R - 2n) % R;
    if (x2 === 0n || modpow(x2, (R - 1n) / 2n) !== 1n) continue;
    const x = Fb.sqrt(Fb.e(x2));
    const P = [x, Fb.e(y)];
    if (!babyJub.inCurve(P)) continue;
    const T = babyJub.mulPointEscalar(P, L);
    const T4 = babyJub.mulPointEscalar(T, 4n);
    const isId = (Q) => Fb.isZero(Q[0]) && Fb.eq(Q[1], Fb.one);
    if (!isId(T4)) return T.map((c) => Fb.toObject(c)); // order exactly 8
  }
  throw new Error("no order-8 point found");
}
