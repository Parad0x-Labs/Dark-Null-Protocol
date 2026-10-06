// Tampered witnesses W1-W17 for transact_v2 (V2_SPEC 13.2 W1-W13; W14-W17 from circuits/v2/REVIEW_NOTES.md).
// Each case starts from a V-E2E witness and changes it so that exactly one constraint group can fail.
import { R, H, inputsFor, statement, resign, smallOrderPoint, babyJub } from "./lib.mjs";

// Returns [{ id, step, what, input, reference_expected }] (inputs are fresh objects).
export function tamperedCases(E2E, ADDR) {
  const step = (n) => E2E.steps.find((s) => s.name === n);
  const load = (n) => inputsFor(E2E, step(n));
  const acct = (n) => ADDR.accounts[step(n).spender];
  const add1 = (x) => ((BigInt(x) + 1n) % R).toString();
  const B8 = babyJub.Base8.map((c) => babyJub.F.toObject(c).toString());

  // [id, step, description, mutate(input) -> optional re-sign, expected reference outcome]
  const cases = [
    ["W1", "transfer", "dummy input label differs from input 0 label (C6)", (i) => { i.in_label[1] = add1(i.in_label[1]); }, "reject"],
    ["W2", "deposit", "deposit output without the deposit label (C6)", (i) => { i.out_label[0] = "0"; }, "reject"],
    ["W3", "deposit", "deposit spending a real note: input 0 of value 1 placed in the tree under the claimed root (C6)", (i, a) => {
      // Isolates C6 (isDep * in_value == 0): the note is a member of `root`, the outputs conserve value, the signature is valid.
      i.in_value[0] = "1";
      i.out_value[1] = add1(i.out_value[1]);
      i.in_leaf_index[0] = "0";
      i.in_path[0] = E2E.tree.zeros.slice(0, 32).map((z) => BigInt(z).toString());
      let node = statement(i).cmIn[0];
      for (let k = 0; k < 32; k++) node = H([node, BigInt(E2E.tree.zeros[k])]);
      i.root = node.toString();
      resign(i, a);
    }, "reject"],
    ["W4", "transfer", "output label differs from input label (C6)", (i) => { i.out_label[1] = add1(i.out_label[1]); }, "reject"],
    ["W5", "transfer", "signature scalar S + 1 (C7)", (i) => { i.sig_S = add1(i.sig_S); }, "reject"],
    ["W6", "transfer", "ext_data_hash changed after signing (C7)", (i) => { i.ext_data_hash = add1(i.ext_data_hash); }, "reject"],
    ["W7", "transfer", "output value + 1 (C4 conservation)", (i) => { i.out_value[0] = add1(i.out_value[0]); }, "reject"],
    ["W8", "withdraw", "public_asset = 0 on a withdraw (C5)", (i) => { i.public_asset = "0"; }, "reject"],
    ["W9", "transfer", "membership sibling tampered (C2)", (i) => { i.in_path[0][3] = add1(i.in_path[0][3]); }, "reject"],
    ["W10", "withdraw", "wrong leaf index for a real input (C2)", (i) => { i.in_leaf_index[0] = add1(i.in_leaf_index[0]); }, "reject"],
    ["W11", "withdraw", "second nk for the same owner (C1, F-NK)", (i) => { i.nk = add1(i.nk); }, "reject"],
    ["W12", "transfer", "ak off the curve (C1)", (i) => { i.ak[0] = add1(i.ak[0]); }, "reject"],
    ["W13", "transfer", "output value 2^64, other output wraps (C3 range)", (i) => {
      const total = BigInt(i.out_value[0]) + BigInt(i.out_value[1]);
      i.out_value[0] = (2n ** 64n).toString();
      i.out_value[1] = (((total - 2n ** 64n) % R) + R) % R + "";
    }, "reject"],
    // Review cases (REVIEW_NOTES.md). Re-signed with the spender's ask so that only the constraint under test can fail.
    ["W14", "withdraw", "one note spent twice in one transact, value counted twice (R1)", (i, a) => {
      for (const k of ["in_value", "in_salt", "in_label", "in_leaf_index", "in_path"]) i[k][1] = i[k][0];
      i.out_value[0] = (BigInt(i.out_value[0]) + BigInt(i.in_value[0])).toString();
      resign(i, a);
    }, "accept"],
    ["W15", "deposit", "small-order ak (order 8) with R8 = S*B8, no ask (R5, circomlib (4*A).x != 0 check)", (i) => {
      const T = smallOrderPoint();
      i.ak = T.map(String);
      i.sig_S = "1";
      i.sig_R8 = B8;
    }, "reject"],
    ["W16", "transfer", "R8 off the curve (R2)", (i) => { i.sig_R8[0] = add1(i.sig_R8[0]); }, "reject"],
    ["W17", "transfer", "non-zero assoc_root in a Phase 1 proof (R3)", (i, a) => { i.assoc_root = "1"; resign(i, a); }, "accept"],
  ];

  return cases.map(([id, st, what, mutate, refExpect]) => {
    const input = load(st);
    mutate(input, acct(st));
    return { id, step: st, what, input, reference_expected: refExpect };
  });
}

// The three valid V-E2E witnesses: [{ step, input, pi }].
export function validCases(E2E) {
  return E2E.steps.map((st) => ({ step: st.name, input: inputsFor(E2E, st), pi: st.public.pi }));
}
