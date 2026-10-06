pragma circom 2.1.6;
include "circomlib/circuits/poseidon.circom";

// V-POS witness source: Poseidon(n) for n = 1..12 over a flat input vector (offset sum(1..n-1)).
template PoseidonVectors() {
    signal input in[78];
    signal output out[12];
    component p[12];
    var off = 0;
    for (var n = 1; n <= 12; n++) {
        p[n - 1] = Poseidon(n);
        for (var k = 0; k < n; k++) { p[n - 1].inputs[k] <== in[off + k]; }
        out[n - 1] <== p[n - 1].out;
        off += n;
    }
}

component main = PoseidonVectors();
