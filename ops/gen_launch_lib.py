"""gen_launch_lib.py — build the ptodsl launch .so for SimpleCopyKernel WITHOUT any ACL init.

The normal DSL run crashes at aclrtSetDevice (before the fatobj is ever built), so we
build the exact same launch shared library here, off-line, by calling the ptodsl native
build directly. No aclInit/SetDevice/launch happens in this process.

Writes /tmp/launch_lib_info.json = {lib_path, launch_symbol, entry, py_name}.
"""
import importlib.util
import json
import os

os.environ.setdefault("PTO_TARGET", "a6")
os.environ.setdefault("MSPROF_SIMULATOR_MODE", "1")

CASE = os.path.expanduser(
    "~/pto-vmi/dsl/SimpleCopyKernel/SimpleCopyKernel_case0_f32_64.py"
)
spec = importlib.util.spec_from_file_location("simplecopy_kernel", CASE)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)  # module __name__ != "__main__" => run_case_acl() skipped

comp = mod.kernel.compile()

from ptodsl._runtime.native_build import build_native_library

lib_path, launch_symbol = build_native_library(
    py_name=comp._py_name,
    module_spec=comp._module_spec,
    kernel_signature=comp._kernel_signature,
    mlir_text=comp.mlir_text(),
    specialization_key=comp.specialization_key,
)

info = {
    "lib_path": str(lib_path),
    "launch_symbol": launch_symbol,
    "entry": comp.ir_function_name,
    "py_name": comp._py_name,
}
out = "/tmp/launch_lib_info.json"
with open(out, "w", encoding="utf-8") as f:
    json.dump(info, f, indent=2)
print(json.dumps(info, indent=2))
print("WROTE", out)
