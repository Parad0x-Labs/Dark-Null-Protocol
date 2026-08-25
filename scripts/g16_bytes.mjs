// Canonical snarkjs -> groth16-solana byte conversion.
// Contract (from the groth16-solana crate docs/tests):
//   - every field element is 32 bytes BIG-endian
//   - G2 coordinates are serialized c1-first: BE(x.c1) || BE(x.c0) || BE(y.c1) || BE(y.c0)
//   - proof_a must be NEGATED by the caller: y' = (Fq - y) mod Fq (Fq = base field, NOT Fr!)
//   - public inputs are plain BE 32-byte chunks

export const BN254_P =
  21888242871839275222246405745257275088696311157297823662689037894645226208583n; // Fq base field

const be32 = (dec) => Buffer.from(BigInt(dec).toString(16).padStart(64, "0"), "hex");
const g1 = ([x, y]) => Buffer.concat([be32(x), be32(y)]);
// negate a G1 point (flip y within the BASE field — using the scalar modulus here is the classic silent bug)
const g1neg = ([x, y]) => Buffer.concat([be32(x), be32((BN254_P - BigInt(y)) % BN254_P)]);
const g2 = ([[x0, x1], [y0, y1]]) =>
  Buffer.concat([be32(x1), be32(x0), be32(y1), be32(y0)]);

export function proofToGroth16Solana(proof, publicSignals) {
  return {
    proof_a: g1neg(proof.pi_a), // verifier checks e(-A,B)*e(IC,gamma)*e(C,delta)*e(alpha,beta) == 1
    proof_b: g2(proof.pi_b),
    proof_c: g1(proof.pi_c),
    public_inputs: publicSignals.map((s) => be32(s)),
  };
}

export function toHex(buf) {
  return Buffer.from(buf).toString("hex");
}
