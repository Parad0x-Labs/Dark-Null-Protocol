#!/bin/sh
# B5 re-derivation of the transact_v2 dev-setup verifying key (PLAN_2027 gate B5). Node container, network off.
# Inputs a third party fetches or rebuilds itself: the PPoT file (hash-pinned), the circuit recompiled with the
# official circom release (hash-pinned), and the committed zkey (the phase-2 transcript).
#
# Checks, each printed as one JSON field:
#   r1cs_rebuilt_matches      rebuilt transact_v2.r1cs SHA-256 == MANIFEST row
#   wasm_rebuilt_matches      rebuilt transact_v2.wasm SHA-256 == MANIFEST row
#   zkey_matches_manifest     committed zkey SHA-256 == MANIFEST row
#   zkey_verify               `snarkjs zkey verify <rebuilt r1cs> <ptau> <zkey>`: the zkey derives from this circuit
#                             and this PPoT file through the contributions recorded in it
#   vk_rederived_matches      vk.json exported from the zkey == MANIFEST row (byte for byte)
#   vk_rs_rederived_matches   vk.rs regenerated from that vk.json == committed programs/dark-null-pool-v2/src/vk.rs
#   manifest_check            every dark_null_v2 MANIFEST row matches its file
#
# Usage: rederive_dev_key.sh <repo_root> <rebuild_dir from build_circuit.sh> <ptau>
set -u
ROOT=$1; RB=$2; PTAU=$3
SNARKJS="node --max-old-space-size=3000 $ROOT/circuits/v2/node_modules/snarkjs/build/cli.cjs"
T=$(mktemp -d)
row() { node -e "const m=require('$ROOT/MANIFEST.json').dark_null_v2; process.stdout.write(m.artifacts.find(a=>a.path==='$1').sha256)"; }
sha() { sha256sum "$1" | cut -d' ' -f1; }
yn() { [ "$1" = "$2" ] && echo true || echo false; }

r1cs_ok=$(yn "$(sha "$RB/transact_v2.r1cs")" "$(row circuits/v2/build/transact_v2.r1cs)")
wasm_ok=$(yn "$(sha "$RB/transact_v2_js/transact_v2.wasm")" "$(row circuits/v2/build/transact_v2.wasm)")
zkey_ok=$(yn "$(sha "$ROOT/circuits/v2/build/transact_v2_dev.zkey")" "$(row circuits/v2/build/transact_v2_dev.zkey)")
if $SNARKJS zkey verify "$RB/transact_v2.r1cs" "$PTAU" "$ROOT/circuits/v2/build/transact_v2_dev.zkey" >"$T/verify.log" 2>&1 \
   && grep -q "ZKey Ok" "$T/verify.log"; then zv=true; else zv=false; fi
contrib=$(sed -e 's/\x1b\[[0-9;]*m//g' "$T/verify.log" | grep -A4 "contribution #1" | tail -4 | tr -d ' \t\n')
$SNARKJS zkey export verificationkey "$ROOT/circuits/v2/build/transact_v2_dev.zkey" "$T/vk.json" >/dev/null 2>&1
vk_ok=$(yn "$(sha "$T/vk.json")" "$(row circuits/v2/build/vk.json)")
node "$ROOT/scripts/setup/gen_vk_rs.mjs" "$T/vk.json" "$T/vk.rs" >/dev/null
vkrs_ok=$(yn "$(sha "$T/vk.rs")" "$(sha "$ROOT/programs/dark-null-pool-v2/src/vk.rs")")
if node "$ROOT/scripts/setup/manifest_v2.mjs" check "$ROOT" >"$T/manifest.log" 2>&1; then mc=true; else mc=false; fi
pass=true
for v in $r1cs_ok $wasm_ok $zkey_ok $zv $vk_ok $vkrs_ok $mc; do [ "$v" = true ] || pass=false; done
printf '{"check":"B5 dev-setup re-derivation","ptau_sha256":"%s","r1cs_rebuilt_sha256":"%s","r1cs_rebuilt_matches":%s,"wasm_rebuilt_matches":%s,"zkey_matches_manifest":%s,"zkey_verify":%s,"contribution_1_hash":"%s","vk_rederived_sha256":"%s","vk_rederived_matches":%s,"vk_rs_rederived_matches":%s,"manifest_check":%s,"pass":%s}\n' \
  "$(sha "$PTAU")" "$(sha "$RB/transact_v2.r1cs")" "$r1cs_ok" "$wasm_ok" "$zkey_ok" "$zv" "$contrib" "$(sha "$T/vk.json")" "$vk_ok" "$vkrs_ok" "$mc" "$pass"
rm -rf "$T"
[ "$pass" = true ]
