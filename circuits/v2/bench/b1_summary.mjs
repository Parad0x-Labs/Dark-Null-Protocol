// Summarize B1 runs: p50/p95 and peak RAM per implementation and thread count (node >= 22, no deps).
// Usage: node b1_summary.mjs <native.jsonl> <snarkjs.jsonl> <out.json>
import fs from "node:fs";
const [nativePath, snarkPath, outPath] = process.argv.slice(2);
const read = (p) => fs.readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const pct = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]; };
const row = (name, xs, ms, rss) => ({ name, runs: xs.length, p50_ms: +pct(ms, 0.5).toFixed(1), p95_ms: +pct(ms, 0.95).toFixed(1), peak_rss_mb: rss.length ? +Math.max(...rss).toFixed(1) : null, all_verified: xs.every((x) => x.verified) });
const native = read(nativePath);
const snark = read(snarkPath);
const rows = [];
for (const th of [4, 1]) {
  const xs = native.filter((x) => x.rayon_threads === th);
  rows.push(row(`native end to end (C++ witness + arkworks prove, incl. process start and zkey load), ${th} thread(s)`, xs, xs.map((x) => x.end_to_end_us / 1000), xs.map((x) => x.peak_rss_mb)));
  rows.push(row(`arkworks prove only, ${th} thread(s)`, xs, xs.map((x) => x.prove_ms), xs.map((x) => x.peak_rss_mb)));
  rows.push(row(`native C++ witness only (fresh process, single-threaded; RSS not sampled), runs of the ${th}-thread series`, xs, xs.map((x) => x.witness_us / 1000), []));
}
rows.push(row("snarkjs end to end (WASM witness + prove)", snark, snark.map((x) => x.total_ms), snark.map((x) => x.max_rss_mb)));
rows.push(row("snarkjs WASM witness only", snark, snark.map((x) => x.witness_ms), snark.map((x) => x.max_rss_mb)));
const gate = rows.filter((r) => r.name.startsWith("native end to end")).every((r) => r.p50_ms <= 3000 && r.peak_rss_mb <= 2048);
const out = { gate: "B1: p50 <= 3 s, peak RAM <= 2 GB", native_meets_b1: gate, rows };
fs.writeFileSync(outPath, JSON.stringify(out, null, 1) + "\n");
console.log(JSON.stringify(out, null, 1));
