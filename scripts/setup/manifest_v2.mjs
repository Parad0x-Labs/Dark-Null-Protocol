// MANIFEST.json rows for the Dark NULL v2 circuit artifacts (interface I1), tagged `dev-setup`.
// Usage:
//   node manifest_v2.mjs write <repo_root> <ptau> <ptau_url>   update MANIFEST.json key "dark_null_v2"
//   node manifest_v2.mjs check <repo_root>                      exit 1 unless every row matches the files
// Rows: SHA-256 and size of each file. The ptau is not in git (75.6 MB); its SHA-256, BLAKE2b-512 and URL are
// recorded and scripts/setup/fetch_pinned.mjs refetches it.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const [cmd, root, ptau, ptauUrl] = process.argv.slice(2);
const KEY = "dark_null_v2";
const FILES = [
  ["circuits/v2/transact_v2.circom", "source"],
  ["circuits/v2/build/transact_v2.r1cs", "r1cs"],
  ["circuits/v2/build/transact_v2.wasm", "wasm"],
  ["circuits/v2/build/transact_v2_dev.zkey", "zkey"],
  ["circuits/v2/build/vk.json", "vk"],
  ["programs/dark-null-pool-v2/src/vk.rs", "program-vk"],
];
const digest = (alg, p) => crypto.createHash(alg).update(fs.readFileSync(p)).digest("hex");
const row = ([rel, role]) => {
  const p = path.join(root, rel);
  return { path: rel, role, tag: "dev-setup", sha256: digest("sha256", p), size: fs.statSync(p).size };
};
const manifestPath = path.join(root, "MANIFEST.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

if (cmd === "write") {
  const vk = JSON.parse(fs.readFileSync(path.join(root, "circuits/v2/build/vk.json"), "utf8"));
  const vkRs = fs.readFileSync(path.join(root, "programs/dark-null-pool-v2/src/vk.rs"), "utf8");
  const vkHash = [...vkRs.matchAll(/pub const VK_HASH: \[u8; 32\] = \[([^\]]*)\]/g)][0][1]
    .match(/0x[0-9a-f]{2}/g).map((b) => b.slice(2)).join("");
  manifest[KEY] = {
    status: "dev-setup",
    note: "Groth16 dev-setup: single-operator phase 2 on PPoT; the operator can forge proofs. Devnet only (V2_SPEC 7.6, DESIGN 8.1).",
    circuit: "transact_v2 (V2_SPEC 7, principal branch)",
    compiler: { name: "circom", version: "2.2.3", flags: "--O2", binary: "circom-linux-amd64", sha256: "85342c7ff332d948df7c0c50ecf201e6129349aef550ce873f3c811b79fe53a3", url: "https://github.com/iden3/circom/releases/download/v2.2.3/circom-linux-amd64" },
    circomlib: "2.0.5",
    snarkjs: "0.7.6",
    constraints: 23167,
    n_public: vk.nPublic,
    vk_hash: vkHash,
    ptau: {
      name: "ppot_0080_16.ptau",
      url: ptauUrl,
      sha256: digest("sha256", ptau),
      blake2b512: digest("blake2b512", ptau),
      size: fs.statSync(ptau).size,
      in_git: false,
    },
    artifacts: FILES.map(row),
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(JSON.stringify(manifest[KEY], null, 1));
} else if (cmd === "check") {
  const m = manifest[KEY];
  let bad = 0;
  for (const r of m.artifacts) {
    const now = row([r.path, r.role]);
    const ok = now.sha256 === r.sha256 && now.size === r.size && r.tag === "dev-setup";
    if (!ok) bad++;
    console.log(`${ok ? "ok      " : "MISMATCH"} ${r.sha256} ${r.path}`);
  }
  process.exit(bad ? 1 : 0);
} else {
  console.error("usage: manifest_v2.mjs write|check <repo_root> [ptau ptau_url]");
  process.exit(2);
}
