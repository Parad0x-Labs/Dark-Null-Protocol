// Read the header and the contribution records of a snarkjs .ptau file and compare them with values PSE publishes
// for PPoT contribution 0080 (node >= 22, no deps). PSE publishes no file digest for the prepared ppot_0080_XX files;
// this ties the file to the published transcript values instead:
//   - the beacon: randao_reveal of Ethereum beacon slot 7,325,000, 2^31 iterations (PSE perpetualpowersoftau README);
//   - contribution 0080's new_challenge BLAKE2b hash (0080_carter_response/README.md).
// Usage: node ptau_info.mjs <file.ptau>
import fs from "node:fs";

const PUBLISHED = {
  beacon_hash: "af941599f6d640b5b4b6116d3ded861b3362a964c390edc270aef45ba17b67148fb3d7ab901a68b1528c9bb3e16721cc000dda5d8466f4aa4a1c8ca9eb57d05e6c2d2e780d6a793df90a1ebd076bb3dd9b7d4075e3e68b36b86c1fb7c4feeded",
  beacon_iterations_exp: 31,
  c0080_new_challenge_blake2b: "4bf672f3ba1de1bb6105e1ab88359612cdf09cb2d154f371937f85ec0cf25e0a10ec88efa3019065850a2e96048bf9ef5f68aa75fcfe26faa120c465d3954174",
};

const b = fs.readFileSync(process.argv[2]);
if (b.subarray(0, 4).toString("latin1") !== "ptau") throw new Error("not a ptau file");
const nSec = b.readUInt32LE(8);
const sec = {};
let o = 12;
for (let i = 0; i < nSec; i++) {
  const t = b.readUInt32LE(o);
  const sz = Number(b.readBigUInt64LE(o + 4));
  sec[t] = { start: o + 12, size: sz };
  o += 12 + sz;
}
const h = sec[1].start;
const n8 = b.readUInt32LE(h);
const power = b.readUInt32LE(h + 4 + n8);
const ceremonyPower = b.readUInt32LE(h + 8 + n8);

const G1 = 2 * n8, G2 = 4 * n8;
let p = sec[7].start;
const nContrib = b.readUInt32LE(p);
p += 4;
const contributions = [];
for (let i = 0; i < nContrib; i++) {
  p += G1 + G2 + G1 + G1 + G2; // tauG1, tauG2, alphaG1, betaG1, betaG2
  p += 3 * (G1 + G1 + G2); // public keys (tau, alpha, beta)
  p += 216; // partial hash
  const nextChallenge = b.subarray(p, p + 64).toString("hex");
  p += 64;
  const type = b.readUInt32LE(p);
  p += 4;
  const paramLen = b.readUInt32LE(p);
  p += 4;
  const end = p + paramLen;
  const c = { index: i + 1, type: type === 1 ? "beacon" : "contribution", next_challenge_blake2b: nextChallenge };
  while (p < end) {
    const k = b[p++];
    if (k === 1) { const l = b[p++]; c.name = b.subarray(p, p + l).toString("utf8"); p += l; }
    else if (k === 2) { c.iterations_exp = b[p++]; }
    else if (k === 3) { const l = b[p++]; c.beacon_hash = b.subarray(p, p + l).toString("hex"); p += l; }
    else throw new Error(`unknown contribution parameter ${k}`);
  }
  contributions.push(c);
}
const beacon = contributions.find((c) => c.type === "beacon");
const out = {
  power,
  ceremony_power: ceremonyPower,
  contributions,
  published: PUBLISHED,
  beacon_matches_published: !!beacon && beacon.beacon_hash === PUBLISHED.beacon_hash && beacon.iterations_exp === PUBLISHED.beacon_iterations_exp,
  c0080_next_challenge_matches_published: contributions.some((c) => c.next_challenge_blake2b === PUBLISHED.c0080_new_challenge_blake2b),
};
console.log(JSON.stringify(out, null, 1));
