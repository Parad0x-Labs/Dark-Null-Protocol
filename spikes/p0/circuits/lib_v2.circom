pragma circom 2.1.6;

// Dark NULL v2 Phase 0 circuit library (spike).
// Poseidon parameters: circomlib Poseidon(n) == light-poseidon == sol_poseidon (Bn254X5, big-endian).
// Domain tags are draft values: DS_x = int.from_bytes(ascii(tag), "big"). See vectors/v2/V-DS.json.

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/eddsaposeidon.circom";

function DS_ASSET()   { return 0x6461726b2d6e756c6c2d61737365742d7631; }   // "dark-null-asset-v1"
function DS_NOTE()    { return 0x6461726b2d6e756c6c2d6e6f74652d7631; }     // "dark-null-note-v1"
function DS_NF()      { return 0x6461726b2d6e756c6c2d6e662d7631; }         // "dark-null-nf-v1"
function DS_PK()      { return 0x6461726b2d6e756c6c2d706b2d7631; }         // "dark-null-pk-v1"
function DS_SIGHASH() { return 0x6461726b2d6e756c6c2d736967686173682d7631; } // "dark-null-sighash-v1"
function DS_PI()      { return 0x6461726b2d6e756c6c2d70692d7631; }         // "dark-null-pi-v1"

// Merkle root from a leaf, its index bits (LSB = level 0) and siblings. Node = Poseidon(left, right).
template MerkleRoot(depth) {
    signal input leaf;
    signal input indexBits[depth];
    signal input siblings[depth];
    signal output root;

    component h[depth];
    signal cur[depth + 1];
    signal left[depth];
    signal right[depth];
    cur[0] <== leaf;
    for (var i = 0; i < depth; i++) {
        // indexBits[i] is boolean (constrained by the caller's Num2Bits).
        left[i] <== cur[i] + indexBits[i] * (siblings[i] - cur[i]);
        right[i] <== siblings[i] + cur[i] - left[i];
        h[i] = Poseidon(2);
        h[i].inputs[0] <== left[i];
        h[i].inputs[1] <== right[i];
        cur[i + 1] <== h[i].out;
    }
    root <== cur[depth];
}

// cm = Poseidon(DS_NOTE, value, asset, owner, salt, label)
template NoteCommitment() {
    signal input value;
    signal input asset;
    signal input owner;
    signal input salt;
    signal input label;
    signal output cm;
    component p = Poseidon(6);
    p.inputs[0] <== DS_NOTE();
    p.inputs[1] <== value;
    p.inputs[2] <== asset;
    p.inputs[3] <== owner;
    p.inputs[4] <== salt;
    p.inputs[5] <== label;
    cm <== p.out;
}

// 2-in / 2-out join-split, depth-`depth` tree, single public input pi.
// Spend authorization: EdDSA-Poseidon (BabyJubJub) by ak over sighash, verified in-circuit.
// owner = Poseidon(DS_PK, ak.x, ak.y, nk)   (nk bound into the owner; see PHASE0_RESULTS finding F-NK)
// nf    = Poseidon(DS_NF, nk, cm, leaf_index)
template TransactCore(depth) {
    // public-statement fields (hashed into pi)
    signal input root;
    signal input public_amount;
    signal input public_asset;
    signal input ext_data_hash;
    signal input now_epoch;
    signal input deposit_label;
    signal input assoc_root;

    // spend key material
    signal input asset;
    signal input ak[2];
    signal input nk;
    signal input sig_R8[2];
    signal input sig_S;

    // inputs
    signal input in_value[2];
    signal input in_salt[2];
    signal input in_label[2];
    signal input in_leaf_index[2];
    signal input in_path[2][depth];

    // outputs
    signal input out_value[2];
    signal input out_owner[2];
    signal input out_salt[2];
    signal input out_label[2];

    signal output pi;
    signal output nf[2];
    signal output cm_out[2];

    // owner key
    component pk = Poseidon(4);
    pk.inputs[0] <== DS_PK();
    pk.inputs[1] <== ak[0];
    pk.inputs[2] <== ak[1];
    pk.inputs[3] <== nk;

    component inRange[2];
    component inCm[2];
    component idxBits[2];
    component path[2];
    component nfh[2];
    for (var i = 0; i < 2; i++) {
        inRange[i] = Num2Bits(64);
        inRange[i].in <== in_value[i];

        inCm[i] = NoteCommitment();
        inCm[i].value <== in_value[i];
        inCm[i].asset <== asset;
        inCm[i].owner <== pk.out;
        inCm[i].salt <== in_salt[i];
        inCm[i].label <== in_label[i];

        idxBits[i] = Num2Bits(depth);
        idxBits[i].in <== in_leaf_index[i];

        path[i] = MerkleRoot(depth);
        path[i].leaf <== inCm[i].cm;
        for (var k = 0; k < depth; k++) {
            path[i].indexBits[k] <== idxBits[i].out[k];
            path[i].siblings[k] <== in_path[i][k];
        }
        // membership is enforced only for non-zero inputs (dummy inputs carry value 0)
        (path[i].root - root) * in_value[i] === 0;

        nfh[i] = Poseidon(4);
        nfh[i].inputs[0] <== DS_NF();
        nfh[i].inputs[1] <== nk;
        nfh[i].inputs[2] <== inCm[i].cm;
        nfh[i].inputs[3] <== in_leaf_index[i];
        nf[i] <== nfh[i].out;
    }

    component outRange[2];
    component outCm[2];
    for (var j = 0; j < 2; j++) {
        outRange[j] = Num2Bits(64);
        outRange[j].in <== out_value[j];
        outCm[j] = NoteCommitment();
        outCm[j].value <== out_value[j];
        outCm[j].asset <== asset;
        outCm[j].owner <== out_owner[j];
        outCm[j].salt <== out_salt[j];
        outCm[j].label <== out_label[j];
        cm_out[j] <== outCm[j].cm;
    }

    // value conservation (all four values < 2^64; the program bounds |public_amount| < 2^64)
    in_value[0] + in_value[1] + public_amount === out_value[0] + out_value[1];
    // public leg asset binding
    public_amount * (public_asset - asset) === 0;

    // sighash and in-circuit spend authorization
    component sh = Poseidon(9);
    sh.inputs[0] <== DS_SIGHASH();
    sh.inputs[1] <== nf[0];
    sh.inputs[2] <== nf[1];
    sh.inputs[3] <== cm_out[0];
    sh.inputs[4] <== cm_out[1];
    sh.inputs[5] <== public_amount;
    sh.inputs[6] <== public_asset;
    sh.inputs[7] <== ext_data_hash;
    sh.inputs[8] <== now_epoch;

    component sig = EdDSAPoseidonVerifier();
    sig.enabled <== 1;
    sig.Ax <== ak[0];
    sig.Ay <== ak[1];
    sig.R8x <== sig_R8[0];
    sig.R8y <== sig_R8[1];
    sig.S <== sig_S;
    sig.M <== sh.out;

    // single public input: pi = Poseidon(12)
    component pih = Poseidon(12);
    pih.inputs[0] <== DS_PI();
    pih.inputs[1] <== root;
    pih.inputs[2] <== nf[0];
    pih.inputs[3] <== nf[1];
    pih.inputs[4] <== cm_out[0];
    pih.inputs[5] <== cm_out[1];
    pih.inputs[6] <== public_amount;
    pih.inputs[7] <== public_asset;
    pih.inputs[8] <== ext_data_hash;
    pih.inputs[9] <== now_epoch;
    pih.inputs[10] <== deposit_label;
    pih.inputs[11] <== assoc_root;
    pi <== pih.out;
}
