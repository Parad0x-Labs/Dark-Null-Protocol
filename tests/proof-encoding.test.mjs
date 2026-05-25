import test from "node:test";
import assert from "node:assert/strict";

import {
  bytes32ToHex,
  encodeBytes32PublicInputParts,
  encodeU64PublicInput,
  encodeWithdrawV2PublicInputs,
  getProofEncoding,
} from "../sdk/index.mjs";

const BN254_FR_HEX = "30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001";

test("proof encoding metadata distinguishes current ABI from compressed target", () => {
  const encoding = getProofEncoding();
  assert.equal(encoding.current_verifier_abi_bytes, 256);
  assert.equal(encoding.compressed_target_bytes, 128);
  assert.deepEqual(encoding.current_public_inputs, ["commitment", "nullifier", "root"]);
  assert.deepEqual(encoding.planned_withdraw_v2_public_inputs, [
    "commitment",
    "nullifier",
    "root",
    "amount",
    "receiver_token_part_0",
    "receiver_token_part_1",
    "mint_part_0",
    "mint_part_1",
  ]);
});

test("u64 public input encoding is fixed-width big-endian", () => {
  assert.deepEqual(encodeU64PublicInput(0), new Array(32).fill(0));
  assert.deepEqual(encodeU64PublicInput(42), new Array(31).fill(0).concat([42]));
  assert.deepEqual(
    encodeU64PublicInput((1n << 64n) - 1n),
    new Array(24).fill(0).concat(new Array(8).fill(255)),
  );
  assert.throws(() => encodeU64PublicInput(1.5), /integer|BigInt/);
  assert.throws(() => encodeU64PublicInput(1n << 64n), /u64/);
});

test("pubkey splitting keeps every derived scalar in Fr range", () => {
  const pubkey = new Array(32).fill(255);
  const [part0, part1] = encodeBytes32PublicInputParts(pubkey, "receiver_token");
  assert.deepEqual(part0.slice(0, 16), new Array(16).fill(0));
  assert.deepEqual(part1.slice(0, 16), new Array(16).fill(0));
  assert.deepEqual(part0.slice(16), new Array(16).fill(255));
  assert.deepEqual(part1.slice(16), new Array(16).fill(255));
});

test("withdraw v2 public inputs reject non-field root inputs", () => {
  const small = bytes32ToHex(new Array(31).fill(0).concat([1]));
  const fr = `0x${BN254_FR_HEX}`;
  assert.throws(
    () =>
      encodeWithdrawV2PublicInputs({
        commitment: small,
        nullifier: small,
        root: fr,
        amount: 1,
        receiverToken: new Array(32).fill(2),
        mint: new Array(32).fill(3),
      }),
    /root must be less/,
  );
});

