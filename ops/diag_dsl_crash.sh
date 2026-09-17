#!/usr/bin/env bash
# diag_dsl_crash.sh — bisect the dav_9201 DSL crash.
#
# Modes (DIAG_MODE env):
#   cleanrun (default) — FULL clean of camodel artifacts in the case dir, then run the
#                        real Vcvt DSL case. If a stale ub_*.xml / parameter_* was the
#                        trigger, this just PASSes.
#   marker            — FULL clean, then SetDevice-only in the case dir with the exact
#                        Vcvt imports (ml_dtypes + numpy + ptodsl + full _load_acl).
#   gdb               — full case under gdb `bt 60` (caller chain).
#
#   Run cleanrun/marker a few times: the camodel SoC build is multi-threaded
#   ("concurrency num: 64", 28 threads), so a race would be intermittent, not 10/10.
set -uo pipefail
source ~/vmi-dashboard/a6/a6_env.sh
CASE_DIR=~/pto-vmi/dsl/VcvtMergeModeKernel
CASE=VcvtMergeModeKernel_case0_bf16_fp8_128_128_w0.py
PY=~/.venv-ptoas/bin/python3
MODE="${DIAG_MODE:-cleanrun}"

clean() {
  cd "$CASE_DIR" || exit 1
  rm -rf log_ca log camodel_log \
    ub_case_config.xml ub_module_config.xml \
    parameter_0 parameter_1 parameter_2 parameter_3 parameter_base \
    parameter_IO_0 parameter_IO_1 parameter_IO_2 parameter_IO_3 \
    etc
  echo "[clean] removed camodel artifacts in $CASE_DIR"
}

if [ "$MODE" = "cleanrun" ]; then
  clean
  echo "=== cleanrun: full DSL case from a clean dir ==="
  cd "$CASE_DIR" || exit 1
  PTO_TARGET=a6 "$PY" "$CASE"
  echo "cleanrun exit=$?"
  echo "=== INTERPRETATION ==="
  echo "PASS / rc!=0 with a Python error -> stale camodel artifacts were the trigger."
  echo "139 SIGSEGV at ub_case_config.xml      -> still the camodel UB-parser crash."
  exit 0
fi

if [ "$MODE" = "marker" ]; then
  clean
  echo "=== marker: SetDevice-only, from the case dir (ml_dtypes+ptodsl+full _load_acl) ==="
  cd "$CASE_DIR" || exit 1
  "$PY" - <<'PY'
import ctypes, os
os.environ.setdefault("MSPROF_SIMULATOR_MODE", "1")
import numpy, ml_dtypes, ptodsl     # exactly what the Vcvt case imports
print("IMPORT-DONE", flush=True)
lib = ctypes.CDLL("libascendcl.so")
lib.aclInit.argtypes=[ctypes.c_char_p]; lib.aclInit.restype=ctypes.c_int
lib.aclrtSetDevice.argtypes=[ctypes.c_int]; lib.aclrtSetDevice.restype=ctypes.c_int
lib.aclrtResetDevice.argtypes=[ctypes.c_int]; lib.aclrtResetDevice.restype=ctypes.c_int
lib.aclrtCreateStream.argtypes=[ctypes.POINTER(ctypes.c_void_p)]; lib.aclrtCreateStream.restype=ctypes.c_int
lib.aclrtDestroyStream.argtypes=[ctypes.c_void_p]; lib.aclrtDestroyStream.restype=ctypes.c_int
lib.aclrtMalloc.argtypes=[ctypes.POINTER(ctypes.c_void_p), ctypes.c_size_t, ctypes.c_int]; lib.aclrtMalloc.restype=ctypes.c_int
lib.aclrtFree.argtypes=[ctypes.c_void_p]; lib.aclrtFree.restype=ctypes.c_int
lib.aclrtMemcpy.argtypes=[ctypes.c_void_p, ctypes.c_size_t, ctypes.c_void_p, ctypes.c_size_t, ctypes.c_int]; lib.aclrtMemcpy.restype=ctypes.c_int
lib.aclrtSynchronizeStream.argtypes=[ctypes.c_void_p]; lib.aclrtSynchronizeStream.restype=ctypes.c_int
print("aclInit=%d" % lib.aclInit(None), flush=True)
print("SETDEVICE-CALLING", flush=True)
rc = lib.aclrtSetDevice(0)
print("SETDEVICE-DONE rc=%d" % rc, flush=True)
os._exit(0)
PY
  echo "=== ub_case_config.xml (head) ==="
  head -40 ub_case_config.xml 2>/dev/null || echo "(no ub_case_config.xml)"
  exit 0
fi

if [ "$MODE" = "marker_gen" ]; then
  clean
  echo "=== marker_gen: _gen() BEFORE SetDevice (heap-layout hypothesis) ==="
  cd "$CASE_DIR" || exit 1
  "$PY" - <<'PY'
import ctypes, os, importlib.util
os.environ.setdefault("MSPROF_SIMULATOR_MODE", "1")
CASE = os.path.expanduser("~/pto-vmi/dsl/VcvtMergeModeKernel/VcvtMergeModeKernel_case0_bf16_fp8_128_128_w0.py")
spec = importlib.util.spec_from_file_location("vcvt_case", CASE)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)   # defines kernel/_gen/reference/_load_acl; run_case_acl skipped
print("GEN-CALLING", flush=True)
x_u16, s_u16 = m._gen()       # the numpy work the real case does BEFORE SetDevice
print("GEN-DONE", flush=True)
lib = m._load_acl()
print("aclInit=%d" % lib.aclInit(None), flush=True)
print("SETDEVICE-CALLING", flush=True)
rc = lib.aclrtSetDevice(0)
print("SETDEVICE-DONE rc=%d" % rc, flush=True)
os._exit(0)
PY
  echo "=== INTERPRETATION ==="
  echo "crashes at SETDEVICE  -> importing the case module (pto/@pto.jit machinery) before"
  echo "                         SetDevice trips the camodel UB-parser heap corruption."
  echo "                         => workaround: SetDevice BEFORE 'from ptodsl import pto'."
  echo "SETDEVICE-DONE rc=0   -> pto machinery is NOT the trigger; look elsewhere."
  exit 0
fi

echo "=== gdb mode: full Vcvt case, bt 60 ==="
cd "$CASE_DIR" || exit 1
rm -rf log_ca log camodel_log ub_case_config.xml parameter_IO_3 ~/.cache/ptodsl
PTO_TARGET=a6 gdb -batch \
  -ex run \
  -ex 'bt 60' \
  --args "$PY" "$CASE" \
  > /tmp/diag_bt.txt 2>&1

echo "=== VERDICT ==="
if grep -q 'aclrtLaunchKernel' /tmp/diag_bt.txt; then
  echo "CRASH AT/BELOW aclrtLaunchKernel -> KERNEL-SPECIFIC (compiler-side UB workaround possible)"
elif grep -q 'aclrtSetDevice' /tmp/diag_bt.txt; then
  echo "CRASH AT/BELOW aclrtSetDevice     -> SoC INIT (kernel-independent; config/race, not PTOAS)"
else
  echo "neither symbol found; inspect /tmp/diag_bt.txt"
fi
echo "=== relevant frames ==="
grep -nE 'aclrtSetDevice|aclrtLaunchKernel|aclrtResetDevice|aclInit|startModel|EslTop|SoC|ub_top|load_macro|pre_treat|TmSim|SIGSEGV' /tmp/diag_bt.txt | tail -80
echo "(full log: /tmp/diag_bt.txt)"
