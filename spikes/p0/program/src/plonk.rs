//! PLONK (snarkjs 0.7.x "plonk" protocol, KZG over BN254) verifier using only Solana syscalls:
//! sol_keccak256 for the Fiat-Shamir transcript, sol_alt_bn128_group_op for G1 add/mul and the pairing.
//! Field arithmetic over Fr is plain BPF code (fr.rs). Mirrors snarkjs src/plonk_verify.js.

use crate::fr::Fr;
use crate::sys;

pub struct PlonkVk {
    pub power: u32,
    pub n: u64,
    pub k1: [u8; 32],
    pub k2: [u8; 32],
    /// primitive 2^power-th root of unity (big-endian, canonical)
    pub omega: [u8; 32],
    /// Qm, Ql, Qr, Qo, Qc, S1, S2, S3: uncompressed G1, big-endian x || y
    pub commitments: [u8; 512],
    /// X_2 = [tau]_2 in alt_bn128 syscall order (x.c1, x.c0, y.c1, y.c0)
    pub x2: [u8; 128],
}

pub const PROOF_LEN: usize = 9 * 64 + 6 * 32;

pub const G1_GEN: [u8; 64] = {
    let mut g = [0u8; 64];
    g[31] = 1;
    g[63] = 2;
    g
};

/// G2 generator in syscall order (x.c1, x.c0, y.c1, y.c0).
pub const G2_GEN: [u8; 128] = [
    0x19, 0x8e, 0x93, 0x93, 0x92, 0x0d, 0x48, 0x3a, 0x72, 0x60, 0xbf, 0xb7, 0x31, 0xfb, 0x5d, 0x25,
    0xf1, 0xaa, 0x49, 0x33, 0x35, 0xa9, 0xe7, 0x12, 0x97, 0xe4, 0x85, 0xb7, 0xae, 0xf3, 0x12, 0xc2,
    0x18, 0x00, 0xde, 0xef, 0x12, 0x1f, 0x1e, 0x76, 0x42, 0x6a, 0x00, 0x66, 0x5e, 0x5c, 0x44, 0x79,
    0x67, 0x43, 0x22, 0xd4, 0xf7, 0x5e, 0xda, 0xdd, 0x46, 0xde, 0xbd, 0x5c, 0xd9, 0x92, 0xf6, 0xed,
    0x09, 0x06, 0x89, 0xd0, 0x58, 0x5f, 0xf0, 0x75, 0xec, 0x9e, 0x99, 0xad, 0x69, 0x0c, 0x33, 0x95,
    0xbc, 0x4b, 0x31, 0x33, 0x70, 0xb3, 0x8e, 0xf3, 0x55, 0xac, 0xda, 0xdc, 0xd1, 0x22, 0x97, 0x5b,
    0x12, 0xc8, 0x5e, 0xa5, 0xdb, 0x8c, 0x6d, 0xeb, 0x4a, 0xab, 0x71, 0x80, 0x8d, 0xcb, 0x40, 0x8f,
    0xe3, 0xd1, 0xe7, 0x69, 0x0c, 0x43, 0xd3, 0x7b, 0x4c, 0xe6, 0xcc, 0x01, 0x66, 0xfa, 0x7d, 0xaa,
];

/// BN254 base field modulus q, big-endian.
const Q_BE: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x97, 0x81, 0x6a, 0x91, 0x68, 0x71, 0xca, 0x8d, 0x3c, 0x20, 0x8c, 0x16, 0xd8, 0x7c, 0xfd, 0x47,
];

pub enum PlonkError {
    BadEncoding = 1,
    BadHint = 2,
    Syscall = 3,
    PairingFailed = 4,
}

/// CU checkpoints: [start, after transcript, after field arithmetic, after G1 ops, after pairing]
pub struct Meter(pub [u64; 5]);

fn challenge(parts: &[&[u8]]) -> Fr {
    Fr::from_be_reduce(&sys::keccak(parts))
}

pub fn g1_neg_pub(p: &[u8; 64]) -> [u8; 64] {
    let mut out = *p;
    if p[32..].iter().all(|b| *b == 0) {
        return out;
    }
    // y' = q - y
    let mut borrow = 0i16;
    for i in (0..32).rev() {
        let d = Q_BE[i] as i16 - p[32 + i] as i16 - borrow;
        if d < 0 {
            out[32 + i] = (d + 256) as u8;
            borrow = 1;
        } else {
            out[32 + i] = d as u8;
            borrow = 0;
        }
    }
    out
}

fn pt(proof: &[u8], i: usize) -> &[u8; 64] {
    proof[i * 64..(i + 1) * 64].try_into().unwrap()
}

fn ev(proof: &[u8], i: usize) -> Result<Fr, PlonkError> {
    let b: &[u8; 32] = proof[576 + i * 32..576 + (i + 1) * 32].try_into().unwrap();
    Fr::from_be_canonical(b).ok_or(PlonkError::BadEncoding)
}

fn vkpt(c: &[u8; 512], i: usize) -> &[u8; 64] {
    c[i * 64..(i + 1) * 64].try_into().unwrap()
}

pub fn verify(
    vk: &PlonkVk,
    public_input: &[u8; 32],
    proof: &[u8],
    hint: Option<&[u8; 32]>,
    meter: &mut Meter,
) -> Result<(), PlonkError> {
    meter.0[0] = sys::cu();
    if proof.len() != PROOF_LEN {
        return Err(PlonkError::BadEncoding);
    }
    let pub_fr = Fr::from_be_canonical(public_input).ok_or(PlonkError::BadEncoding)?;
    let (ea, eb, ec, es1, es2, ezw) = (ev(proof, 0)?, ev(proof, 1)?, ev(proof, 2)?, ev(proof, 3)?, ev(proof, 4)?, ev(proof, 5)?);

    // ---- transcript (keccak256, snarkjs Keccak256Transcript layout) ----
    let beta = challenge(&[&vk.commitments, public_input, &proof[0..192]]);
    let beta_b = beta.to_be();
    let gamma = challenge(&[&beta_b]);
    let gamma_b = gamma.to_be();
    let alpha = challenge(&[&beta_b, &gamma_b, &proof[192..256]]);
    let alpha_b = alpha.to_be();
    let xi = challenge(&[&alpha_b, &proof[256..448]]);
    let xi_b = xi.to_be();
    let v1 = challenge(&[&xi_b, &proof[576..768]]);
    let u = challenge(&[&proof[448..576]]);
    meter.0[1] = sys::cu();

    // ---- field arithmetic ----
    let v2 = v1.mul(&v1);
    let v3 = v2.mul(&v1);
    let v4 = v3.mul(&v1);
    let v5 = v4.mul(&v1);
    let mut xin = xi;
    for _ in 0..vk.power {
        xin = xin.square();
    }
    let one = Fr::ONE;
    let zh = xin.sub(&one);
    let denom = Fr::from_u64(vk.n).mul(&xi.sub(&one));
    let inv = match hint {
        Some(h) => {
            let h = Fr::from_be_canonical(h).ok_or(PlonkError::BadEncoding)?;
            if denom.mul(&h) != one {
                return Err(PlonkError::BadHint);
            }
            h
        }
        None => denom.inverse().ok_or(PlonkError::BadHint)?,
    };
    let l1 = zh.mul(&inv);
    let pi = pub_fr.mul(&l1).neg();
    let alpha2 = alpha.square();
    let e3a = ea.add(&beta.mul(&es1)).add(&gamma);
    let e3b = eb.add(&beta.mul(&es2)).add(&gamma);
    let e3c = ec.add(&gamma);
    let r0 = pi
        .sub(&l1.mul(&alpha2))
        .sub(&e3a.mul(&e3b).mul(&e3c).mul(&ezw).mul(&alpha));
    let k1 = Fr::from_be_canonical(&vk.k1).ok_or(PlonkError::BadEncoding)?;
    let k2 = Fr::from_be_canonical(&vk.k2).ok_or(PlonkError::BadEncoding)?;
    let omega = Fr::from_be_canonical(&vk.omega).ok_or(PlonkError::BadEncoding)?;
    let betaxi = beta.mul(&xi);
    let d2a1 = ea.add(&betaxi).add(&gamma);
    let d2a2 = eb.add(&betaxi.mul(&k1)).add(&gamma);
    let d2a3 = ec.add(&betaxi.mul(&k2)).add(&gamma);
    let d2 = d2a1.mul(&d2a2).mul(&d2a3).mul(&alpha).add(&l1.mul(&alpha2)).add(&u);
    let d3 = e3a.mul(&e3b).mul(&alpha).mul(&beta).mul(&ezw);
    let zh_xin = zh.mul(&xin);
    let zh_xin2 = zh_xin.mul(&xin);
    let e = r0
        .neg()
        .add(&v1.mul(&ea))
        .add(&v2.mul(&eb))
        .add(&v3.mul(&ec))
        .add(&v4.mul(&es1))
        .add(&v5.mul(&es2))
        .add(&u.mul(&ezw));
    let s_wxiw = u.mul(&xi).mul(&omega);
    meter.0[2] = sys::cu();

    // ---- G1 linear combination via alt_bn128 syscalls ----
    let c = &vk.commitments;
    let cpt = |i: usize| -> &[u8; 64] { vkpt(c, i) };
    let terms: [(&[u8; 64], Fr); 17] = [
        (cpt(0), ea.mul(&eb)),     // Qm
        (cpt(1), ea),              // Ql
        (cpt(2), eb),              // Qr
        (cpt(3), ec),              // Qo
        (pt(proof, 3), d2),        // Z
        (cpt(7), d3.neg()),        // S3
        (pt(proof, 4), zh.neg()),  // T1
        (pt(proof, 5), zh_xin.neg()), // T2
        (pt(proof, 6), zh_xin2.neg()), // T3
        (pt(proof, 0), v1),        // A
        (pt(proof, 1), v2),        // B
        (pt(proof, 2), v3),        // C
        (cpt(5), v4),              // S1
        (cpt(6), v5),              // S2
        (&G1_GEN, e.neg()),        // -E
        (pt(proof, 7), xi),        // xi * Wxi
        (pt(proof, 8), s_wxiw),    // u * xi * w * Wxiw
    ];
    let mut b1 = *cpt(4); // Qc
    for (p, s) in terms.iter() {
        let m = sys::g1_mul(p, &s.to_be()).ok_or(PlonkError::Syscall)?;
        b1 = sys::g1_add(&b1, &m).ok_or(PlonkError::Syscall)?;
    }
    let uw = sys::g1_mul(pt(proof, 8), &u.to_be()).ok_or(PlonkError::Syscall)?;
    let a1 = sys::g1_add(pt(proof, 7), &uw).ok_or(PlonkError::Syscall)?;
    let a1n = g1_neg_pub(&a1);
    meter.0[3] = sys::cu();

    // ---- pairing: e(-A1, X2) * e(B1, G2) == 1 ----
    let mut input = [0u8; 384];
    input[0..64].copy_from_slice(&a1n);
    input[64..192].copy_from_slice(&vk.x2);
    input[192..256].copy_from_slice(&b1);
    input[256..384].copy_from_slice(&G2_GEN);
    let ok = sys::pairing(&input).ok_or(PlonkError::Syscall)?;
    meter.0[4] = sys::cu();
    if !ok {
        return Err(PlonkError::PairingFailed);
    }
    Ok(())
}
