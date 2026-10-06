pragma circom 2.1.6;
include "circomlib/circuits/poseidon.circom";

// S-PLONK small test circuit: one public output pi = Poseidon(12)(x[0..11]) and a short Poseidon(2) chain.
// Single public input, same as transact_v2 (DESIGN 5.1). Used for the verifier-cost spike; on-chain verify
// cost depends on the public-input count and log2(domain), not on the gate count.
template PiHash(chain) {
    signal input x[12];
    signal output pi;
    component p = Poseidon(12);
    for (var i = 0; i < 12; i++) { p.inputs[i] <== x[i]; }
    component h[chain];
    signal acc[chain + 1];
    acc[0] <== p.out;
    for (var i = 0; i < chain; i++) {
        h[i] = Poseidon(2);
        h[i].inputs[0] <== acc[i];
        h[i].inputs[1] <== x[i % 12];
        acc[i + 1] <== h[i].out;
    }
    pi <== acc[chain];
}

component main = PiHash(4);
