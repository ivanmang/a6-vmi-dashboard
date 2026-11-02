#!/usr/bin/env python3
"""
disasm.py — disassemble an Ascend AI-Core kernel and split it into
SIMD (vector) / SIMT (matrix+MTE) / SCALAR (control) views.

Pipeline (uses the LLVM tools from the CANN 9.3.0 weekly package):

    host .so  --llvm-objcopy -O binary -j .aicore_binary-->  embedded ELF
    embedded ELF ----------- llvm-objdump -d ------------>  <name>.S
    <name>.S  --------------- classification ------------->  <name>.tagged.S
                                                              <name>.simd.S
                                                              <name>.simt.S
                                                              <name>.scalar.S

Used both standalone (CLI) and as a library by build_disasm.py:

    from disasm import disassemble
    info = disassemble("libfoo_kernel.so", "/out/dir", "foo")

LLVM tool discovery (in order):
    $ASCEND_LLVM_BIN/llvm-obj{dump,copy}
    ~/cann93_tools/tools/bisheng_compiler/bin/llvm-obj{dump,copy}   (default)
"""

import argparse
import json
import os
import re
import subprocess
import sys

DEFAULT_TOOL_BIN = os.path.expanduser("~/cann93_tools/tools/bisheng_compiler/bin")

# ── classification rules ────────────────────────────────────────────────────
# Each rule is (regex, class). First match on the *mnemonic* wins; otherwise the
# operand/register + symbol-context heuristics below apply.
DEFAULT_RULES = [
    # SIMT — cube / matrix compute
    (r"^(MMAD|MATMUL|LDMATRIX|STMATRIX|FMAC|FIXP|IMATMUL|MMA[0-9]|MAC$|"
     r"LDA[0-9.]*$|STA[0-9.]*$|LDB[0-9.]*$|STB[0-9.]*$|MATRIX)",
     "SIMT"),
    # SIMT — MTE / data-movement feeding the matrix path
    (r"(MTE|_TO_UB|UB_TO_|^PUSH_PB|^POP_PB|PIPE|DMA)",
     "SIMT"),
    # SIMD — vector-thread control + explicit vector ops
    (r"^(VAG|VLOOP|VADD|VSUB|VMUL|VDIV|VMAX|VMIN|VABS|VREC|VSQRT|VRSQRT|VEXP|"
     r"VLOG|VRELU|VSEL|VOR\b|VAND|VNOT|VXOR|VCMP|VCVT|VDUP|VMOV|VLD|VST|"
     r"VSHL|VSHR|VRED|VSORT|VEXTRACT|VINSERT|VSLIDE|VSELR|VFIX|VROUND|"
     r"VF\b|SEND$|PLT\.|PSET\.|SMOVI)",
     "SIMD"),
]


class DisasmError(RuntimeError):
    pass


def find_tool(name):
    bin_dir = os.environ.get("ASCEND_LLVM_BIN") or DEFAULT_TOOL_BIN
    p = os.path.join(bin_dir, name)
    return p if os.path.isfile(p) else None


def run(cmd, **kw):
    return subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          text=True, **kw)


def has_section(objdump, path, sec):
    r = run([objdump, "-h", path])
    return re.search(rf"^\s*\d+\s+{re.escape(sec)}\s", r.stdout, re.M) is not None


class Insn:
    __slots__ = ("addr", "enc", "mnem", "operands", "text", "cls", "reason",
                 "symbol", "in_vec_thread")

    def __init__(self, addr, enc, mnem, operands, text, symbol, in_vec_thread):
        self.addr = addr
        self.enc = enc
        self.mnem = mnem
        self.operands = operands
        self.text = text.rstrip("\n")
        self.cls = None
        self.reason = ""
        self.symbol = symbol
        self.in_vec_thread = in_vec_thread


def load_rules(path):
    with open(path) as f:
        data = json.load(f)
    rules = []
    for cat, pats in data.items():
        for p in pats:
            rules.append((p, cat))
    return rules


def classify(mnem, operands, in_vec_thread, rules):
    m = mnem.strip()
    # 1) explicit rules (mnemonic)
    for pat, cat in rules:
        if re.search(pat, m):
            return cat, f"mnemonic ~/{pat}/"
    # 2) register heuristic: any V-register operand => vector unit (SIMD)
    if re.search(r"\bV\d+", operands):
        return "SIMD", "V-register operand"
    # 3) vector-thread section context
    if in_vec_thread:
        return "SIMD", "inside .vector.thread"
    # 4) explicit vector mnemonic prefix
    if re.match(r"^V[A-Z]", m):
        return "SIMD", "V* mnemonic"
    return "SCALAR", "default (control thread)"


def parse_disasm(text, rules):
    items = []
    cur_sym = None
    cur_vec = False
    for line in text.splitlines():
        sym = re.match(r"^([0-9a-fA-F]+)\s+<(.*)>:$", line)
        if sym:
            cur_sym = line
            cur_vec = ".vector" in sym.group(2)
            items.append(("sym", cur_sym))
            continue
        m = re.match(r"^\s*([0-9a-fA-F]+):\s+([0-9a-fA-F]+)\s+(\S+)\s*(.*)$", line)
        if m:
            addr, enc, mnem, operands = m.groups()
            items.append(Insn(addr, enc, mnem, operands, line, cur_sym, cur_vec))
        else:
            items.append(("raw", line))
    return items


def classify_items(items, rules):
    for it in items:
        if isinstance(it, Insn):
            it.cls, it.reason = classify(it.mnem, it.operands, it.in_vec_thread, rules)


def summary(items):
    counts = {}
    for it in items:
        if isinstance(it, Insn):
            counts[it.cls] = counts.get(it.cls, 0) + 1
    return counts


def write_tagged(items, path):
    counts = summary(items)
    with open(path, "w") as f:
        f.write("# disassembled with CANN 9.3.0 llvm-objdump; classified by disasm.py\n")
        f.write("# classes: " + ", ".join(f"{k}={v}" for k, v in sorted(counts.items())) + "\n")
        f.write("#\n")
        for it in items:
            if isinstance(it, Insn):
                f.write(f"{it.text}  ; [{it.cls}]\n")
            elif it[0] == "sym":
                tag = "  ; <-- vector thread (SIMD)" if ".vector" in it[1] else ""
                f.write(it[1] + tag + "\n")
            else:
                f.write(it[1] + "\n")


def write_split(items, path, wanted, header):
    with open(path, "w") as f:
        f.write(header)
        cur_sym = ""
        for it in items:
            if isinstance(it, Insn):
                if it.cls == wanted:
                    if it.symbol != cur_sym:
                        cur_sym = it.symbol
                        f.write("\n" + cur_sym + "\n")
                    f.write(it.text + "\n")
            elif it[0] == "sym":
                cur_sym = it[1]


def disassemble(input_path, out_dir, base, rules=None):
    """Disassemble `input_path` into `out_dir` using base name `base`.

    Returns a dict:
        {"counts": {...}, "files": {"S","tagged","simd","simt","scalar"},
         "so": <abs input>, "total": int}
    Raises DisasmError on failure.
    """
    objdump = find_tool("llvm-objdump")
    objcopy = find_tool("llvm-objcopy")
    if not objdump or not objcopy:
        raise DisasmError("llvm-objdump/llvm-objcopy not found (set ASCEND_LLVM_BIN)")

    rules = rules if rules is not None else DEFAULT_RULES
    inp = os.path.abspath(input_path)
    if not os.path.isfile(inp):
        raise DisasmError(f"{input_path}: not found")
    os.makedirs(out_dir, exist_ok=True)

    elf_path = inp
    if has_section(objdump, inp, ".aicore_binary"):
        elf_path = os.path.join(out_dir, f"{base}.aicore.elf")
        r = run([objcopy, "-O", "binary", "-j", ".aicore_binary", inp, elf_path])
        if r.returncode or not os.path.isfile(elf_path) or os.path.getsize(elf_path) == 0:
            raise DisasmError("objcopy of .aicore_binary failed:\n" + r.stderr)

    r = run([objdump, "-d", elf_path])
    if r.returncode:
        raise DisasmError("llvm-objdump failed:\n" + r.stderr)

    raw = os.path.join(out_dir, f"{base}.S")
    with open(raw, "w") as f:
        f.write(r.stdout)

    items = parse_disasm(r.stdout, rules)
    classify_items(items, rules)

    tagged = os.path.join(out_dir, f"{base}.tagged.S")
    write_tagged(items, tagged)

    simd = os.path.join(out_dir, f"{base}.simd.S")
    simt = os.path.join(out_dir, f"{base}.simt.S")
    scalar = os.path.join(out_dir, f"{base}.scalar.S")
    hdr = lambda c: f"# {base}: {c}-classified instructions only (disasm.py)\n#\n"
    write_split(items, simd, "SIMD", hdr("SIMD (vector)"))
    write_split(items, simt, "SIMT", hdr("SIMT (matrix/MTE)"))
    write_split(items, scalar, "SCALAR", hdr("SCALAR (control)"))

    counts = summary(items)
    return {
        "counts": counts,
        "total": sum(counts.values()),
        "files": {
            "S": os.path.basename(raw),
            "tagged": os.path.basename(tagged),
            "simd": os.path.basename(simd),
            "simt": os.path.basename(simt),
            "scalar": os.path.basename(scalar),
        },
        "so": inp,
    }


def main():
    ap = argparse.ArgumentParser(description="Disassemble Ascend kernel + SIMD/SIMT split")
    ap.add_argument("input", help="kernel .so (or extracted device ELF/.o)")
    ap.add_argument("--out", help="output directory (default: input dir)")
    ap.add_argument("--name", help="output base name (default: input stem, minus _kernel)")
    ap.add_argument("--rules", help="JSON rules file {CLASS: [regex, ...]}")
    args = ap.parse_args()

    inp = os.path.abspath(args.input)
    out_dir = os.path.abspath(args.out) if args.out else os.path.dirname(inp)
    if args.name:
        base = args.name
    else:
        base = os.path.splitext(os.path.basename(inp))[0]
        if base.endswith("_kernel"):
            base = base[:-len("_kernel")]

    try:
        info = disassemble(inp, out_dir, base, load_rules(args.rules) if args.rules else None)
    except DisasmError as e:
        sys.exit(f"ERROR: {e}")

    c = info["counts"]
    total = info["total"] or 1
    print(f"classified {total} instructions: " +
          ", ".join(f"{k}={v} ({v * 100 // total}%)" for k, v in sorted(c.items())))
    f = info["files"]
    print(f"  outputs -> {f['tagged']}, {f['simd']}, {f['simt']}, {f['scalar']}")


if __name__ == "__main__":
    main()