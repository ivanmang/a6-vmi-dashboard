#!/usr/bin/env bash
# build_explorer.sh — build A6 "Kernel Lab" (explorer) bundles for the active
# kernels in kernels.txt. Self-contained: uses scripts/build_bundle.py (A6-patched)
# + static opcode_info/corr_map. Outputs web/explorer/{manifest.json, bundles...}.
set -uo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${PTO_VMI_REPO:-$HOME/pto-vmi}"
PTO_VENV="${PTO_VENV:-$HOME/.venv-ptoas}"
KERNELS_FILE="${KERNELS_FILE:-$SCRIPT_DIR/../kernels.txt}"
EXPLORER_DIR="$SCRIPT_DIR/../web/explorer"
BUNDLE_PY="$SCRIPT_DIR/build_bundle.py"

mkdir -p "$EXPLORER_DIR"
[[ -f "$KERNELS_FILE" ]] || { echo "[explorer] missing $KERNELS_FILE"; exit 1; }
mapfile -t KERNELS < <(grep -vE '^\s*(#|$)' "$KERNELS_FILE" | awk '{print $1}')
echo "[explorer] building Kernel Lab for ${#KERNELS[@]} active kernel(s)"

for kernel in "${KERNELS[@]}"; do
  dsl_dir="$REPO_ROOT/dsl/$kernel"
  py=""
  if [[ -d "$dsl_dir" ]]; then
    py=$(find "$dsl_dir" -maxdepth 1 -type f -name "${kernel}_*_emit.py" 2>/dev/null | sort | head -1)
    [[ -z "$py" ]] && py=$(find "$dsl_dir" -maxdepth 1 -type f \( -name "${kernel}_case0_*.py" -o -name "${kernel}_real_*.py" \) 2>/dev/null | sort | head -1)
    [[ -z "$py" ]] && py=$(find "$dsl_dir" -maxdepth 1 -name "*.py" 2>/dev/null | sort | head -1)
  fi
  if [[ -z "$py" ]]; then
    echo "  SKIP $kernel (no DSL case file)"; continue
  fi
  case_id="$(basename "$py" .py)"
  echo "  → $kernel ($case_id)"
  "$PTO_VENV/bin/python3" "$BUNDLE_PY" \
    --kernel "$kernel" --case "$case_id" --side both --arch a6 \
    --repo "$REPO_ROOT" --pto-venv "$PTO_VENV" --out "$EXPLORER_DIR" \
    --corr-map "$SCRIPT_DIR/corr_map.json" \
    && echo "    ok" || echo "    FAILED (continuing)"
done

# static support files
cp -f "$SCRIPT_DIR/opcode_info.json" "$EXPLORER_DIR/opcode_info.json" 2>/dev/null
cp -f "$SCRIPT_DIR/corr_map.json" "$EXPLORER_DIR/corr_map.json" 2>/dev/null

# manifest.json from the produced bundles
"$PTO_VENV/bin/python3" - "$EXPLORER_DIR" <<'PYEOF'
import json, os, sys
d = sys.argv[1]
skip = {"manifest.json", "opcode_info.json", "corr_map.json", "coverage_taxonomy.json"}
bundles = []
for f in sorted(os.listdir(d)):
    if not f.endswith(".json") or f in skip:
        continue
    try:
        b = json.load(open(os.path.join(d, f), encoding="utf-8"))
    except Exception:
        continue
    bundles.append({
        "kernel": b.get("kernel", "?"),
        "case_id": b.get("case_id", "?"),
        "file": f,
        "stats": b.get("stats", {}),
        "tags": b.get("tags", {}),
    })
with open(os.path.join(d, "manifest.json"), "w", encoding="utf-8") as fh:
    json.dump({"bundles": bundles}, fh, indent=2)
print(f"  manifest.json: {len(bundles)} bundle(s)")
PYEOF

echo "[explorer] done → $EXPLORER_DIR"