#!/usr/bin/env bash
# diag_env.sh — diagnose why env.sh's A6 CANN detection fails on this host.
#
# Run it from anywhere on the yellow zone and paste the output back to blue:
#   bash ops/diag_env.sh
set -u

echo "host: $(hostname)  user: $(id -un)"
echo

echo "=== 1. what's actually in each CANN dir ==="
for c in "$HOME/Ascend/cann-9.1.0" "$HOME/Ascend/cann" "$HOME/Ascend/ascend-toolkit"; do
  echo "-- $c"; ls -la "$c" 2>/dev/null | head -20
done
echo

echo "=== 2. system-wide CANN candidates (+ /usr/local) ==="
for c in \
  /usr/local/CANN/* /usr/local/Ascend/* \
  "$HOME/Ascend"/* ; do
  [[ -d "$c" ]] || continue
  [[ -d "$c/tools" || -d "$c/bin" || -d "$c/include" ]] && echo "  has tools/bin/include: $c"
done
echo

echo "=== 3. dav_9201 / Ascend920A simulator anywhere on disk ==="
find / -maxdepth 7 -type d \( -name "dav_9201" -o -name "Ascend920A" \) 2>/dev/null | head -20
echo

echo "=== 4. bisheng compiler binary anywhere ==="
find / -maxdepth 8 -type f -name "bisheng" 2>/dev/null | head -20
echo

echo "=== 5. buffer_limits.hpp + setenv scripts anywhere ==="
find / -maxdepth 8 -name "buffer_limits.hpp" 2>/dev/null | head -20
echo "--- setenv.bash / set_env.sh ---"
find / -maxdepth 8 \( -name "setenv.bash" -o -name "set_env.sh" \) 2>/dev/null | grep -i ascend | head -20
echo

echo "=== 6. pto-isa repo (A6 compile headers source) ==="
for p in "$HOME/pto-isa" "$HOME/Ascend/pto-isa" /usr/local/pto-isa /opt/pto-isa; do
  [[ -d "$p" ]] && echo "  $p  ($(git -C "$p" rev-parse --short HEAD 2>/dev/null || echo no-git))"
done
find / -maxdepth 6 -type d -name "pto-isa" 2>/dev/null | head
echo

echo "=== 7. ptoas venvs + versions ==="
for v in "$HOME/.venv-ptoas" "$HOME/.venv-ptoas310" "$HOME/.venv-ptoas312"; do
  [[ -d "$v" ]] && echo "  $v  ($($v/bin/python3 -c 'import importlib.metadata as m; print("ptoas", m.version("ptoas"))' 2>/dev/null || echo 'no ptoas'))"
done
which -a ptoas 2>/dev/null
echo

echo "=== 8. environment hints ==="
env | grep -iE "ASCEND|CANN|PTO|SIMULATOR|SOC_VERSION|LD_LIBRARY_PATH" | sort
echo

echo "done."