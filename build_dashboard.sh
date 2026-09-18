#!/usr/bin/env bash
# ============================================================================
# build_dashboard.sh — Build A6 dashboard from simulation dump files
#
# Takes A6 instr_log.dump files and produces a full dashboard using the SAME
# web/ frontend as A5. Runs entirely in the yellow zone.
#
# Requires 3 cloned repos:
#   ~/a6-vmi-dashboard/   — dashboard frontend + build_data.py
#   ~/pto-vmi/         — kernel source (cce/ + dsl/)
#   ~/npu_skills/      — analysis scripts (ca_instr_analysis.py etc.)
#
# Pipeline:
#   1. Parse CCE dumps  → cce_ca_instr_analysis.json   (ca_instr_analysis.py)
#   2. Parse VMI dumps  → vmi_ca_instr_analysis.json   (ca_instr_analysis.py)
#   3. Match CCE↔VMI    → cce_vmi_instruction_breakdown.json (cce_vmi_breakdown.py)
#   4. Build report     → cce_vmi_ca_report.json + .md (cce_vmi_ca_report.py)
#   5. Build data.js    → web/data.js                  (build_data.py)
#   6. Serve dashboard  → http://localhost:8002
#
# Usage:
#   bash build_dashboard.sh                         # auto-detect logs
#   bash build_dashboard.sh --cce-log ~/my/cce/logs # specify CCE log root
#   bash build_dashboard.sh --vmi-log ~/my/vmi/logs # specify VMI log root
#   bash build_dashboard.sh --cce-only              # CCE only (no VMI)
#   bash build_dashboard.sh --serve                 # serve after build
#   bash build_dashboard.sh --serve --port 9000     # custom port
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

# ── Parse args ──────────────────────────────────────────────────────────────
CCE_LOG=""
VMI_LOG=""
CCE_ONLY=0
DO_SERVE=0
PORT=8002
while [[ $# -gt 0 ]]; do
  case "$1" in
    --cce-log)  CCE_LOG="$2"; shift 2 ;;
    --vmi-log)  VMI_LOG="$2"; shift 2 ;;
    --cce-only) CCE_ONLY=1; shift ;;
    --serve)    DO_SERVE=1; shift ;;
    --port)     PORT="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: bash build_dashboard.sh [options]"
      echo ""
      echo "  --cce-log PATH   CCE log root (contains */core0.veccore0.instr_log.dump)"
      echo "  --vmi-log PATH   VMI log root (same structure)"
      echo "  --cce-only       Only build CCE data (no VMI comparison)"
      echo "  --serve          Start dashboard server after build"
      echo "  --port N         Server port (default 8001)"
      echo ""
      echo "Required repos in \$HOME:"
      echo "  ~/a6-vmi-dashboard/   (git clone https://gitcode.com/ivanmang/a6-vmi-dashboard.git)"
      echo "  ~/pto-vmi/         (git clone https://gitcode.com/csjlchen/pto-vmi.git)"
      echo "  ~/npu_skills/      (git clone https://gitcode.com/ChanKaLok/npu_skills.git)"
      exit 0 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

# ── Paths ───────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DASH="${VMI_DASH:-$SCRIPT_DIR}"
REPO="${PTO_VMI_REPO:-$HOME/pto-vmi}"
SKILL="${NPU_SKILLS:-$HOME/npu_skills/pto-as/ca-instruction-breakdown}"

DOCS="$REPO/docs"
DATA_DIR="$DASH/data"
mkdir -p "$DOCS" "$DATA_DIR"

# ── Verify repos exist ──────────────────────────────────────────────────────
hdr "Step 0: Verify repos"
MISSING=0
for dir in "$DASH" "$REPO" "$SKILL"; do
  if [[ ! -d "$dir" ]]; then
    fail "Not found: $dir"
    MISSING=1
  fi
done
if [[ $MISSING -eq 1 ]]; then
  echo ""
  echo "  Clone the required repos:"
  echo "    git clone https://gitcode.com/ivanmang/a6-vmi-dashboard.git  ~/a6-vmi-dashboard"
  echo "    git clone https://gitcode.com/csjlchen/pto-vmi.git       ~/pto-vmi"
  echo "    git clone https://gitcode.com/ChanKaLok/npu_skills.git   ~/npu_skills"
  exit 1
fi

# Verify key scripts exist
SKILL_SCRIPTS="$SKILL/scripts"
EXPLORER_SCRIPTS="$SKILL/explorer/scripts"
for script in \
  "$SKILL_SCRIPTS/ca_instr_analysis.py" \
  "$SKILL_SCRIPTS/cce_vmi_ca_report.py" \
  "$SCRIPT_DIR/scripts/cce_vmi_breakdown.py" \
  "$DASH/scripts/build_data.py"
do
  if [[ ! -f "$script" ]]; then
    fail "Missing script: $script"
    exit 1
  fi
done
pass "All repos and scripts found"

# ── Auto-detect log roots ───────────────────────────────────────────────────
# Search strategy: known log dirs → pto-vmi build dirs → broad home search

find_dump_root() {
  # $1 = label (CCE/VMI), $2 = hint subdir name (cce/vmi)
  local label="$1" hint="$2"
  local found=""

  # 1. Known log directory names
  for candidate in \
    "$REPO/logs/a6_${hint}_logs" \
    "$REPO/logs/run_${hint}_a6" \
    "$REPO/logs/run_${hint}_30k" \
    "$REPO/logs/run_${hint}_part1_logs" \
    "$REPO/logs/run_${hint}_real_logs" \
    "$REPO/logs/run_${hint}_logs"
  do
    if [[ -d "$candidate" ]] && find "$candidate" -name "core0.veccore0.instr_log.dump" -print -quit 2>/dev/null | grep -q .; then
      found="$candidate"
      break
    fi
  done

  # 2. If not found in logs/, search pto-vmi/cce build dirs (dumps not yet collected)
  if [[ -z "$found" ]]; then
    local build_dumps
    build_dumps=$(find "$REPO/cce" -name "core0.veccore0.instr_log.dump" -type f 2>/dev/null | head -1)
    if [[ -n "$build_dumps" ]]; then
      # Use the cce/ dir as root — ca_instr_analysis.py will find dumps recursively
      found="$REPO/cce"
      warn "$label dumps found in cce/ dirs (not collected to logs/)" >&2
    fi
  fi

  # 3. Broad search under pto-vmi/ (any dump anywhere)
  if [[ -z "$found" ]]; then
    local any_dumps
    any_dumps=$(find "$REPO" -name "core0.veccore0.instr_log.dump" -type f 2>/dev/null | head -1)
    if [[ -n "$any_dumps" ]]; then
      # Walk up to the directory containing the case subdirs
      found=$(dirname "$(dirname "$any_dumps")")
      [[ -d "$found" ]] || found=$(dirname "$any_dumps")
      warn "$label dumps found via broad search" >&2
    fi
  fi

  echo "$found"
}

# ── Collect fresh A6 dumps into the parser's expected logs/ layout ──────────
# ca_instr_analysis.py walks root/<case>/core0.veccore0.instr_log.dump, but the
# A6 runs leave them at cce/a6/<k>/build/log_ca/ and dsl/<k>/log_ca/. Copy them
# into logs/a6_cce_logs/<k>/ and logs/a6_vmi_logs/<k>/.
collect_dumps() {
  local label="$1" search_dir="$2" out_dir="$3"
  mkdir -p "$out_dir"
  local n=0
  while IFS= read -r dump; do
    local case_dir
    case_dir=$(echo "$dump" | sed -E 's#/(build/(log_ca|camodel_log)|log_ca|camodel_log)/core0\.veccore0\.instr_log\.dump$##' | xargs -r basename)
    [[ -z "$case_dir" ]] && case_dir="unknown_$n"
    mkdir -p "$out_dir/$case_dir"
    cp -f "$dump" "$out_dir/$case_dir/core0.veccore0.instr_log.dump"
    # The report builder excludes rows whose status != "PASS" (correctness check).
    # We collect only executed kernels; a dump with a VF summary means it ran.
    if grep -q 'vf_real_execute_time' "$dump" 2>/dev/null; then
      echo "PASS" > "$out_dir/$case_dir/status"
    else
      echo "FAIL" > "$out_dir/$case_dir/status"
    fi
    n=$((n+1))
  done < <(find "$search_dir" -name "core0.veccore0.instr_log.dump" -type f 2>/dev/null)
  if [[ $n -gt 0 ]]; then
    info "collected $n $label dump(s) into $out_dir"
  else
    warn "no $label dumps under $search_dir"
  fi
}

hdr "Step 1.5: Collect A6 dumps"
collect_dumps CCE "$REPO/cce/a6" "$REPO/logs/a6_cce_logs"
collect_dumps VMI "$REPO/dsl" "$REPO/logs/a6_vmi_logs"

if [[ -z "$CCE_LOG" ]]; then
  CCE_LOG="$(find_dump_root CCE cce)"
fi

if [[ -z "$VMI_LOG" && $CCE_ONLY -eq 0 ]]; then
  VMI_LOG="$(find_dump_root VMI vmi)"
fi

# ── Step 1: Verify dump files ───────────────────────────────────────────────
hdr "Step 1: Verify A6 dump files"

if [[ -z "$CCE_LOG" || ! -d "$CCE_LOG" ]]; then
  fail "CCE log root not found!"
  echo ""
  echo "  Searched for core0.veccore0.instr_log.dump in:"
  echo "    ~/pto-vmi/logs/a6_cce_logs/"
  echo "    ~/pto-vmi/logs/run_cce_*/"
  echo "    ~/pto-vmi/cce/*/build/  (un-collected build dirs)"
  echo "    ~/pto-vmi/  (broad search)"
  echo ""
  # Show dump files found anywhere under home
  ALL_DUMPS=$(find "$HOME" -name "core0.veccore0.instr_log.dump" -type f 2>/dev/null | head -20)
  if [[ -n "$ALL_DUMPS" ]]; then
    dump_count=$(echo "$ALL_DUMPS" | wc -l)
    echo -e "  ${YELLOW}Found ${dump_count} dump file(s) elsewhere:${NC}"
    while IFS= read -r d; do
      echo "    $d"
    done <<< "$ALL_DUMPS"
    echo ""
    echo "  Use the parent directory as --cce-log:"
    first_dump=$(echo "$ALL_DUMPS" | head -1)
    parent=$(dirname "$first_dump")
    grandparent=$(dirname "$parent")
    echo "    bash build_dashboard.sh --cce-log \"$grandparent\""
  else
    echo -e "  ${RED}No core0.veccore0.instr_log.dump files found anywhere under $HOME${NC}"
    echo ""
    echo -e "  ${YELLOW}Searching for ANY .dump file (A6 may use a different name)...${NC}"
    ANY_DUMPS=$(find "$HOME" -name "*.dump" -type f 2>/dev/null | head -30)
    if [[ -n "$ANY_DUMPS" ]]; then
      any_count=$(echo "$ANY_DUMPS" | wc -l)
      echo -e "  ${GREEN}Found ${any_count} .dump file(s):${NC}"
      while IFS= read -r d; do
        echo "    $d"
      done <<< "$ANY_DUMPS"
      echo ""
      echo -e "  ${YELLOW}A6 dumps may have a different filename.${NC}"
      echo "  Common A6 dump locations/names:"
      echo "    build/log_ca/core0.veccore0.instr_log.dump"
      echo "    build/bin/camodel_log/core0.veccore0.instr_log.dump"
      echo "    *.instr_log.dump"
      echo "    *.dump (in log_ca/ or camodel_log/)"
      echo ""
      echo "  If your dumps have a different name, you can still build the dashboard"
      echo "  by collecting them into a directory structure like:"
      echo "    ~/my_dumps/"
      echo "      ├── KernelName.case0_dtype_dtype_rows_cols/"
      echo "      │   └── core0.veccore0.instr_log.dump  (rename if needed)"
      echo "      └── ..."
      echo ""
      echo "  Then run:"
      echo "    bash build_dashboard.sh --cce-log ~/my_dumps"
    else
      echo -e "  ${RED}No .dump files found anywhere under $HOME${NC}"
      echo ""
      echo "  You need to run A6 simulation first to produce dump files."
      echo ""
      echo "  Search for simulation output files:"
      echo "    find ~ -name '*.dump' 2>/dev/null | head -20"
      echo "    find ~ -name '*instr*log*' 2>/dev/null | head -20"
      echo "    find ~ -name '*log_ca*' -type d 2>/dev/null | head -10"
      echo "    find ~ -name '*camodel*' 2>/dev/null | head -20"
      echo "    ls ~/pto-vmi/cce/*/build/log_ca/ 2>/dev/null"
      echo "    ls ~/pto-vmi/cce/*/build/bin/ 2>/dev/null"
    fi
  fi
  exit 1
fi

CCE_DUMPS=$(find "$CCE_LOG" -name "core0.veccore0.instr_log.dump" 2>/dev/null | wc -l)
if [[ $CCE_DUMPS -eq 0 ]]; then
  fail "No instr_log.dump files in $CCE_LOG"
  echo "  Expected: $CCE_LOG/*/core0.veccore0.instr_log.dump"
  exit 1
fi
pass "CCE dumps: $CCE_LOG ($CCE_DUMPS files)"

HAS_VMI=0
if [[ $CCE_ONLY -eq 0 && -n "$VMI_LOG" && -d "$VMI_LOG" ]]; then
  VMI_DUMPS=$(find "$VMI_LOG" -name "core0.veccore0.instr_log.dump" 2>/dev/null | wc -l)
  if [[ $VMI_DUMPS -gt 0 ]]; then
    pass "VMI dumps: $VMI_LOG ($VMI_DUMPS files)"
    HAS_VMI=1
  else
    warn "VMI log root found but no dumps — CCE-only mode"
  fi
else
  [[ $CCE_ONLY -eq 0 ]] && warn "No VMI logs found — CCE-only mode" || info "CCE-only mode"
fi

# ── Step 2: Parse CCE dumps ─────────────────────────────────────────────────
hdr "Step 2: Parse CCE instruction dumps"

CCE_JSON="$DOCS/cce_ca_instr_analysis.json"
info "ca_instr_analysis.py → CCE dumps"
echo "  Input:  $CCE_LOG"
echo "  Output: $CCE_JSON"

python3 "$SKILL_SCRIPTS/ca_instr_analysis.py" \
  --log-root "$CCE_LOG" \
  --json "$CCE_JSON" 2>&1 | tail -5

if [[ ! -f "$CCE_JSON" ]]; then
  fail "CCE analysis failed"
  exit 1
fi
CCE_CASES=$(python3 -c "import json; d=json.load(open('$CCE_JSON')); print(len(d) if isinstance(d,list) else len(d.get('cases',d.get('rows',[]))))" 2>/dev/null || echo "?")
pass "CCE analysis: $CCE_CASES cases"

# ── Step 3: Parse VMI dumps (if available) ──────────────────────────────────
if [[ $HAS_VMI -eq 1 ]]; then
  hdr "Step 3: Parse VMI instruction dumps"
  VMI_JSON="$DOCS/vmi_ca_instr_analysis.json"
  info "ca_instr_analysis.py → VMI dumps"
  echo "  Input:  $VMI_LOG"
  echo "  Output: $VMI_JSON"

  python3 "$SKILL_SCRIPTS/ca_instr_analysis.py" \
    --log-root "$VMI_LOG" \
    --json "$VMI_JSON" 2>&1 | tail -5

  if [[ -f "$VMI_JSON" ]]; then
    VMI_CASES=$(python3 -c "import json; d=json.load(open('$VMI_JSON')); print(len(d) if isinstance(d,list) else len(d.get('cases',d.get('rows',[]))))" 2>/dev/null || echo "?")
    pass "VMI analysis: $VMI_CASES cases"
  else
    fail "VMI analysis failed — falling back to CCE-only"
    HAS_VMI=0
  fi
fi

# ── Step 4: Match CCE↔VMI kernels ───────────────────────────────────────────
if [[ $HAS_VMI -eq 1 ]]; then
  hdr "Step 4: Match CCE↔VMI kernels"
  MATCH_JSON="$DOCS/cce_vmi_instruction_breakdown.json"
  info "cce_vmi_breakdown.py"
  echo "  Output: $MATCH_JSON"

  PTO_VMI_REPO="$REPO" python3 "$SCRIPT_DIR/scripts/cce_vmi_breakdown.py" 2>&1 | tail -3
  [[ -f "$MATCH_JSON" ]] && pass "Kernel matching done" || warn "Matching failed — continuing"
fi

# ── Step 5: Build comparison report ────────────────────────────────────────
hdr "Step 5: Build comparison report"

REPORT_JSON="$DOCS/cce_vmi_ca_report.json"
REPORT_MD="$DOCS/cce_vmi_ca_report.md"

if [[ $HAS_VMI -eq 1 ]]; then
  info "cce_vmi_ca_report.py (CCE vs VMI)"
  PTO_VMI_REPO="$REPO" \
  CCE_CA_JSON="$CCE_JSON" \
  VMI_CA_JSON="$VMI_JSON" \
  CCE_VMI_REPORT_JSON="$REPORT_JSON" \
  CCE_VMI_REPORT_MD="$REPORT_MD" \
    python3 "$SKILL_SCRIPTS/cce_vmi_ca_report.py" 2>&1 | tail -3
else
  info "Building CCE-only report (no VMI data)"
  python3 - "$CCE_JSON" "$REPORT_JSON" "$REPORT_MD" << 'PYEOF'
import json, sys, os
cce_json, report_json, report_md = sys.argv[1], sys.argv[2], sys.argv[3]
with open(cce_json) as f:
    cce_data = json.load(f)
cases = cce_data if isinstance(cce_data, list) else cce_data.get("cases", cce_data.get("rows", []))

rows = []
for c in cases:
    case_id = c.get("case_id", "?")
    kernel = case_id.split(".")[0] if "." in case_id else case_id
    raw = c.get("raw_unit_counts", {})
    cats = c.get("category_counts", {})
    subcats = c.get("subcategory_counts", {})
    stalls = c.get("long_stalls", [])
    rows.append({
        "case_id": case_id, "kernel": kernel, "vmi_kernel": kernel,
        "cce_status": c.get("status", "PASS"), "vmi_status": "N/A",
        "cce": {
            "ex": raw.get("RVECEX", 0), "su": raw.get("RVECSU", 0),
            "ld": raw.get("RVECLD", 0), "st": raw.get("RVECST", 0),
            "pred": cats.get("predicate", 0), "scalar": raw.get("SCALAR", 0),
            "dma": raw.get("MTE2", 0), "flowctrl": cats.get("flowctrl", 0),
            "membar": cats.get("membar", 0), "dual": c.get("dual_ticks", 0),
            "rvec_dual": sum(1 for combo in c.get("combo_counts", {}) if any(p in combo for p in ["RVECEX","RVECLD","RVECST","RVECSU"])),
            "max_issue": c.get("max_per_tick", 0), "stalls": len(stalls),
            "ex_stalls": len([s for s in stalls if s[0] == "RVECEX"]),
            "max_stall": max((s[3] for s in stalls), default=0),
            "top_stall": (c.get("stall_targets", {}) and list(c["stall_targets"].keys())[0]) or "",
            "ipc": c.get("overall_ipc"), "ex_ipc": c.get("ex_ipc"),
            "vf_real": c.get("vf_real_execute_time"), "vf_compute": c.get("vf_compute_span"),
            "instr_num": c.get("instr_num", 0), "mte2_wait": c.get("mte2_wait", 0),
            "ex_arith": subcats.get("arith", 0), "ex_cast": subcats.get("cast", 0),
            "ex_broadcast": subcats.get("broadcast", 0), "ex_pred_setup": subcats.get("predicate_setup", 0),
            "ex_interleave": subcats.get("interleave", 0), "ex_select_cmp": subcats.get("select_cmp", 0),
            "ex_reduce": subcats.get("reduce", 0), "subcats": subcats, "instr_list": c.get("instr_counts", {}),
        },
        "vmi": None, "excluded": None,
    })

report = {"meta": {"chip": "A6 (dav_9201)", "cce_cases_total": len(rows),
    "matched_pairs": 0, "cce_only_count": len(rows), "excluded_count": 0,
    "vmi_cases_total": 0, "generated_from": "cce_ca_instr_analysis.json (CCE-only)"},
    "rows": rows}
with open(report_json, "w") as f:
    json.dump(report, f, indent=2)
with open(report_md, "w") as f:
    f.write("# A6 CCE-Only Report\n\nChip: A6 (dav_9201)\n\n")
    f.write(f"Total CCE cases: {len(rows)}\n\n")
    f.write("| Kernel | EX | SU | LD | ST | Scalar | IPC | vf_real |\n||---|---|---|---|---|---|---|\n")
    for r in rows:
        c = r["cce"]
        f.write(f"| {r['kernel']} | {c['ex']} | {c['su']} | {c['ld']} | {c['st']} | {c['scalar']} | {c['ipc']} | {c['vf_real']} |\n")
print(f"Wrote {report_json} ({len(rows)} rows)")
PYEOF
fi

if [[ ! -f "$REPORT_JSON" ]]; then
  fail "Report build failed"
  exit 1
fi
ROWS=$(python3 -c "import json; print(len(json.load(open('$REPORT_JSON')).get('rows',[])))" 2>/dev/null || echo "?")
MATCHED=$(python3 -c "import json; d=json.load(open('$REPORT_JSON')); print(sum(1 for r in d.get('rows',[]) if r.get('vmi') and r['vmi'].get('ex') is not None))" 2>/dev/null || echo "0")
pass "Report: $ROWS rows, $MATCHED matched pairs"

# ── Step 6: Build data.js ───────────────────────────────────────────────────
hdr "Step 6: Build dashboard data.js"

cp "$REPORT_JSON" "$DATA_DIR/cce_vmi_ca_report.json"
cp "$REPORT_MD" "$DATA_DIR/cce_vmi_ca_report.md"
cp "$CCE_JSON" "$DATA_DIR/cce_ca_instr_analysis.json"
[[ $HAS_VMI -eq 1 && -f "$VMI_JSON" ]] && cp "$VMI_JSON" "$DATA_DIR/vmi_ca_instr_analysis.json"

info "build_data.py"
cd "$DASH"
PTO_VMI_REPO="$REPO" python3 scripts/build_data.py 2>&1

if [[ ! -f "$DASH/web/data.js" ]]; then
  fail "build_data.py failed"
  exit 1
fi
pass "data.js built: $(du -h "$DASH/web/data.js" | cut -f1)"

# ── Step 6.5: Build Kernel Lab (explorer) bundles ──────────────────────────
hdr "Step 6.5: Build Kernel Lab (explorer) bundles"
if [[ -x "$SCRIPT_DIR/scripts/build_explorer.sh" ]]; then
  PTO_VMI_REPO="$REPO" PTO_VENV="${PTO_VENV:-$HOME/.venv-ptoas}" bash "$SCRIPT_DIR/scripts/build_explorer.sh" 2>&1 | tail -6
else
  warn "build_explorer.sh not found — Kernel Lab will be empty"
fi

# ── Step 7: wIPC (removed for A6 — A5-only model, wipc_all.json is shimmed in app.js) ──

# ── Summary ────────────────────────────────────────────────────────────────
hdr "Dashboard Build Complete"
echo ""
echo "  ╔══════════════════════════════════════════════════════════════╗"
printf "  ║  ${BOLD}A6 Dashboard Built${NC}                                          ║\n"
printf "  ║  CCE cases:  %-46s║\n" "$CCE_CASES"
if [[ $HAS_VMI -eq 1 ]]; then
printf "  ║  VMI cases:  %-46s║\n" "${VMI_CASES:-0}"
printf "  ║  Matched:    %-46s║\n" "$MATCHED"
else
printf "  ║  VMI:        %-46s║\n" "none (CCE-only)"
fi
printf "  ║  Chip:       %-46s║\n" "A6 (dav_9201)"
echo "  ╚══════════════════════════════════════════════════════════════╝"
echo ""

# ── Serve ──────────────────────────────────────────────────────────────────
if [[ $DO_SERVE -eq 1 ]]; then
  hdr "Starting dashboard server"
  pkill -f "http.server.*:$PORT" 2>/dev/null; sleep 1
  info "Serving on http://0.0.0.0:$PORT"
  info "Open: http://localhost:$PORT/index.html"
  cd "$DASH/web"
  python3 -m http.server "$PORT" --bind 0.0.0.0 &
  SERVE_PID=$!
  sleep 2
  if kill -0 $SERVE_PID 2>/dev/null; then
    pass "Dashboard running at http://localhost:$PORT/index.html"
    echo "  Press Ctrl+C to stop"
    wait $SERVE_PID
  else
    fail "Server failed to start"
    exit 1
  fi
else
  info "To serve the dashboard:"
  echo "    cd $DASH/web && python3 -m http.server $PORT"
  echo "    # Then open http://localhost:$PORT"
  echo ""
  echo "  Or re-run with --serve:"
  echo "    bash build_dashboard.sh --serve --port $PORT"
fi
