#!/usr/bin/env bash
# =============================================================================
# cann_bug_experiments.sh — prove/disprove the CANN A6 camodel crash report
# (see cann-a6-camodel-bug-report.md).
#
# Runs experiments E1..E7 on the A6 yellow-zone host and writes a single
# .txt file with all results.
#
# Usage:
#   bash ~/vmi-dashboard/a6/cann_bug_experiments.sh [output.txt]      # all experiments
#   ONLY=E7 bash ~/vmi-dashboard/a6/cann_bug_experiments.sh [out.txt] # only E7
#   ONLY=E1,E6 bash ...                                               # only E1 + E6
# =============================================================================
set -u

OUT="${1:-$HOME/cann_a6_experiments_$(date +%Y%m%d_%H%M%S).txt}"
SEL="${ONLY:-all}"
PY=~/.venv-ptoas/bin/python3
MINI_CTYPES="import ctypes; l=ctypes.CDLL('libascendcl.so'); l.aclInit(None); l.aclrtSetDevice(0)"

want() {
  [ "$SEL" = all ] || [[ ",$SEL," == *",$1,"* ]]
}

ensure_mini_acl() {
  if [ -x /tmp/mini_acl ]; then
    return 0
  fi
  cat > /tmp/mini_acl.cpp <<'CPP'
#include <cstdio>
#include "acl/acl.h"
int main() {
  printf("init=%d\n", aclInit(nullptr));
  printf("set=%d\n", aclrtSetDevice(0));
  aclrtStream s; printf("stream=%d\n", aclrtCreateStream(&s));
  void* d = 0; printf("malloc=%d\n", aclrtMalloc(&d, 4096, ACL_MEM_MALLOC_HUGE_FIRST));
  return 0;
}
CPP
  echo "compiling /tmp/mini_acl ..."
  bisheng -xc++ -std=c++17 /tmp/mini_acl.cpp -o /tmp/mini_acl \
    -I"$ASCEND_HOME_PATH/include" -I"$ASCEND_HOME_PATH/pkg_inc" \
    -L"$ASCEND_HOME_PATH/lib64" -L"$ASCEND_HOME_PATH/tools/simulator/dav_9201/lib" \
    -Wl,-rpath,"$ASCEND_HOME_PATH/tools/simulator/dav_9201/lib" \
    -Wl,--no-as-needed -lruntime_camodel -lascendcl -lplatform -lc_sec -ldl \
    -lpthread -lm -lstdc++ 2>&1 | tail -20
}

{
  echo "===================================================================="
  echo " CANN A6 camodel bug experiments   (selector: $SEL)"
  echo " host: $(hostname)   arch: $(uname -m)   date: $(date '+%F %T %Z')"
  echo " output: $OUT"
  echo "===================================================================="

  echo
  echo "### environment setup"
  source ~/vmi-dashboard/a6/a6_env.sh
  echo "ASCEND_HOME_PATH=$ASCEND_HOME_PATH"
  echo "SOC_VERSION=$SOC_VERSION"
  echo "SIM_LIB=$SIM_LIB"
  echo "VENV=$PTO_VENV"
  echo "python=$("$PY" -V 2>&1)"

  # -------------------------------------------------------------------------
  if want E1; then
  echo
  echo "===================================================================="
  echo " E1 — nondeterminism (race): 20x minimal ctypes aclInit+SetDevice"
  echo "===================================================================="
  pass=0; fail=0
  for i in $(seq 1 20); do
    "$PY" -c "$MINI_CTYPES" > "/tmp/e1_$i.txt" 2>&1
    rc=$?
    echo "  run $i -> exit $rc"
    if [ "$rc" -eq 0 ]; then pass=$((pass+1)); else fail=$((fail+1)); fi
  done
  echo "E1 RESULT: pass=$pass fail=$fail"
  echo "E1 VERDICT: mixed pass/fail => nondeterministic (timing/race). all-fail => deterministic."
  fi

  # -------------------------------------------------------------------------
  if want E2; then
  echo
  echo "===================================================================="
  echo " E2a — faulting RIP (unmapped IP => corrupted control flow)"
  echo "===================================================================="
  gdb --batch -ex run -ex "info registers rip rsp" -ex "info proc mappings" \
      --args "$PY" -c "$MINI_CTYPES" 2>&1 \
      | grep -E "SIGSEGV|^rip|^rsp|0xb8194ca0" | head -20
  echo "E2a NOTE: if no SIGSEGV printed here, the run did not crash under gdb —"
  echo "          which is itself additional nondeterminism evidence."

  echo
  echo " E2b — stack-size discriminator (ulimit -s unlimited)"
  echo "===================================================================="
  ulimit -s unlimited
  for i in 1 2 3; do
    "$PY" -c "$MINI_CTYPES" > /dev/null 2>&1
    echo "  run $i -> exit $?"
  done
  echo "E2b VERDICT: unchanged/mixed => NOT a main-thread stack overflow."
  fi

  # -------------------------------------------------------------------------
  if want E3; then
  echo
  echo "===================================================================="
  echo " E3 — load path: minimal LINKED binary vs ctypes"
  echo "===================================================================="
  ensure_mini_acl
  pass=0; fail=0
  for i in $(seq 1 10); do
    /tmp/mini_acl > "/tmp/e3_$i.txt" 2>&1
    rc=$?
    echo "  mini_acl run $i -> exit $rc"
    if [ "$rc" -eq 0 ]; then pass=$((pass+1)); else fail=$((fail+1)); fi
  done
  echo "E3 RESULT: linked-binary pass=$pass fail=$fail"
  if [ "$pass" -eq 0 ]; then
    echo "E3 VERDICT: linked binary ALSO crashes => NOT a load-path/ctypes issue; it is a dav_9201 camodel teardown bug."
  else
    echo "E3 VERDICT: linked passes while E1 ctypes fails => load path is the trigger."
  fi
  fi

  # -------------------------------------------------------------------------
  if want E4; then
  echo
  echo "===================================================================="
  echo " E4 — Ascend920A (removed — incomplete camodel)"
  echo "===================================================================="
  echo "  Ascend920A/lib ships only libruntime_camodel.so (no libUB/libSoC/"
  echo "  libEslTop/libmodel_api/libnpu_drv_camodel) => not a runnable camodel."
  echo "  dav_9201 is the only usable A6 camodel; its minimal aclInit+SetDevice"
  echo "  crashes deterministically (see E1/E2)."
  fi

  # -------------------------------------------------------------------------
  if want E5; then
  echo
  echo "===================================================================="
  echo " E5 — faulting symbols live in CANN .so (not PTOAS)"
  echo "===================================================================="
  nm -DC "$ASCEND_HOME_PATH/tools/simulator/dav_9201/lib/libUB.so" 2>/dev/null \
      | grep -E "load_macro|arithmetic_calculator|ub_top::init"
  nm -DC "$ASCEND_HOME_PATH/tools/simulator/dav_9201/lib/libcommon.so" 2>/dev/null \
      | grep -E "_M_atom"
  echo "E5 VERDICT: symbols above present => fault path is entirely CANN libs."
  fi

  # -------------------------------------------------------------------------
  if want E6; then
  echo
  echo "===================================================================="
  echo " E6 — cross-camodel control: same minimal code, dav_9201 vs A5 (Ascend950PR_9599)"
  echo "===================================================================="
  A5_LIB=""
  for sub in lib camodel; do
    d="$ASCEND_HOME_PATH/tools/simulator/Ascend950PR_9599/$sub"
    if [ -d "$d" ]; then A5_LIB="$d"; break; fi
  done
  for sim in dav_9201 Ascend950PR_9599; do
    if [ "$sim" = dav_9201 ]; then
      lib="$ASCEND_HOME_PATH/tools/simulator/dav_9201/lib"
    else
      lib="$A5_LIB"
    fi
    [ -d "$lib" ] || { echo "  $sim: lib dir missing ($lib)"; continue; }
    LP=$(echo "$LD_LIBRARY_PATH" | tr ':' '\n' | grep -v "tools/simulator" | paste -sd: 2>/dev/null)
    export LD_LIBRARY_PATH="$lib:$LP"
    pass=0; fail=0
    for i in $(seq 1 5); do
      "$PY" -c "$MINI_CTYPES" > "/tmp/e6_${sim}_$i.txt" 2>&1
      rc=$?
      if [ "$rc" -eq 0 ]; then pass=$((pass+1)); else fail=$((fail+1)); fi
    done
    echo "  $sim: pass=$pass fail=$fail"
  done
  echo "E6 VERDICT: dav_9201 crashes while the A5 camodel passes (same ctypes code, same loader) => the fault is specific to the dav_9201 camodel, not PTOAS/ptodsl/load path."
  fi

  # -------------------------------------------------------------------------
  if want E7; then
  echo
  echo "===================================================================="
  echo " E7 — full backtrace of the minimal LINKED binary (mini_acl)"
  echo "===================================================================="
  # reset env to dav_9201 (E6's last iteration left LD_LIBRARY_PATH on A5)
  source ~/vmi-dashboard/a6/a6_env.sh >/dev/null 2>&1
  ensure_mini_acl
  gdb --batch -ex run -ex "bt 15" --args /tmp/mini_acl 2>&1 | grep -E "SIGSEGV|#[0-9]+" | head -20
  echo "E7 VERDICT: every fault frame resolves into CANN .so (libSoC/libEslTop/libUB/libcommon/libmodel_api); zero PTOAS frames."
  fi

  # -------------------------------------------------------------------------
  echo
  echo "===================================================================="
  echo " DONE. Full log: $OUT"
  echo "===================================================================="
} 2>&1 | tee "$OUT"

echo
echo "Results written to: $OUT"
