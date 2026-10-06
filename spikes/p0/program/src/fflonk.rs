//! fflonk (snarkjs 0.7.x "fflonk" protocol, KZG over BN254) verifier using only Solana syscalls.
//! Mirrors snarkjs src/fflonk_verify.js. All inversions are batched into one binary-EEA inversion.

use crate::fr::Fr;
use crate::plonk::{g1_neg_pub as g1_neg, Meter, PlonkError, G1_GEN, G2_GEN};
use crate::sys;
extern crate alloc;

pub struct FflonkVk {
    pub power: u32,
    pub n: u64,
    pub k1: [u8; 32],
    pub k2: [u8; 32],
    pub w: [u8; 32],
    pub w3: [u8; 32],
    pub w4: [u8; 32],
    pub w8: [u8; 32],
    pub wr: [u8; 32],
    pub x2: [u8; 128],
    pub c0: [u8; 64],
}

/// C1, C2, W1, W2 (4 x 64) + ql qr qm qo qc s1 s2 s3 a b c z zw t1w t2w inv (16 x 32)
pub const PROOF_LEN: usize = 4 * 64 + 16 * 32;

fn fr_of(b: &[u8; 32]) -> Result<Fr, PlonkError> {
    Fr::from_be_canonical(b).ok_or(PlonkError::BadEncoding)
}

fn challenge(parts: &[&[u8]]) -> Fr {
    Fr::from_be_reduce(&sys::keccak(parts))
}

fn pow(x: &Fr, mut e: u64) -> Fr {
    let mut r = Fr::ONE;
    let mut b = *x;
    while e > 0 {
        if e & 1 == 1 {
            r = r.mul(&b);
        }
        b = b.square();
        e >>= 1;
    }
    r
}

pub fn verify(vk: &FflonkVk, public_input: &[u8; 32], proof: &[u8], meter: &mut Meter) -> Result<(), PlonkError> {
    meter.0[0] = sys::cu();
    if proof.len() != PROOF_LEN {
        return Err(PlonkError::BadEncoding);
    }
    let pubf = fr_of(public_input)?;
    let mut ev = [Fr::ZERO; 15];
    for (i, e) in ev.iter_mut().enumerate() {
        *e = fr_of(proof[256 + 32 * i..256 + 32 * (i + 1)].try_into().unwrap())?;
    }
    let c1p: &[u8; 64] = proof[0..64].try_into().unwrap();
    let c2p: &[u8; 64] = proof[64..128].try_into().unwrap();
    let w1p: &[u8; 64] = proof[128..192].try_into().unwrap();
    let w2p: &[u8; 64] = proof[192..256].try_into().unwrap();

    // ---- transcript ----
    let beta = challenge(&[&vk.c0, public_input, c1p]);
    let beta_b = beta.to_be();
    let gamma = challenge(&[&beta_b]);
    let gamma_b = gamma.to_be();
    let xi_seed = challenge(&[&gamma_b, c2p]);
    let xi_seed_b = xi_seed.to_be();
    let alpha = challenge(&[&xi_seed_b, &proof[256..256 + 15 * 32]]);
    let alpha_b = alpha.to_be();
    let y = challenge(&[&alpha_b, w1p]);
    meter.0[1] = sys::cu();

    let (q1, q2, e, mul_h0) = scalars(vk, &pubf, &ev, &beta, &gamma, &xi_seed, &alpha, &y)?;
    meter.0[2] = sys::cu();

    // ---- G1: A1 = C0 + q1*C1 + q2*C2 - e*G1 - mulH0*W1 + y*W2 ----
    let mut a1 = vk.c0;
    let terms: [(&[u8; 64], Fr); 5] = [(c1p, q1), (c2p, q2), (&G1_GEN, e.neg()), (w1p, mul_h0.neg()), (w2p, y)];
    for (p, s) in terms.iter() {
        let m = sys::g1_mul(p, &s.to_be()).ok_or(PlonkError::Syscall)?;
        a1 = sys::g1_add(&a1, &m).ok_or(PlonkError::Syscall)?;
    }
    let a1n = g1_neg(&a1);
    meter.0[3] = sys::cu();

    // ---- pairing: e(-A1, G2) * e(W2, X2) == 1 ----
    let mut input = [0u8; 384];
    input[0..64].copy_from_slice(&a1n);
    input[64..192].copy_from_slice(&G2_GEN);
    input[192..256].copy_from_slice(w2p);
    input[256..384].copy_from_slice(&vk.x2);
    let ok = sys::pairing(&input).ok_or(PlonkError::Syscall)?;
    meter.0[4] = sys::cu();
    if !ok {
        return Err(PlonkError::PairingFailed);
    }
    Ok(())
}

#[inline(never)]
#[allow(clippy::too_many_arguments)]
fn scalars(vk: &FflonkVk, pubf: &Fr, ev: &[Fr; 15], beta: &Fr, gamma: &Fr, xi_seed: &Fr, alpha: &Fr, y: &Fr) -> Result<(Fr, Fr, Fr, Fr), PlonkError> {
    let [ql, qr, qm, qo, qc, s1, s2, s3, a, b, c, z, zw, t1w, t2w] = *ev;
    let (pubf, beta, gamma, xi_seed, alpha, y) = (*pubf, *beta, *gamma, *xi_seed, *alpha, *y);
    // ---- roots ----
    let one = Fr::ONE;
    let k1 = fr_of(&vk.k1)?;
    let k2 = fr_of(&vk.k2)?;
    let w = fr_of(&vk.w)?;
    let w3 = fr_of(&vk.w3)?;
    let w4 = fr_of(&vk.w4)?;
    let w8 = fr_of(&vk.w8)?;
    let wr = fr_of(&vk.wr)?;
    let xs2 = xi_seed.square();
    let mut h0 = [Fr::ZERO; 8];
    h0[0] = xs2.mul(&xi_seed);
    let mut wp = w8;
    for i in 1..8 {
        h0[i] = h0[0].mul(&wp);
        wp = wp.mul(&w8);
    }
    let mut h1 = [Fr::ZERO; 4];
    h1[0] = h0[0].square();
    let mut wp = w4;
    for i in 1..4 {
        h1[i] = h1[0].mul(&wp);
        wp = wp.mul(&w4);
    }
    let w3sq = w3.square();
    let mut h2 = [Fr::ZERO; 3];
    h2[0] = h1[0].mul(&xs2);
    h2[1] = h2[0].mul(&w3);
    h2[2] = h2[0].mul(&w3sq);
    let mut h3 = [Fr::ZERO; 3];
    h3[0] = h2[0].mul(&wr);
    h3[1] = h3[0].mul(&w3);
    h3[2] = h3[0].mul(&w3sq);
    let xi = h2[0].square().mul(&h2[0]);
    let xiw = xi.mul(&w);
    let mut xin = xi;
    for _ in 0..vk.power {
        xin = xin.square();
    }
    let zh = xin.sub(&one);

    // ---- denominators, batch-inverted ----
    // 0: zh, 1: n(xi-1), 2..10: Li0 dens, 10..14: Li1 dens, 14..20: LiS2 dens, 20: mulH1, 21: mulH2
    let mut d = alloc::vec![Fr::ZERO; 22];
    d[0] = zh;
    d[1] = Fr::from_u64(vk.n).mul(&xi.sub(&one));
    let den1_0 = Fr::from_u64(8).mul(&pow(&h0[0], 6));
    for i in 0..8 {
        d[2 + i] = den1_0.mul(&h0[(7 * i) % 8]).mul(&y.sub(&h0[i]));
    }
    let den1_1 = Fr::from_u64(4).mul(&h1[0].square());
    for i in 0..4 {
        d[10 + i] = den1_1.mul(&h1[(3 * i) % 4]).mul(&y.sub(&h1[i]));
    }
    let den1_2a = Fr::from_u64(3).mul(&h2[0]).mul(&xi.sub(&xiw));
    let den1_2b = Fr::from_u64(3).mul(&h3[0]).mul(&xiw.sub(&xi));
    for i in 0..3 {
        d[14 + i] = den1_2a.mul(&h2[(2 * i) % 3]).mul(&y.sub(&h2[i]));
        d[17 + i] = den1_2b.mul(&h3[(2 * i) % 3]).mul(&y.sub(&h3[i]));
    }
    let mut mul_h0 = one;
    for h in h0.iter() {
        mul_h0 = mul_h0.mul(&y.sub(h));
    }
    let mut mul_h1 = one;
    for h in h1.iter() {
        mul_h1 = mul_h1.mul(&y.sub(h));
    }
    let mut mul_h2 = one;
    for h in h2.iter().chain(h3.iter()) {
        mul_h2 = mul_h2.mul(&y.sub(h));
    }
    d[20] = mul_h1;
    d[21] = mul_h2;
    let mut prefix = alloc::vec![Fr::ZERO; 22];
    let mut acc = one;
    for i in 0..22 {
        prefix[i] = acc;
        acc = acc.mul(&d[i]);
    }
    let mut inv_acc = acc.inverse().ok_or(PlonkError::BadHint)?;
    let mut inv = alloc::vec![Fr::ZERO; 22];
    for i in (0..22).rev() {
        inv[i] = inv_acc.mul(&prefix[i]);
        inv_acc = inv_acc.mul(&d[i]);
    }
    let invzh = inv[0];
    let l1 = zh.mul(&inv[1]);
    let pi = pubf.mul(&l1).neg();

    // r0
    let num0 = pow(&y, 8).sub(&xi);
    let mut r0 = Fr::ZERO;
    for i in 0..8 {
        let h = h0[i];
        let mut hp = h;
        let mut c0 = ql.add(&qr.mul(&hp));
        for coef in [qo, qm, qc, s1, s2, s3] {
            hp = hp.mul(&h);
            c0 = c0.add(&coef.mul(&hp));
        }
        r0 = r0.add(&c0.mul(&num0.mul(&inv[2 + i])));
    }
    // r1
    let num1 = pow(&y, 4).sub(&xi);
    let t0 = ql.mul(&a).add(&qr.mul(&b)).add(&qm.mul(&a.mul(&b))).add(&qo.mul(&c)).add(&qc).add(&pi).mul(&invzh);
    let mut r1 = Fr::ZERO;
    for i in 0..4 {
        let h = h1[i];
        let hsq = h.square();
        let c1 = a.add(&h.mul(&b)).add(&hsq.mul(&c)).add(&hsq.mul(&h).mul(&t0));
        r1 = r1.add(&c1.mul(&num1.mul(&inv[10 + i])));
    }
    // r2
    let y3 = pow(&y, 3);
    let num2 = y3.square().sub(&xi.add(&xiw).mul(&y3)).add(&xi.mul(&xiw));
    let t1 = z.sub(&one).mul(&l1).mul(&invzh);
    let betaxi = beta.mul(&xi);
    let t211 = a.add(&betaxi).add(&gamma);
    let t212 = b.add(&betaxi.mul(&k1)).add(&gamma);
    let t213 = c.add(&betaxi.mul(&k2)).add(&gamma);
    let t21 = t211.mul(&t212).mul(&t213).mul(&z);
    let t221 = a.add(&beta.mul(&s1)).add(&gamma);
    let t222 = b.add(&beta.mul(&s2)).add(&gamma);
    let t223 = c.add(&beta.mul(&s3)).add(&gamma);
    let t22 = t221.mul(&t222).mul(&t223).mul(&zw);
    let t2 = t21.sub(&t22).mul(&invzh);
    let mut r2 = Fr::ZERO;
    for i in 0..3 {
        let c2 = z.add(&h2[i].mul(&t1)).add(&h2[i].square().mul(&t2));
        r2 = r2.add(&c2.mul(&num2.mul(&inv[14 + i])));
    }
    for i in 0..3 {
        let c2 = zw.add(&h3[i].mul(&t1w)).add(&h3[i].square().mul(&t2w));
        r2 = r2.add(&c2.mul(&num2.mul(&inv[17 + i])));
    }
    let q1 = alpha.mul(&mul_h0).mul(&inv[20]);
    let q2 = alpha.square().mul(&mul_h0).mul(&inv[21]);
    let e = r0.add(&r1.mul(&q1)).add(&r2.mul(&q2));
    Ok((q1, q2, e, mul_h0))
}
