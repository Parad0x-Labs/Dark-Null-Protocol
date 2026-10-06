//! Host check before deploy: every fixture proof (snarkjs and arkworks, three V-E2E steps each) verifies through
//! groth16-solana with the generated VK, and changed inputs are rejected. Fixtures: tests/fixtures/proofs.txt
//! (`label proof_hex(256 B, A negated) pi_hex(32 B)` per line).
use dark_null_vk_probe::process_instruction;
use pinocchio::pubkey::Pubkey;

fn unhex(s: &str) -> Vec<u8> {
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
}

fn run(proof: &[u8], pi: &[u8]) -> bool {
    let mut data = vec![0x01];
    data.extend_from_slice(proof);
    data.extend_from_slice(pi);
    process_instruction(&Pubkey::default(), &[], &data).is_ok()
}

#[test]
fn fixture_proofs_verify_and_tampering_fails() {
    let fx = include_str!("fixtures/proofs.txt");
    let mut n = 0;
    for line in fx.lines().filter(|l| !l.is_empty()) {
        let mut it = line.split_whitespace();
        let label = it.next().unwrap();
        let proof = unhex(it.next().unwrap());
        let pi = unhex(it.next().unwrap());
        assert!(run(&proof, &pi), "{label}: valid proof rejected");
        let mut pi2 = pi.clone();
        pi2[31] ^= 1;
        assert!(!run(&proof, &pi2), "{label}: changed pi accepted");
        let mut p2 = proof.clone();
        p2[200] ^= 1;
        assert!(!run(&p2, &pi), "{label}: changed proof C accepted");
        let mut p3 = proof.clone();
        p3[63] ^= 1; // A not negated / changed y
        assert!(!run(&p3, &pi), "{label}: changed proof A accepted");
        n += 1;
    }
    assert_eq!(n, 6);
    // non-canonical pi (>= r) is refused before the pairing
    let line = fx.lines().next().unwrap();
    let proof = unhex(line.split_whitespace().nth(1).unwrap());
    assert!(!run(&proof, &[0xff; 32]));
}
