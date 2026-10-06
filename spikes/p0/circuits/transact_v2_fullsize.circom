pragma circom 2.1.6;
include "lib_v2.circom";

// Size proxy for the universal circuit (DESIGN 5.3): the skeleton plus the always-present
// branch components with live constraints: a second EdDSA-Poseidon verify (channel voucher),
// an allowlist path (depth 16) and two association-set paths (depth 20).
// Branch semantics are not implemented here; this circuit exists to measure size and proving cost.
template TransactV2FullSize(depth) {
    signal input root;
    signal input public_amount;
    signal input public_asset;
    signal input ext_data_hash;
    signal input now_epoch;
    signal input deposit_label;
    signal input assoc_root;
    signal input asset;
    signal input ak[2];
    signal input nk;
    signal input sig_R8[2];
    signal input sig_S;
    signal input in_value[2];
    signal input in_salt[2];
    signal input in_label[2];
    signal input in_leaf_index[2];
    signal input in_path[2][depth];
    signal input out_value[2];
    signal input out_owner[2];
    signal input out_salt[2];
    signal input out_label[2];
    // branch witnesses
    signal input chan_ak[2];
    signal input chan_R8[2];
    signal input chan_S;
    signal input chan_msg;
    signal input allow_leaf;
    signal input allow_index;
    signal input allow_path[16];
    signal input allow_root;
    signal input assoc_leaf[2];
    signal input assoc_index[2];
    signal input assoc_path[2][20];
    signal output pi;

    component c = TransactCore(depth);
    c.root <== root;
    c.public_amount <== public_amount;
    c.public_asset <== public_asset;
    c.ext_data_hash <== ext_data_hash;
    c.now_epoch <== now_epoch;
    c.deposit_label <== deposit_label;
    c.assoc_root <== assoc_root;
    c.asset <== asset;
    c.ak <== ak;
    c.nk <== nk;
    c.sig_R8 <== sig_R8;
    c.sig_S <== sig_S;
    c.in_value <== in_value;
    c.in_salt <== in_salt;
    c.in_label <== in_label;
    c.in_leaf_index <== in_leaf_index;
    c.in_path <== in_path;
    c.out_value <== out_value;
    c.out_owner <== out_owner;
    c.out_salt <== out_salt;
    c.out_label <== out_label;
    pi <== c.pi;

    component vs = EdDSAPoseidonVerifier();
    vs.enabled <== 1;
    vs.Ax <== chan_ak[0];
    vs.Ay <== chan_ak[1];
    vs.R8x <== chan_R8[0];
    vs.R8y <== chan_R8[1];
    vs.S <== chan_S;
    vs.M <== chan_msg;

    component ab = Num2Bits(16);
    ab.in <== allow_index;
    component ap = MerkleRoot(16);
    ap.leaf <== allow_leaf;
    for (var k = 0; k < 16; k++) { ap.indexBits[k] <== ab.out[k]; ap.siblings[k] <== allow_path[k]; }
    ap.root === allow_root;

    component sb[2];
    component sp[2];
    for (var i = 0; i < 2; i++) {
        sb[i] = Num2Bits(20);
        sb[i].in <== assoc_index[i];
        sp[i] = MerkleRoot(20);
        sp[i].leaf <== assoc_leaf[i];
        for (var k = 0; k < 20; k++) { sp[i].indexBits[k] <== sb[i].out[k]; sp[i].siblings[k] <== assoc_path[i][k]; }
        sp[i].root === assoc_root;
    }
}

component main = TransactV2FullSize(32);
