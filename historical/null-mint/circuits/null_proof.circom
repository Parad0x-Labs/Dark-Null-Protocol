pragma circom 2.0.0;

include "circomlib/mimcsponge.circom";

template MerkleTreeChecker(levels) {
    signal input leaf;
    signal input root;
    signal input pathElements[levels];
    signal input pathIndices[levels];

    signal selectors[levels][2];
    signal hashes[levels + 1];

    component hashers[levels];

    hashes[0] <== leaf;

    for (var i = 0; i < levels; i++) {
        selectors[i][0] <== hashes[i] - pathIndices[i] * (hashes[i] - pathElements[i]);
        selectors[i][1] <== pathElements[i] - pathIndices[i] * (pathElements[i] - hashes[i]);

        hashers[i] = MiMCSponge(2, 220, 1);
        hashers[i].ins[0] <== selectors[i][0];
        hashers[i].ins[1] <== selectors[i][1];
        hashers[i].k <== 0;
        hashes[i + 1] <== hashers[i].outs[0];
    }

    root === hashes[levels];
}

template NullProof(levels) {
    signal input amount;
    signal input blinding;
    signal input nullifier_secret;
    signal input root;
    signal input pathElements[levels];
    signal input pathIndices[levels];

    signal output commitment;
    signal output nullifier;

    // 1. Commitment = MiMC(amount, blinding, nullifier_secret)
    component mimc_commitment = MiMCSponge(3, 220, 1);
    mimc_commitment.ins[0] <== amount;
    mimc_commitment.ins[1] <== blinding;
    mimc_commitment.ins[2] <== nullifier_secret;
    mimc_commitment.k <== 0;
    commitment <== mimc_commitment.outs[0];

    // 2. Nullifier = MiMC(nullifier_secret)
    component mimc_nullifier = MiMCSponge(1, 220, 1);
    mimc_nullifier.ins[0] <== nullifier_secret;
    mimc_nullifier.k <== 0;
    nullifier <== mimc_nullifier.outs[0];

    // 3. Merkle Proof Verification
    component tree_checker = MerkleTreeChecker(levels);
    tree_checker.leaf <== commitment;
    tree_checker.root <== root;
    for (var i = 0; i < levels; i++) {
        tree_checker.pathElements[i] <== pathElements[i];
        tree_checker.pathIndices[i] <== pathIndices[i];
    }
}

// 128 leaves = 7 levels
component main {public [root, nullifier]} = NullProof(7);
