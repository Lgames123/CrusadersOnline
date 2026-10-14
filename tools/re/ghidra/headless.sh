#!/usr/bin/env bash
# Runs one of these Ghidra scripts against the analysed crusaders.exe, read-only (nothing is saved).
#   tools/re/ghidra/headless.sh <Script.java> <out file> [args...]
# Args go through cmd.exe: no parentheses, pipes or ampersands in them.
set -euo pipefail
GHIDRA="${GHIDRA_HOME:-C:/Users/Lencina/Documents/ghidra_12.1.4_PUBLIC}"
PROJECT_DIR="${GHIDRA_PROJECT_DIR:-C:/Users/Lencina/Desktop/CrusadersDecomp}"
HERE="$(cd "$(dirname "$0")" && pwd -W 2>/dev/null || pwd)"
script="$1"; shift
"$GHIDRA/support/analyzeHeadless.bat" "$PROJECT_DIR" CrusadersDecomp -process -noanalysis -readOnly \
  -scriptPath "$HERE" -postScript "$script" "$@" > "${TMPDIR:-/tmp}/ghidra-headless.log" 2>&1 || true
grep -E "ERROR|Exception" "${TMPDIR:-/tmp}/ghidra-headless.log" | grep -v "Module manifest" || true
