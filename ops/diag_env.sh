#!/usr/bin/env bash
# diag_env.sh — diagnose why env.sh's A6 CANN detection fails on this host.
#
# Run it from anywhere on the yellow zone and paste the output back to blue:
#   bash ops/diag_env.sh
set -u

echo "host: $(hostname)  user: $(id -un)"
echo

CANN="$HOME/Ascend/cann-9.1.0"

echo "=== 1. CANN top-level (note symlinks: bin/include/lib64 -> x86_64-linux/...) ==="
ls -la "$CANN" 2>/dev/null
echo

echo "=== 2. compiler/ — is bisheng/ccec here? (symlink-aware) ==="
ls -la "$CANN/compiler" 2>/dev/null
echo "-- $CANN/compiler/bin --"
ls -la "$CANN/compiler/bin" 2>/dev/null | head -20
echo "-- any bisheng* / ccec anywhere under CANN (-L follows symlinks) --"
find -L "$CANN" -maxdepth 5 \( -name "bisheng*" -o -name "ccec" \) 2>/dev/null | head
echo

echo "=== 3. x86_64-linux/ (real binaries/headers live here) ==="
ls -la "$CANN/x86_64-linux" 2>/dev/null
echo

echo "=== 4. simulator dirs (follow symlinks) ==="
echo "-- dav_9201 / Ascend920A --"
find -L / -maxdepth 7 -type d \( -name "dav_9201" -o -name "Ascend920A" \) 2>/dev/null | head
echo "-- any *950* / *910* / dav* sim dirs under ~/Ascend --"
find -L "$HOME/Ascend" -maxdepth 6 -type d \( -iname "*950*" -o -iname "*910*" -o -iname "dav*" \) 2>/dev/null | head
echo "-- tools/simulator present at all? --"
ls -la "$CANN/tools" 2>/dev/null || echo "  (no $CANN/tools)"
echo

echo "=== 5. simulator/toolkit INSTALLERS (.run) lying around ==="
find / -maxdepth 5 \( -name "*.run" -o -iname "*simulator*.tar*" \) 2>/dev/null | grep -iE "ascend|cann|sim" | head
echo

echo "=== 6. ~/Ascend top level ==="
ls -la "$HOME/Ascend" 2>/dev/null
echo

echo "=== 7. pto-isa headers (A6 compile headers live here) ==="
for p in "$HOME/npu_skills/pto-isa" "$HOME/pto-isa"; do
  [[ -d "$p" ]] || continue
  echo "  $p"
  ls -d "$p"/include/pto 2>/dev/null && grep -l "PTO_NPU_ARCH_A6" "$p"/include/pto/common/buffer_limits.hpp 2>/dev/null && echo "     [HAS A6 arch]"
done
echo

echo "=== 8. ptoas versions + ptoas binary on PATH ==="
for v in "$HOME/.venv-ptoas" "$HOME/.venv-ptoas310" "$HOME/.venv-ptoas312"; do
  [[ -d "$v" ]] && echo "  $v  ($($v/bin/python3 -c 'import importlib.metadata as m; print("ptoas", m.version("ptoas"))' 2>/dev/null || echo 'no ptoas'))"
done
which -a ptoas 2>/dev/null && ptoas --version 2>/dev/null
echo

echo "done."