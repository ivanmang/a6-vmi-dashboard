#!/usr/bin/env bash
# diag_bundle.sh — reproduce the Kernel Lab VPTO/LLVM emit exactly as
# build_bundle.py does, and dump the real ptoas stderr.
set -uo pipefail
cd "$(dirname "$0")/.."
source env.sh
EMIT_PY=~/pto-vmi/dsl/VcvtMergeModeKernel/VcvtMergeModeKernel_case0_bf16_fp8_128_128_w0_emit.py
MLIR=/tmp/v.mlir

echo "=== 1. MLIR emit (_emit.py) ==="
PTO_TARGET=a6 ~/.venv-ptoas/bin/python3 "$EMIT_PY" --emit > "$MLIR" 2>/tmp/v.err
echo "  mlir lines: $(wc -l < "$MLIR")"
tail -3 /tmp/v.err

echo ""
echo "=== 2. VPTO emit ==="
rm -f /tmp/diag_vpto.out
~/.venv-ptoas/bin/ptoas --pto-arch=a6 --pto-backend=vpto --pto-level=level3 \
  --enable-tile-op-expand --emit-vpto "$MLIR" -o /tmp/diag_vpto.out >/tmp/diag_vpto.log 2>&1
echo "  rc=$?  out=$([ -f /tmp/diag_vpto.out ] && stat -c%s /tmp/diag_vpto.out || echo MISSING) bytes"
tail -5 /tmp/diag_vpto.log

echo ""
echo "=== 3. LLVM emit ==="
rm -f /tmp/diag_llvm.out
~/.venv-ptoas/bin/ptoas --pto-arch=a6 --pto-backend=vpto --pto-level=level3 \
  --enable-tile-op-expand --emit-vpto-llvm-ir "$MLIR" -o /tmp/diag_llvm.out >/tmp/diag_llvm.log 2>&1
echo "  rc=$?  out=$([ -f /tmp/diag_llvm.out ] && stat -c%s /tmp/diag_llvm.out || echo MISSING) bytes"
tail -5 /tmp/diag_llvm.log