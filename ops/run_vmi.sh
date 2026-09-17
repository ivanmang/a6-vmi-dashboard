#!/usr/bin/env bash
# ============================================================================
# run_vmi.sh — Run VMI/DSL kernels on the A6 simulator (yellow-zone)
#
# Phase 1: dynamic discovery. By default runs ALL runnable VMI/DSL kernels in
# ~/pto-vmi/dsl/ (one case0/real file per kernel → kernel-only log dirs, which
# is what cce_vmi_ca_report.py expects). Use --matched to run only the subset
# that has CCE counterparts (the legacy 31).
#
# Produces: ~/pto-vmi/logs/a6_vmi_logs/<Kernel>/core0.veccore0.instr_log.dump
#           ~/pto-vmi/logs/a6_vmi_logs/_manifest.tsv   (per-case triage table)
#
# Usage:
#   bash run_vmi.sh                       # run ALL ~153 kernels (default)
#   bash run_vmi.sh --matched            # run only the 31 matched kernels
#   bash run_vmi.sh -c ActMinMaxClamp    # run one kernel (substring match)
#   bash run_vmi.sh --list               # list discovered cases and exit
#   bash run_vmi.sh --list --matched     # list the 31 matched only
#   bash run_vmi.sh -v                   # verbose (show full sim output)
#   bash run_vmi.sh --resume             # skip cases already PASS (restart safely)
#   bash run_vmi.sh --retry-failed       # re-run only non-PASS cases (after a patch)
#
# Resilience for long runs (153 cases × ~30s ≈ 75min+):
#   nohup bash run_vmi.sh --all --resume > a6_vmi_all.log 2>&1 &
#   # or: tmux new -s a6vmi 'bash run_vmi.sh --all --resume'
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
DSL_DIR="${REPO_ROOT}/dsl"
LOG_ROOT="${LOG_ROOT:-${REPO_ROOT}/logs/a6_vmi_logs}"
MANIFEST="${LOG_ROOT}/_manifest.tsv"
PER_CASE_TIMEOUT="${PER_CASE_TIMEOUT:-600}"

# ── Kernel list: single source of truth is kernels.txt (repo root) ─────────
# Used when --matched is passed. Only UNCOMMENTED kernels run.
KERNELS_FILE="${KERNELS_FILE:-$SCRIPT_DIR/../kernels.txt}"
if [[ -f "$KERNELS_FILE" ]]; then
  mapfile -t MATCHED_KERNELS < <(grep -vE '^\s*(#|$)' "$KERNELS_FILE" | awk '{print $1}')
else
  MATCHED_KERNELS=(VcvtMergeModeKernel)
fi

# ── Parse args ──────────────────────────────────────────────────────────────
VERBOSE=0
KERNEL_FILTER=""
LIST_ONLY=0
DISCOVER_MODE="matched"    # "matched" (kernels.txt) [default], "demo", or "all"
SKIP_PASS=0             # set by --resume / --retry-failed
SKIP_LABEL=""           # messaging only
while [[ $# -gt 0 ]]; do
  case "$1" in
    -v|--verbose) VERBOSE=1; shift ;;
    -c|--case) KERNEL_FILTER="$2"; shift 2;;
    -l|--list) LIST_ONLY=1; shift;;
    --all)     DISCOVER_MODE="all"; shift;;
    --matched) DISCOVER_MODE="matched"; shift;;
    --demo)    DISCOVER_MODE="demo"; shift;;
    --resume)        SKIP_PASS=1; SKIP_LABEL="resume"; shift;;
    --retry-failed)  SKIP_PASS=1; SKIP_LABEL="retry-failed"; shift;;
    -h|--help)
      echo "Usage: bash run_vmi.sh [--demo|--all|--matched] [-v] [-c KERNEL] [--list] [--resume|--retry-failed]"
      echo ""
      echo "  --demo         Run ONLY the ~52 demo kernels (docs/demo_kernels.md) [DEFAULT]"
      echo "  --all          Run ALL runnable VMI/DSL kernels (~157)"
      echo "  --matched      Run the 31 legacy matched kernels (CCE counterparts)"
      echo "  -v             Verbose: show full sim output"
      echo "  -c KERNEL      Run only the specified kernel (substring match)"
      echo "  -l, --list     List discovered cases and exit"
      echo "  --resume       Skip cases already marked PASS (restart an interrupted run)"
      echo "  --retry-failed Re-run only non-PASS cases (after extending A6 patches)"
      echo ""
      echo "Log root : $LOG_ROOT"
      echo "Manifest : $MANIFEST"
      exit 0 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

# ── Discover VMI case files ─────────────────────────────────────────────────
# One case per kernel (first <Kernel>_case0_*.py, else first <Kernel>_real_*.py),
# sorted. Kernel-only log dir names keep cce_vmi_ca_report.py matching working
# (it joins VMI cases by kernel name, not case_id). Multi-variant kernels use
# their first case0 — same convention as the A5 run_dashboard_refresh.sh.
declare -a CASES=()
declare -a PATCH_FILES=()   # py paths to target="a5"→"a6" patch + restore

discover_one_kernel() {
  # $1 = kernel name. Echoes the chosen py path (empty if none).
  local kernel="$1" dsl_dir="${DSL_DIR}/$1" py=""
  [[ -d "$dsl_dir" ]] || return 0
  py=$(find "$dsl_dir" -maxdepth 1 -type f \
        \( -name "${kernel}_case0_*.py" -o -name "${kernel}_real_*.py" \) \
        2>/dev/null | sort | head -1)
  echo "$py"
}

if [[ "$DISCOVER_MODE" == "matched" ]]; then
  hdr "Discover matched VMI cases (${#MATCHED_KERNELS[@]} kernels)"
  for kernel in "${MATCHED_KERNELS[@]}"; do
    py="$(discover_one_kernel "$kernel")"
    [[ -n "$py" ]] || { warn "no case file for matched kernel: $kernel"; continue; }
    CASES+=("${kernel}|${py}")
    PATCH_FILES+=("$py")
  done
elif [[ "$DISCOVER_MODE" == "demo" ]]; then
  hdr "Discover demo VMI cases (~52 kernels from docs/demo_kernels.md)"
  # Source of truth: ~/pto-vmi/docs/demo_kernels.md. Parse the indented bullet
  # block (lines starting with a tab or 1+ spaces then an uppercase letter),
  # filter out non-kernel prose. Falls back to a hardcoded list if the doc is
  # absent (keeps the script self-contained / testable without pto-vmi).
  DEMO_DOC="${REPO_ROOT:-$HOME/pto-vmi}/docs/demo_kernels.md"
  if [[ -f "$DEMO_DOC" ]]; then
    # Parse the indented bullet block: lines starting with whitespace then a
    # kernel name (starts upper OR lower — some kernels are lowercase, e.g.
    # clippedSwigluKernel, confusionSoftmaxGradArKernel), ending in a known
    # suffix (Kernel/In/Nz/MxNz) or whitespace.
    mapfile -t DEMO_KERNELS < <(awk '/^[[:space:]]+[A-Za-z][A-Za-z0-9_]*(Kernel|In|Nz|MxNz)?[[:space:]]*$/ {gsub(/^[[:space:]]+|[[:space:]]+$/,""); print}' "$DEMO_DOC" | sort -u)
  fi
  if [[ ${#DEMO_KERNELS[@]} -eq 0 ]]; then
    DEMO_KERNELS=(
      AmaxPerBlockKernel AntiMxQuantDequantKernel AntiQuantComputeNKMxNz
      AntiQuantPerChannelKernel AntiquantVFImplW8D64Kernel B2ToB1CastKernel
      B4ToB1CastKernel B4ToB2CastKernel Bf16ToF32Cast128In Bf16ToFp32Cast64In
      CastNd2nzKernel ComputeGeluTanhKernel CrossEntropyLossFullLoadKernel
      DintlvCmpHistVfKernel DynamicBlockMxQuantGatherVfKernel ExpertTokenHistVfKernel
      FaDnSoftmaxMxfp8NotInitKernel FaDnSoftmaxNotInitKernel FaNdSoftmaxNotInitKernel
      FakeQuantMinMaxArgsKernel Fp32ToFp16Cast128In Fp32ToFp8Cast256In
      GatherV2LoadIndicesVfKernel GeluDynamicQuantWorkspaceKernel
      GroupNormSwishGradUnalignVfKernel KFanoutVaddKernel MergeModeKernel
      PintlvMaskKernel QuantBf16toMXFp4Kernel QuantBf16toMXFp8CeilKernel
      QuantBf16toMXFp8Kernel QuantBf16toNVFp4Kernel QuantFP32toMXFp4Kernel
      QuantFP32toMXFp8CeilKernel QuantFP32toMXFp8Kernel QuantFP32toNVFp4Kernel
      QuantMaxVfKernel RowExpandMulKernel RowMaxKernel RowReduceSumKernel
      S8ToS32Cast256In S8ToS32Cast64In SigmoidGradKernel SigmoidHalfKernel
      SiluGradKernel SoftmaxGradKernel SwishHalfKernel VFProcessSwigluVfKernel
      VFSwiGluKernel VcvtMergeModeKernel clippedSwigluKernel confusionSoftmaxGradArKernel
    )
  fi
  for kernel in "${DEMO_KERNELS[@]}"; do
    py="$(discover_one_kernel "$kernel")"
    [[ -n "$py" ]] || { warn "no case file for demo kernel: $kernel"; continue; }
    CASES+=("${kernel}|${py}")
    PATCH_FILES+=("$py")
  done
else
  hdr "Discover ALL VMI cases (every kernel under $DSL_DIR)"
  shopt -s nullglob
  for d in "$DSL_DIR"/*/; do
    [[ -d "$d" ]] || continue
    kernel="$(basename "$d")"
    py="$(discover_one_kernel "$kernel")"
    [[ -n "$py" ]] || continue
    CASES+=("${kernel}|${py}")
    PATCH_FILES+=("$py")
  done
  shopt -u nullglob
fi

if [[ ${LIST_ONLY} -eq 1 ]]; then
  echo "Discovered VMI cases (${#CASES[@]} total, mode=$DISCOVER_MODE):"
  for entry in "${CASES[@]}"; do
    kernel="${entry%%|*}"; py="${entry##*|}"
    st=""
    if [[ -f "${LOG_ROOT}/${kernel}/status" ]]; then
      st="  [$(cat "${LOG_ROOT}/${kernel}/status" 2>/dev/null)]"
    fi
    printf '  %-42s → %s%s\n' "$kernel" "$(basename "$py")" "$st"
  done
  echo ""
  echo "  Total: ${#CASES[@]} case(s)"
  exit 0
fi

if [[ ${#CASES[@]} -eq 0 ]]; then
  fail "No VMI case files found under $DSL_DIR"
  echo "  Expected: dsl/<Kernel>/<Kernel>_case0_*.py or <Kernel>_real_*.py"
  [[ "$DISCOVER_MODE" == "matched" ]] && echo "  (matched mode — check MATCHED_KERNELS list / repo path)"
  exit 1
fi

# ── Auto-setup environment (only needed to actually RUN, not to list) ───────
if [[ -z "${SOC_VERSION:-}" || -z "${ASCEND_HOME_PATH:-}" ]]; then
  info "Environment not set — sourcing ../env.sh..."
  source "$SCRIPT_DIR/../env.sh" 2>/dev/null || {
    fail "Failed to source ../env.sh"
    exit 1
  }
fi
[[ -n "${SOC_VERSION:-}" ]] || { fail "SOC_VERSION not set"; exit 1; }

# ── Verify ptoas is available ──────────────────────────────────────────────
if ! command -v ptoas &>/dev/null; then
  fail "ptoas not found in PATH"
  echo "  VMI/DSL requires ptoas. Install it in a venv:"
  echo "    python3 -m venv ~/.venv-ptoas310"
  echo "    source ~/.venv-ptoas310/bin/activate"
  echo "    pip install ~/ptoas-0.59-cp310-cp310-manylinux_2_34_x86_64_a6patched.whl ptodsl"
  echo ""
  echo "  Then apply the A6 patches and source ../env.sh to pick up the venv:"
  echo "    python3 $SCRIPT_DIR/patch_ptoas_a6.py"
  echo "    source $SCRIPT_DIR/../env.sh"
  exit 1
fi

TOTAL=${#CASES[@]}
info "Found $TOTAL VMI case(s) (mode=$DISCOVER_MODE)"
info "SOC=$SOC_VERSION  LOG_ROOT=$LOG_ROOT"
[[ $SKIP_PASS -eq 1 ]] && info "Skip mode: $SKIP_LABEL — cases already PASS are skipped"

# ── Patch VMI Python files: target="a5" → target="a6" ─────────────────────
# When -c KERNEL is given, only the filtered case actually runs — so only patch
# that file (not all 50). The run loop applies the same KERNEL_FILTER match.
hdr "Patch VMI target for A6"
PATCHED=0
for py in "${PATCH_FILES[@]}"; do
  [[ -f "$py" ]] || continue
  # Scope to the filter: only patch files that will actually run.
  if [[ -n "${KERNEL_FILTER}" ]]; then
    bn="$(basename "$py" .py)"
    dir_k="$(basename "$(dirname "$py")")"
    [[ "$dir_k" == *"${KERNEL_FILTER}"* || "$bn" == *"${KERNEL_FILTER}"* ]] || continue
  fi
  if grep -q 'target="a5"' "$py" 2>/dev/null; then
    if [[ ! -f "${py}.a5bak" ]]; then
      cp "$py" "${py}.a5bak"
    fi
    sed -i 's/target="a5"/target="a6"/g' "$py"
    PATCHED=$((PATCHED + 1))
  fi
done
if [[ $PATCHED -gt 0 ]]; then
  pass "Patched $PATCHED VMI file(s): target=\"a5\" → target=\"a6\"${KERNEL_FILTER:+ (scoped to -c $KERNEL_FILTER)}"
else
  warn "No files needed patching (already target=\"a6\" or no a5 found)"
fi

# ── Verify ptoas supports a6 ────────────────────────────────────────────────
if ptoas --help 2>&1 | grep -q "pto-arch=<a2|a3|a5|a6>"; then
  pass "ptoas supports --pto-arch=a6"
else
  warn "ptoas may not support a6 — check: ptoas --help | grep pto-arch"
  echo "  If not, install the A6-capable whl + run patch_ptoas_a6.py:"
  echo "    pip install --force-reinstall ~/ptoas-0.59-cp310-cp310-manylinux_2_34_x86_64_a6patched.whl"
  echo "    python3 $SCRIPT_DIR/patch_ptoas_a6.py"
fi

# ── Run each VMI case ───────────────────────────────────────────────────────
hdr "Run VMI/DSL kernels on A6 simulator"

mkdir -p "$LOG_ROOT"
# (Re)initialize the manifest — per-case triage table for Phase 2 / --retry-failed
printf 'kernel\tcase\tstatus\tdump_bytes\telapsed_s\terror\n' > "$MANIFEST"

PASS=0; FAIL=0; SKIP=0; FAILED_CASES=()
START_TIME=$SECONDS

echo ""
echo "  Running $TOTAL case(s)..."
echo "  ┌────────────────────────────────────────────────────────────────────┐"

for i in "${!CASES[@]}"; do
  entry="${CASES[$i]}"
  idx=$((i+1))
  kernel="${entry%%|*}"
  py_path="${entry##*|}"
  case_name="$(basename "$py_path" .py)"

  if [[ -n "${KERNEL_FILTER}" && "$kernel" != *"${KERNEL_FILTER}"* && "$case_name" != *"${KERNEL_FILTER}"* ]]; then
    continue
  fi

  pct=$((idx*100/TOTAL))
  printf "  │ ${CYAN}[%d/%d]%3d%%${NC} %-40s " "$idx" "$TOTAL" "$pct" "$case_name"

  case_log_dir="${LOG_ROOT}/${kernel}"
  mkdir -p "$case_log_dir"
  case_log="${case_log_dir}/run.log"

  # ── Resume / retry-failed: skip cases already PASS ───────────────────────
  if [[ $SKIP_PASS -eq 1 && -f "${case_log_dir}/status" ]]; then
    prior_status="$(cat "${case_log_dir}/status" 2>/dev/null)"
    if [[ "$prior_status" == "PASS" ]]; then
      # Reuse the existing dump + manifest row; count as skip
      dump_size=0
      [[ -f "${case_log_dir}/core0.veccore0.instr_log.dump" ]] && \
        dump_size=$(stat -c%s "${case_log_dir}/core0.veccore0.instr_log.dump" 2>/dev/null || echo 0)
      echo -e "${GREEN}SKIP${NC} (already PASS, ${dump_size}B)"
      printf '%s\t%s\t%s\t%d\t0\t\n' "$kernel" "$case_name" "SKIP_PASS" "$dump_size" >> "$MANIFEST"
      SKIP=$((SKIP+1))
      PASS=$((PASS+1))
      continue
    fi
  fi

  rc=0
  case_start=$SECONDS
  if [[ $VERBOSE -eq 1 ]]; then
    echo "│"
    (cd "$case_log_dir" && timeout "$PER_CASE_TIMEOUT" python3 "$py_path" 2>&1) | sed 's/^/  │   /'
    rc=${PIPESTATUS[0]}
  else
    # Redirect stderr to /dev/null to suppress bash's "Aborted" signal report
    # (camodel crashes at cleanup AFTER producing the dump — this is expected)
    { (cd "$case_log_dir" && timeout "$PER_CASE_TIMEOUT" python3 "$py_path") > "$case_log" 2>&1; } 2>/dev/null
    rc=$?
  fi
  case_elapsed=$((SECONDS - case_start))

  # ── Collect dump files ───────────────────────────────────────────────────
  dump_found=0

  # A6 camodel writes dumps to log_ca/ subdirectory
  # Check log_ca/ first (has real data), then CWD (might be empty)
  for dump_path in \
    "${case_log_dir}/log_ca/core0.veccore0.instr_log.dump" \
    "${case_log_dir}/core0.veccore0.instr_log.dump" \
    "${case_log_dir}/core0.vector_core0.instr_log.dump"
  do
    if [[ -f "$dump_path" ]] && [[ -s "$dump_path" ]]; then
      # Found a non-empty dump — copy/normalize
      cp -f "$dump_path" "${case_log_dir}/core0.veccore0.instr_log.dump"
      dump_found=1
      break
    fi
  done

  # Fallback: any non-empty *.instr_log.dump (searches log_ca/ too)
  if [[ $dump_found -eq 0 ]]; then
    any_dump=$(find "$case_log_dir" -name "core0.veccore0.instr_log.dump" -type f -size +0 2>/dev/null | head -1)
    if [[ -n "$any_dump" ]]; then
      cp -f "$any_dump" "${case_log_dir}/core0.veccore0.instr_log.dump"
      dump_found=1
    fi
  fi

  # Clean up other dump files (VMI produces hundreds)
  find "$case_log_dir" -maxdepth 1 -name 'core*.dump' \
    ! -name 'core0.veccore0.instr_log.dump' \
    -delete 2>/dev/null || true
  rm -f "$case_log_dir"/core[0-9]*.veccore1* \
        "$case_log_dir"/core[0-9]*.cubecore* \
        "$case_log_dir"/core[0-9]*.wrapper* \
        "$case_log_dir"/core[0-9]*.biu* \
        "$case_log_dir"/core[0-9]*.mte* \
        "$case_log_dir"/mcu_log.dump \
        "$case_log_dir"/stars_log*.dump 2>/dev/null || true

  # Extract vf_real
  instr_dump="${case_log_dir}/core0.veccore0.instr_log.dump"
  if [[ -f "$instr_dump" ]]; then
    vf_sum=$(grep -oE "vf_real_execute_time: [0-9]+" "$instr_dump" | tail -1 | awk '{print $2}')
    echo "${vf_sum:-0}" > "${case_log_dir}/vf_ticks.txt"
  else
    echo "0" > "${case_log_dir}/vf_ticks.txt"
  fi

  # Check PASS in log (camodel may crash at cleanup after PASS)
  if grep -qE '^PASS |PASS case' "$case_log" 2>/dev/null; then
    rc=0
  elif [[ $dump_found -eq 1 && $rc -ne 0 ]]; then
    # Dump exists despite non-zero exit — sim crashed at cleanup (expected)
    rc=0
  elif [[ $rc -eq 124 ]]; then
    # timeout killed it
    rc=124
  fi

  # Check if the collected dump is actually non-empty
  instr_dump="${case_log_dir}/core0.veccore0.instr_log.dump"
  dump_size=0
  [[ -f "$instr_dump" ]] && dump_size=$(stat -c%s "$instr_dump" 2>/dev/null || echo 0)

  MAN_STATUS=""; MAN_ERR=""
  if [[ $rc -eq 124 ]]; then
    echo -e "${RED}TIMEOUT${NC} (${case_elapsed}s)"
    echo "FAIL (timeout ${case_elapsed}s)" > "${case_log_dir}/status"
    FAIL=$((FAIL+1)); FAILED_CASES+=("${kernel} (timeout ${case_elapsed}s)")
    MAN_STATUS="TIMEOUT"; MAN_ERR="timeout ${case_elapsed}s"
  elif [[ $rc -eq 0 && $dump_found -eq 1 && $dump_size -gt 0 ]]; then
    echo -e "${GREEN}PASS ✓${NC} ${case_elapsed}s ${dump_size}B"
    echo "PASS" > "${case_log_dir}/status"
    PASS=$((PASS+1))
    MAN_STATUS="PASS"
  elif [[ $rc -eq 0 && $dump_found -eq 1 && $dump_size -eq 0 ]]; then
    echo -e "${YELLOW}PASS (empty dump)${NC} ${case_elapsed}s"
    echo "PASS_EMPTY" > "${case_log_dir}/status"
    FAIL=$((FAIL+1)); FAILED_CASES+=("${kernel} (empty dump)")
    MAN_STATUS="PASS_EMPTY"; MAN_ERR="empty dump"
  elif [[ $rc -eq 0 && $dump_found -eq 0 ]]; then
    echo -e "${YELLOW}PASS (no dump)${NC} ${case_elapsed}s"
    echo "PASS_NODUMP" > "${case_log_dir}/status"
    FAIL=$((FAIL+1)); FAILED_CASES+=("$kernel (no dump)")
    MAN_STATUS="PASS_NODUMP"; MAN_ERR="no dump"
  else
    echo -e "${RED}FAIL ✗${NC}"
    if [[ $VERBOSE -eq 0 ]]; then
      err=$(grep -iE "error|fail|traceback|exception" "$case_log" 2>/dev/null | tail -1)
      [[ -n "$err" ]] && echo -e "  │     ${RED}Error:${NC} ${err:0:70}"
    else
      err=""
    fi
    echo "FAIL (exit=${rc})" > "${case_log_dir}/status"
    FAIL=$((FAIL+1)); FAILED_CASES+=("$kernel")
    MAN_STATUS="FAIL (exit=${rc})"; MAN_ERR="${err:0:120}"
  fi
  printf '%s\t%s\t%s\t%d\t%d\t%s\n' "$kernel" "$case_name" "$MAN_STATUS" "$dump_size" "$case_elapsed" "$MAN_ERR" >> "$MANIFEST"
done

ELAPSED=$((SECONDS - START_TIME))
echo "  └────────────────────────────────────────────────────────────────────┘"
echo ""

# ── Summary ────────────────────────────────────────────────────────────────
echo "  ╔════════════════════════════════════════════════════════════════════╗"
printf "  ║  ${BOLD}A6 VMI Run Summary${NC}                                           ║\n"
printf "  ║  Total: %-3d   ${GREEN}Passed: %-3d${NC}   ${RED}Failed: %-3d${NC}   Skip: %-3d  Time: %ds%*s║\n" \
  "$TOTAL" "$PASS" "$FAIL" "$SKIP" "$ELAPSED" $((8 - ${#ELAPSED})) ""
echo "  ╚════════════════════════════════════════════════════════════════════╝"

if [[ ${#FAILED_CASES[@]} -gt 0 ]]; then
  echo ""
  echo -e "  ${RED}Failed:${NC}"
  for fc in "${FAILED_CASES[@]}"; do echo "    ✗ $fc"; done
fi

echo ""
if [[ $PASS -gt 0 ]]; then
  pass "Dumps collected at: $LOG_ROOT"
  pass "Manifest: $MANIFEST  (Phase 2 triage: cut -f1,3,5,6 \"$MANIFEST\" | column -t)"
  info "Next: build dashboard  →  bash $SCRIPT_DIR/a6_build_dashboard.sh --serve"
fi

# ── Restore VMI Python files: target="a6" → target="a5" ────────────────────
hdr "Restore VMI target to a5"
RESTORED=0
for py in "${PATCH_FILES[@]}"; do
  bak="${py}.a5bak"
  [[ -f "$bak" ]] || continue
  mv "$bak" "$py"
  RESTORED=$((RESTORED + 1))
done
if [[ $RESTORED -gt 0 ]]; then
  pass "Restored $RESTORED VMI file(s) to target=\"a5\""
fi

[[ ${FAIL} -eq 0 ]]
