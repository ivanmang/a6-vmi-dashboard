#!/usr/bin/env bash
# probe_a6_shift.sh — definitive: run the REAL kernel_v66.ll through the A6 backend,
# swapping only the vshrs intrinsic name, to find the form dav-920r1-vec selects.
set -u
BISHENG=~/Ascend/cann-9.1.0/bin/bisheng
SRC=/tmp/kernel_v66.ll
OLD="vshrs.v128u16.logic.x"

CANDS="
vshrs.v128u16.logic.x
vshrs.v128u16u16.z
vshr.v128u16.logic.x
vshr.v128u16u16.z
vshrs.v128u16.arith.x
vshr.v128u16.arith.x
"

for cand in $CANDS; do
  sed "s/$OLD/$cand/g" "$SRC" > ~/probe_kernel.ll
  rm -f ~/probe_kernel.o
  if "$BISHENG" \
      --cce-aicore-arch=dav-920r1-vec --cce-aicore-only -O2 \
      --cce-generic-addrspace=off -cce-bitcode-is-aicore -Wno-override-module \
      -dc --cce-long-scbz=true -mllvm -cce-dyn-kernel-stack-size=true \
      -mllvm --cce-aicore-vec-misched=0 -mllvm --cce-simt-fpmath-combine=false \
      -c -x ir ~/probe_kernel.ll -o ~/probe_kernel.o >~/probe_kernel.log 2>&1; then
    echo "COMPILES     $cand"
  else
    echo "fail         $cand : $(grep -m1 -oE 'Cannot select: .*|error: .*|fatal error: .*' ~/probe_kernel.log | head -1)"
  fi
done
rm -f ~/probe_kernel.ll ~/probe_kernel.o ~/probe_kernel.log