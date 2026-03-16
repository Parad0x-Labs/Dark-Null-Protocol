import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const historicalRoot = path.join(repoRoot, "historical", "null-mint");

function matchValue(source, pattern, label) {
  const match = source.match(pattern);
  assert.ok(match, `Missing ${label}`);
  return match[1];
}

test("historical null-mint snapshot is sanitized and internally consistent", async () => {
  const anchorToml = await fs.readFile(path.join(historicalRoot, "Anchor.toml"), "utf8");
  const libRs = await fs.readFile(path.join(historicalRoot, "programs", "paradox", "src", "lib.rs"), "utf8");
  const idl = JSON.parse(await fs.readFile(path.join(historicalRoot, "idl", "paradox.json"), "utf8"));
  const typeSource = await fs.readFile(path.join(historicalRoot, "types", "paradox.ts"), "utf8");
  const vk = JSON.parse(await fs.readFile(path.join(historicalRoot, "verification_key_latest.json"), "utf8"));
  const readme = await fs.readFile(path.join(historicalRoot, "README.md"), "utf8");

  const programId = matchValue(libRs, /declare_id!\("([^"]+)"\);/, "program id");
  const localnetProgramId = matchValue(anchorToml, /\[programs\.localnet\][\s\S]*?paradox = "([^"]+)"/, "localnet paradox id");
  const devnetProgramId = matchValue(anchorToml, /\[programs\.devnet\][\s\S]*?paradox = "([^"]+)"/, "devnet paradox id");
  const nrPubinputs = Number(matchValue(libRs, /nr_pubinputs: (\d+),/, "nr_pubinputs"));

  assert.equal(programId, localnetProgramId);
  assert.equal(programId, devnetProgramId);
  assert.equal(programId, idl.address);
  assert.match(typeSource, new RegExp(`"address": "${programId}"`));

  assert.equal(nrPubinputs, vk.nPublic);
  assert.equal(vk.IC.length, nrPubinputs + 1);
  assert.match(libRs, /Groth16Verifier::new/);
  assert.match(libRs, /verifier\.verify\(\)/);

  assert.doesNotMatch(anchorToml, /C:\/Users\//);
  assert.doesNotMatch(anchorToml, /\/Users\//);
  assert.doesNotMatch(readme, /C:\/Users\//);
  assert.doesNotMatch(readme, /\/Users\//);

  const requiredArtifacts = [
    ["circuits", "null_proof_final.zkey"],
    ["circuits", "null_proof.r1cs"],
    ["circuits", "null_proof_js", "null_proof.wasm"],
    ["circuits", "vk.json"],
    ["vk-gen", "src", "main.rs"],
    ["tools", "parse_vk_to_rust.cjs"],
  ];

  for (const parts of requiredArtifacts) {
    const stat = await fs.stat(path.join(historicalRoot, ...parts));
    assert.ok(stat.size > 0, `Expected non-empty artifact: ${parts.join("/")}`);
  }

  const forbiddenFiles = [
    "wallet-b.json",
    "temp-wallet-a.json",
    "temp-wallet-b.json",
    path.join("target", "deploy", "paradox-keypair.json"),
    path.join("target", "deploy", "ghost_mint-keypair.json"),
    path.join("target", "deploy", "whisper-keypair.json"),
  ];

  for (const relativePath of forbiddenFiles) {
    await assert.rejects(fs.access(path.join(historicalRoot, relativePath)));
  }
});
