#!/usr/bin/env python3
"""build_a5a6_all.py — join the FULL A5 + A6 per-kernel VF metrics into a5a6_all.json.

The A5 and A6 numbers come from each sim machine's `perf_pmu_per_vf.log`
(`c_cycle_rvec_busy` = pure vector-compute SIMD cycles, directly comparable
across chips) plus EXU IPC and Elements/Cycle. This joins them by kernel name and
emits the SAME schema as a5a6_simd.json (keyed by category, rows = A5+A6 pairs),
so the existing "A5 vs A6" dashboard tab renders it unchanged.

Expected perf_pmu_per_vf.log layout (whitespace columns; ADAPT parse_perf_pmu if
the real log differs — it is sim-machine specific):
    <kernel>  <case>  <c_cycle_rvec_busy>  <exu_ipc>  <elements_per_cycle>
e.g.
    QuantBf16toMXFp8  128x128  848  1.35  19.32

Usage:
    python3 build_a5a6_all.py --a5 <a5/perf_pmu_per_vf.log> \
        --a6 <a6/perf_pmu_per_vf.log> [--out web/a5a6_all.json]
"""
import argparse
import json
import os
import re


def parse_perf_pmu(path):
    """Parse a perf_pmu_per_vf.log into {kernel: {kernel, case, simd, ipc, ec}}.

    `simd` is c_cycle_rvec_busy. The parser is deliberately tolerant: it tries a
    `key=value` / `key : value` block first, then falls back to whitespace
    columns. If the real log layout differs, only this function needs changing.
    """
    out = {}
    if not path or not os.path.isfile(path):
        print(f"WARN: missing perf_pmu log: {path}")
        return out

    text = open(path, encoding="utf-8", errors="replace").read()

    # --- try structured key=value / key : value blocks first ---
    blocks = re.split(r"\n\s*\n", text)
    for block in blocks:
        kv = dict(re.findall(r"([\w.]+)\s*[:=]\s*([+-]?\d+(?:\.\d+)?)", block))
        if "kernel" in kv or "c_cycle_rvec_busy" in kv:
            kernel = kv.get("kernel") or kv.get("case") or kv.get("name")
            if not kernel:
                continue
            simd = kv.get("c_cycle_rvec_busy") or kv.get("rvec_busy")
            ipc = kv.get("exu_ipc") or kv.get("ipc")
            ec = kv.get("ec") or kv.get("elements_per_cycle") or kv.get("e_c")
            if simd is None:
                continue
            out[kernel] = {"kernel": kernel, "case": kv.get("case", ""),
                           "simd": float(simd),
                           "ipc": float(ipc) if ipc is not None else None,
                           "ec": float(ec) if ec is not None else None}

    # --- whitespace-column fallback ---
    for ln in text.splitlines():
        ln = ln.strip()
        if not ln or ln.startswith(("#", "//", "|")):
            continue
        parts = ln.split()
        if len(parts) < 3 or parts[0] in out:
            continue
        try:
            simd = float(parts[2].replace(",", ""))
        except ValueError:
            continue
        ipc = float(parts[3]) if len(parts) > 3 else None
        ec = float(parts[4]) if len(parts) > 4 else None
        out[parts[0]] = {"kernel": parts[0], "case": parts[1],
                         "simd": simd, "ipc": ipc, "ec": ec}

    print(f"  {os.path.basename(path)}: {len(out)} kernels")
    return out


def full_kernel(short):
    """Map a short label to the pto-vmi kernel-dir name (mirrors extract_a5a6_simd.py)."""
    s = short.strip()
    if s.lower().startswith("square"):
        return "QuantBf16toMXFp4SquareKernel"
    if "→" in s:
        s = s.split("→")[0].strip()
    return s + "Kernel" if not s.endswith("Kernel") else s


def category_of(kernel):
    k = kernel.lower()
    if "dequant" in k:
        return "dequant"
    if "quant" in k or "square" in k:
        return "quant"
    return "other"


def build(a5_log, a6_log, out_path):
    a5 = parse_perf_pmu(a5_log)
    a6 = parse_perf_pmu(a6_log)

    cats = {}
    for kernel, m5 in sorted(a5.items()):
        m6 = a6.get(kernel)
        if not m6:
            continue
        cat = category_of(kernel)
        rows = cats.setdefault(cat, [])
        delta = round((m6["simd"] - m5["simd"]) / m5["simd"] * 100, 1)
        rows.append({"kernel": kernel, "case": m5.get("case", ""), "arch": "A5",
                     "kernel_full": full_kernel(kernel), "simd": m5["simd"],
                     "ipc": m5["ipc"], "ec": m5["ec"], "delta": delta})
        rows.append({"kernel": kernel, "case": m6.get("case", m5.get("case", "")),
                     "arch": m6.get("arch", "A6"), "kernel_full": full_kernel(kernel),
                     "simd": m6["simd"], "ipc": m6["ipc"], "ec": m6["ec"], "delta": None})

    out = {cat: {"rows": rows, "notes": ""} for cat, rows in sorted(cats.items())}
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"), ensure_ascii=False)

    n = sum(len(v["rows"]) // 2 for v in out.values())
    unpaired = sorted(set(a5) - set(a6))
    print(f"Wrote {out_path}: {n} paired kernels across {list(out.keys())}")
    if unpaired:
        print(f"  A5-only (no A6 match): {len(unpaired)} — {unpaired[:10]}")


def main():
    ap = argparse.ArgumentParser(description="Join full A5 + A6 VF metrics into a5a6_all.json")
    ap.add_argument("--a5", required=True, help="A5 perf_pmu_per_vf.log")
    ap.add_argument("--a6", required=True, help="A6 perf_pmu_per_vf.log")
    ap.add_argument("--out", default="a5a6_all.json")
    args = ap.parse_args()
    build(args.a5, args.a6, args.out)


if __name__ == "__main__":
    main()