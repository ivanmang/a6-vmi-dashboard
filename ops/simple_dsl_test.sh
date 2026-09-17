#!/usr/bin/env bash
# =============================================================================
# simple_dsl_test.sh — run the simplest DSL cases on the A6 camodel (dav_9201)
# and report whether ANY of them can pass.
#
# Outputs a single .txt file (see OUT). Run on the A6 yellow-zone host:
#   bash ~/vmi-dashboard/a6/simple_dsl_test.sh [output.txt]
# =============================================================================
set -u

OUT="${1:-$HOME/simple_dsl_a6_$(date +%Y%m%d_%H%M%S).txt}"
PY=~/.venv-ptoas/bin/python3
REPO=~/pto-vmi

# kernel:case_file  (the two super-simple smoke cases only)
CASES=(
  "SimpleCopyKernel:SimpleCopyKernel_case0_f32_64.py"
  "SimpleSquareKernel:SimpleSquareKernel_case0_f32_64.py"
)

run_case() {
  local kernel="$1" fname="$2"
  source ~/vmi-dashboard/a6/a6_env.sh >/dev/null 2>&1   # dav_9201 camodel env

  cd "$REPO/dsl/$kernel" || { echo "  [skip] missing $REPO/dsl/$kernel"; return 1; }
  sed -i 's/target="a5"/target="a6"/' "$fname" 2>/dev/null

  rm -rf log_ca log camodel_log ub_case_config.xml parameter_IO_3 ~/.cache/ptodsl
  PTO_TARGET=a6 "$PY" "$fname" > "/tmp/dsl_${kernel}.txt" 2>&1
  local rc=$?

  local passline
  passline=$(grep -m1 -oE "PASS [A-Za-z0-9_]+" "/tmp/dsl_${kernel}.txt" 2>/dev/null | head -1)
  echo "  ${kernel} -> exit ${rc}   ${passline:-<no PASS>}"
  if [ "$rc" -ne 0 ]; then
    grep -m1 -E "Segmentation|ub_case_config|TmSim::reset|mismatch|AssertionError|aclInit|ModuleNotFound" \
      "/tmp/dsl_${kernel}.txt" 2>/dev/null | head -1
  fi
}

{
  echo "===================================================================="
  echo " Simple DSL A6 smoke test (dav_9201 camodel)"
  echo " host: $(hostname)   date: $(date '+%F %T %Z')"
  echo " output: $OUT"
  echo "===================================================================="
  source ~/vmi-dashboard/a6/a6_env.sh
  echo "ASCEND_HOME_PATH=$ASCEND_HOME_PATH"
  echo "python=$("$PY" -V 2>&1)"
  echo "cases: ${#CASES[@]}"

  for entry in "${CASES[@]}"; do
    kernel="${entry%%:*}"; fname="${entry#*:}"
    echo
    echo "---- case: ${kernel} ----"
    run_case "$kernel" "$fname"
  done

  echo
  echo "===================================================================="
  echo " SUMMARY"
  echo "===================================================================="
  for entry in "${CASES[@]}"; do
    kernel="${entry%%:*}"
    f="/tmp/dsl_${kernel}.txt"
    if [ -f "$f" ]; then
      p=$(grep -m1 -oE "PASS [A-Za-z0-9_]+" "$f" 2>/dev/null | head -1)
      echo "  ${kernel}: ${p:-NO PASS}"
    fi
  done

  echo
  echo "---- restore tested .py files (undo target=a6 sed) ----"
  for entry in "${CASES[@]}"; do
    kernel="${entry%%:*}"; fname="${entry#*:}"
    git -C "$REPO" checkout -- "dsl/$kernel/$fname" 2>/dev/null \
      && echo "  reverted dsl/$kernel/$fname"
  done

  echo
  echo "DONE. Full log: $OUT"
} 2>&1 | tee "$OUT"

echo
echo "Results written to: $OUT"