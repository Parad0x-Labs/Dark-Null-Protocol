pragma circom 2.1.6;
include "lib_v2.circom";

// Phase 1 join-split skeleton: principal branch only. Public signal: pi.
template TransactV2Skeleton(depth) {
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
}

component main = TransactV2Skeleton(32);
