#!/usr/bin/env node

import crypto from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vkPath = path.join(repoRoot, "circuits", "vk.json");
const rustPath = path.join(repoRoot, "src", "verifying_key.rs");

function scalarBytes(value) {
  const hex = BigInt(value).toString(16).padStart(64, "0");
  return hex.match(/.{2}/g).map((pair) => `0x${pair}`).join(", ");
}

function g1(point) {
  return `${scalarBytes(point[0])}, ${scalarBytes(point[1])}`;
}

function g2(point) {
  return [
    scalarBytes(point[0][1]),
    scalarBytes(point[0][0]),
    scalarBytes(point[1][1]),
    scalarBytes(point[1][0]),
  ].join(", ");
}

function icPoint(point) {
  return `        [${g1(point)}]`;
}

const vkRaw = readFileSync(vkPath);
const vk = JSON.parse(vkRaw.toString("utf8"));
const vkHash = crypto.createHash("sha256").update(vkRaw).digest("hex");
const ic = vk.IC.map(icPoint).join(",\n");

const rust = `// Auto-generated from circuits/vk.json
// Do not edit manually.

use groth16_solana::groth16::Groth16Verifyingkey;

pub const NR_PUBINPUTS: usize = ${vk.nPublic};
pub const VK_IC_COUNT: usize = ${vk.IC.length};
pub const VK_PROTOCOL: &str = "${vk.protocol}";
pub const VK_CURVE: &str = "${vk.curve}";
pub const VK_JSON_SHA256: &str = "${vkHash}";

pub const VERIFYING_KEY: Groth16Verifyingkey = Groth16Verifyingkey {
    nr_pubinputs: ${vk.nPublic},
    vk_alpha_g1: [
        ${g1(vk.vk_alpha_1)}
    ],
    vk_beta_g2: [
        ${g2(vk.vk_beta_2)}
    ],
    vk_gamme_g2: [
        ${g2(vk.vk_gamma_2)}
    ],
    vk_delta_g2: [
        ${g2(vk.vk_delta_2)}
    ],
    vk_ic: &[
${ic}
    ]
};
`;

writeFileSync(rustPath, rust);
