#!/usr/bin/env python3
"""build_bundle.py — build a CCE-VMI Explorer bundle for one kernel+case.

Reads the 4 source layers (CCE cpp, DSL py, MLIR, VPTO IR, LLVM IR) + parses the
CA-model instr_log.dump (execution trace with ticks), correlates disasm instructions
to source lines by op→mnemonic structural matching, and writes a single JSON bundle.

Reuses the LINE_RE regex + parse approach from ca_instr_analysis.py (the skill's
dump parser) — kept inline here so the explorer is self-contained.

Usage:
    python3 build_bundle.py --kernel BrcAddKernel \
        --case BrcAddKernel.case_real_float_Rows_128_Cols_64 \
        [--repo ~/pto-vmi] [--pto-venv ~/miniconda3/envs/ptoas] [--out bundles/]
"""
import os, re, sys, json, argparse, subprocess, tempfile
from collections import defaultdict

# ---------------------------------------------------------------------------
# dump parser (adapted from ca_instr_analysis.py — LINE_RE + record collection)
# ---------------------------------------------------------------------------
LINE_RE = re.compile(
    r'^\[info\]\s+\[(\d+)\]\s+\(PC:\s+(0x[0-9a-fA-F]+)\)\s+([A-Z][A-Z0-9]*)\s*:\s+'
    r'\(Binary:\s+(0x[0-9a-fA-F]+)\)\s+\(ID:\s+(\d+)\)\s+(\S+)'
)
VF_REAL_RE = re.compile(r'vf_real_execute_time:\s*(\d+)')
RVEC_UNITS = {"RVECEX", "RVECSU", "RVECLD", "RVECST"}

def parse_dump(path):
    """Parse instr_log.dump → list of instruction dicts + timeline metadata.

    Each instruction: {tick, pc, unit, binary, id, mnemonic, operands}
    Dedups RV_SEND (same ID logged per consuming unit) by (id, tick).
    """
    if not path or not os.path.isfile(path):
        return None, None
    records = []
    seen = set()
    vf_real = None
    vf_start_tick = None
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            m = LINE_RE.match(line)
            if not m:
                continue
            tick = int(m.group(1)); pc = m.group(2); unit = m.group(3)
            binary = m.group(4); id_ = m.group(5); mnemonic = m.group(6)
            if "vf_real_execute_time" in line:
                mv = VF_REAL_RE.search(line)
                if mv: vf_real = int(mv.group(1))
            key = (id_, tick)
            if key in seen:
                continue
            seen.add(key)
            # operands = everything after the mnemonic on the line (trimmed)
            operands = line[m.end():].strip()
            records.append({"tick": tick, "pc": pc, "unit": unit,
                            "binary": binary, "id": id_, "mnemonic": mnemonic,
                            "operands": operands})
            if unit == "PUSHQ" and "PUSH_PB" in mnemonic and vf_start_tick is None:
                vf_start_tick = tick
    if not records:
        return None, None
    # VF-section records (between PUSH_PB and end); fallback all RVEC+PUSHQ
    last_tick = records[-1]["tick"]
    vf_recs = [r for r in records if vf_start_tick is not None and r["tick"] >= vf_start_tick]
    if not vf_recs:
        vf_recs = [r for r in records if r["unit"] in RVEC_UNITS or r["unit"] == "PUSHQ"]
    timeline = {
        "vf_real": vf_real,
        "first_tick": vf_recs[0]["tick"] if vf_recs else records[0]["tick"],
        "last_tick": vf_recs[-1]["tick"] if vf_recs else last_tick,
        "vf_start_tick": vf_start_tick,
    }
    return vf_recs, timeline

# ---------------------------------------------------------------------------
# stall detection (tick gaps between consecutive same-unit RVEC instrs)
# ---------------------------------------------------------------------------
def detect_stalls(records, ex_thresh=4, other_thresh=8):
    stalls = []
    per_unit = defaultdict(list)
    for r in records:
        if r["unit"] in RVEC_UNITS:
            per_unit[r["unit"]].append(r)
    for unit, recs in per_unit.items():
        thresh = ex_thresh if unit == "RVECEX" else other_thresh
        for i in range(1, len(recs)):
            gap = recs[i]["tick"] - recs[i-1]["tick"]
            if gap >= thresh:
                stalls.append({"tick": recs[i]["tick"], "gap": gap, "unit": unit,
                               "from": recs[i-1]["mnemonic"], "to": recs[i]["mnemonic"]})
    return sorted(stalls, key=lambda s: s["tick"])

# ---------------------------------------------------------------------------
# source-line correlation (structural, by op→mnemonic map + order within unit)
# ---------------------------------------------------------------------------
CALL_RE = re.compile(r'\b([A-Za-z_][A-Za-z0-9_]*)\s*\(')          # CCE intrinsics
VMI_OP_RE = re.compile(r'pto\.vmi\.([a-z_][a-z0-9_]*)')            # DSL pto.vmi.* ops
INFRA_RE = re.compile(r'pto\.(castptr|mte_load|mte_store|set_flag|wait_flag)\b')

def is_commented_cce(line, in_block_comment):
    """Check if a C++ line is entirely a comment (// or inside /* */).
    Returns (is_comment, new_in_block_state)."""
    s = line.lstrip()
    if in_block_comment:
        if '*/' in s:
            # rest of line after */ could be code, but for our purposes treat as comment
            return True, False
        return True, True
    if s.startswith('//') or s.startswith('/*') or s.startswith('*') or s.startswith('/*'):
        if '/*' in s and '*/' not in s:
            return True, True
        return True, False
    return False, False

def is_commented_py(line):
    """Check if a Python line is a comment or inside a string (triple-quote tracked)."""
    s = line.lstrip()
    if s.startswith('#'):
        return True
    return False

def find_source_calls(lines, pattern, kind="cce"):
    """Return list of (line_no_1indexed, matched_token) for calls matching pattern.
    Skips commented lines so correlations don't point at commented-out code."""
    hits = []
    in_block = False
    for i, ln in enumerate(lines, 1):
        if kind == "cce":
            is_cmt, in_block = is_commented_cce(ln, in_block)
            if is_cmt:
                continue
        else:  # python/dsl
            if is_commented_py(ln):
                continue
        for m in pattern.finditer(ln):
            tok = m.group(1)
            hits.append((i, tok))
    return hits

def build_corr_index(source_calls, corr_map):
    """Build mnemonic → [line_numbers] index from source calls + corr_map.
    source_calls: [(line, token)]. corr_map: token→RV_mnemonic."""
    idx = defaultdict(list)
    for line, tok in source_calls:
        rv = corr_map.get(tok)
        if rv:
            idx[rv].append(line)
    return idx

def correlate(disasm_recs, cce_idx, vmi_idx, mlir_idx):
    """Annotate each disasm instruction with cce_line/dsl_line/mlir_line (1-indexed or null).
    Uses order-based matching with WRAP: the Nth RV_VMULS in disasm ↔ source hit
    (N mod len(hits)) — so all 128 unrolled executions of the same op point to the
    same source line (the one call in the source)."""
    counters = defaultdict(int)
    for r in disasm_recs:
        mn = r["mnemonic"]
        cce_line = vmi_line = mlir_line = None
        if mn.startswith("RV_") or mn in ("PUSH_PB",):
            n = counters[mn]
            if mn in cce_idx and cce_idx[mn]:
                cce_line = cce_idx[mn][n % len(cce_idx[mn])]
            if mn in vmi_idx and vmi_idx[mn]:
                vmi_line = vmi_idx[mn][n % len(vmi_idx[mn])]
            if mn in mlir_idx and mlir_idx[mn]:
                mlir_line = mlir_idx[mn][n % len(mlir_idx[mn])]
            counters[mn] += 1
        r["cce_line"] = cce_line
        r["dsl_line"] = vmi_line
        r["mlir_line"] = mlir_line
    return disasm_recs

# ---------------------------------------------------------------------------
# MLIR op extraction (for mlir→disasm correlation)
# ---------------------------------------------------------------------------
MLIR_OP_RE = re.compile(r'pto\.vmi\.([a-z_][a-z0-9_]*)')
MLIR_RV_RE = re.compile(r'\bRV_([A-Z][A-Z0-9_]*)')

def find_mlir_ops(mlir_lines, vmi_to_rv):
    """Return mnemonic→[line_numbers] for MLIR pto.vmi.* ops."""
    idx = defaultdict(list)
    for i, ln in enumerate(mlir_lines, 1):
        for m in MLIR_OP_RE.finditer(ln):
            op = m.group(1)
            rv = vmi_to_rv.get(op)
            if rv:
                idx[rv].append(i)
    return idx

# ---------------------------------------------------------------------------
# IR emission (MLIR via --emit-mlir; VPTO + LLVM via ptoas)
# ---------------------------------------------------------------------------
def emit_mlir(py_path, pto_python):
    for flag in ("--emit-mlir", "--emit"):
        r = subprocess.run([pto_python, py_path, flag],
                           capture_output=True, text=True, timeout=120)
        if r.returncode == 0 and r.stdout.strip():
            return r.stdout, None
    return None, (r.stderr or "").strip()[:500]

def emit_ptoas(mlir_text, ptoas_bin, mode, tmpdir, tag, arch):
    """mode = '--emit-vpto' or '--emit-vpto-llvm-ir'."""
    mlir_file = os.path.join(tmpdir, f"{tag}.mlir")
    out_file = os.path.join(tmpdir, f"{tag}.{mode.replace('--','').replace('-','_')}.out")
    with open(mlir_file, "w") as f:
        f.write(mlir_text)
    cmd = [ptoas_bin, f"--pto-arch={arch}", "--pto-backend=vpto", mode, mlir_file, "-o", out_file]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if r.returncode != 0 or not os.path.isfile(out_file):
        return None, r.stderr.strip()[:500]
    with open(out_file) as f:
        return f.read(), None

# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
# Use the pto-vmi commit at build time for stable source links
import subprocess as _sp
try:
    _repo = os.environ.get("PTO_VMI_REPO", os.path.expanduser("~/pto-vmi"))
    _commit = _sp.check_output(["git", "-C", _repo, "rev-parse", "HEAD"], stderr=_sp.DEVNULL).decode().strip()
except:
    _commit = "main"
GITCODE_BASE = "https://gitcode.com/csjlchen/pto-vmi/tree/" + _commit

# ---------------------------------------------------------------------------
# VMI feature taxonomy (§1–§6 from docs/pto_vmi_features.md)
# Single source of truth: docs/pto_vmi_features.md — parsed by parse_features.py.
# The kernel→feature membership, evidence strings and sub-category flags all come
# from the doc's §1–§6 tables + §9 matrix + notes (no duplicate hardcoded map).
try:
    import parse_features
except ImportError:  # make the import work regardless of cwd
    import importlib.util, os as _os
    _spec = importlib.util.spec_from_file_location(
        "parse_features", _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "parse_features.py"))
    parse_features = importlib.util.module_from_spec(_spec)
    _spec.loader.exec_module(parse_features)

_FEATURES_DOC = {}  # cache: repo -> taxonomy (or None)


def _load_features_doc(repo):
    if repo not in _FEATURES_DOC:
        md = os.path.join(repo, "docs", "pto_vmi_features.md")
        try:
            _FEATURES_DOC[repo] = parse_features.parse_features_md(md) if os.path.isfile(md) else None
        except Exception:
            _FEATURES_DOC[repo] = None
    return _FEATURES_DOC[repo]


def _derive_vmi_features(kernel, repo):
    """Return (feature_keys, evidence_map, subs_map) parsed from docs/pto_vmi_features.md."""
    doc = _load_features_doc(repo)
    if doc and kernel in doc["kernels"]:
        info = doc["kernels"][kernel]
        return info["features"], info["evidence"], info["subs"]
    return [], {}, {}


# coverage tags (compute-pattern × dtype × shape + reduce/pack-unpack dims)
# ---------------------------------------------------------------------------
_TAG_BREAKDOWN = None  # cached cce_vmi_instruction_breakdown.json

def _load_breakdown(repo):
    global _TAG_BREAKDOWN
    if _TAG_BREAKDOWN is not None:
        return _TAG_BREAKDOWN
    path = os.path.join(repo, "docs", "cce_vmi_instruction_breakdown.json")
    if os.path.isfile(path):
        with open(path) as f:
            _TAG_BREAKDOWN = json.load(f)
    else:
        _TAG_BREAKDOWN = {"matched": []}
    return _TAG_BREAKDOWN

# op-set → compute pattern (a kernel can match multiple)
_PATTERN_OPS = {
    "reduce": {"vcadd","vcmax","vcmin","vcgadd","vcgmax","vcgmin","vcpadd","vcpaddv2","reduce_addf","reduce_maxf","reduce_minf"},
    "broadcast": {"vbrc","broadcast","vbr","vdup"},
    "elementwise": {"vadd","vsub","vmul","vdiv","vmax","vmin","vadds","vmuls","vmaxs","vmins","vshls","vshrs","vand","vor","vxor","vnot","vshl","vshr"},
    "cast/pack": {"vcvt","vinterpret_cast","vpack","vunpack"},
    "gather/scatter": {"vgather","vscatter","vgatherb","compress","compress_store"},
    "select/mask": {"vsel","vselr","vcmp","vcmps","create_mask","create_group_mask"},
    "rearrange": {"vdintlv","vintlv","shuffle","channel_split","channel_merge"},
    "sfu/activation": {"vexp","vln","vsqrt","vabs","vneg","vrelu","vlrelu","vprelu","vexpdif","vaxpy","vmula","vmull","vfma"},
}
_SUBGROUP_REDUCE = {"vcgadd","vcgmax","vcgmin","vcpadd","vcpaddv2"}
_FULL_REDUCE = {"vcadd","vcmax","vcmin"}
_DTYPE_MAP = {"f16":"half","f32":"float","u32":"uint32","u16":"uint16","u8":"uint8","i8":"int8","i16":"int16","i32":"int32","fp8":"fp8","bf16":"bf16"}  # collapse aliases
_PACK_TOKENS = ["PK_B32","PK_B16","PK4_B32","UNPK_B8","UNPK_B16","UNPK_B32"]

def _norm_dtype(dt):
    return _DTYPE_MAP.get(dt, dt)

def derive_tags(kernel, case_id, vmi_op_counts, mlir_text, case_filename, repo):
    """Derive the coverage tags block for a bundle."""
    ops = set(vmi_op_counts.keys()) if vmi_op_counts else set()
    # --- compute_pattern ---
    patterns = []
    for pat, opset in _PATTERN_OPS.items():
        if ops & opset:
            patterns.append(pat)
    # quant: any op with 'quant' or 'mxfp' in the name
    if any("quant" in o or "mxfp" in o for o in ops):
        patterns.append("quant")
    # --- reduce_kind / group_size / dim ---
    reduce_kinds = []
    if ops & _SUBGROUP_REDUCE:
        reduce_kinds.append("sub-group")
    if ops & _FULL_REDUCE:
        reduce_kinds.append("full-vector")
    if "vcpadd" in ops or "vcpaddv2" in ops:
        if "pairwise" not in reduce_kinds:
            reduce_kinds.append("pairwise")
    reduce_group_size = None
    if reduce_kinds:
        if "sub-group" in reduce_kinds:
            reduce_group_size = 8
        elif "full-vector" in reduce_kinds:
            reduce_group_size = 64
    # --- dtypes + shapes (from case filename) ---
    # Supports both _real_<dtype>_Rows_<N>_Cols_<N> and case0_<dtype>_<dtype>_<N>_<N> formats
    dtypes = []
    shapes = []
    fn = case_filename or ""
    # Parse by splitting on _ — works for caseN_<dtype1>_<dtype2>_<rows>_<cols>
    parts = fn.replace(".py","").replace(".cpp","").split("_")
    case_idx = None
    for i, p in enumerate(parts):
        if p.startswith("case") and p[4:].isdigit():
            case_idx = i
            break
    if case_idx is not None:
        rest = parts[case_idx+1:]
        shape_parts = []
        for p in rest:
            if p.isdigit():
                shape_parts.append(int(p))
            else:
                dt = _norm_dtype(p)
                if dt not in dtypes:
                    dtypes.append(dt)
        if len(shape_parts) >= 2:
            shapes.append({"rows": shape_parts[0], "cols": shape_parts[1]})
        elif len(shape_parts) == 1:
            shapes.append({"rows": shape_parts[0], "cols": None})
    # Fallback: try _real_ format
    if not dtypes:
        m = re.search(r'_real_([a-z0-9_]+?)_(?:Rows|N|Cols)', fn)
        if m:
            for part in m.group(1).split("_"):
                if part and part not in ("interleaved","round"):
                    dt = _norm_dtype(part)
                    if dt not in dtypes:
                        dtypes.append(dt)
    if not shapes:
        sm = re.search(r'Rows_(\d+)_Cols_(\d+)', fn)
        if sm:
            shapes.append({"rows": int(sm.group(1)), "cols": int(sm.group(2))})
        else:
            sm2 = re.search(r'Rows_(\d+)', fn)
            if sm2:
                shapes.append({"rows": int(sm2.group(1)), "cols": None})
    # --- reduce_dim (best-effort from kernel name + shape) ---
    reduce_dim = "none"
    if reduce_kinds:
        kn = kernel.lower()
        if "rowmax" in kn or "rowmin" in kn or "amaxperrow" in kn or "row" in kn:
            reduce_dim = "row"
        elif "amaxperblock" in kn or "perblock" in kn or "block" in kn:
            reduce_dim = "block"
        elif shapes and shapes[0].get("cols") and shapes[0]["cols"] >= 128:
            reduce_dim = "row"  # reducing across cols (row-reduce) if cols is large
        else:
            reduce_dim = "row"  # default for reduce kernels (most reduce across the vector = row)
    # if group_size 64 but cols >= 128, upgrade to multi-VL
    if reduce_group_size == 64 and shapes and shapes[0].get("cols") and shapes[0]["cols"] >= 128:
        reduce_group_size = shapes[0]["cols"]
    # --- reduce_group_size (normalize None to "N/A") ---
    if reduce_group_size is None:
        reduce_group_size = "N/A"
    # --- data_movement ---
    dm = []
    if {"vgather","vgatherb"} & ops: dm.append("gather")
    if "vscatter" in ops: dm.append("scatter")
    if {"vbrc","broadcast","vbr","vdup"} & ops: dm.append("broadcast")
    if {"vdintlv","vintlv"} & ops: dm.append("dintlv")
    if {"vpack"} & ops: dm.append("pack")
    if {"vunpack"} & ops: dm.append("unpack")
    # --- pack_unpack (VPTO dist tokens from MLIR) ---
    pack_unpack = []
    if mlir_text:
        for tok in _PACK_TOKENS:
            if tok in mlir_text:
                pack_unpack.append(tok)
        if pack_unpack:
            if "pack" not in dm and any(t.startswith("PK_") for t in pack_unpack):
                dm.append("pack")
            if "unpack" not in dm and any(t.startswith("UNPK_") for t in pack_unpack):
                dm.append("unpack")
    # --- isa_modes (best-effort from 0722 doc) ---
    isa_modes = _isa_modes_for_kernel(kernel, repo)
    # VMI feature taxonomy (§1–§6 from pto_vmi_features.md; parsed from the doc)
    vmi_features, vmi_evidence, vmi_subs = _derive_vmi_features(kernel, repo)
    tags = {
        "dtypes": dtypes,
        "shapes": shapes,
        "compute_pattern": patterns,
        "reduce_kind": reduce_kinds,
        "reduce_group_size": reduce_group_size,
        "reduce_dim": reduce_dim,
        "data_movement": dm,
        "pack_unpack": pack_unpack,
        "isa_modes": isa_modes,
        "vmi_features": vmi_features,
        "vmi_evidence": vmi_evidence,
    }
    if vmi_subs:
        tags["vmi_subs"] = vmi_subs
    return tags

_ISA_MODES_MAP = None
def _isa_modes_for_kernel(kernel, repo):
    """Best-effort: parse pto_vmi_issue_0722.md for per-kernel mode mentions."""
    global _ISA_MODES_MAP
    if _ISA_MODES_MAP is None:
        _ISA_MODES_MAP = {}
        doc = os.path.join(repo, "docs", "pto_vmi_issue_0722.md")
        if os.path.isfile(doc):
            text = open(doc, encoding="utf-8", errors="replace").read()
            # The doc uses {key="value"} syntax (e.g. {pmode="zero"}, {rnd="R"}, {dist_mode="unpack"})
            # Also match bare key="value" in code spans
            for line in text.splitlines():
                # match mode tags: pmode="zero", rnd="R", dist_mode="unpack", sat="true", etc.
                modes = re.findall(r'([a-z_]+)="([A-Za-z_]+)"', line)
                if not modes:
                    continue
                # find kernel names mentioned on the same line
                knames = re.findall(r'([A-Z][a-zA-Z0-9]*Kernel)', line)
                if not knames:
                    continue
                for kn in knames:
                    _ISA_MODES_MAP.setdefault(kn, set())
                    for mk, mv in modes:
                        _ISA_MODES_MAP[kn].add(mk + "=" + mv)
        # convert sets to sorted lists
        _ISA_MODES_MAP = {k: sorted(v) for k, v in _ISA_MODES_MAP.items()}
    return _ISA_MODES_MAP.get(kernel, [])

def get_vmi_op_counts(kernel, repo):
    """Look up the VMI op counts for a kernel from the breakdown JSON."""
    bd = _load_breakdown(repo)
    for m in bd.get("matched", []):
        if m.get("vmi") == kernel or m.get("cce") == kernel:
            return m.get("vmi_data", {}).get("vmi_op_counts", {})
    return {}

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--kernel", required=True, help="Kernel dir name (e.g. BrcAddKernel)")
    ap.add_argument("--case", required=True, help="CCE case_id (e.g. BrcAddKernel.case_real_float_Rows_128_Cols_64)")
    ap.add_argument("--repo", default=os.path.expanduser("~/pto-vmi"))
    ap.add_argument("--arch", default="a6", choices=["a5", "a6"],
                    help="target arch: a6 uses cce/a6/<k> and logs/a6_{cce,vmi}_logs/<k>")
    ap.add_argument("--pto-venv", default=os.path.expanduser("~/miniconda3/envs/ptoas"))
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "bundles"))
    ap.add_argument("--side", default="vmi", choices=["vmi", "cce", "both"],
                    help="which dump side to parse (vmi=DSL trace, cce=CCE trace, both=both in one bundle)")
    ap.add_argument("--corr-map", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "corr_map.json"))
    args = ap.parse_args()

    repo = args.repo
    pto_python = os.path.join(args.pto_venv, "bin", "python3")
    ptoas_bin = os.path.join(args.pto_venv, "bin", "ptoas")

    with open(args.corr_map) as f:
        corr = json.load(f)
    cce_to_rv = corr["cce_to_rv"]
    vmi_to_rv = corr["vmi_to_rv"]

    # --- 1. CCE cpp ---
    cce_base = os.path.join(repo, "cce")
    cce_dir = os.path.join(cce_base, args.kernel) if args.arch == "a5" else os.path.join(cce_base, args.arch, args.kernel)
    cpp_files = [f for f in os.listdir(cce_dir) if f.endswith(".cpp") and f != "main.cpp"] if os.path.isdir(cce_dir) else []
    if not cpp_files:
        cpp_files = [f for f in os.listdir(cce_dir) if f.endswith(".cpp")]
    cce_cpp_file = os.path.join(cce_dir, cpp_files[0]) if cpp_files else None
    cce_lines = []
    if cce_cpp_file:
        with open(cce_cpp_file, encoding="utf-8", errors="replace") as f:
            cce_lines = f.read().splitlines()
    cce_rel = os.path.relpath(cce_cpp_file, repo) if cce_cpp_file else None

    # --- 2. DSL py (find the real-shape .py matching the case) ---
    dsl_dir = os.path.join(repo, "dsl", args.kernel)
    dsl_py_file = None
    if os.path.isdir(dsl_dir):
        pys = sorted(f for f in os.listdir(dsl_dir) if f.endswith(".py") and "_real_" in f)
        if not pys:
            pys = sorted(f for f in os.listdir(dsl_dir) if f.endswith(".py"))
        if pys:
            dsl_py_file = os.path.join(dsl_dir, pys[0])
    dsl_lines = []
    if dsl_py_file:
        with open(dsl_py_file, encoding="utf-8", errors="replace") as f:
            dsl_lines = f.read().splitlines()
    dsl_rel = os.path.relpath(dsl_py_file, repo) if dsl_py_file else None

    # --- 3. MLIR ---
    mlir_text, mlir_err = (None, "no DSL py")
    if dsl_py_file:
        mlir_text, mlir_err = emit_mlir(dsl_py_file, pto_python)
    mlir_lines = mlir_text.splitlines() if mlir_text else []

    # --- 4+5. VPTO + LLVM IR ---
    vpto_text = llvm_text = None
    vpto_err = llvm_err = None
    if mlir_text:
        with tempfile.TemporaryDirectory() as tmpdir:
            vpto_text, vpto_err = emit_ptoas(mlir_text, ptoas_bin, "--emit-vpto", tmpdir, args.kernel, args.arch)
            llvm_text, llvm_err = emit_ptoas(mlir_text, ptoas_bin, "--emit-vpto-llvm-ir", tmpdir, args.kernel, args.arch)
    vpto_lines = vpto_text.splitlines() if vpto_text else []
    llvm_lines = llvm_text.splitlines() if llvm_text else []

    # --- 6. parse dumps ---
    def load_dump(side):
        if args.arch == "a6":
            sub = "a6_vmi_logs" if side == "vmi" else "a6_cce_logs"
            dpath = os.path.join(repo, "logs", sub, args.kernel,
                                 "core0.veccore0.instr_log.dump")
        elif side == "vmi":
            dpath = os.path.join(repo, "logs", "run_vmi_30k", args.kernel,
                                 "core0.veccore0.instr_log.dump")
        else:
            dpath = os.path.join(repo, "logs", "run_cce_30k", args.case,
                                 "core0.veccore0.instr_log.dump")
        return parse_dump(dpath)

    # primary side for correlation
    primary_side = "vmi" if args.side in ("vmi", "both") else "cce"
    disasm_recs, timeline = load_dump(primary_side)
    if disasm_recs is None and args.side == "both":
        disasm_recs, timeline = load_dump("cce")
        primary_side = "cce"
    if disasm_recs is None:
        # try the other side as fallback
        other = "cce" if primary_side == "vmi" else "vmi"
        disasm_recs, timeline = load_dump(other)
        primary_side = other

    cce_disasm = cce_timeline = None
    vmi_disasm = vmi_timeline = None
    if args.side == "both":
        vmi_disasm, vmi_timeline = load_dump("vmi")
        cce_disasm, cce_timeline = load_dump("cce")

    if disasm_recs is None:
        print(f"[build_bundle] ERROR: no dump found for {args.kernel} (case={args.case})", file=sys.stderr)
        sys.exit(1)

    # --- 7. correlate ---
    stalls = detect_stalls(disasm_recs)
    cce_calls = find_source_calls(cce_lines, CALL_RE, "cce")
    dsl_calls = find_source_calls(dsl_lines, VMI_OP_RE, "vmi")
    cce_idx = build_corr_index(cce_calls, cce_to_rv)
    dsl_idx = build_corr_index(dsl_calls, vmi_to_rv)
    mlir_idx = find_mlir_ops(mlir_lines, vmi_to_rv)
    correlate(disasm_recs, cce_idx, dsl_idx, mlir_idx)

    if cce_disasm:
        correlate(cce_disasm, cce_idx, dsl_idx, mlir_idx)
        cce_stalls = detect_stalls(cce_disasm)
        cce_timeline["stalls"] = cce_stalls
    if vmi_disasm:
        correlate(vmi_disasm, cce_idx, dsl_idx, mlir_idx)
        vmi_stalls = detect_stalls(vmi_disasm)
        vmi_timeline["stalls"] = vmi_stalls

    # --- 8. write bundle ---
    bundle = {
        "kernel": args.kernel,
        "case": args.case,
        "case_id": args.case,
        "gitcode_base": GITCODE_BASE,
        "primary_side": primary_side,
        "layers": {
            "cce_cpp": {"lines": cce_lines, "file": cce_rel,
                        "src_url": f"{GITCODE_BASE}/{cce_rel}" if cce_rel else None},
            "dsl_py": {"lines": dsl_lines, "file": dsl_rel,
                       "src_url": f"{GITCODE_BASE}/{dsl_rel}" if dsl_rel else None},
            "mlir": {"lines": mlir_lines, "error": mlir_err if not mlir_text else None},
            "vpto": {"lines": vpto_lines, "error": vpto_err if not vpto_text else None},
            "llvm_ir": {"lines": llvm_lines, "error": llvm_err if not llvm_text else None},
            "disasm": {"instructions": disasm_recs, "side": primary_side},
        },
        "timeline": timeline,
    }
    if cce_disasm:
        bundle["layers"]["cce_disasm"] = {"instructions": cce_disasm, "side": "cce"}
        bundle["cce_timeline"] = cce_timeline
    if vmi_disasm:
        bundle["layers"]["vmi_disasm"] = {"instructions": vmi_disasm, "side": "vmi"}
        bundle["vmi_timeline"] = vmi_timeline

    # stats for validation
    n_corr_cce = sum(1 for r in disasm_recs if r["cce_line"])
    n_corr_dsl = sum(1 for r in disasm_recs if r["dsl_line"])
    n_corr_mlir = sum(1 for r in disasm_recs if r["mlir_line"])
    n_rv = sum(1 for r in disasm_recs if r["mnemonic"].startswith("RV_"))
    bundle["stats"] = {
        "disasm_count": len(disasm_recs),
        "rv_instr_count": n_rv,
        "correlated_to_cce": n_corr_cce,
        "correlated_to_dsl": n_corr_dsl,
        "correlated_to_mlir": n_corr_mlir,
        "stall_count": len(stalls),
    }
    timeline["stalls"] = stalls

    # --- 7b. derive coverage tags ---
    vmi_op_counts = get_vmi_op_counts(args.kernel, repo)
    dsl_filename = os.path.basename(dsl_py_file) if dsl_py_file else ""
    tags = derive_tags(args.kernel, args.case, vmi_op_counts, mlir_text, dsl_filename, repo)
    bundle["tags"] = tags

    os.makedirs(args.out, exist_ok=True)
    # sanitize case for filename
    safe_case = re.sub(r'[^A-Za-z0-9_.-]', '_', args.case)
    out_path = os.path.join(args.out, f"{args.kernel}.{safe_case}.json")
    with open(out_path, "w") as f:
        json.dump(bundle, f, separators=(",", ":"))
    size = os.path.getsize(out_path)
    print(f"[build_bundle] wrote {out_path} ({size/1024:.1f} KB)")
    print(f"  disasm={len(disasm_recs)} rv={n_rv} corr_cce={n_corr_cce} corr_dsl={n_corr_dsl} corr_mlir={n_corr_mlir} stalls={len(stalls)} vf_real={timeline.get('vf_real')}")

if __name__ == "__main__":
    main()
