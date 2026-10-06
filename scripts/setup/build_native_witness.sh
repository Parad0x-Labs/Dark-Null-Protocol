#!/bin/sh
# Build the native (C++) witness generator that circom emits with `--c --no_asm` (sandbox only).
# Needs g++, make, libgmp-dev and nlohmann-json3-dev (Debian bookworm packages; install them in a throwaway
# container, then disconnect the network before this step). Works on arm64 and x86_64 (no assembly).
# Usage: build_native_witness.sh <transact_v2_cpp dir>
# Output: <dir>/transact_v2 (reads <dir>/transact_v2.dat at run time). Usage of the binary:
#   transact_v2 <input.json> <out.wtns>      exit 0 and a .wtns file, or a failed assert (exit 134) naming the template
set -eu
cd "$1"
# One job: the generated transact_v2.cpp is about 40 MB and g++ -O3 needs about 2 GB for it.
# NATIVE_OPT overrides the optimisation level on a machine with less free memory (default -O3, as circom emits).
make -j1 CFLAGS="-std=c++11 ${NATIVE_OPT:--O3} -I." >make.log 2>&1 || { tail -20 make.log >&2; exit 1; }
ls -la transact_v2
