//! Native (host) tests of the spike verifiers against real snarkjs proofs.
//! Host syscall fallbacks: keccak via sha3, alt_bn128 via solana-bn254's arkworks path.
use dark_null_spike_p0::process_instruction;

fn hx(s: &str) -> Vec<u8> {
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
}

fn fixtures() -> serde_json::Value {
    serde_json::from_str(include_str!("fixtures/ix_fixtures.json")).unwrap()
}

fn run(tag: u8, data: &[u8]) -> bool {
    let mut d = vec![tag];
    d.extend_from_slice(data);
    process_instruction(&[0u8; 32], &[], &d).is_ok()
}

#[test]
fn groth16_accepts_and_rejects() {
    let f = fixtures();
    assert!(run(0x30, &hx(f["g16_skeleton"].as_str().unwrap())));
    assert!(run(0x31, &hx(f["g16_pi_hash"].as_str().unwrap())));
    assert!(run(0x32, &hx(f["g16_fullsize"].as_str().unwrap())));
    assert!(!run(0x30, &hx(f["bad"]["g16_skeleton_pub"].as_str().unwrap())));
}

#[test]
fn plonk_accepts_and_rejects() {
    let f = fixtures();
    assert!(run(0x40, &hx(f["plonk_pi_hash"]["data_hint"].as_str().unwrap())));
    assert!(run(0x41, &hx(f["plonk_pi_hash"]["data_nohint"].as_str().unwrap())));
    assert!(run(0x42, &hx(f["plonk_skeleton"]["data_hint"].as_str().unwrap())));
    assert!(!run(0x40, &hx(f["bad"]["plonk_pi_hash_eval"].as_str().unwrap())));
    assert!(!run(0x40, &hx(f["bad"]["plonk_pi_hash_pub"].as_str().unwrap())));
}

#[test]
fn fflonk_accepts_and_rejects() {
    let f = fixtures();
    assert!(run(0x50, &hx(f["fflonk_pi_hash"].as_str().unwrap())));
    assert!(!run(0x50, &hx(f["bad"]["fflonk_pi_hash_eval"].as_str().unwrap())));
}
