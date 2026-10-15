#!/usr/bin/env python3
"""
extract_a5a6_simd.py — extract the hand-curated "A5 vs A6" Quant/DeQuant SIMD
tables from pto-vmi's README.md (a6 branch) into web/a5a6_simd.json.

The README keeps two sections whose numbers come from the sim machine's
`perf_pmu_per_vf.log` (c_cycle_rvec_busy) — pure vector-compute SIMD cycles,
directly comparable across chips — plus EXU IPC and Elements/Cycle. These metrics
are NOT in the CA instruction-analysis JSONs, so they're parsed here from the
README (the source of truth the user maintains) and embedded into data.js as
`window.REPORT.a5a6_simd` so the A5↔A6 tab can render them.

Section headings looked for (exact):
  ### A5 vs A6 — Quant (VF/SIMD cycles, EXU IPC, Elements/Cycle)
  ### A5 vs A6 — DeQuant (VF/SIMD cycles, EXU IPC, Elements/Cycle)

Each table is two rows per kernel (A5 top with Δ SIMD, A6 below); kernel/case
cells are empty on the continuation row and carried forward. Single-row A6-only
entries (DequantHiF4) are handled.

Usage:
    python3 scripts/extract_a5a6_simd.py --readme ~/pto-vmi/README.md \
        [--out web/a5a6_simd.json]
"""
import argparse
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUT = os.path.normpath(os.path.join(HERE, "..", "web", "a5a6_simd.json"))

QUANT_HEADING = "### A5 vs A6 — Quant"
DEQUANT_HEADING = "### A5 vs A6 — DeQuant"

_INT_RE = re.compile(r"^[+-]?\d+$")
_FLOAT_RE = re.compile(r"^[+-]?\d+(?:\.\d+)?$")


def _num(cell):
    """Parse a numeric cell; strip ** bold, %, spaces and typographic dashes."""
    s = (cell.strip().replace("**", "").replace(" ", "").replace("%", "")
         .replace("\u2212", "-").replace("\u2013", "-").replace("\u2014", "-"))
    if s in ("", "-", "–", "—"):
        return None
    if _INT_RE.match(s):
        return int(s)
    if _FLOAT_RE.match(s):
        return float(s)
    return None


def _delta(cell):
    """Parse the Δ SIMD cell into a numeric percentage (None when '—')."""
    return _num(cell)


def parse_table(lines):
    rows = []
    prev_kernel = prev_case = ""
    for ln in lines:
        ln = ln.strip()
        if not ln.startswith("|"):
            continue
        cells = [c.strip() for c in ln.strip().strip("|").split("|")]
        # separator row (e.g. |---|---|)
        if cells and all(re.fullmatch(r":?-{2,}:?", c) for c in cells if c != ""):
            continue
        # header row
        if cells and cells[0].lower() in ("kernel", "testcase"):
            continue
        if len(cells) < 7:
            continue
        kernel = cells[0] or prev_kernel
        case = cells[1] or prev_case
        prev_kernel, prev_case = kernel, case
        rows.append({
            "kernel": kernel,
            "case": case,
            "arch": cells[2],
            "simd": _num(cells[3]),
            "ipc": _num(cells[4]),
            "ec": _num(cells[5]),
            "delta": _delta(cells[6]),
        })
    return rows


def parse_section(text):
    """Return (rows, notes) for a section body starting after its heading."""
    lines = text.split("\n")
    table_start = table_end = None
    for i, ln in enumerate(lines):
        if ln.strip().startswith("|"):
            if table_start is None:
                table_start = i
            table_end = i
    if table_start is None:
        return [], ""
    rows = parse_table(lines[table_start:table_end + 1])
    notes = "\n".join(ln.strip() for ln in lines[table_end + 1:] if ln.strip())
    return rows, notes


def extract_section(readme, heading):
    """Return the body between `heading` and the next ###/## heading."""
    idx = readme.find(heading)
    if idx < 0:
        return None
    body = readme[idx + len(heading):]
    m = re.search(r"\n(?:###|##) ", body)
    if m:
        body = body[:m.start()]
    return body


def build(readme_path, out_path):
    with open(readme_path, encoding="utf-8") as f:
        readme = f.read()

    out = {"quant": {"rows": [], "notes": ""}, "dequant": {"rows": [], "notes": ""}}
    for key, heading in (("quant", QUANT_HEADING), ("dequant", DEQUANT_HEADING)):
        body = extract_section(readme, heading)
        if body is None:
            print(f"WARN: section not found: {heading}")
            continue
        rows, notes = parse_section(body)
        out[key] = {"rows": rows, "notes": notes}
        print(f"{key}: {len(rows)} rows, {len(notes)} chars of notes")

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"Wrote {out_path} ({os.path.getsize(out_path)/1024:.1f} KB)")


def main():
    ap = argparse.ArgumentParser(description="Extract A5 vs A6 Quant/DeQuant SIMD tables from pto-vmi README.md")
    ap.add_argument("--readme", required=True, help="path to pto-vmi README.md (a6 branch)")
    ap.add_argument("--out", default=DEFAULT_OUT, help="output JSON path")
    args = ap.parse_args()
    build(args.readme, args.out)


if __name__ == "__main__":
    main()
