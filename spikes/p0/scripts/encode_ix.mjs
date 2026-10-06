// Encode snarkjs proofs into spike-program instruction data (hex) + compute the PLONK inverse hint.
// Usage: node encode_ix.mjs <outdir>   (reads <outdir>/*_proof.json, writes <outdir>/ix_fixtures.json)
import fs from "node:fs";
import { keccak_256 } from "@noble/hashes/sha3";

const dir = process.argv[2] || "out";
const R = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const Q = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;
const be = (x) => BigInt(x).toString(16).padStart(64, "0");
const g1 = (p) => be(p[0]) + be(p[1]);
const g1neg = (p) => be(p[0]) + be(BigInt(p[1]) === 0n ? 0n : Q - BigInt(p[1]));
const g2 = (p) => be(p[0][1]) + be(p[0][0]) + be(p[1][1]) + be(p[1][0]);
const load = (f) => JSON.parse(fs.readFileSync(`${dir}/${f}`, "utf8"));
const modinv = (a) => { let [t, nt, r, nr] = [0n, 1n, R, ((a % R) + R) % R]; while (nr) { const q = r / nr; [t, nt] = [nt, t - q * nt]; [r, nr] = [nr, r - q * nr]; } return ((t % R) + R) % R; };
const H = (hex) => BigInt("0x" + Buffer.from(keccak_256(Buffer.from(hex, "hex"))).toString("hex")) % R;

function g16(proofFile) {
  const { proof, publicSignals } = load(proofFile);
  return g1neg(proof.pi_a) + g2(proof.pi_b) + g1(proof.pi_c) + be(publicSignals[0]);
}

function plonk(proofFile, vkFile) {
  const { proof: p, publicSignals } = load(proofFile);
  const vk = load(vkFile);
  const pub = be(publicSignals[0]);
  const pts = ["A", "B", "C", "Z", "T1", "T2", "T3", "Wxi", "Wxiw"].map((k) => g1(p[k])).join("");
  const evs = ["eval_a", "eval_b", "eval_c", "eval_s1", "eval_s2", "eval_zw"].map((k) => be(p[k])).join("");
  const vkc = ["Qm", "Ql", "Qr", "Qo", "Qc", "S1", "S2", "S3"].map((k) => g1(vk[k])).join("");
  const beta = H(vkc + pub + pts.slice(0, 3 * 128));
  const gamma = H(be(beta));
  const alpha = H(be(beta) + be(gamma) + pts.slice(3 * 128, 4 * 128));
  const xi = H(be(alpha) + pts.slice(4 * 128, 7 * 128));
  const n = BigInt(2 ** vk.power);
  const hint = modinv((n * ((xi - 1n + R) % R)) % R);
  const proofHex = pts + evs;
  return { pub, proof: proofHex, hint: be(hint), data_hint: pub + proofHex + be(hint), data_nohint: pub + proofHex };
}

function fflonk(proofFile) {
  const { proof: p, publicSignals } = load(proofFile);
  const pts = ["C1", "C2", "W1", "W2"].map((k) => g1(p.polynomials[k])).join("");
  const evs = ["ql", "qr", "qm", "qo", "qc", "s1", "s2", "s3", "a", "b", "c", "z", "zw", "t1w", "t2w", "inv"].map((k) => be(p.evaluations[k])).join("");
  return be(publicSignals[0]) + pts + evs;
}

const flip = (hex, byteOffset) => {
  const b = Buffer.from(hex, "hex");
  b[byteOffset] ^= 0x01;
  return b.toString("hex");
};

const fx = {
  g16_skeleton: g16("skel_g16_proof.json"),
  g16_pi_hash: g16("pi_g16_proof.json"),
  g16_fullsize: fs.existsSync(`${dir}/full_g16_proof.json`) ? g16("full_g16_proof.json") : null,
  plonk_pi_hash: plonk("pi_plonk_proof.json", "pi_hash_plonk_vk.json"),
  plonk_skeleton: plonk("skel_plonk_proof.json", "transact_v2_skeleton_plonk_vk.json"),
  fflonk_pi_hash: fflonk("pi_fflonk_proof.json"),
};
// tampered variants (one bit in the first evaluation / in the public input)
fx.bad = {
  g16_skeleton_pub: flip(fx.g16_skeleton, 256 + 31),
  plonk_pi_hash_eval: flip(fx.plonk_pi_hash.data_hint, 32 + 576 + 31),
  plonk_pi_hash_pub: flip(fx.plonk_pi_hash.data_hint, 31),
  fflonk_pi_hash_eval: flip(fx.fflonk_pi_hash, 32 + 256 + 31),
};
fs.writeFileSync(`${dir}/ix_fixtures.json`, JSON.stringify(fx, null, 1));
console.log("sizes (bytes):", { g16: fx.g16_skeleton.length / 2, plonk_hint: fx.plonk_pi_hash.data_hint.length / 2, fflonk: fx.fflonk_pi_hash.length / 2 });
