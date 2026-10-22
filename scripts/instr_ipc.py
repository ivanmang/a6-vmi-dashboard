#!/usr/bin/env python3
"""Issue-rows + IPC-line math for one VF window, shared by build_bundle.py.

This is the computation half of the instruction-vs-IPC chart. It turns a trace
into a small JSON payload the dashboard renders client-side (so the bin-width
and hide-row edits are live UI, not a re-render of a static PNG).

Two trace sources are normalized into one entry list, then the exact window /
rows / IPC math from the chart spec is applied unchanged:

  * bin  — `instr.bin` (npusim record / camodel), decoded with CANN's cannsim
           instr_decoder:
             - 9.2.0: cannsim.core.public.instr_decoder.decode_instr_logs_from_file
               → entries carry an explicit `is_popped` flag.
             - 9.1.0: cannsim.core.instr_decoder.decode_instr_logs(dir) → entries
               have no is_popped; the core index is 0..63 with core>=32 marking
               the popped (issue) copy, so is_popped = (core >= 32).
  * text — `core0.veccore0.instr_popped_log.dump` (issue, is_popped==1) +
           `core0.veccore0.instr_log.dump` (completion, is_popped==0). The camodel
           writes both; the popped log carries issue ticks, the instr log carries
           retire ticks, so `done - issue` reproduces `vf_real_execute_time`.

Each normalized entry is (time, core, sub, is_popped, opcode). The chart keeps
core==0 and sub==1 (the vector pipe the VF runs on), drops everything else.
"""

import re
from pathlib import Path

# The opcode is the last token of `dec`:  (ID: 123) OPCODE
# [A-Za-z0-9_]+ (superset of the spec's [A-Z0-9_]+) so lowercase forms like
# RV_VLOOPv2 are not truncated.
OP_RE = re.compile(r"\(ID:\s*(\d+)\)\s+([A-Za-z0-9_]+)")
TICK_RE = re.compile(r"\[info\]\s+\[(\d+)\]")

VEC_CORE = 0
VEC_SUB = 1
PALETTE = [
    "#1f4e79", "#8fb4d4", "#1a7a7a", "#e07a1f", "#1b5e20", "#7cb342",
    "#5c4e78", "#c45c26", "#3d5a80", "#6b4c7a", "#b5b5b5", "#888888",
]


def opcode_of(dec):
    m = OP_RE.search(dec or "")
    return m.group(2) if m else None


# ---------------------------------------------------------------------------
# source pick: one normalized entry list from bin or text
# ---------------------------------------------------------------------------

def _decode_bin(trace_dir, bin_path):
    """Decode instr.bin → list of {time, core, sub, is_popped, op}. None on failure."""
    entries = []

    def norm(raw, has_popped):
        out = []
        for e in raw:
            if has_popped:
                core, sub, isp = int(e.core), int(e.sub), int(getattr(e, "is_popped", 0))
            else:
                core, sub, isp = int(e.core) % 32, int(e.sub), (0 if int(e.core) < 32 else 1)
            out.append({
                "time": int(e.time),
                "core": core,
                "sub": sub,
                "is_popped": isp,
                "op": opcode_of(getattr(e, "dec", "") or ""),
            })
        return out

    # 9.2.0 API first (file path, explicit is_popped).
    try:
        from cannsim.core.public.instr_decoder import decode_instr_logs_from_file
        raw = decode_instr_logs_from_file(Path(bin_path))
        if raw:
            entries = norm(raw, True)
    except Exception:
        entries = []
    if entries:
        return entries

    # 9.1.0 API (directory path, core>=32 = popped/issue copy).
    try:
        from cannsim.core.instr_decoder import decode_instr_logs
        raw = decode_instr_logs(Path(trace_dir))
        if raw:
            entries = norm(raw, False)
    except Exception:
        entries = []
    return entries or None


def _decode_text(trace_dir):
    """Decode the two core0.veccore0 text dumps → entry list. None if absent."""
    popped = Path(trace_dir) / "core0.veccore0.instr_popped_log.dump"
    issue = Path(trace_dir) / "core0.veccore0.instr_log.dump"
    if not popped.is_file() and not issue.is_file():
        return None
    entries = []
    for path, is_popped in ((popped, 1), (issue, 0)):
        try:
            for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
                tm = TICK_RE.search(line)
                if not tm:
                    continue
                op = opcode_of(line)
                if op is None:
                    continue
                entries.append({
                    "time": int(tm.group(1)),
                    "core": VEC_CORE,
                    "sub": VEC_SUB,
                    "is_popped": is_popped,
                    "op": op,
                })
        except OSError:
            continue
    return entries or None


def load_entries(trace_dir):
    """Normalized entry list for *trace_dir*, preferring instr.bin over text dumps."""
    td = Path(trace_dir)
    bin_path = td / "instr.bin"
    if bin_path.is_file():
        entries = _decode_bin(td, bin_path)
        if entries:
            return entries
    return _decode_text(td)


# ---------------------------------------------------------------------------
# window / rows / ipc — match the chart spec exactly
# ---------------------------------------------------------------------------

def _vec(entries, is_popped):
    return [e for e in entries
            if e["core"] == VEC_CORE and e["sub"] == VEC_SUB and e["is_popped"] == is_popped]


def window(entries, kind):
    """Return (ticks, ops) for one kind ("simd"|"simt"). ops = [(t, opcode), ...].

    ticks = done - issue (the VF window width). ops = every *issue* inside the
    window except the VF opcode itself. Returns (None, None) if the window is
    degenerate (missing VF issue/completion, or done <= issue).
    """
    vf_name = "VF_SIMT" if kind == "simt" else "VF"
    issues = _vec(entries, 1)
    if not issues:
        return None, None
    issue = next((e["time"] for e in issues if e["op"] == vf_name), None)
    done = next((e["time"] for e in _vec(entries, 0) if e["op"] == vf_name), None)
    if issue is None or done is None or done <= issue:
        return None, None
    ticks = done - issue
    ops = [(e["time"] - issue, e["op"]) for e in issues
           if e["op"] is not None and e["op"] != vf_name and issue <= e["time"] <= done]
    return ticks, ops


def rows_from(ops):
    """One row per opcode, busiest first (grouping is a later client-side edit)."""
    counts = {}
    for _, op in ops:
        counts[op] = counts.get(op, 0) + 1
    rows = []
    for i, op in enumerate(sorted(counts, key=lambda name: (-counts[name], name))):
        label = op
        if label.startswith("RV_"):
            label = label[3:]
        elif label.startswith("SIMT_"):
            label = label[5:]
        rows.append((label, op, counts[op], PALETTE[i % len(PALETTE)]))
    return rows


def ipc_line(ops, ticks, width):
    """Bin issues into *width*-tick bins; return (xs, ys) at bin centers."""
    n = (ticks + width - 1) // width
    counts = [0] * n
    for t, _ in ops:
        if 0 <= t < ticks:
            counts[t // width] += 1
    xs, ys = [], []
    for i, c in enumerate(counts):
        lo, hi = i * width, min(ticks, (i + 1) * width)
        w = hi - lo
        xs.append(lo + w / 2)
        ys.append(c / w)
    return xs, ys


# ---------------------------------------------------------------------------
# bundle payload (consumed by web/app.js renderExIpc)
# ---------------------------------------------------------------------------

def _payload(entries, kind, bin_width=20):
    ticks, ops = window(entries, kind)
    if ticks is None or ops is None or ticks <= 0:
        return None
    rows = rows_from(ops)
    xs, ys = ipc_line(ops, ticks, bin_width)
    return {
        "vf": ticks,
        "issues": len(ops),
        "ipc": (len(ops) / ticks),
        "bin": bin_width,
        # full flattened issue ticks let the client re-bin at any width without refetch
        "ticks": sorted(t for t, _ in ops),
        "ipc_xs": xs,
        "ipc_ys": ys,
        "rows": [
            {"label": label, "op": op, "n": n, "color": color,
             "ticks": sorted(t for t, o in ops if o == op)}
            for label, op, n, color in rows
        ],
    }


def compute_for_bundle(trace_dir, bin_width=20):
    """Return {"simd": {...}, "simt": {...}} (whichever windows exist), else {}."""
    entries = load_entries(trace_dir)
    if not entries:
        return {}
    out = {}
    for kind in ("simd", "simt"):
        payload = _payload(entries, kind, bin_width)
        if payload:
            out[kind] = payload
    return out


def main(argv):
    """CLI for sanity-checking a trace dir vs the spec's worked numbers."""
    import argparse
    import json
    import sys
    p = argparse.ArgumentParser(description="Compute instr-vs-IPC payload for a trace dir.")
    p.add_argument("trace_dir")
    p.add_argument("--bin", type=int, default=20, help="IPC bin width in ticks (default 20)")
    args = p.parse_args(argv[1:])
    result = compute_for_bundle(args.trace_dir, args.bin)
    if not result:
        print("no VF/VF_SIMT window found", file=sys.stderr)
        return 1
    for kind, pay in result.items():
        print(f"{kind}  VF {pay['vf']}  issues {pay['issues']}  IPC {pay['issues'] / pay['vf']:.2f}")
        for r in pay["rows"]:
            print(f"  {r['label']:12s} {r['op']:16s} ×{r['n']}")
        print(json.dumps({"vf": pay["vf"], "ipc": pay["issues"] / pay["vf"],
                          "ipc_xs": pay["ipc_xs"], "ipc_ys": pay["ipc_ys"]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(__import__("sys").argv))