// Download a file and check its SHA-256 against a pinned value before it is kept (sandbox only; node >= 22, no deps).
// Usage: node fetch_pinned.mjs <url> <out_path> <sha256_hex>
// Exit 1 and no output file if the digest differs.
import fs from "node:fs";
import crypto from "node:crypto";

const [url, out, want] = process.argv.slice(2);
if (!url || !out || !/^[0-9a-f]{64}$/.test(want || "")) {
  console.error("usage: node fetch_pinned.mjs <url> <out_path> <sha256_hex>");
  process.exit(2);
}
const res = await fetch(url, { redirect: "follow" });
if (!res.ok) {
  console.error(`HTTP ${res.status} for ${url}`);
  process.exit(1);
}
const h = crypto.createHash("sha256");
const tmp = `${out}.part`;
const fd = fs.openSync(tmp, "w");
let n = 0;
for await (const chunk of res.body) {
  h.update(chunk);
  fs.writeSync(fd, chunk);
  n += chunk.length;
}
fs.closeSync(fd);
const got = h.digest("hex");
if (got !== want) {
  fs.unlinkSync(tmp);
  console.error(`SHA-256 mismatch for ${url}: got ${got}, want ${want}`);
  process.exit(1);
}
fs.renameSync(tmp, out);
console.log(JSON.stringify({ url, path: out, bytes: n, sha256: got, etag: res.headers.get("etag") }));
