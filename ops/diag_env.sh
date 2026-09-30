#!/usr/bin/env bash
# diag_env.sh — diagnose why env.sh's A6 CANN detection fails on this host.
#
# Run it from anywhere on the yellow zone and paste the output back to blue:
#   bash ops/diag_env.sh
set -u

echo "host: $(hostname)  user: $(id -un)"
echo

echo "=== 1. tools/simulator dirs per candidate ==="
for c in "$HOME/Ascend/cann-9.1.0" "$HOME/Ascend/cann" "$HOME/Ascend/ascend-toolkit"; do
  echo "-- $c"
  ls -d "$c"/tools/simulator/* 2>/dev/null | head
  ls -d "$c"/x86_64-linux/simulator/* 2>/dev/null | head
done
echo

echo "=== 2. dav_9201 / Ascend920A anywhere ==="
find "$HOME/Ascend" -maxdepth 6 -type d \( -name "dav_9201" -o -name "Ascend920A" \) 2>/dev/null
echo

echo "=== 3. bisheng binary ==="
ls -l \
  "$HOME/Ascend/cann-9.1.0/tools/bisheng_compiler/bin/bisheng" \
  "$HOME/Ascend/cann-9.1.0/bin/bisheng" \
  "$HOME/Ascend/ascend-toolkit/tools/bisheng_compiler/bin/bisheng" \
  "$HOME/Ascend/ascend-toolkit/bin/bisheng" 2>/dev/null
echo

echo "=== 4. buffer_limits.hpp location + A6 arch ==="
while IFS= read -r h; do
  [[ -n "$h" ]] || continue
  if grep -q "PTO_NPU_ARCH_A6" "$h" 2>/dev/null; then
    echo "  $h  [HAS A6]"
  else
    echo "  $h  (no A6)"
  fi
done < <(find "$HOME/Ascend" -maxdepth 6 -name buffer_limits.hpp 2>/dev/null | head)
echo

echo "=== 5. symlinks ==="
ls -ld "$HOME/Ascend/cann" "$HOME/Ascend/ascend-toolkit" 2>/dev/null
echo

echo "=== 6. setenv scripts ==="
ls -l "$HOME/Ascend/cann-9.1.0/bin/setenv.bash" "$HOME/Ascend/ascend-toolkit/bin/setenv.bash" 2>/dev/null
echo

echo "=== 7. pto-isa headers (A6 compile headers source) ==="
ls -d "$HOME/pto-isa/include/pto" 2>/dev/null && grep -l "PTO_NPU_ARCH_A6" "$HOME/pto-isa/include/pto/common/buffer_limits.hpp" 2>/dev/null
echo

echo "=== 8. ptoas venvs ==="
for v in "$HOME/.venv-ptoas" "$HOME/.venv-ptoas310" "$HOME/.venv-ptoas312"; do
  [[ -d "$v" ]] && echo "  $v  ($($v/bin/python3 -c 'import importlib.metadata as m; print("ptoas", m.version("ptoas"))' 2>/dev/null))"
done
echo

echo "done."
