#!/usr/bin/env bash
# ============================================================================
# run_cce.sh — Run CCE kernels (matched pairs only) on A6 simulator
#
# Only runs the 31 kernels that have matching VMI/DSL counterparts.
# This is the CCE half of the A6 CCE-vs-VMI comparison.
#
# Produces: ~/pto-vmi/logs/a6_cce_logs/<Kernel>.<case>/core0.veccore0.instr_log.dump
#
# Usage:
#   bash run_cce.sh                    # run all 31 matched kernels
#   bash run_cce.sh -c ActMinMaxClamp  # run one kernel
#   bash run_cce.sh --list             # list cases
#   bash run_cce.sh -v                 # verbose (show full sim output)
# ============================================================================

set -uo pipefail

# ── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
pass() { echo -e "  ${GREEN}✓${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; }
info() { echo -e "  ${CYAN}→${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
hdr()  { echo -e "\n${BOLD}${BLUE}=== $1 ===${NC}"; }

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${PTO_VMI_REPO:-$HOME/pto-vmi}"
CCE_DIR="${REPO_ROOT}/cce/a6"
LOG_ROOT="${LOG_ROOT:-${REPO_ROOT}/logs/a6_cce_logs}"
PER_CASE_TIMEOUT="${PER_CASE_TIMEOUT:-1800}"
A6_ARCH="dav-920r1-vec"

# ── Kernel list: single source of truth is kernels.txt (repo root) ─────────
# Only UNCOMMENTED kernels run. Currently validated: VcvtMergeModeKernel.
KERNELS_FILE="${KERNELS_FILE:-$SCRIPT_DIR/../kernels.txt}"
if [[ -f "$KERNELS_FILE" ]]; then
  mapfile -t KERNELS < <(grep -vE '^\s*(#|$)' "$KERNELS_FILE" | awk '{print $1}')
else
  KERNELS=(VcvtMergeModeKernel)
fi

# ── Parse args ──────────────────────────────────────────────────────────────
VERBOSE=0
KERNEL_FILTER=""
LIST_ONLY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    -v|--verbose) VERBOSE=1; shift ;;
    -c|--case) KERNEL_FILTER="$2"; shift 2;;
    -l|--list) LIST_ONLY=1; shift;;
    -h|--help)
      echo "Usage: bash run_cce.sh [-v] [-c KERNEL] [--list]"
      echo "  -v   Verbose: show full cmake+make+sim output"
      echo "  -c   Run only the specified kernel (substring match)"
      echo "  -l   List the 31 matched kernels and exit"
      echo ""
      echo "Only runs kernels with matching VMI/DSL counterparts (${#KERNELS[@]} kernels)."
      exit 0 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

# ── Auto-setup environment ──────────────────────────────────────────────────
if [[ -z "${SOC_VERSION:-}" || -z "${ASCEND_HOME_PATH:-}" ]]; then
  info "Environment not set — sourcing ../env.sh..."
  source "$SCRIPT_DIR/../env.sh" 2>/dev/null || {
    fail "Failed to source ../env.sh"
    exit 1
  }
fi
[[ -n "${SOC_VERSION:-}" ]] || { fail "SOC_VERSION not set"; exit 1; }
RUN_MODE="${RUN_MODE:-sim}"
NPU_ID="${NPU_ID:-0}"

# ── Discover case0 test for each kernel ─────────────────────────────────────
hdr "Discover matched CCE cases (${#KERNELS[@]} kernels)"

declare -a CASES=()
for kernel in "${KERNELS[@]}"; do
  main_cpp="${CCE_DIR}/${kernel}/main.cpp"
  [[ -f "$main_cpp" ]] || continue
  # Find case0_* tests only (case1+ are not in the matched suite)
  while IFS= read -r m; do
    cn="$(printf '%s' "${m}" | grep -oE 'case0_[A-Za-z0-9_]+')"
    [[ -n "${cn}" ]] && CASES+=("${CCE_DIR}/${kernel}|${cn}")
  done < <(grep -oE 'TEST_F\([A-Za-z0-9_]+, *case0_[A-Za-z0-9_]+\)' "$main_cpp" 2>/dev/null)
done

if [[ ${LIST_ONLY} -eq 1 ]]; then
  echo "Matched CCE cases (${#CASES[@]} total):"
  for entry in "${CASES[@]}"; do
    kdir="${entry%%|*}"; cn="${entry##*|}"
    printf '  %s.%s\n' "$(basename "$kdir")" "$cn"
  done
  exit 0
fi

if [[ ${#CASES[@]} -eq 0 ]]; then
  fail "No test cases found"
  exit 1
fi

TOTAL=${#CASES[@]}
info "Found $TOTAL test cases (matched pairs only)"
info "SOC=$SOC_VERSION  ARCH=$A6_ARCH  LOG_ROOT=$LOG_ROOT"

# ── Patch CMakeLists for A6 ─────────────────────────────────────────────────
hdr "Patch CMakeLists for A6"
PTO_ISA="${PTO_ISA_PATH:-$HOME/pto-isa/include}"
PATCHED=0
for kernel in "${KERNELS[@]}"; do
  cmakelists="${CCE_DIR}/${kernel}/CMakeLists.txt"
  [[ -f "$cmakelists" ]] || continue
  if ! grep -q "${A6_ARCH}" "$cmakelists" 2>/dev/null; then
    cp "$cmakelists" "${cmakelists}.a5bak"
    sed -i "s/dav-c310-vec/${A6_ARCH}/g" "$cmakelists"
    sed -i "s/dav-c310-cube/dav-920r1-cube/g" "$cmakelists"
    if [[ -d "$PTO_ISA/pto" ]] && ! grep -q "${PTO_ISA}" "$cmakelists" 2>/dev/null; then
      sed -i "s|\${ASCEND_HOME_PATH}/include|${PTO_ISA} \${ASCEND_HOME_PATH}/include|g" "$cmakelists"
    fi
    PATCHED=$((PATCHED + 1))
  fi
done
pass "Patched $PATCHED CMakeLists.txt files"

# ── Run each case ───────────────────────────────────────────────────────────
hdr "Run CCE kernels on A6 simulator"

mkdir -p "${LOG_ROOT}"
PASS=0; FAIL=0; FAILED_CASES=()
START_TIME=$SECONDS

echo ""
echo "  Running $TOTAL case(s)..."
echo "  ┌────────────────────────────────────────────────────────────────────┐"

for i in "${!CASES[@]}"; do
  entry="${CASES[$i]}"
  idx=$((i+1))
  kdir="${entry%%|*}"
  kernel_name="$(basename "$kdir")"
  case_name="${entry##*|}"
  case_id="${kernel_name}.${case_name}"

  # Apply filter
  if [[ -n "${KERNEL_FILTER}" && "${case_id}" != *"${KERNEL_FILTER}"* && "${kernel_name}" != *"${KERNEL_FILTER}"* ]]; then
    continue
  fi

  pct=$((idx*100/TOTAL))
  printf "  │ ${CYAN}[%d/%d]%3d%%${NC} %-40s " "$idx" "$TOTAL" "$pct" "$case_id"

  run_sh="${kdir}/run.sh"
  case_log_dir="${LOG_ROOT}/${case_id}"
  mkdir -p "$case_log_dir"
  case_log="${case_log_dir}/run.log"

  if [[ ! -f "$run_sh" ]]; then
    echo -e "${RED}SKIP${NC} (no run.sh)"
    FAIL=$((FAIL+1)); FAILED_CASES+=("${case_id} (no run.sh)")
    continue
  fi

  rc=0
  case_start=$SECONDS
  if [[ $VERBOSE -eq 1 ]]; then
    echo "│"
    (cd "$kdir" && timeout "$PER_CASE_TIMEOUT" bash "$run_sh" \
      -r "$RUN_MODE" -v "$SOC_VERSION" -n "$NPU_ID" -c "$case_name" 2>&1) | sed 's/^/  │   /'
    rc=${PIPESTATUS[0]}
  else
    # Redirect stderr to suppress bash's signal report (Aborted/Killed)
    { (cd "$kdir" && timeout "$PER_CASE_TIMEOUT" bash "$run_sh" \
      -r "$RUN_MODE" -v "$SOC_VERSION" -n "$NPU_ID" -c "$case_name") \
        > "$case_log" 2>&1; } 2>/dev/null
    rc=$?
  fi
  case_elapsed=$((SECONDS - case_start))

  # ── Collect dump files ───────────────────────────────────────────────────
  build_dir="${kdir}/build"
  dump_found=0

  for dump_path in \
    "${build_dir}/log_ca/core0.veccore0.instr_log.dump" \
    "${build_dir}/bin/camodel_log/core0.veccore0.instr_log.dump" \
    "${build_dir}/core0.veccore0.instr_log.dump" \
    "${build_dir}/log_ca/core0.vector_core0.instr_log.dump" \
    "${build_dir}/bin/camodel_log/core0.vector_core0.instr_log.dump"
  do
    if [[ -f "$dump_path" ]]; then
      cp -f "$dump_path" "${case_log_dir}/core0.veccore0.instr_log.dump" 2>/dev/null
      dump_found=1
      break
    fi
  done

  # Fallback: any *.instr_log.dump
  if [[ $dump_found -eq 0 ]]; then
    any_dump=$(find "$build_dir" -name "*.instr_log.dump" -type f 2>/dev/null | head -1)
    if [[ -n "$any_dump" ]]; then
      cp -f "$any_dump" "${case_log_dir}/core0.veccore0.instr_log.dump" 2>/dev/null
      dump_found=1
    fi
  fi

  # Extract vf_real
  instr_dump="${case_log_dir}/core0.veccore0.instr_log.dump"
  if [[ -f "$instr_dump" ]]; then
    vf_sum=$(grep -oE "vf_real_execute_time: [0-9]+" "$instr_dump" | awk '{sum += $2} END {print sum+0}')
    echo "$vf_sum" > "${case_log_dir}/vf_ticks.txt"
  else
    echo "0" > "${case_log_dir}/vf_ticks.txt"
  fi

  if [[ $rc -eq 124 ]]; then
    echo -e "${RED}TIMEOUT${NC} (${case_elapsed}s)"
    echo "FAIL (timeout ${case_elapsed}s)" > "${case_log_dir}/status"
    FAIL=$((FAIL+1)); FAILED_CASES+=("${case_id} (timeout)")
  elif [[ $rc -eq 0 && $dump_found -eq 1 ]]; then
    echo -e "${GREEN}PASS ✓${NC} ${case_elapsed}s"
    echo "PASS" > "${case_log_dir}/status"
    PASS=$((PASS+1))
  elif [[ $rc -eq 0 && $dump_found -eq 0 ]]; then
    echo -e "${YELLOW}PASS (no dump)${NC} ${case_elapsed}s"
    echo "PASS_NODUMP" > "${case_log_dir}/status"
    FAIL=$((FAIL+1)); FAILED_CASES+=("${case_id} (no dump)")
  else
    echo -e "${RED}FAIL ✗${NC} ${case_elapsed}s"
    if [[ $VERBOSE -eq 0 ]]; then
      err=$(grep -iE "error|fail|segfault|abort" "$case_log" 2>/dev/null | tail -1)
      [[ -n "$err" ]] && echo -e "  │     ${RED}Error:${NC} ${err:0:70}"
    fi
    echo "FAIL (exit=${rc})" > "${case_log_dir}/status"
    FAIL=$((FAIL+1)); FAILED_CASES+=("$case_id")
  fi

  rm -rf "$kdir/build"
done

ELAPSED=$((SECONDS - START_TIME))
echo "  └────────────────────────────────────────────────────────────────────┘"
echo ""

# ── Summary ────────────────────────────────────────────────────────────────
echo "  ╔════════════════════════════════════════════════════════════════════╗"
printf "  ║  ${BOLD}A6 CCE Run Summary${NC}                                           ║\n"
printf "  ║  Total: %-3d   ${GREEN}Passed: %-3d${NC}   ${RED}Failed: %-3d${NC}   Time: %ds%*s║\n" \
  "$TOTAL" "$PASS" "$FAIL" "$ELAPSED" $((14 - ${#ELAPSED})) ""
echo "  ╚════════════════════════════════════════════════════════════════════╝"

if [[ ${#FAILED_CASES[@]} -gt 0 ]]; then
  echo ""
  echo -e "  ${RED}Failed:${NC}"
  for fc in "${FAILED_CASES[@]}"; do echo "    ✗ $fc"; done
fi

# ── Restore CMakeLists ─────────────────────────────────────────────────────
hdr "Restore CMakeLists"
for kernel in "${KERNELS[@]}"; do
  cmakelists="${CCE_DIR}/${kernel}/CMakeLists.txt"
  [[ -f "${cmakelists}.a5bak" ]] && mv "${cmakelists}.a5bak" "$cmakelists"
done
pass "Restored to dav-c310-vec (A5)"

echo ""
if [[ $PASS -gt 0 ]]; then
  pass "Dumps collected at: $LOG_ROOT"
  info "Next: run VMI  →  bash $SCRIPT_DIR/run_vmi.sh"
  info "Then: build    →  bash $SCRIPT_DIR/../build_dashboard.sh --serve"
fi

[[ ${FAIL} -eq 0 ]]
