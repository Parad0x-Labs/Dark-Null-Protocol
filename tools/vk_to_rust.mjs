import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const vkPath = path.join(toolDir, "..", "circuits", "vk.json");
const outPath = path.join(toolDir, "..", "src", "verifying_key.rs");

const vkRaw = fs.readFileSync(vkPath);
const vk = JSON.parse(vkRaw.toString("utf8"));
const sha256 = crypto.createHash("sha256").update(vkRaw).digest("hex");

function toRustBytes(value) {
  const hex = BigInt(value).toString(16).padStart(64, "0");
  return hex.match(/.{1,2}/g).map((pair) => `0x${pair}`).join(", ");
}

function parseG1(point) {
  return `${toRustBytes(point[0])}, ${toRustBytes(point[1])}`;
}

function parseG2(point) {
  return `${toRustBytes(point[0][1])}, ${toRustBytes(point[0][0])}, ${toRustBytes(point[1][1])}, ${toRustBytes(point[1][0])}`;
}

const ic = vk.IC.map((point) => `        [${parseG1(point)}]`).join(",\n");

const rustCode = `// Auto-generated from circuits/vk.json
// Do not edit manually.

use groth16_solana::groth16::Groth16Verifyingkey;

pub const NR_PUBINPUTS: usize = ${vk.IC.length - 1};
pub const VK_IC_COUNT: usize = ${vk.IC.length};
pub const VK_PROTOCOL: &str = "${vk.protocol}";
pub const VK_CURVE: &str = "${vk.curve}";
pub const VK_JSON_SHA256: &str = "${sha256}";

pub const VERIFYING_KEY: Groth16Verifyingkey = Groth16Verifyingkey {
    nr_pubinputs: ${vk.IC.length - 1},
    vk_alpha_g1: [
        ${parseG1(vk.vk_alpha_1)}
    ],
    vk_beta_g2: [
        ${parseG2(vk.vk_beta_2)}
    ],
    vk_gamme_g2: [
        ${parseG2(vk.vk_gamma_2)}
    ],
    vk_delta_g2: [
        ${parseG2(vk.vk_delta_2)}
    ],
    vk_ic: &[
${ic}
    ]
};
`;

fs.writeFileSync(outPath, rustCode);
console.log(`Wrote ${path.relative(process.cwd(), outPath)}`);
