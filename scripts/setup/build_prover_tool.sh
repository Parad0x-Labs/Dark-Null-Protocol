#!/bin/sh
# Build circuits/v2/tools (arkworks prover with the snarkjs zkey loader) offline (sandbox only).
# Step 1, throwaway rust:1.86-slim-bookworm container WITH network, sources only (no build scripts run):
#   cd circuits/v2/tools && cargo vendor --locked --versioned-dirs vendor
# Step 2, build container WITHOUT network (the PLAN's dnax-sbf-build), with the vendor dir streamed in:
#   build_prover_tool.sh <circuits/v2/tools dir> <target dir>
# Run: dark-null-circuit-tools prove <transact_v2_dev.zkey> <witness.wtns> [proof.json]
set -eu
cd "$1"
mkdir -p .cargo
printf '[source.crates-io]\nreplace-with = "vendored-sources"\n\n[source.vendored-sources]\ndirectory = "vendor"\n' > .cargo/config.toml
CARGO_TARGET_DIR=$2 cargo build --release --offline --locked -j 2
sha256sum "$2/release/dark-null-circuit-tools"
