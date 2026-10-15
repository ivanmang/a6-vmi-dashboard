#!/usr/bin/env python3
"""
build_a5_snapshot.py — extract a compact A5 snapshot for the A5↔A6 compare tab.

The yellow zone is download-only (it can *pull* gitcode but can never push data
out), and the A6 (dav_9201) simulator exists only there. So the A5↔A6 comparison
must be hosted on yellow, with the A5 numbers *pushed in* as a committed snapshot.

This script runs on the A5 side (blue / ecs / b10 — anywhere the A5 dashboard
artifacts live) and writes a compact `web/a5_report.json` that is COMMITTED into
the `a6-vmi-dashboard` repo. On yellow, `scripts/build_data.py` embeds that file
into `web/data.js` as `window.REPORT.a5` and the `A5↔A6` tab joins it against the
locally-generated A6 rows.

Only the scalar per-side metrics are kept (the heavy `subcats` / `instr_list`
dicts are dropped) so the snapshot stays small (~50 KB, 50 kernels).

Usage:
    python3 scripts/build_a5_snapshot.py \
        --report ~/vmi-dashboard/data/cce_vmi_ca_report.json \
        --datajs ~/vmi-dashboard/web/data.js \
        --out    web/a5_report.json
"""
import argparse
import json
import os
import re

# Scalar numeric fields kept per CCE/VMI side (everything except subcats/instr_list).
SCALAR_KEYS = (
    "ex", "su", "ld", "st", "pred", "scalar", "dma", "flowctrl", "membar",
    "dual", "rvec_dual", "max_issue", "stalls", "ex_stalls", "max_stall",
    "top_stall", "ipc", "ex_ipc", "vf_real", "vf_compute", "instr_num",
    "mte2_wait", "ex_arith", "ex_cast", "ex_broadcast", "ex_pred_setup",
    "ex_interleave", "ex_select_cmp", "ex_reduce",
)

META_KEYS = (
    "pto_vmi_commit", "pto_vmi_short_commit", "build_date", "build_timestamp",
    "ptoas_version", "cann_version", "soc_version", "cce_cases_total",
    "matched_pairs", "cce_only_count", "excluded_count", "vmi_cases_total",
)

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUT = os.path.normpath(os.path.join(HERE, "..", "web", "a5_report.json"))


def load_json(path):
    if not path or not os.path.isfile(path):
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def trim_side(side):
    """Keep only the scalar metrics for one CCE/VMI side."""
    if not isinstance(side, dict):
        return side
    return {k: side[k] for k in SCALAR_KEYS if k in side}


def extract_meta_from_datajs(path):
    """Pull provenance (commit/toolchain/build date) from the A5 web/data.js."""
    if not path or not os.path.isfile(path):
        return {}
    text = open(path, encoding="utf-8").read()
    m = re.search(r"window\.REPORT\s*=\s*(\{.*\});?\s*$", text, re.S)
    if not m:
        return {}
    try:
        d = json.loads(m.group(1))
    except Exception:
        return {}
    meta = d.get("meta") if isinstance(d, dict) else None
    if not isinstance(meta, dict):
        return {}
    return {k: meta[k] for k in META_KEYS if k in meta}


def build(report_path, datajs_path, out_path):
    report = load_json(report_path)
    if not report or "rows" not in report:
        raise SystemExit(f"ERROR: no rows in A5 report: {report_path!r}")

    # Top-level excluded list (A5 report keeps it separately, keyed by kernel).
    excluded = report.get("excluded") or []
    excluded_by_kernel = {e.get("kernel") for e in excluded if isinstance(e, dict)}

    meta = extract_meta_from_datajs(datajs_path)
    meta.setdefault("source", "vmi-dashboard (A5)")
    meta["report_matched_count"] = report.get("matched_count")
    meta["report_excluded_count"] = report.get("excluded_count")

    rows = []
    for r in report["rows"]:
        kernel = r.get("kernel")
        row = {
            "case_id": r.get("case_id"),
            "kernel": kernel,
            "vmi_kernel": r.get("vmi_kernel"),
            "cce_status": r.get("cce_status"),
            "vmi_status": r.get("vmi_status"),
            "excluded": kernel in excluded_by_kernel,
            "cce": trim_side(r.get("cce")),
            "vmi": trim_side(r.get("vmi")),
        }
        rows.append(row)

    payload = {"meta": meta, "rows": rows}

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, separators=(",", ":"))
    print(f"Wrote {out_path} ({os.path.getsize(out_path)/1024:.1f} KB, {len(rows)} rows)")
    print(f"  meta: pto_vmi={meta.get('pto_vmi_short_commit', '?')} "
          f"build={meta.get('build_date', '?')} ptoas={meta.get('ptoas_version', '?')}")


def main():
    ap = argparse.ArgumentParser(description="Build a compact A5 snapshot for a6-vmi-dashboard.")
    ap.add_argument("--report", required=True, help="A5 data/cce_vmi_ca_report.json")
    ap.add_argument("--datajs", default=None, help="A5 web/data.js (for meta provenance)")
    ap.add_argument("--out", default=DEFAULT_OUT, help="output path")
    args = ap.parse_args()
    build(args.report, args.datajs, args.out)


if __name__ == "__main__":
    main()