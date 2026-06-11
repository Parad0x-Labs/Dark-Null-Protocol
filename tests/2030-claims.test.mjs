import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checkScript = path.join(repoRoot, "scripts", "check-2030-claims.mjs");
const primitivesPath = path.join(repoRoot, "docs", "2030_PRIMITIVES.md");
const ledgerPath = path.join(repoRoot, "docs", "CLAIMS_LEDGER.md");

async function read(relativePath) {
  return fs.readFile(path.join(repoRoot, relativePath), "utf8");
}

test("2030 claim guard passes for the gated frontier docs", () => {
  const output = execFileSync(process.execPath, [checkScript], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.match(output, /2030 claims check passed/);
});

test("x402 privacy extension remains private receipt primitives unless integration evidence exists", async () => {
  const primitives = await fs.readFile(primitivesPath, "utf8");

  assert.match(
    primitives,
    /\| Dark Null x402 Privacy Extension \| `prototype` \| .*private receipt primitives until integration evidence exists/,
  );
  assert.match(primitives, /no live x402 merchant gateway/);
  assert.match(primitives, /external `dna-x402` release commit/);
});

test("recursive batching is prototype-only (sequential O(N), no epoch proofs); compressed anonymity stays research", async () => {
  const primitives = await fs.readFile(primitivesPath, "utf8");

  // recursive batching upgraded from research to prototype (sequential verifier shipped)
  assert.match(primitives, /\| Recursive Settlement Batches \| `prototype` \|/);
  assert.match(primitives, /no recursive verifier/);
  assert.match(primitives, /SnarkPack aggregation is the research target/);
  assert.match(primitives, /\| Compressed Anonymity \/ Nullifier State \| `research` \|/);
  assert.match(primitives, /no compressed-account deployment/);
});

test("BDHKE blind token prototype boundary — on-chain registry and key rotation are the research target", async () => {
  const primitives = await fs.readFile(primitivesPath, "utf8");
  const ledger = await fs.readFile(ledgerPath, "utf8");

  assert.match(primitives, /\| BDHKE Blind Receipt Tokens \| `prototype` \|/);
  assert.match(primitives, /no on-chain spent-token registry/);
  assert.match(primitives, /no x402 gateway integration/);
  assert.match(ledger, /BDHKE Blind Receipt Tokens \| Prototype \|/);
});

test("Token-2022 confidential transfer remains blocked while availability is audit-gated", async () => {
  const primitives = await fs.readFile(primitivesPath, "utf8");

  assert.match(primitives, /\| Confidential Token-2022 Linkage Privacy \| `blocked` \|/);
  assert.match(primitives, /blocked while Solana confidential transfer availability is audit-gated/);
  assert.match(primitives, /no Confidential Transfer integration/);
});

test("integration watchlist references are not delivered claims", async () => {
  const primitives = await fs.readFile(primitivesPath, "utf8");

  assert.match(primitives, /no MagicBlock integration/);
  assert.match(primitives, /no Arcium integration/);
  assert.match(primitives, /no Jito BAM integration/);
  assert.match(primitives, /no Alpenglow-specific runtime path/);
  assert.match(primitives, /no x402 Bazaar indexing integration/);
});

test("claims ledger carries gated research primitives without turning them into launch claims", async () => {
  const ledger = await fs.readFile(ledgerPath, "utf8");

  assert.match(ledger, /## Gated Research Primitives/);
  assert.match(ledger, /Proof-Carrying Relayer Swarm \| Research \| not a validator network, not BFT, and not decentralized consensus/);
  assert.match(ledger, /MPC Sealed Pricing \/ Private Auctions \| Research \| not a private compute network/);
});

test("frontier docs are linked from README and product map", async () => {
  const readme = await read("README.md");
  const productMap = await read("docs/PARADOX_STACK.md");

  assert.match(readme, /docs\/2030_PRIMITIVES\.md/);
  assert.match(readme, /frontier_primitives:/);
  assert.match(productMap, /## Frontier Convergence/);
  assert.match(productMap, /frontier:/);
});
