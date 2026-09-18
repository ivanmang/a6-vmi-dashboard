#!/usr/bin/env python3
"""
parse_features.py — parse docs/pto_vmi_features.md into the single source of
truth for the CCE-VMI dashboard "Feature Coverage" tab.

Produces a taxonomy document:

  {
    "source": "docs/pto_vmi_features.md",
    "features": [ {key, num, label, desc, subs:[{key,label}]} ... ],
    "kernels":  { "Kernel": {"features":[...], "evidence":{feat:str}, "subs":{feat:[sub]}} ... },
    "known_gaps": ["...", ...],
    "matrix_notes": "..."
  }

The kernel→feature membership, evidence strings and sub-category flags are all
parsed mechanically from the §1–§6 evidence tables + the §9 overview matrix +
the §5/§6 notes, so the coverage tab stays in lock-step with the doc.

Two CLI modes:
  parse_features.py --md <md> --out-taxonomy <json>       # emit taxonomy json
  parse_features.py --md <md> --retag <bundles_dir>       # rewrite tags in bundles + manifest
"""
import json
import os
import re
import argparse

# ---------------------------------------------------------------------------
# stable cosmetic metadata (keys are stable; membership/evidence come from doc)
# ---------------------------------------------------------------------------
FEATURE_DEFS = [
    (1, "logical_vector", "§1 Logical Vector",
     "One logical VL (128×f32 / 256×f16), auto K-way fan-out to physical regs. Compact/partial vectors. Category A/B/C layout behavior.",
     None),
    (2, "load_store_dist", "§2 Load/Store Dist",
     "Unified vload/vstore with dist_mode (brc, unpack, dintlv, block_stride, group+stride). Replaces physical vlds/vsts variants.",
     [("dist_brc", "brc (broadcast)"),
      ("dist_dintlv", "dintlv"),
      ("dist_unpack", "unpack"),
      ("dist_block_stride", "block_stride / group+stride")]),
    (3, "unified_vcvt", "§3 Unified vcvt",
     "vcvt hides part/pack/EVEN-ODD. 7 conversion types in one op. fp+int unified mnemonics. vinterpret_cast for bit-reinterpret.",
     [("vcvt_narrow_wide", "Narrow → wide"),
      ("vcvt_wide_narrow", "Wide → narrow"),
      ("vcvt_same_width", "Same width")]),
    (4, "group_reduce", "§4 Group Reduce",
     "vcmax/vcadd {group=C} → compact V<C×T>. vbrc broadcast back. One logical op = vcgmax + cross-reg merge + contiguous materialize.",
     None),
    (5, "mask_predication", "§5 Mask/Predication",
     "create_mask(active_lanes) / create_group_mask. pmode=zero (default) or merge. First-N tail mask. MERGE semantics via pnot+vor/vsel.",
     None),
    (6, "intent_ops", "§6 Intent Ops",
     "Higher-level ops: vselr (register permute), vgather/vscatter (Category C), fused SFU (vexpdif/vlrelu/vmula), vchist/vdhist (histogram), vintlv/vdintlv (rearrange).",
     [("intent_rearrange", "Rearrange (vintlv/vdintlv)"),
      ("intent_hist", "Histogram (vchist/vdhist)"),
      ("intent_gather", "In-register gather (vselr)"),
      ("intent_gather_scatter", "UB gather/scatter"),
      ("intent_fused", "Fused SFU (vaxpy/vprelu/…)")]),
]

KEY_BY_NUM = {n: k for n, k, *_ in FEATURE_DEFS}
ORDER = [k for _, k, *_ in FEATURE_DEFS]

# §3 width sub-section mapping (`#### 3.x`)
VCVT_SUBSECTION = {
    "3.1": "vcvt_narrow_wide",
    "3.2": "vcvt_wide_narrow",
    "3.3": "vcvt_same_width",
}

# §2 dist sub-category derivation from evidence text
DIST_SUBS = [
    ("dist_brc", re.compile(r"\bbrc\b", re.I)),
    ("dist_dintlv", re.compile(r"dintlv", re.I)),
    ("dist_unpack", re.compile(r"unpack", re.I)),
    ("dist_block_stride", re.compile(r"block_stride|group=|stride", re.I)),
]
# §6 intent sub-category derivation from evidence text
INTENT_SUBS = [
    ("intent_rearrange", re.compile(r"vintlv|vdintlv", re.I)),
    ("intent_hist", re.compile(r"vchist|vdhist", re.I)),
    ("intent_gather", re.compile(r"vselr", re.I)),
    ("intent_gather_scatter", re.compile(r"vgather|vscatter", re.I)),
    ("intent_fused", re.compile(r"vaxpy|vprelu|vmula|vmull|vlrelu|vexpdif", re.I)),
]
SUB_DERIVERS = {"load_store_dist": DIST_SUBS, "intent_ops": INTENT_SUBS}


# ---------------------------------------------------------------------------
# markdown helpers
# ---------------------------------------------------------------------------
def split_cells(line):
    cells = line.split("|")
    # drop leading/trailing empty cells produced by surrounding pipes
    if cells and cells[0].strip() == "":
        cells = cells[1:]
    if cells and cells[-1].strip() == "":
        cells = cells[:-1]
    return [c.strip() for c in cells]


def parse_table(lines):
    """Parse a markdown table block (list of | lines) → (header, rows)."""
    header = None
    rows = []
    for ln in lines:
        if not ln.strip().startswith("|"):
            continue
        if re.match(r"^\s*\|[\s:\-|]+\|\s*$", ln):
            continue  # separator row
        cells = split_cells(ln)
        if header is None:
            header = cells
        else:
            rows.append(cells)
    return header, rows


def split_kernels(cell):
    """'SiluGradKernel / SigmoidGradKernel' → ['SiluGradKernel','SigmoidGradKernel']."""
    names = []
    for part in re.split(r"\s*/\s*", cell):
        name = re.sub(r"[`*]", "", part).strip()
        if name:
            names.append(name)
    return names


def is_kernel_evidence_table(header):
    return (header is not None and len(header) == 2
            and header[0].strip().lower() == "kernel"
            and "evidence" in header[1].lower())


def derive_subs(feature, evidence):
    subs = []
    for key, rx in SUB_DERIVERS.get(feature, []):
        if rx.search(evidence or ""):
            subs.append(key)
    return subs


# ---------------------------------------------------------------------------
# main parser
# ---------------------------------------------------------------------------
def parse_features_md(md_path):
    text = open(md_path, encoding="utf-8", errors="replace").read()
    lines = text.splitlines()

    features = []
    for num, key, label, desc, subs in FEATURE_DEFS:
        features.append({"key": key, "num": num, "label": label, "desc": desc,
                         "subs": subs and [{"key": k, "label": l} for k, l in subs]})

    # kernels: kernel → {"features":set, "evidence":{}, "subs":{}}
    kernels = {}

    def touch(k):
        if k not in kernels:
            kernels[k] = {"features": set(), "evidence": {}, "subs": {}}

    def add(kernel, feature, evidence, sub=None):
        evidence = re.sub(r"[`*]", "", evidence or "")
        evidence = re.sub(r"\s+", " ", evidence).strip()
        touch(kernel)
        kernels[kernel]["features"].add(feature)
        # first evidence wins (keeps the richest phrasing)
        if feature not in kernels[kernel]["evidence"]:
            kernels[kernel]["evidence"][feature] = evidence
        if sub:
            kernels[kernel]["subs"].setdefault(feature, [])
            if sub not in kernels[kernel]["subs"][feature]:
                kernels[kernel]["subs"][feature].append(sub)

    known_gaps = []
    section_note_lines = []

    # ---- walk sections 1-6 (and 9 for the matrix) ----
    cur_section = None
    cur_vcvt_sub = None  # active §3.x width class
    cur_section_num = None

    i = 0
    n = len(lines)
    tables = []  # (section_num, vcvt_sub, table_lines)
    while i < n:
        ln = lines[i]
        m = re.match(r"^## (\d+)\.\s+(.*)$", ln)
        if m:
            cur_section_num = int(m.group(1))
            cur_section = m.group(2).strip()
            cur_vcvt_sub = None
            i += 1
            continue
        m4 = re.match(r"^#### (3\.\d+)\s+(.*)$", ln)
        if m4 and cur_section_num == 3:
            cur_vcvt_sub = VCVT_SUBSECTION.get(m4.group(1))
            i += 1
            continue
        # collect table blocks
        if ln.strip().startswith("|") and 1 <= (cur_section_num or 0) <= 6:
            block = []
            j = i
            while j < n and lines[j].strip().startswith("|"):
                block.append(lines[j])
                j += 1
            tables.append((cur_section_num, cur_vcvt_sub, block))
            i = j
            continue
        # collect blockquote notes in sections 5/6
        if ln.strip().startswith(">") and cur_section_num in (5, 6):
            note = re.sub(r"^\s*>\s?", "", ln).strip()
            if note and note not in section_note_lines:
                section_note_lines.append(note)
        i += 1

    # ---- parse §1-§6 kernel-evidence tables ----
    for sec, vcvt_sub, block in tables:
        header, rows = parse_table(block)
        if not is_kernel_evidence_table(header):
            continue
        feature = KEY_BY_NUM.get(sec)
        if not feature:
            continue
        for row in rows:
            if len(row) < 2:
                continue
            for kname in split_kernels(row[0]):
                evidence = row[1]
                add(kname, feature, evidence)
                if feature == "unified_vcvt" and vcvt_sub:
                    add(kname, feature, evidence, vcvt_sub)
                if feature == "load_store_dist":
                    for s in derive_subs("load_store_dist", evidence):
                        add(kname, feature, evidence, s)
                if feature == "intent_ops":
                    for s in derive_subs("intent_ops", evidence):
                        add(kname, feature, evidence, s)

    # ---- §6 note: "`op` is shown by Kernel" adds intent sub coverage ----
    for note in section_note_lines:
        # op codes are always backtick'd in the doc notes
        for m in re.finditer(r"`([a-z][a-z0-9]+)`\s+(?:which\s+)?is shown by\s+([A-Za-z0-9]+Kernel)", note):
            op, kname = m.group(1), m.group(2)
            subs = derive_subs("intent_ops", op)
            if subs:
                add(kname, "intent_ops", op + " (note)", subs[0])
        # known gaps: split into sentences, strip markdown emphasis, test each
        for sent in re.split(r"(?<=[.)])\s+", note):
            plain = re.sub(r"[`*]", "", sent)
            if re.search(r"does not (use|have|support)|\bnot (used|shown|available)\b|still not", plain, re.I):
                gap = plain.strip()
                if gap and gap not in known_gaps:
                    known_gaps.append(gap)

    # ---- §9 matrix: authoritative feature membership cross-check ----
    for sec, _vcvt, block in tables:
        if sec != 9:
            continue
        header, rows = parse_table(block)
        if not header or header[0].strip().lower() != "kernel":
            continue
        for row in rows:
            if len(row) < 2:
                continue
            for kname in split_kernels(row[0]):
                if not kname:
                    continue
                touch(kname)
                for col in range(1, min(len(row), 1 + len(ORDER))):
                    feat = ORDER[col - 1]
                    if "✓" in (row[col] or ""):
                        kernels[kname]["features"].add(feat)
                        if feat not in kernels[kname]["evidence"]:
                            kernels[kname]["evidence"][feat] = "—"

    # ---- finalize ----
    out_kernels = {}
    for k in sorted(kernels):
        d = kernels[k]
        out_kernels[k] = {
            "features": sorted(d["features"], key=ORDER.index) if d["features"] else [],
            "evidence": {f: d["evidence"].get(f, "—") for f in sorted(d["features"], key=ORDER.index)},
            "subs": {f: d["subs"].get(f, []) for f in sorted(d["features"], key=ORDER.index) if f in d["subs"]},
        }
    return {
        "source": os.path.basename(md_path),
        "features": features,
        "kernels": out_kernels,
        "known_gaps": known_gaps,
        "matrix_notes": section_note_lines,
    }


# ---------------------------------------------------------------------------
# retag existing bundles (no ptoas/sim needed — tags only)
# ---------------------------------------------------------------------------
def retag_bundles(md_path, bundles_dir):
    tax = parse_features_md(md_path)
    kernels = tax["kernels"]
    SKIP = {"manifest.json", "coverage_taxonomy.json", "corr_map.json", "opcode_info.json"}
    count = 0
    for fname in sorted(os.listdir(bundles_dir)):
        if fname in SKIP or not fname.endswith(".json"):
            continue
        path = os.path.join(bundles_dir, fname)
        try:
            b = json.load(open(path))
        except Exception:
            continue
        k = b.get("kernel")
        if not k or k == "?":
            continue
        info = kernels.get(k)
        tags = b.get("tags", {})
        if info:
            tags["vmi_features"] = info["features"]
            tags["vmi_evidence"] = info["evidence"]
            if info["subs"]:
                tags["vmi_subs"] = info["subs"]
            else:
                tags.pop("vmi_subs", None)
        else:
            # kernel not in the doc → no feature coverage
            tags["vmi_features"] = []
            tags["vmi_evidence"] = {}
            tags.pop("vmi_subs", None)
        b["tags"] = tags
        json.dump(b, open(path, "w"), separators=(",", ":"))
        count += 1
    # rewrite manifest
    manifests = []
    for fname in sorted(os.listdir(bundles_dir)):
        if fname in SKIP or not fname.endswith(".json"):
            continue
        try:
            d = json.load(open(os.path.join(bundles_dir, fname)))
        except Exception:
            continue
        manifests.append({"kernel": d.get("kernel", "?"), "case_id": d.get("case_id", "?"),
                          "file": fname, "stats": d.get("stats", {}), "tags": d.get("tags", {})})
    json.dump({"bundles": manifests},
              open(os.path.join(bundles_dir, "manifest.json"), "w"), indent=2)
    return count, len(manifests), len(kernels)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--md", default="~/pto-vmi/docs/pto_vmi_features.md")
    ap.add_argument("--out-taxonomy", default=None)
    ap.add_argument("--retag", default=None)  # bundles dir
    ap.add_argument("--print-summary", action="store_true")
    args = ap.parse_args()
    md = os.path.expanduser(args.md)

    if args.retag:
        n_bundles, n_manifest, n_kernels = retag_bundles(md, args.retag)
        print(f"retagged {n_bundles} bundles (manifest={n_manifest}, taxonomy kernels={n_kernels})")
        return

    tax = parse_features_md(md)
    if args.out_taxonomy:
        json.dump(tax, open(args.out_taxonomy, "w"), indent=2, ensure_ascii=False)
        print(f"wrote {args.out_taxonomy} ({len(tax['kernels'])} kernels, {len(tax['features'])} features, {len(tax['known_gaps'])} gaps)")
    if args.print_summary:
        print(json.dumps(tax, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()