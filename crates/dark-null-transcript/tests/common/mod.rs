//! Shared test support: vector loading and an independent BabyJubJub / EdDSA-Poseidon reference
//! (ark-bn254 field arithmetic + num-bigint scalars; written from the curve definition, not from
//! circomlibjs) used to re-derive and verify every signature in the vectors.
#![allow(dead_code)]

use ark_bn254::Fr;
use ark_ff::{BigInteger, Field, One, PrimeField, Zero};
use dark_null_transcript::fr::Fr32;
use dark_null_transcript::hash::LightPoseidon;
use dark_null_transcript::preimage::eddsa_challenge;
use num_bigint::BigUint;
use serde_json::Value;
use std::path::PathBuf;
use std::str::FromStr;

pub const HP: LightPoseidon = LightPoseidon;

pub fn vectors_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../vectors/v2")
}

pub fn load(name: &str) -> Value {
    let p = vectors_dir().join(format!("{name}.json"));
    serde_json::from_str(&std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("{}: {e}", p.display()))).unwrap()
}

/// "0x..." (any length up to 64 hex digits) as a 32-byte big-endian value.
pub fn fr(v: &Value) -> Fr32 {
    let s = v.as_str().expect("hex string");
    let s = s.strip_prefix("0x").unwrap_or(s);
    let padded = format!("{:0>64}", s);
    let mut o = [0u8; 32];
    o.copy_from_slice(&hex::decode(padded).unwrap());
    o
}

/// Plain hex bytes.
pub fn bytes(v: &Value) -> Vec<u8> {
    hex::decode(v.as_str().expect("hex")).unwrap()
}

pub fn b32(v: &Value) -> [u8; 32] {
    bytes(v).try_into().expect("32 bytes")
}

pub fn dec_u64(v: &Value) -> u64 {
    match v {
        Value::String(s) => s.parse().unwrap(),
        Value::Number(n) => n.as_u64().unwrap(),
        _ => panic!("not an integer"),
    }
}

pub fn from_u64_fr(v: u64) -> Fr32 {
    dark_null_transcript::fr::from_u64(v)
}

const B58: &[u8] = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

pub fn b58dec(s: &str) -> [u8; 32] {
    let mut n = BigUint::zero();
    for c in s.bytes() {
        n = n * 58u32 + B58.iter().position(|x| *x == c).expect("base58") as u32;
    }
    let raw = n.to_bytes_be();
    let lead = s.bytes().take_while(|c| *c == b'1').count();
    let mut v = vec![0u8; lead];
    if !n.is_zero() {
        v.extend_from_slice(&raw);
    }
    let mut o = [0u8; 32];
    o[32 - v.len()..].copy_from_slice(&v);
    o
}

pub fn b58enc(b: &[u8; 32]) -> String {
    let mut n = BigUint::from_bytes_be(b);
    let mut s = Vec::new();
    while !n.is_zero() {
        let r = (&n % 58u32).to_u32_digits().first().copied().unwrap_or(0);
        s.push(B58[r as usize]);
        n /= 58u32;
    }
    for x in b.iter() {
        if *x == 0 {
            s.push(b'1');
        } else {
            break;
        }
    }
    s.reverse();
    String::from_utf8(s).unwrap()
}

/// Solana PDA with the canonical (highest off-curve) bump: SHA256(seeds || bump || program || "ProgramDerivedAddress").
pub fn find_pda(seeds: &[&[u8]], program: &[u8; 32]) -> ([u8; 32], u8) {
    for bump in (0..=255u8).rev() {
        if let Some(a) = create_pda(seeds, bump, program) {
            return (a, bump);
        }
    }
    panic!("no pda")
}

/// `create_program_address` for one bump; `None` when the hash is an ed25519 point.
pub fn create_pda(seeds: &[&[u8]], bump: u8, program: &[u8; 32]) -> Option<[u8; 32]> {
    let b = [bump];
    let mut parts: Vec<&[u8]> = seeds.to_vec();
    parts.push(&b);
    parts.push(program);
    parts.push(b"ProgramDerivedAddress");
    let a = dark_null_transcript::hash::sha256(&parts);
    if curve25519_dalek::edwards::CompressedEdwardsY(a).decompress().is_some() {
        None
    } else {
        Some(a)
    }
}

// ---------------- BabyJubJub ----------------

pub type Pt = (Fr, Fr);

pub fn fe(x: &Fr32) -> Fr {
    Fr::from_be_bytes_mod_order(x)
}

pub fn fe_bytes(x: &Fr) -> Fr32 {
    let v = x.into_bigint().to_bytes_be();
    let mut o = [0u8; 32];
    o[32 - v.len()..].copy_from_slice(&v);
    o
}

fn a() -> Fr {
    Fr::from(168700u64)
}
fn d() -> Fr {
    Fr::from(168696u64)
}

pub fn b8() -> Pt {
    (
        Fr::from_str("5299619240641551281634865583518297030282874472190772894086521144482721001553").unwrap(),
        Fr::from_str("16950150798460657717958625567821834550301663161624707787222815936182638968203").unwrap(),
    )
}

pub fn l_bjj() -> BigUint {
    BigUint::from_str("2736030358979909402780800718157159386076813972158567259200215660948447373041").unwrap()
}

pub fn on_curve(p: &Pt) -> bool {
    let (x2, y2) = (p.0.square(), p.1.square());
    a() * x2 + y2 == Fr::one() + d() * x2 * y2
}

pub fn add(p: &Pt, q: &Pt) -> Pt {
    let x1x2 = p.0 * q.0;
    let y1y2 = p.1 * q.1;
    let dxy = d() * x1x2 * y1y2;
    let x3 = (p.0 * q.1 + p.1 * q.0) * (Fr::one() + dxy).inverse().unwrap();
    let y3 = (y1y2 - a() * x1x2) * (Fr::one() - dxy).inverse().unwrap();
    (x3, y3)
}

pub fn mul(p: &Pt, k: &BigUint) -> Pt {
    let mut acc: Pt = (Fr::zero(), Fr::one());
    for i in (0..k.bits()).rev() {
        acc = add(&acc, &acc);
        if k.bit(i) {
            acc = add(&acc, p);
        }
    }
    acc
}

fn half() -> BigUint {
    BigUint::from_bytes_be(&Fr::MODULUS.to_bytes_be()) >> 1
}

/// circomlib `packPoint`: y little-endian, MSB of byte 31 = (x > (p-1)/2).
pub fn pack(p: &Pt) -> [u8; 32] {
    let mut y = fe_bytes(&p.1);
    y.reverse();
    if BigUint::from_bytes_be(&fe_bytes(&p.0)) > half() {
        y[31] |= 0x80;
    }
    y
}

pub fn unpack(b: &[u8; 32]) -> Option<Pt> {
    let sign = b[31] & 0x80 != 0;
    let mut yb = *b;
    yb[31] &= 0x7f;
    yb.reverse();
    let y = BigUint::from_bytes_be(&yb);
    if y >= BigUint::from_bytes_be(&Fr::MODULUS.to_bytes_be()) {
        return None;
    }
    let y = fe(&yb);
    let y2 = y.square();
    let x2 = (Fr::one() - y2) * (a() - d() * y2).inverse()?;
    let mut x = x2.sqrt()?;
    if (BigUint::from_bytes_be(&fe_bytes(&x)) > half()) != sign {
        x = -x;
    }
    Some((x, y))
}

pub fn big(x: &Fr32) -> BigUint {
    BigUint::from_bytes_be(x)
}

pub fn big_bytes(x: &BigUint) -> Fr32 {
    let v = x.to_bytes_be();
    let mut o = [0u8; 32];
    o[32 - v.len()..].copy_from_slice(&v);
    o
}

pub fn pt_bytes(p: &Pt) -> [Fr32; 2] {
    [fe_bytes(&p.0), fe_bytes(&p.1)]
}

/// EdDSA-Poseidon verification with circomlib semantics: S < l and S*B8 == R8 + (8*hm)*A.
pub fn eddsa_verify(a_pub: &Pt, r8: &Pt, s: &BigUint, m: &Fr32) -> bool {
    if s >= &l_bjj() || !on_curve(a_pub) || !on_curve(r8) {
        return false;
    }
    let hm = eddsa_challenge(&HP, &pt_bytes(r8), &pt_bytes(a_pub), m).unwrap();
    let left = mul(&b8(), s);
    let right = add(r8, &mul(a_pub, &(big(&hm) * 8u32)));
    left == right
}

/// Spec signing (V2_SPEC 4.4): r = eddsa_nonce(nonce_key, M); R8 = r*B8; S = (r + 8*hm*a) mod l.
pub fn eddsa_sign(a_scalar: &Fr32, nonce_key: &[u8; 32], m: &Fr32) -> (Pt, BigUint, Fr32) {
    let r = big(&dark_null_transcript::kdf::eddsa_nonce(nonce_key, m));
    let r8 = mul(&b8(), &r);
    let a_pub = mul(&b8(), &big(a_scalar));
    let hm = eddsa_challenge(&HP, &pt_bytes(&r8), &pt_bytes(&a_pub), m).unwrap();
    let s = (r + big(&hm) * 8u32 * big(a_scalar)) % l_bjj();
    (r8, s, hm)
}

/// circomlib `packSignature`: packPoint(R8) || LE32(S).
pub fn pack_sig(r8: &Pt, s: &BigUint) -> [u8; 64] {
    let mut o = [0u8; 64];
    o[..32].copy_from_slice(&pack(r8));
    let mut sb = big_bytes(s);
    sb.reverse();
    o[32..].copy_from_slice(&sb);
    o
}
