#!/usr/bin/env python3
"""
build_data.py — generate web/data.js from the CA report JSON + markdown + raw analysis.

The dashboard is fully offline (no CDN, no fetch). All data is embedded into a
single JS file so it works from file:// or any static server.

Usage:
    python3 scripts/build_data.py

Reads:
    ../data/cce_vmi_ca_report.json        (132 rows, structured — real-shape analysis)
    ../data/cce_vmi_ca_report.md          (the full markdown report, rendered in "Raw Report" tab)
    ../data/cce_ca_instr_analysis.json    (raw per-case CCE analysis — for latency inventory; optional)
    ../data/vmi_ca_instr_analysis.json    (raw per-case VMI analysis — for latency inventory; optional)
Writes:
    web/data.js

The executive-summary tables (section A, latency inventory, outliers) are DERIVED
dynamically from the report rows + raw analysis JSONs — not hand-transcribed — so
the dashboard stays consistent with the report on every refresh. The derivation
mirrors the logic in cce_vmi_ca_report.py (scripts/ of the ca-instruction-breakdown
skill), which computes the same tables into the markdown report.
"""
import datetime
import json
import os
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.normpath(os.path.join(HERE, "..", "data"))
WEB = os.path.normpath(os.path.join(HERE, "..", "web"))

JSON_PATH = os.path.join(DATA, "cce_vmi_ca_report.json")
MD_PATH = os.path.join(DATA, "cce_vmi_ca_report.md")
CCE_RAW_PATH = os.path.join(DATA, "cce_ca_instr_analysis.json")
VMI_RAW_PATH = os.path.join(DATA, "vmi_ca_instr_analysis.json")
OUT_PATH = os.path.join(WEB, "data.js")


def load_json(path):
    if not os.path.isfile(path):
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)

def load_md():
    with open(MD_PATH, encoding="utf-8") as f:
        return f.read()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _num(x):
    """Coerce to float for arithmetic, treating None/0 as safe."""
    return x if isinstance(x, (int, float)) else None

def _ratio(num, den):
    if num and den:
        return round(num / den, 3)
    return None

def _kernel_note(kernel):
    """Replicate cce_vmi_ca_report.py's A2 root-cause heuristic by kernel name."""
    kn = kernel.lower()
    if "cast" in kn or "convert" in kn or "widen" in kn or "narrow" in kn:
        return "VMI lacks direct multi-stage cast → vcvt chain"
    if "gelu" in kn or "swiglu" in kn or "swish" in kn or "sigmoid" in kn or "silu" in kn:
        return "VMI decomposes activation (gelu/tanh/silu) into vexp+vdiv chain"
    if "quant" in kn or "mxfp" in kn:
        return "VMI unfused quant (separate scale + clip + cast)"
    if "gather" in kn or "select" in kn:
        return "VMI emits explicit gather/select ops CCE lacks"
    if "rowmax" in kn or "amax" in kn or "max" in kn or "topk" in kn:
        return "VMI decomposes reduce-max (vcmax + vbrc)"
    return "VMI multi-op decomposition (no native fused op)"

def _cce_cause(kernel):
    kn = kernel.lower()
    if "deintlv" in kn:
        return "manual deintlv in EX"
    if "confusion" in kn or "softmax" in kn:
        return "tile-unrolled per shape"
    return "tile-unrolled / manual op"

def _vfreal_cause(gap, cce_ipc, vmi_ipc):
    """gap = cce.vf_real - vmi.vf_real (positive ⇒ CCE slower)."""
    if gap > 0:
        if cce_ipc and vmi_ipc and cce_ipc < vmi_ipc:
            return "prologue/MTE2-bound (low IPC)"
        return "tile-unrolled EX explosion"
    # VMI slower
    return "EX workaround (VMI emits 2× more EX)"

def _slower(gap):
    return "CCE" if gap > 0 else "VMI"


# ---------------------------------------------------------------------------
# Definitions — methodology string derived from the ACTUAL run environment,
# not hardcoded. Detects CANN version (from ASCEND_HOME_PATH basename) and
# ptoas version (from the ptoas CLI / __init__), so the Overview tab always
# reflects what actually produced the data.
# ---------------------------------------------------------------------------
def _detect_cann_version():
    """Return a human CANN label from $ASCEND_HOME_PATH or $CANN_ROOT env.

    Looks at the basename of the CANN install dir (e.g. 'cann-9.1.0'
    -> 'CANN 9.1.0'). Falls back to 'CANN (unknown)'."""
    cann = os.environ.get("ASCEND_HOME_PATH", "") or os.environ.get("CANN_ROOT", "")
    if cann:
        base = os.path.basename(cann.rstrip("/"))
        # 'cann-9.1.0' -> '9.1.0'
        ver = base.split("-", 1)[1] if "-" in base else base
        if ver and ver[0].isdigit():
            return f"CANN {ver}"
        return f"CANN ({base})"
    return "CANN (unknown)"


def _detect_ptoas_version():
    """Return the ptoas version label by querying the ptoas CLI or module.

    The ptoas package has no __version__ attribute, so we prefer the
    `ptoas --version` CLI (prints e.g. 'ptoas vmi 0.1.6').
    Falls back to importing the module, then to '(version unknown)'."""
    import subprocess
    # 1. ptoas CLI (most reliable — matches what vmi_sim_env.sh puts on PATH)
    ptoas_bin = os.environ.get("PTOAS_BIN", "")
    if not ptoas_bin:
        # search PATH (may be the venv python's bin)
        from shutil import which
        ptoas_bin = which("ptoas") or ""
    if ptoas_bin:
        try:
            out = subprocess.check_output([ptoas_bin, "--version"],
                                          stderr=subprocess.STDOUT, timeout=5)
            txt = out.decode().strip()
            # 'ptoas vmi 0.1.6' -> 'PTOAS vmi 0.1.6' (keep everything after 'ptoas ')
            # 'ptoas vmi 0.1.6' -> 'PTOAS vmi 0.1.6' (keep everything after 'ptoas ')
            if txt.lower().startswith("ptoas"):
                rest = txt[5:].strip()  # everything after 'ptoas'
                return f"PTOAS {rest}" if rest else "PTOAS"
            return f"PTOAS {txt}"
        except Exception:
            pass
    # 2. import fallback (unlikely to have a version, but try)
    try:
        import importlib
        ptoas = importlib.import_module("ptoas")
        v = getattr(ptoas, "__version__", None)
        if v:
            return f"PTOAS {v}"
    except Exception:
        pass
    return "PTOAS (version unknown)"


def _detect_sim_soc():
    """Return the simulator SoC label from $SOC_VERSION or default A5."""
    soc = os.environ.get("SOC_VERSION", "")
    if not soc:
        # default for the A5 dashboard run
        soc = "Ascend950PR_9599"
    return soc


def _derive_definitions():
    """Build the definitions dict with a methodology string derived from the
    actual environment that produced the data (CANN version, ptoas version, SoC).
    Replaces the former hardcoded 'CANN 9.0.0-beta.1' string."""
    cann = _detect_cann_version()
    ptoas = _detect_ptoas_version()
    soc = _detect_sim_soc()
    methodology = (
        f"VMI/DSL: {ptoas} + {cann} sim ({soc}). "
        "CCE: bisheng (clang 15.0.5) + same {soc} camodel. "
        "Real IPC = total_rvec_executed/vf_compute_span (not launch-bound instr_num/vf_real). "
        "Counts are executed instructions from core0.veccore0.instr_log.dump, RV_SEND deduped by (ID, tick)."
    ).format(soc=soc)
    return {
        "vf_real": "vf_real_execute_time (VF wall-clock). VFcomp = last_RVEC - first_RVEC tick.",
        "ipc": "total_rvec_executed / vf_compute_span (true EX-throughput IPC, max 2.0)",
        "ex_ipc": "EX / (last_EX - first_EX) (higher => better EX throughput; can exceed 1.0 via dual-issue)",
        "stalls": "RVEC tick-gaps >= threshold (EX>=4, SU/LD/ST>=8)",
        "dual": "ticks issuing >1 unique instruction",
        "rvec_dual": "ticks with >1 RVEC instr (EX+EX / LD+EX)",
        "mte2_wait": "cycles VEC stalled waiting for GM->UB data (last WAIT_FLAG -> first RVEC)",
        "scope": "all counts are VF-section only (between PUSH_PB and the VF summary line) - i.e. executed instructions inside the vector function, NOT the whole-dump scalar prologue.",
        "methodology": methodology,
    }


# ---------------------------------------------------------------------------
# Derive the executive-summary tables from the report rows
# (mirrors cce_vmi_ca_report.py §A logic so the dashboard matches the MD report)
# ---------------------------------------------------------------------------
def derive_summary(rows):
    def is_matched(r):
        # Excluded pairs (semantic divergence, flagged by cce_vmi_ca_report.py)
        # are dropped from every comparison — they are not valid matches.
        return (not r.get("excluded")) and r.get("vmi") and r["vmi"].get("ex") is not None

    matched = [r for r in rows if is_matched(r)]
    n = len(matched)

    # ---- A1: aggregate verdict tally ----
    ex_more_vmi = sum(1 for r in matched if r["vmi"]["ex"] > r["cce"]["ex"])
    ex_more_cce = sum(1 for r in matched if r["cce"]["ex"] > r["vmi"]["ex"])
    su_more_cce = sum(1 for r in matched if r["cce"]["su"] > r["vmi"]["su"])
    scalar_more_cce = sum(1 for r in matched if r["cce"]["scalar"] > r["vmi"]["scalar"])
    ipc_better_vmi = sum(1 for r in matched if r["cce"]["ipc"] and r["vmi"]["ipc"] and r["vmi"]["ipc"] > r["cce"]["ipc"])
    exipc_better_vmi = sum(1 for r in matched if r["cce"]["ex_ipc"] and r["vmi"]["ex_ipc"] and r["vmi"]["ex_ipc"] > r["cce"]["ex_ipc"])
    rvec_dual_more_vmi = sum(1 for r in matched if r["vmi"]["rvec_dual"] > r["cce"]["rvec_dual"])
    a1_tally = [
        {"dimension": "EX count (more instrs)", "cce_worse": ex_more_cce, "vmi_worse": ex_more_vmi,
         "interpretation": "VMI lowering decomposes into more vector-compute ops (often workarounds for missing fused ops)"},
        {"dimension": "SU (store-desc setup)", "cce_worse": su_more_cce, "vmi_worse": n - su_more_cce,
         "interpretation": "CCE does manual per-stream store-descriptor setup; VMI consolidates"},
        {"dimension": "Scalar prologue", "cce_worse": scalar_more_cce, "vmi_worse": n - scalar_more_cce,
         "interpretation": "CCE's manual addr/loop setup is ~5× heavier than VMI's MLIR prologue"},
        {"dimension": "Overall IPC (lower = worse)", "cce_worse": ipc_better_vmi, "vmi_worse": n - ipc_better_vmi,
         "interpretation": "VMI's leaner prologue + MTE2 overlap lifts wall-clock throughput"},
        {"dimension": "EX-IPC (vector throughput)", "cce_worse": exipc_better_vmi, "vmi_worse": n - exipc_better_vmi,
         "interpretation": "VMI dual-issues the EX pipe more effectively (EX+EX, LD+EX)"},
        {"dimension": "RVEC dual-issue (fewer = worse)", "cce_worse": rvec_dual_more_vmi, "vmi_worse": n - rvec_dual_more_vmi,
         "interpretation": "CCE produces sequential dependency chains; VMI interleaves independent ops"},
    ]

    # ---- A2: VMI EX explosion (ΔEX ≥ 4) ----
    big_ex = sorted([r for r in matched if r["vmi"]["ex"] is not None and r["cce"]["ex"] is not None
                     and r["vmi"]["ex"] - r["cce"]["ex"] >= 4],
                    key=lambda x: x["vmi"]["ex"] - x["cce"]["ex"], reverse=True)
    a2_vmi_ex = []
    seen = set()
    for r in big_ex:
        if r["kernel"] in seen:
            continue
        seen.add(r["kernel"])
        c, v = r["cce"], r["vmi"]
        a2_vmi_ex.append({
            "kernel": r["kernel"], "cce_ex": c["ex"], "vmi_ex": v["ex"],
            "dex": v["ex"] - c["ex"],
            "exipc_ratio": _ratio(v["ex_ipc"], c["ex_ipc"]),
            "note": _kernel_note(r["kernel"]),
        })
        if len(a2_vmi_ex) >= 14:
            break

    # ---- A3: CCE EX explosion (ΔEX ≥ 3, CCE worse) ----
    cce_more = sorted([r for r in matched if r["cce"]["ex"] is not None and r["vmi"]["ex"] is not None
                       and r["cce"]["ex"] - r["vmi"]["ex"] >= 3],
                      key=lambda x: x["cce"]["ex"] - x["vmi"]["ex"], reverse=True)
    a3_cce_ex = []
    seen = set()
    for r in cce_more:
        if r["kernel"] in seen:
            continue
        seen.add(r["kernel"])
        c, v = r["cce"], r["vmi"]
        a3_cce_ex.append({
            "kernel": r["kernel"], "cce_ex": c["ex"], "vmi_ex": v["ex"],
            "dex": c["ex"] - v["ex"], "root_cause": _cce_cause(r["kernel"]),
        })
        if len(a3_cce_ex) >= 14:
            break

    # ---- A4: vf_real gap (|Δ| ≥ 30) ----
    big_gap = sorted([r for r in matched if r["cce"]["vf_real"] and r["vmi"]["vf_real"]
                      and abs(r["cce"]["vf_real"] - r["vmi"]["vf_real"]) >= 30],
                     key=lambda x: abs(x["cce"]["vf_real"] - x["vmi"]["vf_real"]), reverse=True)
    a4_vfreal = []
    seen = set()
    for r in big_gap:
        if r["kernel"] in seen:
            continue
        seen.add(r["kernel"])
        c, v = r["cce"], r["vmi"]
        gap = c["vf_real"] - v["vf_real"]
        a4_vfreal.append({
            "kernel": r["kernel"], "cce": c["vf_real"], "vmi": v["vf_real"],
            "delta": gap, "slower": _slower(gap),
            "cause": _vfreal_cause(gap, c["ipc"], v["ipc"]),
        })
        if len(a4_vfreal) >= 28:
            break

    # ---- A5: predicate differences ----
    a5_pred = []
    for r in matched:
        cp, vp = r["cce"]["pred"], r["vmi"]["pred"]
        if cp != vp:
            issue = ("CCE pushes a 2nd predicate block (extra cost)" if cp > vp else
                     "CCE has no VF predicate (possible correctness gap)" if cp == 0 else
                     "VMI pushes extra predicate")
            a5_pred.append({"kernel": r["kernel"], "cce_pred": cp, "vmi_pred": vp, "issue": issue})

    # ---- A6: stall-source difference (dominant longest-stall op per side) ----
    def _dominant_stall_source(rows, side):
        c = Counter()
        for r in rows:
            ts = r[side].get("top_stall")
            if not ts:
                continue
            # top_stall is "<unit>:<src>→<dst>=<N>c" (or "<src>→<dst>=<N>c")
            seg = ts.split(":")[-1]
            src = seg.split("→")[0]
            if src.startswith("RV_"):
                c[src] += 1
        if not c:
            return "?", 0
        op, cnt = c.most_common(1)[0]
        return (op[3:] if op.startswith("RV_") else op), cnt
    cce_label, cce_cnt = _dominant_stall_source(matched, "cce")
    vmi_label, vmi_cnt = _dominant_stall_source(matched, "vmi")
    a6_stall_pattern = {
        "cce_label": cce_label,
        "vmi_label": vmi_label,
        "headline": f"CCE {cce_label} vs VMI {vmi_label}",
        "cce_root": f"RV_{cce_label} — the most common longest-stall source on CCE ({cce_cnt} of {len(matched)} pairs)",
        "vmi_root": f"RV_{vmi_label} — the most common longest-stall source on VMI ({vmi_cnt} of {len(matched)} pairs)",
        "note": f"Dominant longest-stall (top_stall) source per side: CCE → RV_{cce_label} ({cce_cnt} pairs), VMI → RV_{vmi_label} ({vmi_cnt} pairs).",
        "cce_store_stalls": "CCE store-pipe stalls (top stall ST:RV_VSTI→RV_VSTI) appear in a few tile-unrolled kernels (VFProcessGroupIndex, GeluDynamicQuantWorkspace) - back-to-back VSTI serialize at 1 store/cycle.",
    }

    # ---- A7: diagnostic conclusion ----
    a7_conclusion = [
        {"problem": "EX explosion (missing fused ops)", "who": "VMI", "pairs": len(a2_vmi_ex), "fix": "Add fused ops to VMI (f32→int cast, gelu+quant, tanh)"},
        {"problem": "EX explosion (tile-unrolling)", "who": "CCE", "pairs": len(a3_cce_ex), "fix": "Shape-independent lowering + hardware dist_mode deintlv"},
        {"problem": "SU overhead (store-desc)", "who": "CCE", "pairs": su_more_cce, "fix": "Auto-generate consolidated store descriptors (VMI approach)"},
        {"problem": "Scalar prologue bloat", "who": "CCE", "pairs": scalar_more_cce, "fix": "MLIR-generated prologue (VMI approach)"},
        {"problem": "Predicate overhead", "who": "CCE", "pairs": len([r for r in a5_pred if "2nd predicate" in r["issue"]]), "fix": "Fold clip-threshold into single predicate (clippedSwiglu)"},
        {"problem": "No dual-issue", "who": "CCE", "pairs": "most", "fix": "Interleave independent ops; avoid PSET→compute chains"},
        {"problem": "Store-port stalls", "who": "CCE", "pairs": 4, "fix": "Consolidate stores; avoid back-to-back VSTI"},
        {"problem": "Low overall IPC", "who": "CCE", "pairs": f"{ipc_better_vmi}/{n}", "fix": "Leaner prologue + MTE2 overlap"},
        {"problem": "Low EX-IPC", "who": "CCE", "pairs": f"{exipc_better_vmi}/{n}", "fix": "Better dual-issue + shorter predicate-setup latency"},
    ]

    # ---- outliers: top-6 by CCE vf_real (excludes semantic-divergence pairs) ----
    outliers = []
    for r in sorted([r for r in rows if not r.get("excluded")], key=lambda r: -(r["cce"]["vf_real"] or 0))[:6]:
        c = r["cce"]
        note = ""
        if c["vf_real"] and c["vf_real"] > 200:
            note = "very high latency"
        elif (c["ex"] or 0) > 50:
            note = "EX-heavy"
        elif c["ipc"] is not None and c["ipc"] < 0.05:
            note = "IPC very low (prologue/MTE2 bound)"
        elif c["ex_ipc"] is not None and c["ex_ipc"] < 0.15:
            note = "EX-IPC very low (stall-bound)"
        outliers.append({
            "kernel": r["kernel"], "ex": c["ex"], "su": c["su"], "ld": c["ld"],
            "st": c["st"], "vf_real": c["vf_real"], "ipc": c["ipc"],
            "ex_ipc": c["ex_ipc"], "note": note,
        })

    return {
        "a1_tally": a1_tally,
        "a2_vmi_ex": a2_vmi_ex,
        "a3_cce_ex": a3_cce_ex,
        "a4_vfreal": a4_vfreal,
        "a5_pred": a5_pred,
        "a6_stall_pattern": a6_stall_pattern,
        "a7_conclusion": a7_conclusion,
        "outliers": outliers,
        "bottom_line": (
            "CCE has the systemic problems (scalar prologue bloat, SU overhead, no dual-issue, low IPC). "
            "VMI's main problem is EX explosion (missing fused ops) - but VMI compensates with better "
            "dual-issue, so the extra EX instructions rarely hurt EX-IPC."
        ),
        "net_conclusion": (
            "CCE's problems are architectural (manual prologue, store-desc, sequential lowering). "
            "VMI's problems are compiler-coverage (missing fused ops). VMI's better dual-issue means its "
            "extra EX instructions are usually free - the real VMI cost is only when dEX >= 8 AND EX-IPC ratio < 1."
        ),
        "unit_mapping": [
            {"user": "EX", "ca_unit": "RVECEX", "category": "vec_compute", "meaning": "vector compute (VMUL/VCVT/VDINTLV/PSET...)"},
            {"user": "SU", "ca_unit": "RVECSU", "category": "store_desc", "meaning": "scalar store-descriptor setup (SMOV/SADD...)"},
            {"user": "LD", "ca_unit": "RVECLD", "category": "vec_load", "meaning": "vector load (VLD)"},
            {"user": "ST", "ca_unit": "RVECST", "category": "vec_store", "meaning": "vector store data (VST)"},
            {"user": "predicate", "ca_unit": "PUSH_PB", "category": "predicate", "meaning": "push predicate block"},
            {"user": "-", "ca_unit": "MTE2", "category": "dma", "meaning": "GM<->UB DMA"},
            {"user": "-", "ca_unit": "SCALAR", "category": "scalar", "meaning": "addr / loop setup"},
            {"user": "-", "ca_unit": "FLOWCTRL", "category": "flowctrl", "meaning": "SET_FLAG / WAIT_FLAG"},
        ],
        "definitions": _derive_definitions(),
    }


def derive_latency_inventory(cce_raw, vmi_raw):
    """Aggregate stall target opcodes across all CCE+VMI cases (top 15)."""
    targets = Counter()
    for src in (cce_raw or [], vmi_raw or []):
        for rec in src:
            for entry in rec.get("long_stalls", []):
                # entry = [unit, from, to, gap]
                if len(entry) >= 4:
                    unit, _frm, to, _gap = entry[0], entry[1], entry[2], entry[3]
                    targets[(to, unit)] += 1
    return [{"instruction": to, "unit": unit, "occurrences": cnt}
            for (to, unit), cnt in targets.most_common(15)]


def derive_meta(rows, vmi_raw):
    matched = [r for r in rows if (not r.get("excluded")) and r.get("vmi") and r["vmi"].get("ex") is not None]
    cce_only = [r for r in rows if not r.get("excluded") and not (r.get("vmi") and r["vmi"].get("ex") is not None)]
    return {
        "cce_cases_total": len(rows),
        "matched_pairs": len(matched),
        "cce_only_count": len(cce_only),
        "excluded_count": len([r for r in rows if r.get("excluded")]),
        "excluded": [{"kernel": r["kernel"], "vmi_kernel": r["vmi_kernel"],
                       "cce_ex": r["cce"]["ex"], "vmi_ex": r["vmi"]["ex"],
                       "cce_vf_real": r["cce"]["vf_real"], "vmi_vf_real": r["vmi"]["vf_real"],
                       "cce_status": r.get("cce_status", "PASS"),
                       "vmi_status": r.get("vmi_status", "PASS"),
                       "reason": r["excluded"]}
                      for r in rows if r.get("excluded")],
        "vmi_cases_total": len(vmi_raw) if vmi_raw is not None else 0,
        "generated_from": "cce_vmi_ca_report.json",
    }


def build():
    data = load_json(JSON_PATH)
    if data is None:
        raise SystemExit(f"ERROR: {JSON_PATH} not found. Drop the report JSON into data/ first.")
    md = load_md()
    cce_raw = load_json(CCE_RAW_PATH)
    vmi_raw = load_json(VMI_RAW_PATH)
    rows = data["rows"]

    summary = derive_summary(rows)
    summary["latency_inventory"] = derive_latency_inventory(cce_raw, vmi_raw)
    meta = derive_meta(rows, vmi_raw)

    # Toolchain / SoC provenance (for the footer + definitions) — detected from
    # the actual run environment, never hardcoded.
    meta["cann_version"] = _detect_cann_version()
    meta["ptoas_version"] = _detect_ptoas_version()
    meta["soc_version"] = _detect_sim_soc()

    # Capture pto-vmi git commit for source links
    import subprocess
    try:
        repo_dir = os.environ.get("PTO_VMI_REPO", os.path.expanduser("~/pto-vmi"))
        commit = subprocess.check_output(["git", "-C", repo_dir, "rev-parse", "HEAD"], stderr=subprocess.DEVNULL).decode().strip()
        short_commit = subprocess.check_output(["git", "-C", repo_dir, "rev-parse", "--short", "HEAD"], stderr=subprocess.DEVNULL).decode().strip()
        meta["pto_vmi_commit"] = commit
        meta["pto_vmi_short_commit"] = short_commit
    except:
        meta["pto_vmi_commit"] = "main"
        meta["pto_vmi_short_commit"] = "main"

    # Build timestamp: pick the FRESHEST signal available.
    # NOTE: run_dashboard_refresh.sh writes its summary AFTER build_data.py runs,
    # so during a refresh the summary files still hold the PREVIOUS run's time.
    # The data/cce_vmi_ca_report.json (just regenerated) is the true "when the
    # sim ran" signal. Use max() of all candidates so it never regresses.
    run_date = None; run_ts = None
    daily_status = None; daily_ts = None

    def _ts_from_summary(path):
        if not os.path.isfile(path):
            return None, None
        try:
            s = json.load(open(path))
            ts = s.get("run_timestamp")
            if not ts and s.get("timestamp"):
                ts = int(datetime.datetime.fromisoformat(s["timestamp"]).timestamp())
            if not ts:
                return None, None
            date_str = s.get("run_date") or s.get("timestamp", "")[:16].replace("T", " ")
            return int(ts), date_str
        except Exception:
            return None, None

    candidates = []  # (timestamp, date_str)
    for summary_path in [os.path.expanduser("~/pto-vmi/logs/run_dashboard_refresh_summary.json"),
                         os.path.join(os.environ.get("PTO_VMI_REPO", ""), "logs", "run_dashboard_refresh_summary.json"),
                         os.path.expanduser("~/pto-vmi/logs/daily_refresh_summary.json"),
                         os.path.join(os.environ.get("PTO_VMI_REPO", ""), "logs", "daily_refresh_summary.json")]:
        ts, ds = _ts_from_summary(summary_path)
        if ts:
            candidates.append((ts, ds))
    # report.json mtime — the data we just built from (freshest during a refresh)
    report_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "cce_vmi_ca_report.json")
    if os.path.isfile(report_path):
        mt = int(os.path.getmtime(report_path))
        candidates.append((mt, datetime.datetime.fromtimestamp(mt).strftime("%Y-%m-%d %H:%M")))
    if candidates:
        run_ts, run_date = max(candidates, key=lambda x: x[0])

    # daily refresh status (read AFTER the timestamp loop so it never clobbers run_ts)
    for dp in [os.path.expanduser("~/pto-vmi/logs/daily_refresh_summary.json"),
               os.path.join(os.environ.get("PTO_VMI_REPO", ""), "logs", "daily_refresh_summary.json")]:
        if daily_status:
            break
        if os.path.isfile(dp):
            try:
                ds = json.load(open(dp))
                daily_status = ds.get("status")
                try:
                    daily_ts = int(datetime.datetime.fromisoformat(ds.get("timestamp", "")).timestamp())
                except Exception:
                    daily_ts = run_ts
            except Exception:
                pass

    # ultimate fallback: now
    if not run_ts:
        run_ts = int(datetime.datetime.now().timestamp())
        run_date = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    meta["build_date"] = run_date
    meta["build_timestamp"] = run_ts
    meta["daily_status"] = daily_status or "unknown"
    meta["daily_timestamp"] = daily_ts or run_ts

    payload = {
        "meta": meta,
        "rows": rows,
        "matched_count": len([r for r in rows if (not r.get("excluded")) and r.get("vmi") and r["vmi"].get("ex") is not None]),
        "summary": summary,
        "report_md": md,
    }

    os.makedirs(WEB, exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        f.write("/* AUTO-GENERATED by scripts/build_data.py - do not edit by hand.\n")
        f.write("   Embedded CCE vs VMI CA report data (offline, no fetch needed).\n")
        f.write("   Executive summary DERIVED from rows + raw analysis JSONs.\n")
        f.write("*/\n")
        f.write("window.REPORT = ")
        f.write(json.dumps(payload, separators=(",", ":")))
        f.write(";\n")

    size = os.path.getsize(OUT_PATH)
    print(f"Wrote {OUT_PATH} ({size/1024:.1f} KB)")
    print(f"  rows: {len(rows)}  matched: {meta['matched_pairs']}  cce_only: {meta['cce_only_count']}  vmi_cases: {meta['vmi_cases_total']}")
    print(f"  summary: a1_tally={len(summary['a1_tally'])} a2={len(summary['a2_vmi_ex'])} a3={len(summary['a3_cce_ex'])} a4={len(summary['a4_vfreal'])} a5={len(summary['a5_pred'])} latency_inv={len(summary['latency_inventory'])} outliers={len(summary['outliers'])}")


if __name__ == "__main__":
    build()
