//! transact_v2 native prover path (sandbox tool; WP-CIRCUIT deliverable for WP-CLIENT).
//!
//! Loads the snarkjs `dev-setup` zkey into an arkworks `ProvingKey`, reads a circom witness (`.wtns`, from the
//! native C++ generator or from WASM), proves with ark-groth16 0.5 using the circom/snarkjs QAP reduction, verifies
//! with the zkey's verifying key, and prints the proof in snarkjs JSON form plus the 256-byte program encoding
//! (V2_SPEC 2.6, A negated).
//!
//!   prove <transact_v2_dev.zkey> <witness.wtns> [proof_out.json]   one proof; JSON timing + peak RSS on stdout
//!
//! The zkey layout follows snarkjs 0.7 (`zkey_utils.js`): sections 1 header, 2 Groth16 header, 3 IC, 4 coefficients,
//! 5 A, 6 B1, 7 B2, 8 C, 9 H. Points are little-endian Montgomery form; coefficients are stored as c * R^2 mod r.
use ark_bn254::{Bn254, Fq, Fq2, Fr, G1Affine, G2Affine};
use ark_ff::{BigInteger, BigInteger256, One, PrimeField, Zero};
use ark_groth16::{prepare_verifying_key, Groth16, Proof, ProvingKey, VerifyingKey};
use ark_poly::EvaluationDomain;
use ark_relations::r1cs::{ConstraintMatrices, SynthesisError};
use ark_std::UniformRand;
use rayon::prelude::*;
use std::{fs, io::Read, time::Instant};

// ---------------------------------------------------------------------------------------------------------------
// Binary file sections (r1cs / wtns / zkey share the iden3 container format)
// ---------------------------------------------------------------------------------------------------------------

fn u32le(b: &[u8], o: usize) -> u32 {
    u32::from_le_bytes(b[o..o + 4].try_into().unwrap())
}
fn u64le(b: &[u8], o: usize) -> u64 {
    u64::from_le_bytes(b[o..o + 8].try_into().unwrap())
}

/// (section type, start offset, size)
fn sections(b: &[u8], magic: &[u8; 4]) -> Vec<(u32, usize, usize)> {
    assert_eq!(&b[0..4], magic, "bad magic");
    let n = u32le(b, 8) as usize;
    let mut out = Vec::with_capacity(n);
    let mut o = 12;
    for _ in 0..n {
        let t = u32le(b, o);
        let sz = u64le(b, o + 4) as usize;
        out.push((t, o + 12, sz));
        o += 12 + sz;
    }
    out
}

fn section(secs: &[(u32, usize, usize)], t: u32) -> (usize, usize) {
    let s = secs.iter().find(|s| s.0 == t).unwrap_or_else(|| panic!("missing section {t}"));
    (s.1, s.2)
}

// ---------------------------------------------------------------------------------------------------------------
// Field and point decoding
// ---------------------------------------------------------------------------------------------------------------

fn bigint_le(b: &[u8]) -> BigInteger256 {
    let mut limbs = [0u64; 4];
    for (i, l) in limbs.iter_mut().enumerate() {
        *l = u64le(b, 8 * i);
    }
    BigInteger256::new(limbs)
}

/// Montgomery-form little-endian Fq (snarkjs `toRprLEM`).
fn fq_m(b: &[u8]) -> Fq {
    Fq::new_unchecked(bigint_le(b))
}

/// zkey coefficient: stored integer = c * R^2 mod r. Two Montgomery reductions recover c.
fn fr_coeff(b: &[u8]) -> Fr {
    Fr::new_unchecked(Fr::new_unchecked(bigint_le(b)).into_bigint())
}

/// Standard (non-Montgomery) little-endian Fr, as in `.wtns` files.
fn fr_std(b: &[u8]) -> Fr {
    Fr::from_bigint(bigint_le(b)).expect("non-canonical witness value")
}

fn g1(b: &[u8]) -> G1Affine {
    let x = fq_m(&b[0..32]);
    let y = fq_m(&b[32..64]);
    if x.is_zero() && y.is_zero() {
        return G1Affine::identity();
    }
    let p = G1Affine::new_unchecked(x, y);
    assert!(p.is_on_curve(), "G1 point not on curve");
    p
}

fn g2(b: &[u8]) -> G2Affine {
    let x = Fq2::new(fq_m(&b[0..32]), fq_m(&b[32..64]));
    let y = Fq2::new(fq_m(&b[64..96]), fq_m(&b[96..128]));
    if x.is_zero() && y.is_zero() {
        return G2Affine::identity();
    }
    let p = G2Affine::new_unchecked(x, y);
    assert!(p.is_on_curve(), "G2 point not on curve");
    p
}

// ---------------------------------------------------------------------------------------------------------------
// zkey -> arkworks
// ---------------------------------------------------------------------------------------------------------------

struct Zkey {
    pk: ProvingKey<Bn254>,
    matrices: ConstraintMatrices<Fr>,
    n_vars: usize,
    n_public: usize,
    domain_size: usize,
}

fn read_zkey(path: &str) -> Zkey {
    let b = fs::read(path).expect("read zkey");
    let secs = sections(&b, b"zkey");
    let (h1, _) = section(&secs, 1);
    assert_eq!(u32le(&b, h1), 1, "zkey protocol is not groth16");

    let (mut o, _) = section(&secs, 2);
    let n8q = u32le(&b, o) as usize;
    assert_eq!(n8q, 32);
    o += 4;
    assert_eq!(bigint_le(&b[o..o + 32]), Fq::MODULUS, "zkey base field is not BN254");
    o += n8q;
    let n8r = u32le(&b, o) as usize;
    assert_eq!(n8r, 32);
    o += 4;
    assert_eq!(bigint_le(&b[o..o + 32]), Fr::MODULUS, "zkey scalar field is not BN254");
    o += n8r;
    let n_vars = u32le(&b, o) as usize;
    let n_public = u32le(&b, o + 4) as usize;
    let domain_size = u32le(&b, o + 8) as usize;
    o += 12;
    let alpha_g1 = g1(&b[o..o + 64]);
    o += 64;
    let beta_g1 = g1(&b[o..o + 64]);
    o += 64;
    let beta_g2 = g2(&b[o..o + 128]);
    o += 128;
    let gamma_g2 = g2(&b[o..o + 128]);
    o += 128;
    let delta_g1 = g1(&b[o..o + 64]);
    o += 64;
    let delta_g2 = g2(&b[o..o + 128]);

    let g1s = |t: u32, n: usize| -> Vec<G1Affine> {
        let (s, sz) = section(&secs, t);
        assert_eq!(sz, n * 64, "section {t} size");
        (0..n).into_par_iter().map(|i| g1(&b[s + 64 * i..s + 64 * (i + 1)])).collect()
    };
    let ic = g1s(3, n_public + 1);
    let a_query = g1s(5, n_vars);
    let b_g1_query = g1s(6, n_vars);
    let b_g2_query = {
        let (s, sz) = section(&secs, 7);
        assert_eq!(sz, n_vars * 128, "section 7 size");
        (0..n_vars).into_par_iter().map(|i| g2(&b[s + 128 * i..s + 128 * (i + 1)])).collect()
    };
    let l_query = g1s(8, n_vars - n_public - 1);
    let h_query = g1s(9, domain_size);

    // Coefficients of A and B. snarkjs appends one A row per public signal (and the constant) after the circuit's
    // constraints; the circom reduction re-adds those rows, so they are dropped here.
    let (mut c, _) = section(&secs, 4);
    let n_coeffs = u32le(&b, c) as usize;
    c += 4;
    let mut rows: [Vec<Vec<(Fr, usize)>>; 2] = [vec![vec![]; domain_size], vec![vec![]; domain_size]];
    let mut max_row = 0usize;
    for _ in 0..n_coeffs {
        let m = u32le(&b, c) as usize;
        let row = u32le(&b, c + 4) as usize;
        let sig = u32le(&b, c + 8) as usize;
        let v = fr_coeff(&b[c + 12..c + 44]);
        c += 44;
        max_row = max_row.max(row);
        rows[m][row].push((v, sig));
    }
    let num_constraints = max_row - n_public;
    let [mut a, mut bm] = rows;
    a.truncate(num_constraints);
    bm.truncate(num_constraints);
    let matrices = ConstraintMatrices {
        num_instance_variables: n_public + 1,
        num_witness_variables: n_vars - n_public - 1,
        num_constraints,
        a_num_non_zero: a.iter().map(|r| r.len()).sum(),
        b_num_non_zero: bm.iter().map(|r| r.len()).sum(),
        c_num_non_zero: 0,
        a,
        b: bm,
        c: vec![],
    };

    let vk = VerifyingKey::<Bn254> { alpha_g1, beta_g2, gamma_g2, delta_g2, gamma_abc_g1: ic };
    let pk = ProvingKey { vk, beta_g1, delta_g1, a_query, b_g1_query, b_g2_query, h_query, l_query };
    Zkey { pk, matrices, n_vars, n_public, domain_size }
}

fn read_wtns(path: &str) -> Vec<Fr> {
    let b = fs::read(path).expect("read wtns");
    let secs = sections(&b, b"wtns");
    let (h, _) = section(&secs, 1);
    let n8 = u32le(&b, h) as usize;
    assert_eq!(n8, 32);
    assert_eq!(bigint_le(&b[h + 4..h + 36]), Fr::MODULUS, "witness field is not BN254 Fr");
    let n = u32le(&b, h + 4 + n8) as usize;
    let (d, sz) = section(&secs, 2);
    assert_eq!(sz, n * n8);
    (0..n).map(|i| fr_std(&b[d + i * n8..d + (i + 1) * n8])).collect()
}

// ---------------------------------------------------------------------------------------------------------------
// QAP reduction used by circom/snarkjs zkeys (H evaluated on the odd coset of the 2n-th roots of unity)
// ---------------------------------------------------------------------------------------------------------------

struct CircomReduction;

impl ark_groth16::r1cs_to_qap::R1CSToQAP for CircomReduction {
    fn instance_map_with_evaluation<F: PrimeField, D: EvaluationDomain<F>>(
        _cs: ark_relations::r1cs::ConstraintSystemRef<F>,
        _t: &F,
    ) -> Result<(Vec<F>, Vec<F>, Vec<F>, F, usize, usize), SynthesisError> {
        unimplemented!("setup comes from the snarkjs zkey")
    }

    fn witness_map_from_matrices<F: PrimeField, D: EvaluationDomain<F>>(
        matrices: &ConstraintMatrices<F>,
        num_inputs: usize,
        num_constraints: usize,
        full_assignment: &[F],
    ) -> Result<Vec<F>, SynthesisError> {
        use ark_groth16::r1cs_to_qap::evaluate_constraint;
        let domain = D::new(num_constraints + num_inputs).ok_or(SynthesisError::PolynomialDegreeTooLarge)?;
        let n = domain.size();
        let zero = F::zero();
        let mut a = vec![zero; n];
        let mut b = vec![zero; n];
        a[..num_constraints]
            .par_iter_mut()
            .zip(b[..num_constraints].par_iter_mut())
            .zip(matrices.a.par_iter())
            .zip(matrices.b.par_iter())
            .for_each(|(((a, b), at), bt)| {
                *a = evaluate_constraint(at, full_assignment);
                *b = evaluate_constraint(bt, full_assignment);
            });
        a[num_constraints..num_constraints + num_inputs].clone_from_slice(&full_assignment[..num_inputs]);
        let mut c = vec![zero; n];
        c[..num_constraints].par_iter_mut().zip(a.par_iter()).zip(b.par_iter()).for_each(|((c, a), b)| *c = *a * *b);

        let shift = D::new(2 * n).ok_or(SynthesisError::PolynomialDegreeTooLarge)?.element(1);
        for v in [&mut a, &mut b, &mut c] {
            domain.ifft_in_place(v);
            D::distribute_powers_and_mul_by_const(v, shift, F::one());
            domain.fft_in_place(v);
        }
        let mut ab = domain.mul_polynomials_in_evaluation_domain(&a, &b);
        ab.par_iter_mut().zip(c.par_iter()).for_each(|(ab, c)| *ab -= c);
        Ok(ab)
    }

    fn h_query_scalars<F: PrimeField, D: EvaluationDomain<F>>(
        _max_power: usize,
        _t: F,
        _zt: F,
        _delta_inverse: F,
    ) -> Result<Vec<F>, SynthesisError> {
        unimplemented!("setup comes from the snarkjs zkey")
    }
}

type G16 = Groth16<Bn254, CircomReduction>;

// ---------------------------------------------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------------------------------------------

fn dec<F: PrimeField>(x: F) -> String {
    // decimal string of the canonical integer (big-endian bytes, repeated division by 10)
    let mut n = x.into_bigint().to_bytes_be();
    let mut digits = vec![];
    while n.iter().any(|&b| b != 0) {
        let mut rem: u32 = 0;
        for byte in n.iter_mut() {
            let cur = (rem << 8) | *byte as u32;
            *byte = (cur / 10) as u8;
            rem = cur % 10;
        }
        digits.push(b'0' + rem as u8);
    }
    if digits.is_empty() {
        return "0".into();
    }
    digits.reverse();
    String::from_utf8(digits).unwrap()
}

fn hex_be<F: PrimeField>(x: F) -> String {
    x.into_bigint().to_bytes_be().iter().map(|b| format!("{b:02x}")).collect()
}

fn proof_json(p: &Proof<Bn254>, pi: Fr) -> String {
    let a_neg_y = -p.a.y;
    let bytes = format!(
        "{}{}{}{}{}{}{}{}",
        hex_be(p.a.x),
        hex_be(a_neg_y),
        hex_be(p.b.x.c1),
        hex_be(p.b.x.c0),
        hex_be(p.b.y.c1),
        hex_be(p.b.y.c0),
        hex_be(p.c.x),
        hex_be(p.c.y)
    );
    format!(
        "{{\"proof\":{{\"pi_a\":[\"{}\",\"{}\",\"1\"],\"pi_b\":[[\"{}\",\"{}\"],[\"{}\",\"{}\"],[\"1\",\"0\"]],\"pi_c\":[\"{}\",\"{}\",\"1\"],\"protocol\":\"groth16\",\"curve\":\"bn128\"}},\"publicSignals\":[\"{}\"],\"proof_bytes\":\"{}\",\"pi_bytes\":\"{}\"}}",
        dec(p.a.x),
        dec(p.a.y),
        dec(p.b.x.c0),
        dec(p.b.x.c1),
        dec(p.b.y.c0),
        dec(p.b.y.c1),
        dec(p.c.x),
        dec(p.c.y),
        dec(pi),
        bytes,
        hex_be(pi)
    )
}

fn peak_rss_kb() -> u64 {
    let mut s = String::new();
    fs::File::open("/proc/self/status").and_then(|mut f| f.read_to_string(&mut s)).ok();
    s.lines()
        .find(|l| l.starts_with("VmHWM:"))
        .and_then(|l| l.split_whitespace().nth(1))
        .and_then(|v| v.parse().ok())
        .unwrap_or(0)
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("prove") => {
            let t0 = Instant::now();
            let z = read_zkey(&args[2]);
            let t1 = Instant::now();
            let w = read_wtns(&args[3]);
            assert_eq!(w.len(), z.n_vars, "witness length does not match the zkey");
            assert!(w[0].is_one(), "witness[0] must be 1");
            let t2 = Instant::now();
            let mut rng = rand::rngs::OsRng;
            let (r, s) = (Fr::rand(&mut rng), Fr::rand(&mut rng));
            let num_inputs = z.n_public + 1;
            let proof = G16::create_proof_with_reduction_and_matrices(&z.pk, r, s, &z.matrices, num_inputs, z.matrices.num_constraints, &w)
                .expect("prove");
            let t3 = Instant::now();
            let pvk = prepare_verifying_key(&z.pk.vk);
            let public = &w[1..num_inputs];
            let ok = G16::verify_proof(&pvk, &proof, public).expect("verify");
            let bad = G16::verify_proof(&pvk, &proof, &[public[0] + Fr::one()]).expect("verify");
            if let Some(out) = args.get(4) {
                fs::write(out, proof_json(&proof, public[0])).expect("write proof");
            }
            println!(
                "{{\"impl\":\"arkworks ark-groth16 0.5 (rayon), snarkjs zkey\",\"threads\":{},\"n_vars\":{},\"constraints\":{},\"domain\":{},\"load_zkey_ms\":{:.1},\"read_wtns_ms\":{:.1},\"prove_ms\":{:.1},\"peak_rss_mb\":{:.1},\"verified\":{},\"rejects_pi_plus_1\":{},\"pi\":\"0x{}\"}}",
                rayon::current_num_threads(),
                z.n_vars,
                z.matrices.num_constraints,
                z.domain_size,
                (t1 - t0).as_secs_f64() * 1e3,
                (t2 - t1).as_secs_f64() * 1e3,
                (t3 - t2).as_secs_f64() * 1e3,
                peak_rss_kb() as f64 / 1024.0,
                ok,
                !bad,
                hex_be(public[0])
            );
            if !ok || bad {
                std::process::exit(1);
            }
        }
        _ => {
            eprintln!("usage: dark-null-circuit-tools prove <zkey> <wtns> [proof.json]");
            std::process::exit(2);
        }
    }
}
