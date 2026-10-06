//! Phase 0 host tools (sandbox only).
//!   vectors <vectors.json>                 light-poseidon recomputation of V-POS and the derivation vectors
//!   setup   <circuit.r1cs> <pk.bin>        arkworks Groth16 circuit-specific setup (timing only; not PPoT)
//!   prove   <circuit.r1cs> <witness.wtns> <pk.bin>   one arkworks Groth16 proof; prints JSON timing + peak RSS
use ark_bn254::{Bn254, Fr};
use ark_ff::{BigInteger, PrimeField};
use ark_groth16::{Groth16, ProvingKey};
use ark_relations::{
    lc,
    r1cs::{ConstraintSynthesizer, ConstraintSystemRef, LinearCombination, SynthesisError, Variable},
};
use ark_serialize::{CanonicalDeserialize, CanonicalSerialize};
use ark_snark::SNARK;
use light_poseidon::{Poseidon, PoseidonBytesHasher};
use std::{fs, io::Read, time::Instant};

fn u32le(b: &[u8], o: usize) -> u32 {
    u32::from_le_bytes(b[o..o + 4].try_into().unwrap())
}
fn u64le(b: &[u8], o: usize) -> u64 {
    u64::from_le_bytes(b[o..o + 8].try_into().unwrap())
}

struct R1cs {
    n_wires: usize,
    n_pub: usize,
    constraints: Vec<[Vec<(usize, Fr)>; 3]>,
}

fn sections(b: &[u8]) -> Vec<(u32, usize, usize)> {
    let n = u32le(b, 8) as usize;
    let mut out = vec![];
    let mut o = 12;
    for _ in 0..n {
        let t = u32le(b, o);
        let sz = u64le(b, o + 4) as usize;
        out.push((t, o + 12, sz));
        o += 12 + sz;
    }
    out
}

fn read_r1cs(path: &str) -> R1cs {
    let b = fs::read(path).unwrap();
    assert_eq!(&b[0..4], b"r1cs");
    let secs = sections(&b);
    let (_, h, _) = *secs.iter().find(|s| s.0 == 1).unwrap();
    let n8 = u32le(&b, h) as usize;
    let mut o = h + 4 + n8;
    let n_wires = u32le(&b, o) as usize;
    let n_out = u32le(&b, o + 4) as usize;
    let n_pub_in = u32le(&b, o + 8) as usize;
    o += 12 + 4 + 8;
    let m = u32le(&b, o) as usize;
    let (_, mut c, _) = *secs.iter().find(|s| s.0 == 2).unwrap();
    let mut constraints = Vec::with_capacity(m);
    for _ in 0..m {
        let mut lcs: [Vec<(usize, Fr)>; 3] = [vec![], vec![], vec![]];
        for l in lcs.iter_mut() {
            let nt = u32le(&b, c) as usize;
            c += 4;
            for _ in 0..nt {
                let w = u32le(&b, c) as usize;
                let coeff = Fr::from_le_bytes_mod_order(&b[c + 4..c + 4 + n8]);
                l.push((w, coeff));
                c += 4 + n8;
            }
        }
        constraints.push(lcs);
    }
    R1cs { n_wires, n_pub: n_out + n_pub_in, constraints }
}

fn read_wtns(path: &str) -> Vec<Fr> {
    let b = fs::read(path).unwrap();
    assert_eq!(&b[0..4], b"wtns");
    let secs = sections(&b);
    let (_, h, _) = *secs.iter().find(|s| s.0 == 1).unwrap();
    let n8 = u32le(&b, h) as usize;
    let n = u32le(&b, h + 4 + n8) as usize;
    let (_, d, _) = *secs.iter().find(|s| s.0 == 2).unwrap();
    (0..n).map(|i| Fr::from_le_bytes_mod_order(&b[d + i * n8..d + (i + 1) * n8])).collect()
}

#[derive(Clone)]
struct Circom<'a> {
    r1cs: &'a R1cs,
    witness: Option<Vec<Fr>>,
}

impl<'a> ConstraintSynthesizer<Fr> for Circom<'a> {
    fn generate_constraints(self, cs: ConstraintSystemRef<Fr>) -> Result<(), SynthesisError> {
        let w = self.witness.as_ref();
        let mut vars = vec![Variable::One];
        for i in 1..self.r1cs.n_wires {
            let val = || w.map(|w| w[i]).ok_or(SynthesisError::AssignmentMissing);
            let v = if i <= self.r1cs.n_pub { cs.new_input_variable(val)? } else { cs.new_witness_variable(val)? };
            vars.push(v);
        }
        let mk = |terms: &Vec<(usize, Fr)>| {
            let mut l: LinearCombination<Fr> = lc!();
            for (wi, c) in terms {
                l += (*c, vars[*wi]);
            }
            l
        };
        for [a, b, c] in self.r1cs.constraints.iter() {
            cs.enforce_constraint(mk(a), mk(b), mk(c))?;
        }
        Ok(())
    }
}

fn peak_rss_kb() -> u64 {
    let mut s = String::new();
    fs::File::open("/proc/self/status").and_then(|mut f| f.read_to_string(&mut s)).ok();
    s.lines().find(|l| l.starts_with("VmHWM:")).and_then(|l| l.split_whitespace().nth(1)).and_then(|v| v.parse().ok()).unwrap_or(0)
}

fn hexfr(s: &str) -> [u8; 32] {
    let h = s.trim_start_matches("0x");
    let h = format!("{:0>64}", h);
    let mut out = [0u8; 32];
    for i in 0..32 {
        out[i] = u8::from_str_radix(&h[2 * i..2 * i + 2], 16).unwrap();
    }
    out
}

fn ph(inputs: &[[u8; 32]]) -> String {
    let mut p = Poseidon::<Fr>::new_circom(inputs.len()).unwrap();
    let refs: Vec<&[u8]> = inputs.iter().map(|x| &x[..]).collect();
    let h = p.hash_bytes_be(&refs).unwrap();
    format!("0x{}", h.iter().map(|b| format!("{:02x}", b)).collect::<String>())
}

fn vectors(path: &str) {
    let v: serde_json::Value = serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
    let (mut ok, mut bad) = (0, 0);
    let mut check = |name: String, inputs: Vec<[u8; 32]>, expected: &str| {
        let got = ph(&inputs);
        if got == expected {
            ok += 1;
        } else {
            bad += 1;
            println!("MISMATCH {name}: {got} != {expected}");
        }
    };
    for c in v["V-POS"]["cases"].as_array().unwrap() {
        let ins: Vec<[u8; 32]> = c["inputs"].as_array().unwrap().iter().map(|x| hexfr(x.as_str().unwrap())).collect();
        check(format!("V-POS {} n={}", c["set"], c["n"]), ins, c["output"].as_str().unwrap());
    }
    let ds = &v["V-DS"]["tags"];
    let d = |k: &str| hexfr(ds[k]["value"].as_str().unwrap());
    let s = |x: &serde_json::Value| hexfr(x.as_str().unwrap());
    let num = |x: &serde_json::Value| {
        let n: u128 = x.as_str().unwrap().parse().unwrap();
        let mut b = [0u8; 32];
        b[16..].copy_from_slice(&n.to_be_bytes());
        b
    };
    let a = &v["V-ASSET"];
    check("V-ASSET".into(), vec![d("DS_ASSET"), s(&a["mint_hi"]), s(&a["mint_lo"])], a["asset"].as_str().unwrap());
    let k = &v["V-KEYS"];
    check("owner".into(), vec![d("DS_PK"), s(&k["ak"][0]), s(&k["ak"][1]), s(&k["nk"])], k["owner"].as_str().unwrap());
    for (i, c) in v["V-NOTE"]["cases"].as_array().unwrap().iter().enumerate() {
        check(format!("V-NOTE {i}"), vec![d("DS_NOTE"), num(&c["value"]), s(&a["asset"]), s(&c["owner"]), s(&c["salt"]), s(&c["label"])], c["cm"].as_str().unwrap());
    }
    for (i, c) in v["V-NF"]["cases"].as_array().unwrap().iter().enumerate() {
        check(format!("V-NF {i}"), vec![d("DS_NF"), s(&c["nk"]), s(&c["cm"]), num(&c["leaf_index"])], c["nf"].as_str().unwrap());
    }
    let sh = &v["V-SIGHASH"];
    let nf = &v["V-NF"]["cases"];
    let notes = &v["V-NOTE"]["cases"];
    check(
        "V-SIGHASH".into(),
        vec![d("DS_SIGHASH"), s(&nf[0]["nf"]), s(&nf[1]["nf"]), s(&notes[2]["cm"]), s(&notes[3]["cm"]), s(&sh["public_amount_field"]), s(&a["asset"]), s(&sh["ext_data_hash"]), num(&sh["now_epoch"])],
        sh["sighash"].as_str().unwrap(),
    );
    let zero = [0u8; 32];
    check(
        "V-PI skeleton".into(),
        vec![d("DS_PI"), s(&v["V-TREE"]["root"]), s(&nf[0]["nf"]), s(&nf[1]["nf"]), s(&notes[2]["cm"]), s(&notes[3]["cm"]), s(&sh["public_amount_field"]), s(&a["asset"]), s(&sh["ext_data_hash"]), num(&sh["now_epoch"]), zero, zero],
        v["V-PI"]["skeleton_pi"].as_str().unwrap(),
    );
    println!("{{\"impl\":\"light-poseidon 0.4.0\",\"ok\":{ok},\"mismatch\":{bad}}}");
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    match a[1].as_str() {
        "vectors" => vectors(&a[2]),
        "setup" => {
            let r1cs = read_r1cs(&a[2]);
            let t = Instant::now();
            let mut rng = rand::rngs::OsRng;
            let (pk, _vk) = Groth16::<Bn254>::circuit_specific_setup(Circom { r1cs: &r1cs, witness: None }, &mut rng).unwrap();
            let mut f = fs::File::create(&a[3]).unwrap();
            pk.serialize_uncompressed(&mut f).unwrap();
            println!("{{\"setup_ms\":{},\"constraints\":{},\"peak_rss_mb\":{:.1}}}", t.elapsed().as_millis(), r1cs.constraints.len(), peak_rss_kb() as f64 / 1024.0);
        }
        "prove" => {
            let r1cs = read_r1cs(&a[2]);
            let wit = read_wtns(&a[3]);
            let t0 = Instant::now();
            let pk = ProvingKey::<Bn254>::deserialize_uncompressed_unchecked(&fs::read(&a[4]).unwrap()[..]).unwrap();
            let t1 = Instant::now();
            let mut rng = rand::rngs::OsRng;
            let public: Vec<Fr> = wit[1..=r1cs.n_pub].to_vec();
            let proof = Groth16::<Bn254>::prove(&pk, Circom { r1cs: &r1cs, witness: Some(wit) }, &mut rng).unwrap();
            let t2 = Instant::now();
            let pvk = Groth16::<Bn254>::process_vk(&pk.vk).unwrap();
            let ok = Groth16::<Bn254>::verify_with_processed_vk(&pvk, &public, &proof).unwrap();
            let pi0 = public[0].into_bigint().to_bytes_be();
            println!(
                "{{\"impl\":\"arkworks ark-groth16 0.5 (rayon)\",\"threads\":{},\"load_pk_ms\":{},\"prove_ms\":{},\"peak_rss_mb\":{:.1},\"verified\":{},\"pi\":\"0x{}\"}}",
                std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1),
                (t1 - t0).as_millis(),
                (t2 - t1).as_millis(),
                peak_rss_kb() as f64 / 1024.0,
                ok,
                pi0.iter().map(|b| format!("{:02x}", b)).collect::<String>()
            );
        }
        _ => panic!("unknown command"),
    }
}
