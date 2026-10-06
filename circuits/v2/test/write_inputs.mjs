// Write the valid V-E2E witnesses and tampered witnesses W1-W17 as circom input files (for the native witness
// generator). Usage: node write_inputs.mjs <V-E2E.json> <V-ADDR.json> <out_dir>
import fs from "node:fs";
import path from "node:path";
import { readJson } from "./lib.mjs";
import { tamperedCases, validCases } from "./cases.mjs";

const [e2ePath, addrPath, outDir] = process.argv.slice(2);
const E2E = readJson(e2ePath);
const ADDR = readJson(addrPath);
fs.mkdirSync(outDir, { recursive: true });
const index = { valid: [], tampered: [] };
for (const v of validCases(E2E)) {
  fs.writeFileSync(path.join(outDir, `e2e_${v.step}.json`), JSON.stringify(v.input));
  index.valid.push({ step: v.step, file: `e2e_${v.step}.json`, pi: v.pi });
}
for (const t of tamperedCases(E2E, ADDR)) {
  fs.writeFileSync(path.join(outDir, `${t.id}.json`), JSON.stringify(t.input));
  index.tampered.push({ id: t.id, step: t.step, what: t.what, file: `${t.id}.json` });
}
fs.writeFileSync(path.join(outDir, "index.json"), JSON.stringify(index, null, 1));
console.log(`wrote ${index.valid.length} valid and ${index.tampered.length} tampered inputs to ${outDir}`);
