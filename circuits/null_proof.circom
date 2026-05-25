pragma circom 2.0.0;

include "mimcsponge.circom";

template MerkleTreeRoot(levels) {
    signal input leaf;
    signal input pathElements[levels];
    signal input pathIndices[levels];

    signal selectors[levels][2];
    signal hashes[levels + 1];
    signal output root;

    component hashers[levels];

    hashes[0] <== leaf;

    for (var i = 0; i < levels; i++) {
        pathIndices[i] * (pathIndices[i] - 1) === 0;
        selectors[i][0] <== hashes[i] - pathIndices[i] * (hashes[i] - pathElements[i]);
        selectors[i][1] <== pathElements[i] - pathIndices[i] * (pathElements[i] - hashes[i]);

        hashers[i] = MiMCSponge(2, 220, 1);
        hashers[i].ins[0] <== selectors[i][0];
        hashers[i].ins[1] <== selectors[i][1];
        hashers[i].k <== 0;
        hashes[i + 1] <== hashers[i].outs[0];
    }

    root <== hashes[levels];
}

template NullProofV2(levels) {
    signal input amount;
    signal input receiver_token_part_0;
    signal input receiver_token_part_1;
    signal input mint_part_0;
    signal input mint_part_1;
    signal input blinding;
    signal input nullifier_secret;
    signal input pathElements[levels];
    signal input pathIndices[levels];

    signal output commitment;
    signal output nullifier;
    signal output root;

    // Commitment binds payout semantics so proof-valid payout arguments cannot be swapped.
    component mimc_commitment = MiMCSponge(7, 220, 1);
    mimc_commitment.ins[0] <== amount;
    mimc_commitment.ins[1] <== receiver_token_part_0;
    mimc_commitment.ins[2] <== receiver_token_part_1;
    mimc_commitment.ins[3] <== mint_part_0;
    mimc_commitment.ins[4] <== mint_part_1;
    mimc_commitment.ins[5] <== blinding;
    mimc_commitment.ins[6] <== nullifier_secret;
    mimc_commitment.k <== 0;
    commitment <== mimc_commitment.outs[0];

    component mimc_nullifier = MiMCSponge(1, 220, 1);
    mimc_nullifier.ins[0] <== nullifier_secret;
    mimc_nullifier.k <== 0;
    nullifier <== mimc_nullifier.outs[0];

    component tree_root = MerkleTreeRoot(levels);
    tree_root.leaf <== commitment;
    for (var i = 0; i < levels; i++) {
        tree_root.pathElements[i] <== pathElements[i];
        tree_root.pathIndices[i] <== pathIndices[i];
    }
    root <== tree_root.root;
}

// 128 leaves = 7 levels
component main {
    public [
        amount,
        receiver_token_part_0,
        receiver_token_part_1,
        mint_part_0,
        mint_part_1
    ]
} = NullProofV2(7);
