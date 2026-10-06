// Phase 0: build circuit inputs and cross-implementation test vectors (sandbox only).
// Usage: node gen_inputs.mjs <outdir>
// Reference implementation: circomlibjs (Poseidon, EdDSA-Poseidon over BabyJubJub).
import { buildPoseidon, buildEddsa } from "circomlibjs";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const out = process.argv[2] || "out";
fs.mkdirSync(out, { recursive: true });

const R = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const poseidon = await buildPoseidon();
const eddsa = await buildEddsa();
const F = poseidon.F;
const H = (xs) => F.toObject(poseidon(xs.map((x) => F.e(x))));
const hex = (x) => "0x" + x.toString(16).padStart(64, "0");
const tag = (s) => BigInt("0x" + Buffer.from(s, "ascii").toString("hex"));

const DS = {
  DS_ASSET: tag("dark-null-asset-v1"),
  DS_NOTE: tag("dark-null-note-v1"),
  DS_NF: tag("dark-null-nf-v1"),
  DS_PK: tag("dark-null-pk-v1"),
  DS_NK: tag("dark-null-nk-v1"),
  DS_SIGHASH: tag("dark-null-sighash-v1"),
  DS_PI: tag("dark-null-pi-v1"),
};

// base58 decode (mint addresses)
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58dec(s) {
  let n = 0n;
  for (const c of s) n = n * 58n + BigInt(B58.indexOf(c));
  let h = n.toString(16);
  if (h.length % 2) h = "0" + h;
  let b = Buffer.from(h, "hex");
  let lead = 0;
  for (const c of s) { if (c === "1") lead++; else break; }
  b = Buffer.concat([Buffer.alloc(lead), b]);
  return Buffer.concat([Buffer.alloc(32 - b.length), b]);
}

// ---------- V-POS ----------
const vpos = [];
const flatSeq = [];
const flatEdge = [];
for (let n = 1; n <= 12; n++) {
  const seq = Array.from({ length: n }, (_, i) => BigInt(i + 1));
  const edge = Array.from({ length: n }, (_, i) => {
    const d = BigInt.asUintN(253, BigInt("0x" + createHash("sha256").update(`dark-null-v-pos-${n}-${i}`).digest("hex")));
    return i === 0 ? R - 1n : d % R;
  });
  vpos.push({ n, set: "seq", inputs: seq.map(hex), output: hex(H(seq)) });
  vpos.push({ n, set: "edge", inputs: edge.map(hex), output: hex(H(edge)) });
  flatSeq.push(...seq);
  flatEdge.push(...edge);
}
fs.writeFileSync(path.join(out, "poseidon_vectors.seq.input.json"), JSON.stringify({ in: flatSeq.map(String) }));
fs.writeFileSync(path.join(out, "poseidon_vectors.edge.input.json"), JSON.stringify({ in: flatEdge.map(String) }));

// ---------- keys and notes ----------
const spendPrv = Buffer.from("dark-null-p0-test-spend-key-0001", "ascii");
const ak = eddsa.prv2pub(spendPrv).map((p) => F.toObject(p));
const nk = H([DS.DS_NK, 1n]);
const owner = H([DS.DS_PK, ak[0], ak[1], nk]);
const recvPrv = Buffer.from("dark-null-p0-test-recv-key-00002", "ascii");
const recvAk = eddsa.prv2pub(recvPrv).map((p) => F.toObject(p));
const recvNk = H([DS.DS_NK, 2n]);
const recvOwner = H([DS.DS_PK, recvAk[0], recvAk[1], recvNk]);

const mint = "So11111111111111111111111111111111111111112";
const mintBytes = b58dec(mint);
const mintHi = BigInt("0x" + mintBytes.subarray(0, 16).toString("hex"));
const mintLo = BigInt("0x" + mintBytes.subarray(16, 32).toString("hex"));
const asset = H([DS.DS_ASSET, mintHi, mintLo]);

const cmOf = (v, owner_, salt, label) => H([DS.DS_NOTE, v, asset, owner_, salt, label]);
const inNotes = [
  { value: 700n, salt: 0x1111n, label: 0n, leaf: 5n },
  { value: 300n, salt: 0x2222n, label: 0n, leaf: 9n },
];
for (const n of inNotes) n.cm = cmOf(n.value, owner, n.salt, n.label);

// sparse depth-32 Merkle tree; empty leaf = 0; node = Poseidon(left, right)
function sparseTree(depth, leaves /* Map idx->value */) {
  const zeros = [0n];
  for (let i = 0; i < depth; i++) zeros.push(H([zeros[i], zeros[i]]));
  const levels = [new Map(leaves)];
  for (let d = 0; d < depth; d++) {
    const next = new Map();
    for (const idx of levels[d].keys()) {
      const p = idx >> 1n;
      if (next.has(p)) continue;
      const l = levels[d].get(p * 2n) ?? zeros[d];
      const r = levels[d].get(p * 2n + 1n) ?? zeros[d];
      next.set(p, H([l, r]));
    }
    levels.push(next);
  }
  const root = levels[depth].get(0n) ?? zeros[depth];
  const pathOf = (idx) => {
    const sib = [];
    let i = idx;
    for (let d = 0; d < depth; d++) { sib.push(levels[d].get(i ^ 1n) ?? zeros[d]); i >>= 1n; }
    return sib;
  };
  return { root, pathOf, zeros };
}
const tree = sparseTree(32, new Map(inNotes.map((n) => [n.leaf, n.cm])));

const outNotes = [
  { value: 600n, owner: recvOwner, salt: 0x3333n, label: 0n },
  { value: 250n, owner: owner, salt: 0x4444n, label: 0n },
];
for (const n of outNotes) n.cm = cmOf(n.value, n.owner, n.salt, n.label);
const publicAmountInt = -150n; // withdraw 150
const publicAmount = ((publicAmountInt % R) + R) % R;
const extData = Buffer.from("dark-null-p0-ext-data-fixture", "ascii");
const extDataHash = BigInt("0x" + createHash("sha256").update(extData).digest("hex").slice(0, 62)); // 248 bits
const nowEpoch = 1n;
const depositLabel = 0n;

const nf = inNotes.map((n) => H([DS.DS_NF, nk, n.cm, n.leaf]));
const sighash = H([DS.DS_SIGHASH, nf[0], nf[1], outNotes[0].cm, outNotes[1].cm, publicAmount, asset, extDataHash, nowEpoch]);
const sig = eddsa.signPoseidon(spendPrv, F.e(sighash));
if (!eddsa.verifyPoseidon(F.e(sighash), sig, eddsa.prv2pub(spendPrv))) throw new Error("eddsa self-check failed");

function baseInput(assocRoot) {
  return {
    root: tree.root, public_amount: publicAmount, public_asset: asset, ext_data_hash: extDataHash,
    now_epoch: nowEpoch, deposit_label: depositLabel, assoc_root: assocRoot,
    asset, ak, nk, sig_R8: sig.R8.map((p) => F.toObject(p)), sig_S: sig.S,
    in_value: inNotes.map((n) => n.value), in_salt: inNotes.map((n) => n.salt), in_label: inNotes.map((n) => n.label),
    in_leaf_index: inNotes.map((n) => n.leaf), in_path: inNotes.map((n) => tree.pathOf(n.leaf)),
    out_value: outNotes.map((n) => n.value), out_owner: outNotes.map((n) => n.owner),
    out_salt: outNotes.map((n) => n.salt), out_label: outNotes.map((n) => n.label),
  };
}
const piOf = (assocRoot) => H([DS.DS_PI, tree.root, nf[0], nf[1], outNotes[0].cm, outNotes[1].cm, publicAmount, asset, extDataHash, nowEpoch, depositLabel, assocRoot]);
const str = (o) => JSON.parse(JSON.stringify(o, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

const skelInput = baseInput(0n);
fs.writeFileSync(path.join(out, "transact_v2_skeleton.input.json"), JSON.stringify(str(skelInput)));

// full-size proxy: channel voucher signature, allowlist path (16), association paths (20)
const chanPrv = Buffer.from("dark-null-p0-test-chan-key-00003", "ascii");
const chanMsg = H([0xc4a2n, 1000n, 7n]);
const chanSig = eddsa.signPoseidon(chanPrv, F.e(chanMsg));
const allowTree = sparseTree(16, new Map([[3n, 0xa110a110n]]));
const assocTree = sparseTree(20, new Map([[11n, 0xabcn], [12n, 0xdefn]]));
const fullInput = {
  ...baseInput(assocTree.root),
  chan_ak: eddsa.prv2pub(chanPrv).map((p) => F.toObject(p)), chan_R8: chanSig.R8.map((p) => F.toObject(p)), chan_S: chanSig.S, chan_msg: chanMsg,
  allow_leaf: 0xa110a110n, allow_index: 3n, allow_path: allowTree.pathOf(3n), allow_root: allowTree.root,
  assoc_leaf: [0xabcn, 0xdefn], assoc_index: [11n, 12n], assoc_path: [assocTree.pathOf(11n), assocTree.pathOf(12n)],
};
fs.writeFileSync(path.join(out, "transact_v2_fullsize.input.json"), JSON.stringify(str(fullInput)));

// pi_hash test circuit input
const piX = Array.from({ length: 12 }, (_, i) => BigInt(1000 + i));
let acc = H(piX);
for (let i = 0; i < 4; i++) acc = H([acc, piX[i % 12]]);
fs.writeFileSync(path.join(out, "pi_hash.input.json"), JSON.stringify(str({ x: piX })));

const vectors = {
  "V-DS": { note: "draft domain tags: DS_x = big-endian integer of the ASCII tag", tags: Object.fromEntries(Object.entries(DS).map(([k, v]) => [k, { ascii: Buffer.from(v.toString(16), "hex").toString("ascii"), value: hex(v) }])) },
  "V-POS": { params: "Poseidon BN254 x^5, circomlib/light-poseidon constants, width n+1; sol_poseidon Bn254X5 big-endian", cases: vpos },
  "V-ASSET": { mint, mint_hi: hex(mintHi), mint_lo: hex(mintLo), formula: "Poseidon(DS_ASSET, mint[0..16], mint[16..32])", asset: hex(asset) },
  "V-KEYS": {
    note: "test keys only; spend key bytes are ASCII fixtures",
    spend_prv_ascii: spendPrv.toString("ascii"), ak: ak.map(hex), nk_formula: "Poseidon(DS_NK, 1)", nk: hex(nk),
    owner_formula: "Poseidon(DS_PK, ak.x, ak.y, nk)", owner: hex(owner),
    recv_prv_ascii: recvPrv.toString("ascii"), recv_owner: hex(recvOwner),
  },
  "V-NOTE": {
    formula: "Poseidon(DS_NOTE, value, asset, owner, salt, label)",
    cases: [...inNotes.map((n) => ({ value: n.value.toString(), owner: hex(owner), salt: hex(n.salt), label: hex(n.label), cm: hex(n.cm) })),
            ...outNotes.map((n) => ({ value: n.value.toString(), owner: hex(n.owner), salt: hex(n.salt), label: hex(n.label), cm: hex(n.cm) }))],
  },
  "V-NF": { formula: "Poseidon(DS_NF, nk, cm, leaf_index)", cases: inNotes.map((n, i) => ({ nk: hex(nk), cm: hex(n.cm), leaf_index: n.leaf.toString(), nf: hex(nf[i]) })) },
  "V-TREE": { depth: 32, empty_leaf: hex(0n), node: "Poseidon(left, right)", zero_root: hex(tree.zeros[32]), leaves: inNotes.map((n) => ({ index: n.leaf.toString(), cm: hex(n.cm) })), root: hex(tree.root) },
  "V-SIGHASH": { formula: "Poseidon(DS_SIGHASH, nf0, nf1, cm0, cm1, public_amount, public_asset, ext_data_hash, claimed_epoch)", public_amount_int: publicAmountInt.toString(), public_amount_field: hex(publicAmount), ext_data_ascii: extData.toString("ascii"), ext_data_hash: hex(extDataHash), now_epoch: nowEpoch.toString(), sighash: hex(sighash), sig: { R8: sig.R8.map((p) => hex(F.toObject(p))), S: hex(sig.S) } },
  "V-PI": { formula: "Poseidon(DS_PI, root, nf0, nf1, cm0, cm1, public_amount, public_asset, ext_data_hash, now_epoch, deposit_label, assoc_root)", skeleton_pi: hex(piOf(0n)), fullsize_assoc_root: hex(assocTree.root), fullsize_pi: hex(piOf(assocTree.root)) },
  "PI-HASH-CIRCUIT": { x: piX.map(String), pi: hex(acc) },
};
fs.writeFileSync(path.join(out, "vectors.json"), JSON.stringify(vectors, null, 2));
console.log(JSON.stringify({ skeleton_pi: hex(piOf(0n)), fullsize_pi: hex(piOf(assocTree.root)), pi_hash: hex(acc), root: hex(tree.root) }, null, 1));
