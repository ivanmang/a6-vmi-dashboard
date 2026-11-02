#!/usr/bin/env python3
"""
build_disasm.py — build the A6 static-disassembly layer (SIMD vs SIMT) for the
dashboard.

Scans for host kernel .so files (CCE and DSL), disassembles each into SIMD/SIMT/
SCALAR views via disasm.py, and writes web/disasm/{manifest.json, <Kernel>/...}.

Usage:
    python3 scripts/build_disasm.py
    python3 scripts/build_disasm.py --kernels kernels.txt --out web/disasm --repo ~/pto-vmi

.so discovery (CCE), first hit wins per kernel:
    1. $REPO/logs/a6_cce_so/<Kernel>/            (staged by run_cce.sh)
    2. $REPO/cce/a6/<Kernel>/build/lib/          (a6 branch, not yet cleaned)
    3. $REPO/cce/<Kernel>/build/lib/             (main branch)

DSL:
    1. $REPO/logs/a6_vmi_so/<Kernel>/            (staged by run_vmi.sh)
    2. $REPO/dsl/<Kernel>/build/lib/ + *.so near the case file

Only the *largest* .so in a hit directory is used (the host fat-object that
carries the .aicore_binary section). Kernels with no .so are recorded with an
"error" so the UI can show why the tab is empty for them.
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import disasm  # noqa: E402

_ROOT = os.path.normpath(os.path.join(HERE, ".."))


def read_kernels(path):
    if not os.path.isfile(path):
        return []
    out = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            out.append(line.split()[0])
    return out


def _largest_so(dirpath):
    if not os.path.isdir(dirpath):
        return None
    best, best_size = None, -1
    for root, _dirs, files in os.walk(dirpath):
        for fn in files:
            if not fn.endswith(".so"):
                continue
            p = os.path.join(root, fn)
            try:
                sz = os.path.getsize(p)
            except OSError:
                continue
            if sz > best_size:
                best, best_size = p, sz
    return best


def find_cce_so(repo, kernel):
    candidates = [
        os.path.join(repo, "logs", "a6_cce_so", kernel),
        os.path.join(repo, "cce", "a6", kernel, "build"),
        os.path.join(repo, "cce", kernel, "build"),
    ]
    for d in candidates:
        so = _largest_so(d)
        if so:
            return so
    return None


def find_dsl_so(repo, kernel):
    candidates = [
        os.path.join(repo, "logs", "a6_vmi_so", kernel),
        os.path.join(repo, "dsl", kernel, "build"),
        os.path.join(repo, "dsl", kernel),
    ]
    for d in candidates:
        so = _largest_so(d)
        if so:
            return so
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--kernels", default=os.path.join(_ROOT, "kernels.txt"))
    ap.add_argument("--out", default=os.path.join(_ROOT, "web", "disasm"))
    ap.add_argument("--repo", default=os.environ.get("PTO_VMI_REPO", os.path.expanduser("~/pto-vmi")))
    args = ap.parse_args()

    kernels = read_kernels(args.kernels)
    out = os.path.abspath(args.out)
    os.makedirs(out, exist_ok=True)

    manifest = {"kernels": [], "generated_from": "llvm-objdump (CANN 9.3.0) + disasm.py"}
    n_ok = 0
    for kernel in kernels:
        entry = {"kernel": kernel, "cce": None, "dsl": None}

        so = find_cce_so(args.repo, kernel)
        if so:
            kdir = os.path.join(out, kernel)
            try:
                info = disasm.disassemble(so, kdir, "cce")
                entry["cce"] = {
                    "counts": info["counts"],
                    "total": info["total"],
                    "files": info["files"],
                    "so": os.path.basename(so),
                }
                n_ok += 1
                print(f"  ✓ {kernel} CCE  {info['counts']}  ({os.path.basename(so)})")
            except disasm.DisasmError as e:
                entry["cce"] = {"error": str(e)[:200]}
                print(f"  ✗ {kernel} CCE  {e}")
        else:
            entry["cce"] = {"error": "no .so found (run run_cce.sh first)"}
            print(f"  – {kernel} CCE  (no .so)")

        so = find_dsl_so(args.repo, kernel)
        if so:
            kdir = os.path.join(out, kernel)
            try:
                info = disasm.disassemble(so, kdir, "dsl")
                entry["dsl"] = {
                    "counts": info["counts"],
                    "total": info["total"],
                    "files": info["files"],
                    "so": os.path.basename(so),
                }
                n_ok += 1
                print(f"  ✓ {kernel} DSL  {info['counts']}  ({os.path.basename(so)})")
            except disasm.DisasmError as e:
                entry["dsl"] = {"error": str(e)[:200]}
                print(f"  ✗ {kernel} DSL  {e}")

        manifest["kernels"].append(entry)

    manifest_path = os.path.join(out, "manifest.json")
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"  manifest.json: {len(manifest['kernels'])} kernel(s), {n_ok} disassembled → {out}")


if __name__ == "__main__":
    main()