#!/usr/bin/env bash
# linked_launcher_poc.sh — proof-of-concept: run the ptodsl-compiled SimpleCopyKernel
# fatobj on dav_9201 from a minimal C++ host (like CCE) instead of the python/ctypes
# host. If this PASSes, the DSL crash is the python host, not the compiler output.
#
# Stages:
#   1) build the ptodsl launch .so off-line (no ACL init)  -> /tmp/launch_lib_info.json
#   2) compile linked_launcher.cpp with the mini_acl link line (linked camodel+acl)
#   3) run it
set -uo pipefail
cd "$(dirname "$0")"
source ./a6_env.sh
PY=~/.venv-ptoas/bin/python3
BISHENG="$ASCEND_HOME_PATH/bin/bisheng"

echo "=== [1/3] generate ptodsl launch .so (no ACL init, no launch) ==="
PTO_TARGET=a6 MSPROF_SIMULATOR_MODE=1 "$PY" ./gen_launch_lib.py || { echo "GEN FAILED"; exit 1; }

SO=$("$PY" -c "import json;print(json.load(open('/tmp/launch_lib_info.json'))['lib_path'])")
SYM=$("$PY" -c "import json;print(json.load(open('/tmp/launch_lib_info.json'))['launch_symbol'])")
echo "so=$SO"
echo "sym=$SYM"
[ -f "$SO" ] || { echo "missing $SO"; exit 1; }

echo "=== [2/3] compile linked C++ launcher (mini_acl link line) ==="
"$BISHENG" -xc++ -std=c++17 ./linked_launcher.cpp -o /tmp/linked_launcher \
  -I"$ASCEND_HOME_PATH/include" -I"$ASCEND_HOME_PATH/pkg_inc" \
  -L"$ASCEND_HOME_PATH/lib64" -L"$ASCEND_HOME_PATH/tools/simulator/dav_9201/lib" \
  -Wl,-rpath,"$ASCEND_HOME_PATH/tools/simulator/dav_9201/lib" \
  -Wl,--no-as-needed -lruntime_camodel -lascendcl -lplatform -lc_sec -ldl \
  -lpthread -lm -lstdc++ || { echo "COMPILE FAILED"; exit 1; }

echo "=== [3/3] run ==="
/tmp/linked_launcher "$SO" "$SYM"
echo "launcher exit=$?"
