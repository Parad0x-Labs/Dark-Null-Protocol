use ark_bn254::{Bn254, G1Affine, G2Affine, Fq, Fq2};
use ark_groth16::VerifyingKey;
use ark_serialize::CanonicalSerialize;
use serde::{Deserialize, Serialize};
use std::fs;
use std::str::FromStr;

#[derive(Serialize, Deserialize)]
struct SnarkjsVk {
    #[serde(rename = "vk_alpha_1")]
    alpha_1: Vec<String>,
    #[serde(rename = "vk_beta_2")]
    beta_2: Vec<Vec<String>>,
    #[serde(rename = "vk_gamma_2")]
    gamma_2: Vec<Vec<String>>,
    #[serde(rename = "vk_delta_2")]
    delta_2: Vec<Vec<String>>,
    #[serde(rename = "IC")]
    ic: Vec<Vec<String>>,
}

fn to_fq(s: &str) -> Fq {
    Fq::from_str(s).unwrap_or_else(|_| panic!("Failed to parse Fq: {}", s))
}

fn to_g1(v: &[String]) -> G1Affine {
    let x = to_fq(&v[0]);
    let y = to_fq(&v[1]);
    G1Affine::new(x, y)
}

fn to_g2(v: &[Vec<String>]) -> G2Affine {
    let x = Fq2::new(to_fq(&v[0][0]), to_fq(&v[0][1]));
    let y = Fq2::new(to_fq(&v[1][0]), to_fq(&v[1][1]));
    G2Affine::new(x, y)
}

fn main() {
    let data = fs::read_to_string("../circuits/vk.json").expect("Unable to read vk.json");
    let snark_vk: SnarkjsVk = serde_json::from_str(&data).expect("JSON was not well-formatted");

    let alpha_g1 = to_g1(&snark_vk.alpha_1);
    let beta_g2 = to_g2(&snark_vk.beta_2);
    let gamma_g2 = to_g2(&snark_vk.gamma_2);
    let delta_g2 = to_g2(&snark_vk.delta_2);
    let gamma_abc_g1: Vec<G1Affine> = snark_vk.ic.iter().map(|v| to_g1(v)).collect();

    let mut vk_bytes = Vec::new();
    // Serialize components separately for Groth16Verifyingkey
    alpha_g1.serialize_uncompressed(&mut vk_bytes).unwrap();
    beta_g2.serialize_uncompressed(&mut vk_bytes).unwrap();
    gamma_g2.serialize_uncompressed(&mut vk_bytes).unwrap();
    delta_g2.serialize_uncompressed(&mut vk_bytes).unwrap();
    
    // Add IC elements
    for ic in gamma_abc_g1 {
        ic.serialize_uncompressed(&mut vk_bytes).unwrap();
    }

    println!("VK_BYTES (Uncompressed): {:?}", vk_bytes);
    fs::write("../circuits/vk.bin", &vk_bytes).unwrap();
    println!("Successfully wrote vk.bin");
}
