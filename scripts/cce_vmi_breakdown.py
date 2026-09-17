#!/usr/bin/env python3
"""
Build a full instruction breakdown for all CCE and VMI kernels in pto-vmi,
match each VMI kernel to its CCE counterpart (same case / same functionality),
and emit a side-by-side comparison report.

CCE  : raw CCE intrinsics  (cce/<Kernel>/*_kernel.cpp)
VMI  : pto.vmi.* ops       (dsl/<Kernel>/*.py — ptodsl Python API emitting VMI IR)

NOTE: pto-vmi commit 0125c26 removed the top-level `vmi/` folder ("use dsl
version"). VMI/DSL kernels now live exclusively under `dsl/<Kernel>/*.py`,
which build VMI IR via the ptodsl Python API (`pto.vmi.vload(...)`, etc.).
This scanner walks `dsl/*/*.py` and aggregates `pto.vmi.*` op call sites —
the same instruction-frequency view the old `vmi/*/kernel.pto` scan gave.
"""
import os, re, json, sys
from collections import Counter, OrderedDict

ROOT = os.environ.get("PTO_VMI_REPO", os.path.expanduser("~/pto-vmi"))
CCE_DIR = os.path.join(ROOT, "cce")
DSL_DIR = os.path.join(ROOT, "dsl")          # was VMI_DIR = ROOT/"vmi" (removed in 0125c26)
OUT_MD  = os.path.join(ROOT, "docs", "cce_vmi_instruction_breakdown.md")
OUT_JSON= os.path.join(ROOT, "docs", "cce_vmi_instruction_breakdown.json")

# ---------------------------------------------------------------------------
# 1. Curated CCE intrinsic allowlist (vector + predicate + DMA/sync + scalar)
#    Sourced from docs/__clang_cce_vector_intrinsics.h + observed scalar ops.
# ---------------------------------------------------------------------------
VECTOR_INSTR = set("""
vabs vadd vadds vavg vaxpy vbcnt vbr vbr_f16 vbr_f32 vbr_s16 vbr_s32 vbr_s8
vbr_u16 vbr_u32 vbr_u8 vcadd vcgadd vcgaddv2 vci vcls vcmp vcmp_eq vcmp_ge
vcmp_lt vcmp_ne vcmps vcmps_eq vcmps_ge vcmps_gt vcmps_le vcmps_lt vcmps_ne
vcp vcpadd vcpaddv2 vcvt vdintlv vdintlvv2 vdiv vdup vexpdif vext vextfa vfcvt
vfma vgather2 vgather2_bc vgatherb vintegral vintlv vintlvv2 vld vlda vldas
vldi vlds vldu vldui vldus vload vmod vmov vmul vmula vmulcmps vmulcvt vmull
vmuls vmulscvt vneg vnop vnopxn vnot vor vpack vpackv2 vscatter vscvt vsel
vselr vselrv2 vsfcvt vshl vshls vshr vshrs vsld vsldb vslide vsqz vsst vsstb
vst vsta vstai vstar vstas vstore vsts vstu vstui vstur vstus vsub vtrc vunpack
vusqz vxor vmadd vaddc vaddcs vsubc vsubcs vldsx2 vstsx2 vlrelu vrelu vprelu
vmax vmin vmaxs vmins vln vsqrt sprclr chistv2 dhistv2 sprsts vdsts vmulscvt
""".split())

PRED_INSTR = set("""
pand pdintlv_b32 pdintlv_b16 pdintlv_b8 pge_b16 pge_b32 pge_b8 pintlv_b32
pintlv_b16 pintlv_b8 plt_2xvl_b64 pltm_2xvl_b64 plt_b32 plt_b16 plt_b8 pnot
por ppack psel pset_b16 pset_b32 pset_b8 pset_2xvl_b64 punpack pxor pld pldi
plds pmov psts psti pstu
""".split())

DMA_SYNC = set("""TLOAD TSTORE TASSIGN set_flag wait_flag""".split())

CCE_INSTR = VECTOR_INSTR | PRED_INSTR | DMA_SYNC

# classify for the report
def cce_kind(tok):
    if tok in PRED_INSTR:   return "pred"
    if tok in DMA_SYNC:     return "dma/sync"
    return "vec"

# ---------------------------------------------------------------------------
# 2. CCE extraction  (unchanged — reads cce/<Kernel>/*_kernel.cpp)
# ---------------------------------------------------------------------------
CALL_RE = re.compile(r'\b([A-Za-z_][A-Za-z0-9_]*)\s*\(')

def cce_kernel_cpp(dpath):
    """Return the kernel .cpp (not main.cpp) inside a cce kernel dir."""
    cpps = [f for f in os.listdir(dpath) if f.endswith(".cpp") and f != "main.cpp"]
    if not cpps:
        cpps = [f for f in os.listdir(dpath) if f.endswith(".cpp")]
    return os.path.join(dpath, cpps[0]) if cpps else None

def extract_cce(dpath):
    cpp = cce_kernel_cpp(dpath)
    if not cpp:
        return None
    src = open(cpp, encoding="utf-8", errors="replace").read()
    cnt = Counter()
    for m in CALL_RE.finditer(src):
        tok = m.group(1)
        if tok in CCE_INSTR:
            cnt[tok] += 1
    return {
        "cpp": os.path.relpath(cpp, ROOT),
        "instr_counts": dict(sorted(cnt.items(), key=lambda x: (-x[1], x[0]))),
        "instr_set": sorted(cnt.keys()),
        "total": sum(cnt.values()),
        # compute-only = vector + predicate (exclude DMA/sync) for apples-to-apples vs VMI ops
        "compute_counts": dict(sorted({k:v for k,v in cnt.items() if k not in DMA_SYNC}.items(), key=lambda x: (-x[1], x[0]))),
        "compute_total": sum(v for k,v in cnt.items() if k not in DMA_SYNC),
        "dma_sync_total": sum(v for k,v in cnt.items() if k in DMA_SYNC),
        "kinds": sorted({cce_kind(t) for t in cnt}),
    }

# ---------------------------------------------------------------------------
# 3. VMI extraction  (rewritten: scans dsl/<Kernel>/*.py for pto.vmi.* ops)
# ---------------------------------------------------------------------------
VMI_OP_RE  = re.compile(r'(?<!!)\bpto\.vmi\.([a-z_][a-z0-9_]*)')
PTO_INFRA_RE = re.compile(r'(?<!!)\bpto\.([a-z_][a-z0-9_]*)')
# Real VMI infra / structure ops (exclude types like `ptr` and attributes like
# `target_arch`, `kernel_kind`, `kernel`, and the `vmi` namespace itself).
INFRA_OPS = {
    "castptr", "mte_gm_ub", "mte_ub_gm", "mte_load", "mte_store",
    "set_flag", "wait_flag", "vecscope", "barrier",
    "barrier_start", "barrier_end", "sync", "bar",
}
# cce_ref hints in dsl .py docstrings/comments:
#   "cce/<Kernel>/<file>.cpp :: <Func>"  or  "VMI DSL port of cce/<Kernel>/..."
CCE_PATH_RE  = re.compile(r'cce/([A-Za-z0-9_]+)/', re.I)
CCE_FUNC_RE  = re.compile(r'::\s*([A-Za-z0-9_]+)')
JIT_NAME_RE  = re.compile(r'@pto\.jit\s*\(\s*[^)]*?\bname\s*=\s*["\']([^"\']+)["\']', re.S)

ABBREV = {
    "dyn": "dynamic",
    "mxfp4": "mxfp4",
    "mxfp8": "mxfp8",
}

def normalize_stem(name):
    """lowercase, drop kernel/test/vf suffixes & non-alphanumerics for fuzzy match."""
    s = name.lower()
    s = re.sub(r'(kernel|test)$', '', s)
    s = re.sub(r'vf$', '', s)
    s = re.sub(r'[^a-z0-9_]', '', s)
    # expand common abbreviations so 'dyn' matches 'dynamic'
    parts = s.split('_')
    parts = [ABBREV.get(p, p) for p in parts]
    s = ''.join(parts)
    return s

def extract_vmi(dpath):
    """Aggregate pto.vmi.* ops across all .py files in a dsl/<Kernel>/ dir."""
    try:
        py_files = sorted(f for f in os.listdir(dpath) if f.endswith(".py"))
    except OSError:
        return None
    if not py_files:
        return None
    vmi_ops = Counter()
    infra = Counter()
    combined_parts = []
    for f in py_files:
        p = os.path.join(dpath, f)
        try:
            src = open(p, encoding="utf-8", errors="replace").read()
        except OSError:
            continue
        combined_parts.append(src)
        for m in VMI_OP_RE.finditer(src):
            vmi_ops[m.group(1)] += 1
        for m in PTO_INFRA_RE.finditer(src):
            op = m.group(1)
            if op == "vmi" or op not in INFRA_OPS:
                continue
            infra[op] += 1
    combined = "\n".join(combined_parts)
    # CCE reference: prefer an explicit `cce/<Kernel>/` path mention in the
    # docstring; fall back to a `:: FuncName` hint.
    cce_ref = None
    m = CCE_PATH_RE.search(combined)
    if m:
        cce_ref = m.group(1)
    if not cce_ref:
        m = CCE_FUNC_RE.search(combined)
        if m:
            cce_ref = m.group(1).strip()
    # func_name from @pto.jit(name="...") decorator
    func_name = None
    m = JIT_NAME_RE.search(combined)
    if m:
        func_name = m.group(1)
    return {
        "pto": os.path.relpath(dpath, ROOT),       # dir (was single .pto file)
        "py_files": py_files,
        "vmi_op_counts": dict(sorted(vmi_ops.items(), key=lambda x: (-x[1], x[0]))),
        "vmi_op_set": sorted(vmi_ops.keys()),
        "vmi_total": sum(vmi_ops.values()),
        "infra_counts": dict(sorted(infra.items(), key=lambda x: (-x[1], x[0]))),
        "cce_ref": cce_ref,
        "func_name": func_name,
        "dir": os.path.basename(dpath.rstrip("/")),
    }

# ---------------------------------------------------------------------------
# 4. Build cce lookup + match vmi->cce
# ---------------------------------------------------------------------------
def build_cce_index():
    idx = {}            # normalized stem -> list of cce dir names
    exact = {}          # exact cce dir name -> data
    # CCE now lives under arch dirs: cce/<arch>/<Kernel>/ (e.g. cce/a6/VcvtMergeModeKernel).
    # Support both that and the flat cce/<Kernel>/ layout.
    for a in sorted(os.listdir(CCE_DIR)):
        adp = os.path.join(CCE_DIR, a)
        if not os.path.isdir(adp):
            continue
        if cce_kernel_cpp(adp):              # flat: cce/<Kernel>/ has the .cpp
            kernel_dirs = [adp]
        else:                                # arch-first: cce/<arch>/<Kernel>/
            kernel_dirs = [os.path.join(adp, k) for k in sorted(os.listdir(adp))
                           if os.path.isdir(os.path.join(adp, k))]
        for dp in kernel_dirs:
            data = extract_cce(dp)
            if data is None:
                continue
            d = os.path.basename(dp.rstrip("/"))
            exact[d] = data
            stem = normalize_stem(d)
            idx.setdefault(stem, []).append(d)
    return exact, idx

def match_cce(cce_ref, func_name, vmi_dir, cce_exact, cce_stem_idx):
    # 0. exact dir-name match — the common case now that dsl/<Kernel>/ mirrors
    #    cce/<Kernel>/ (pto-vmi normalized both to PascalCase kernel dir names).
    if vmi_dir in cce_exact:
        return vmi_dir, "exact-dir"
    cands = []
    if cce_ref:
        if cce_ref in cce_exact:
            return cce_ref, "exact-ref"
        # try Test->Kernel / Vf variants
        for suf in ["Test", "Vf", "Kernel"]:
            alt = cce_ref + "Kernel" if cce_ref.endswith(suf) and not cce_ref.endswith("Kernel") else None
            if alt and alt in cce_exact:
                return alt, "suffix-fix"
        cands.append(("ref-stem", normalize_stem(cce_ref)))
    if func_name:
        # @pto.jit name like "BrcAdd_case1_float_Rows_1_Cols_64" -> stem "brcadd"
        f = func_name
        f = re.sub(r'^vmi_', '', f)
        f = re.sub(r'_(\d+)_kernel$', '', f)
        f = re.sub(r'_kernel$', '', f)
        f = re.sub(r'_case\d+.*$', '', f)
        cands.append(("func-stem", normalize_stem(f)))
    # dir name fallback (strip trailing _<digits>)
    dn = re.sub(r'_\d+$', '', vmi_dir.replace("-", "_"))
    cands.append(("dir-stem", normalize_stem(dn)))
    for label, stem in cands:
        if stem in cce_stem_idx:
            hits = cce_stem_idx[stem]
            if len(hits) == 1:
                return hits[0], label
            # disambiguate: pick the one whose stem contains/contained
            return hits[0], f"{label}(ambiguous:{hits})"
    return None, "UNMATCHED"

# ---------------------------------------------------------------------------
# 5. Run
# ---------------------------------------------------------------------------
def main():
    if not os.path.isdir(CCE_DIR):
        print(f"[cce_vmi_breakdown] ERROR: CCE dir not found: {CCE_DIR}", file=sys.stderr)
        sys.exit(1)
    if not os.path.isdir(DSL_DIR):
        print(f"[cce_vmi_breakdown] ERROR: DSL dir not found: {DSL_DIR}", file=sys.stderr)
        print("  (pto-vmi removed the vmi/ folder in commit 0125c26; VMI kernels", file=sys.stderr)
        print("   now live under dsl/<Kernel>/*.py)", file=sys.stderr)
        sys.exit(1)

    cce_exact, cce_stem_idx = build_cce_index()
    vmi = {}
    for d in sorted(os.listdir(DSL_DIR)):
        dp = os.path.join(DSL_DIR, d)
        if not os.path.isdir(dp):
            continue
        v = extract_vmi(dp)
        if v:
            vmi[d] = v

    # match
    matched = []
    unmatched_vmi = []
    for d, v in vmi.items():
        cce_name, how = match_cce(v["cce_ref"], v["func_name"], d, cce_exact, cce_stem_idx)
        v["matched_cce"] = cce_name
        v["match_method"] = how
        if cce_name:
            matched.append((d, cce_name, how))
        else:
            unmatched_vmi.append(d)

    # CCE kernels with NO vmi counterpart
    matched_cce_names = {c for _, c, _ in matched}
    cce_only = sorted(k for k in cce_exact if k not in matched_cce_names)

    # ---- aggregate instruction frequency across all kernels ----
    cce_freq = Counter()
    for k, d in cce_exact.items():
        for instr, c in d["instr_counts"].items():
            cce_freq[instr] += c
    vmi_freq = Counter()
    vmi_op_kernels = Counter()  # how many kernels use each op
    for k, v in vmi.items():
        for op, c in v["vmi_op_counts"].items():
            vmi_freq[op] += c
            vmi_op_kernels[op] += 1

    # ---- write JSON ----
    report = {
        "summary": {
            "cce_kernels_total": len(cce_exact),
            "vmi_kernels_total": len(vmi),
            "matched_pairs": len(matched),
            "unmatched_vmi": unmatched_vmi,
            "cce_only_count": len(cce_only),
        },
        "matched": [
            {"vmi": v, "cce": c, "method": how,
             "vmi_data": vmi[v], "cce_data": cce_exact[c]}
            for v, c, how in matched
        ],
        "cce_only": cce_only,
        "cce_instruction_frequency": dict(sorted(cce_freq.items(), key=lambda x:(-x[1],x[0]))),
        "vmi_instruction_frequency": dict(sorted(vmi_freq.items(), key=lambda x:(-x[1],x[0]))),
        "vmi_op_kernel_coverage": dict(sorted(vmi_op_kernels.items(), key=lambda x:(-x[1],x[0]))),
    }
    with open(OUT_JSON, "w") as f:
        json.dump(report, f, indent=2)

    # ---- write Markdown ----
    write_md(report, matched, unmatched_vmi, cce_only, cce_exact, vmi,
             cce_freq, vmi_freq, vmi_op_kernels)
    print(f"wrote {OUT_MD}")
    print(f"wrote {OUT_JSON}")
    print(f"summary: cce={len(cce_exact)} dsl(vmi)={len(vmi)} matched={len(matched)} "
          f"unmatched_vmi={len(unmatched_vmi)} cce_only={len(cce_only)}")

# ---------------------------------------------------------------------------
# 6. Markdown
# ---------------------------------------------------------------------------
def write_md(report, matched, unmatched_vmi, cce_only, cce_exact, vmi,
             cce_freq, vmi_freq, vmi_op_kernels):
    L = []
    def w(s=""): L.append(s)

    w("# CCE vs VMI Instruction Breakdown — Full Per-Kernel Comparison")
    w()
    w("> Auto-generated by `scripts/cce_vmi_breakdown.py`. Scans the **actual**")
    w("> `cce/*/_kernel.cpp` (raw CCE intrinsics) and `dsl/*/*.py` (ptodsl Python")
    w("> API emitting `pto.vmi.*` ops). Each matched pair is the *same case / same")
    w("> functionality*; the instruction breakdown differs because VMI uses")
    w("> different lowerings / workarounds (broadcast→vbrc, vpack→vcvt, predicate")
    w("> ops→vcmp+vsel, etc.).")
    w()
    w("> **Layout note:** pto-vmi commit `0125c26` removed the top-level `vmi/`")
    w("> folder; VMI/DSL kernels now live only under `dsl/<Kernel>/*.py`. This")
    w("> scanner aggregates `pto.vmi.*` call sites across every `.py` in each")
    w("> `dsl/<Kernel>/` dir (both `*_case*.py` small-shape and `*_real_*.py`).")
    w()
    w("## 0. Summary")
    w()
    s = report["summary"]
    w(f"| Metric | Count |")
    w(f"|---|---|")
    w(f"| CCE kernels scanned | {s['cce_kernels_total']} |")
    w(f"| VMI/DSL kernels scanned | {s['vmi_kernels_total']} |")
    w(f"| Matched CCE↔VMI pairs (same case/functionality) | {s['matched_pairs']} |")
    w(f"| VMI kernels still unmatched (review) | {len(s.get('unmatched_vmi', []))} |")
    w(f"| CCE kernels with no VMI counterpart | {s['cce_only_count']} |")
    w()
    w("**Note on \"ca model\":** the CCE path emits raw CCE intrinsics that map ~1:1 to")
    w("hardware vector instructions, while the VMI path emits `pto.vmi.*` ops that are")
    w("later lowered (VPTO) — so even for the *same case*, the instruction breakdown can")
    w("differ substantially (e.g. a single `vcvt` round-trip becomes `extf`+`truncf`,")
    w("a `vbr` broadcast becomes `pto.vmi.broadcast`, a predicate `pand` becomes")
    w("`vcmp`+`vand`+`vsel`).")
    w()
    w("**Count caveat:** each CCE `.cpp` is a *template* (half/bf16/float × Rows×Cols)")
    w("with multiple `TEST_F` cases, while the dsl side aggregates `pto.vmi.*` call")
    w("sites across *all* `.py` files in the dir (case + real variants). So `#CCE` and")
    w("`#VMI` are both inflated vs a single concrete case; compare instruction")
    w("**sets/kinds** (`#CCE-vec-kinds` vs `#VMI-op-kinds`) for a fairer view.")
    w()

    # ---- per-kernel comparison ----
    w("## 1. Per-Kernel Instruction Breakdown (matched CCE↔VMI)")
    w()
    w("Sorted by VMI kernel name. `#CCE` = all CCE call sites (incl. DMA/sync); `#CCE-vec` = compute-only (vec+pred, excl. DMA/sync); `#VMI` = `pto.vmi.*` ops. `Δ` = #VMI − #CCE-vec (positive ⇒ VMI expands more).")
    w()
    w("| # | VMI kernel | CCE kernel | match | #CCE | #CCE-vec | #VMI | Δ | CCE intrinsics (count) | VMI ops (count) |")
    w("|---|---|---|---|---|---|---|---|---|---|")
    for i, (vd, cd, how) in enumerate(matched, 1):
        cd_data = cce_exact[cd]
        vd_data = vmi[vd]
        delta = vd_data['vmi_total'] - cd_data['compute_total']
        cce_str = ", ".join(f"`{k}`({v})" for k, v in cd_data["instr_counts"].items())
        vmi_str = ", ".join(f"`{k}`({v})" for k, v in vd_data["vmi_op_counts"].items())
        w(f"| {i} | `{vd}` | `{cd}` | {how} | {cd_data['total']} | {cd_data['compute_total']} | {vd_data['vmi_total']} | {delta:+d} | {cce_str} | {vmi_str} |")
    w()

    # ---- divergence ranking (where breakdowns differ most) ----
    w("## 1b. Divergence Ranking — pairs whose instruction breakdown differs most")
    w()
    w("Ranked by absolute compute delta `|Δ|` = |#VMI − #CCE-vec|. These are the cases")
    w("where the VMI representation diverges most from the raw CCE intrinsic count")
    w("(f16→f32 up-casts, predicate lowering, multi-stage casts, broadcast workarounds, etc.).")
    w()
    w("| VMI kernel | CCE kernel | #CCE | #CCE-vec | #VMI | Δ | #CCE-vec-kinds | #VMI-op-kinds |")
    w("|---|---|---|---|---|---|---|---|")
    ranked = sorted(matched, key=lambda t: abs(vmi[t[0]]['vmi_total'] - cce_exact[t[1]]['compute_total']), reverse=True)
    for vd, cd, how in ranked[:25]:
        cd_data = cce_exact[cd]; vd_data = vmi[vd]
        delta = vd_data['vmi_total'] - cd_data['compute_total']
        w(f"| `{vd}` | `{cd}` | {cd_data['total']} | {cd_data['compute_total']} | {vd_data['vmi_total']} | {delta:+d} | {len(cd_data['compute_counts'])} | {len(vd_data['vmi_op_counts'])} |")
    w()

    # ---- detailed per-kernel blocks (with infra) ----
    w("## 2. Detailed Breakdown per Kernel (CCE set + VMI ops + VMI infra)")
    w()
    for vd, cd, how in matched:
        cd_data = cce_exact[cd]
        vd_data = vmi[vd]
        w(f"### `{vd}`  ⇄  `{cd}`   <sub>({how})</sub>")
        w()
        w(f"- **CCE source:** `{cd_data['cpp']}`")
        w(f"- **VMI source:** `{vd_data['pto']}/` ({len(vd_data['py_files'])} .py: {', '.join(vd_data['py_files'])})")
        if vd_data["cce_ref"]:
            w(f"- **VMI CCE-ref hint:** `{vd_data['cce_ref']}`")
        w()
        w("| side | instruction | count |")
        w("|---|---|---|")
        w(f"| **CCE** | — (total, incl DMA/sync) | {cd_data['total']} |")
        w(f"| CCE | — (compute-only: vec+pred) | {cd_data['compute_total']} |")
        w(f"| CCE | — (DMA/sync) | {cd_data['dma_sync_total']} |")
        for k, v in cd_data["instr_counts"].items():
            tag = " *(dma/sync)*" if k in DMA_SYNC else ""
            w(f"| CCE | `{k}`{tag} | {v} |")
        w(f"| **VMI** | — (vmi ops total) | {vd_data['vmi_total']} |")
        for k, v in vd_data["vmi_op_counts"].items():
            w(f"| VMI | `pto.vmi.{k}` | {v} |")
        if vd_data["infra_counts"]:
            w(f"| VMI-infra | — (infra total) | {sum(vd_data['infra_counts'].values())} |")
            for k, v in vd_data["infra_counts"].items():
                w(f"| VMI-infra | `pto.{k}` | {v} |")
        delta = vd_data['vmi_total'] - cd_data['compute_total']
        w(f"| **Δ** | #VMI − #CCE-vec | {delta:+d} |")
        w()

    # ---- unmatched vmi ----
    if unmatched_vmi:
        w("## 3. VMI/DSL kernels with no CCE match (manual review needed)")
        w()
        w("| VMI kernel | cce_ref hint | jit name | #VMI ops |")
        w("|---|---|---|---|")
        for vd in unmatched_vmi:
            v = vmi[vd]
            w(f"| `{vd}` | {v['cce_ref'] or '—'} | {v['func_name'] or '—'} | {v['vmi_total']} |")
        w()

    # ---- cce only ----
    w("## 4. CCE kernels with no VMI counterpart")
    w()
    w(f"{len(cce_only)} CCE kernels have no matching VMI implementation (VMI is a subset of CCE).")
    w()
    cols = 3
    w("| " + " | ".join([f"col{i+1}" for i in range(cols)]) + " |")
    w("|" + "|".join(["---"]*cols) + "|")
    for i in range(0, len(cce_only), cols):
        row = cce_only[i:i+cols]
        w("| " + " | ".join(f"`{k}`" for k in row) + " |")
    w()

    # ---- semantic CCE->VMI correspondence ----
    w("## 5. CCE→VMI Op Correspondence & Divergence Patterns")
    w()
    w("How raw CCE intrinsics map to `pto.vmi.*` ops. \"1:1\" = direct lowering;")
    w("\"expands\" = one CCE intrinsic becomes several VMI ops; \"workaround\" =")
    w("VMI has no direct op so the CCE intrinsic is emulated. This is why the")
    w("instruction breakdown is \"very different\" between the two even for the same case.")
    w()
    w("| CCE intrinsic | VMI op(s) | mapping | note |")
    w("|---|---|---|---|")
    corr = [
        ("vlds / vldas / vldus", "pto.vmi.vload", "1:1", "UNPK/DINTLV/unaligned load modes → vload (dist_mode param) or plain load"),
        ("vsts / vstas / vstus / vsstb", "pto.vmi.vstore", "1:1", "PK/INTLV/block-strided/unaligned store → vstore (dist_mode param) or plain store"),
        ("vmul", "pto.vmi.vmul / mulf", "1:1", ""),
        ("vadd / vadds", "pto.vmi.vadd / addf", "1:1", "vadds(scalar) → addf(broadcast scalar)"),
        ("vsub", "pto.vmi.vsub / subf", "1:1", ""),
        ("vdiv", "pto.vmi.vdiv / divf", "1:1", ""),
        ("vexp", "pto.vmi.vexp", "1:1", ""),
        ("vln", "pto.vmi.vln", "1:1", ""),
        ("vneg", "pto.vmi.vneg / negf", "1:1", ""),
        ("vabs", "pto.vmi.vabs / absf", "1:1", ""),
        ("vmax / vmaxs", "pto.vmi.vmax / maxf", "1:1", ""),
        ("vmin / vmins", "pto.vmi.vmin / minf", "1:1", ""),
        ("vsqrt", "pto.vmi.vsqrt / sqrtf", "1:1", ""),
        ("vand / vor / vxor", "pto.vmi.vand/vor/vxor (i-type)", "1:1", "on integer bitcast of float"),
        ("vnot", "pto.vmi.vnot", "1:1", "integer"),
        ("vsel", "pto.vmi.vsel / select", "1:1", ""),
        ("vbr / vdup", "pto.vmi.vbrc / broadcast", "expands", "CCE lane-0/scalar broadcast → broadcast(const)"),
        ("vcvt (unpack f16→f32)", "pto.vmi.vcvt / extf", "1:1", "PART_EVEN upcast"),
        ("vcvt (pack f32→f16)", "pto.vmi.vcvt / truncf", "1:1", "round + narrow"),
        ("vcvt (f32→int)", "pto.vmi.vcvt + fptosi + trunci", "expands", "rounding-mode trunc emulated via fptosi±0.5"),
        ("vcvt (int→f32)", "pto.vmi.vcvt / sitofp / extsi", "expands", ""),
        ("vpack", "pto.vmi.vcvt / vstore(dintlv)", "workaround", "no vpack op; narrowing cast or re-interleave store"),
        ("vunpack", "pto.vmi.vcvt / extsi", "workaround", "integer widen via vcvt"),
        ("vdintlv / vintlv", "pto.vmi.vload/vstore(dintlv)", "1:1/wo", "deinterleave via load/store dist_mode"),
        ("vmuls", "pto.vmi.vmuls / mulf(broadcast)", "expands", "vec×scalar → broadcast+mulf"),
        ("vmula / vmadd / vaxpy", "pto.vmi.vfma / fma", "1:1", "fused multiply-add"),
        ("vcadd / vcmax / vcmin", "pto.vmi.reduce_*", "1:1/wo", "block reduce; vcgadd/vcpadd skipped (scratch)"),
        ("vcmp_* / vcmps_*", "pto.vmi.vcmp / cmpf / cmpi", "1:1", ""),
        ("vgather2 / vscatter", "pto.vmi.vgather / vscatter", "1:1", "UB pointer gather"),
        ("vlrelu / vrelu / vprelu", "pto.vmi.vlrelu / vrelu / vprelu", "1:1", ""),
        ("plt_b32 / pset_b32 / pand / por / pxor", "pto.vmi.create_mask + vcmp + vsel", "workaround", "predicate ops have no VMI op; mask→vec→op→mask round-trip"),
        ("vtrc (fp trunc)", "copysign(0.5)+fptosi+vcvt", "workaround", "no vtrc; emulated"),
        ("chistv2 / dhistv2 / sprclr", "— (skipped)", "workaround", "histogram/scratch ops, output not checked"),
        ("TLOAD/TSTORE", "pto.mte_load / mte_store", "1:1", "DMA GM↔UB"),
        ("set_flag/wait_flag", "pto.set_flag / wait_flag", "1:1", "pipe sync"),
        ("TASSIGN", "pto.castptr", "workaround", "UB offset assignment → castptr constant"),
    ]
    for c, v, m, n in corr:
        w(f"| `{c}` | `{v}` | {m} | {n} |")
    w()
    w("**Key divergence drivers (why VMI breakdown differs from CCE):**")
    w()
    w("1. **f16 compute path** — CCE computes in f16 natively (`vexp`/`vmul` on f16);")
    w("   VMI up-casts f16→f32 (`extf`), computes in f32, then `truncf` back. Adds 2 ops/vec.")
    w("2. **Predicate ops** — CCE `pand`/`por`/`pxor`/`plt_b32` have no VMI op; emulated via")
    w("   `create_mask`+`vcmp`+`vsel` (mask↔vector round-trips).")
    w("3. **Multi-stage casts** — CCE `vcvt` f32→int8 is one op; VMI needs `fptosi`+`trunci`")
    w("   (+ `and`/`select` for rounding modes other than ROUND_R).")
    w("4. **vpack/vunpack** — no VMI op; replaced by `vcvt` or re-interleave stores.")
    w("5. **Broadcast** — CCE `vbr`/`vdup`/`vlds(BRC)` → `pto.vmi.vbrc`/`broadcast`; BLK/BRC load")
    w("   modes often moved to host (pre-expand) so the kernel sees a plain load.")
    w()

    # ---- aggregate frequency ----
    w("## 6. Aggregate Instruction Frequency (all kernels)")
    w()
    w("### 6a. CCE intrinsic frequency (across all CCE kernels)")
    w()
    w("| intrinsic | kind | total call sites | kernels using |")
    w("|---|---|---|---|")
    cce_kernels_using = Counter()
    for d in cce_exact.values():
        for instr in d["instr_set"]:
            cce_kernels_using[instr] += 1
    for instr, cnt in sorted(cce_freq.items(), key=lambda x:(-x[1],x[0])):
        w(f"| `{instr}` | {cce_kind(instr)} | {cnt} | {cce_kernels_using[instr]} |")
    w()
    w("### 6b. VMI op frequency (across all VMI/DSL kernels)")
    w()
    w("| vmi op | total call sites | kernels using |")
    w("|---|---|---|")
    for op, cnt in sorted(vmi_freq.items(), key=lambda x:(-x[1],x[0])):
        w(f"| `pto.vmi.{op}` | {cnt} | {vmi_op_kernels[op]} |")
    w()

    with open(OUT_MD, "w") as f:
        f.write("\n".join(L) + "\n")

if __name__ == "__main__":
    main()
