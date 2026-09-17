#!/usr/bin/env bash
# env.sh — Environment setup for A6 (dav_9201) simulation
#
# Source this before running any A6 scripts:
#   source env.sh
#
# Auto-detects CANN with A6 support. Falls back to CANN_HOME env override.
set -uo pipefail

# ── Auto-detect CANN with A6 support ────────────────────────────────────────
_detect_cann() {
  local best=""
  local found_any=""

  # Build candidate list
  local -a candidates=()
  [[ -n "${CANN_HOME:-}" ]] && candidates+=("$CANN_HOME")
  candidates+=(
    "$HOME/Ascend/cann-9.1.0"
    "$HOME/Ascend/cann-9.0.0-alpha.1"
    "$HOME/Ascend/cann"
    "$HOME/Ascend/ascend-toolkit"
    "$HOME/Ascend/cann-9.0.0-beta.1"
    "/usr/local/CANN/cann-9.1.0"
    "/usr/local/CANN/cann-9.0.0-alpha.1"
    "/usr/local/CANN/cann"
    "/usr/local/Ascend/cann"
    "/usr/local/Ascend/ascend-toolkit"
    "/usr/local/CANN/cann-9.0.0-beta.1"
  )

  # Also search for any cann-* dir under ~/Ascend and /usr/local/CANN
  for d in "$HOME"/Ascend/cann-* /usr/local/CANN/cann-* /usr/local/Ascend/cann-*; do
    [[ -d "$d" ]] && candidates+=("$d")
  done

  for cann in "${candidates[@]}"; do
    [[ -z "$cann" || ! -d "$cann" ]] && continue
    found_any="$cann"

    # Check 1: PTO_NPU_ARCH_A6 in headers
    for hdr in \
      "$cann/include/pto/common/buffer_limits.hpp" \
      "$cann/x86_64-linux/include/pto/common/buffer_limits.hpp"
    do
      if [[ -f "$hdr" ]] && grep -q "PTO_NPU_ARCH_A6" "$hdr" 2>/dev/null; then
        echo "$cann"
        return 0
      fi
    done

    # Check 2: A6 simulator present (dav_9201 or Ascend920A)
    for sim in "$cann/tools/simulator/dav_9201" "$cann/tools/simulator/Ascend920A" \
               "$cann/x86_64-linux/simulator/dav_9201" "$cann/x86_64-linux/simulator/Ascend920A"; do
      if [[ -d "$sim" ]]; then
        echo "$cann"
        return 0
      fi
    done

    # Check 3: bisheng supports dav-920r1-vec
    local bisheng=""
    for b in "$cann/tools/bisheng_compiler/bin/bisheng" "$cann/bin/bisheng"; do
      [[ -e "$b" ]] && bisheng="$b" && break
    done
    if [[ -n "$bisheng" ]]; then
      # CANN 9.1.0+ with bisheng is A6-capable enough to try
      echo "$cann"
      return 0
    fi
  done

  # Return empty — caller will show error
  echo ""
}

export ASCEND_HOME_PATH="${ASCEND_HOME_PATH:-$(_detect_cann)}"

if [[ -z "$ASCEND_HOME_PATH" || ! -d "$ASCEND_HOME_PATH" ]]; then
  echo "[a6_env] ERROR: No CANN with A6 support found." >&2
  echo "" >&2
  echo "  Searched:" >&2
  echo "    ~/Ascend/cann-*" >&2
  echo "    /usr/local/CANN/cann-*" >&2
  echo "    /usr/local/Ascend/cann*" >&2
  echo "" >&2
  echo "  Found CANN installations:" >&2
  for d in "$HOME"/Ascend/cann-* /usr/local/CANN/cann-* /usr/local/Ascend/cann* "$HOME"/Ascend/cann "$HOME"/Ascend/ascend-toolkit; do
    [[ -d "$d" ]] && echo "    $d" >&2
  done
  echo "" >&2
  echo "  To override, set CANN_HOME:" >&2
  echo "    export CANN_HOME=/your/cann/path" >&2
  echo "    source env.sh" >&2
  return 1 2>/dev/null || exit 1
fi

# ── A6 SOC version (try dav_9201, fallback Ascend920A) ─────────────────────
SIM_DIR=""
for sd in "$ASCEND_HOME_PATH/tools/simulator" "$ASCEND_HOME_PATH/x86_64-linux/simulator"; do
  [[ -d "$sd" ]] && SIM_DIR="$sd" && break
done

if [[ -n "$SIM_DIR" ]]; then
  if [[ -d "$SIM_DIR/dav_9201" ]]; then
    export SOC_VERSION="dav_9201"
  elif [[ -d "$SIM_DIR/Ascend920A" ]]; then
    export SOC_VERSION="Ascend920A"
  else
    export SOC_VERSION="dav_9201"
  fi
else
  export SOC_VERSION="dav_9201"
fi
export RUN_MODE="sim"
export NPU_ID="${NPU_ID:-0}"

# ── Source CANN environment ────────────────────────────────────────────────
# Prefer bin/setenv.bash (cann-9.1.0, used by the proven pto-isa run_st.py)
# then set_env.sh. Mirrors the working A6 CCE path exactly.
if [[ -f "$ASCEND_HOME_PATH/bin/setenv.bash" ]]; then
  source "$ASCEND_HOME_PATH/bin/setenv.bash" 2>/dev/null
elif [[ -f "$ASCEND_HOME_PATH/set_env.sh" ]]; then
  source "$ASCEND_HOME_PATH/set_env.sh" 2>/dev/null
fi

# ── Sim runtime libs + ACL stubs ───────────────────────────────────────────
# Mirrors the PROVEN pto-isa tests/script/run_st.py (A6 CCE runs kernels in
# ~97s on dav_9201). The working recipe:
#   1. filter /runtime/lib64 OUT of LD_LIBRARY_PATH
#   2. prepend $ASCEND_HOME_PATH/runtime/lib64/stub  (ACL stub libs — critical)
#   3. prepend the dav_9201 sim dir: prefer lib/ (the working link line uses
#      -L .../dav_9201/lib -lruntime_camodel), fall back to camodel/.
# No LD_PRELOAD — the working CCE path uses none; the camodel is reached via
# normal linking (-lruntime_camodel -lascendcl -lplatform ...).
SIM_LIB=""
if [[ -n "$SIM_DIR" ]]; then
  for sub in lib camodel; do
    d="$SIM_DIR/$SOC_VERSION/$sub"
    if [[ -d "$d" ]]; then SIM_LIB="$d"; break; fi
  done
  # Fall back to $SOC/ if neither lib/ nor camodel/ exists.
  [[ -z "$SIM_LIB" && -d "$SIM_DIR/$SOC_VERSION" ]] && SIM_LIB="$SIM_DIR/$SOC_VERSION"
fi
# Step 1+2: drop /runtime/lib64, add runtime/lib64/stub first (ACL stubs).
STUB_DIR="$ASCEND_HOME_PATH/runtime/lib64/stub"
if [[ -d "$STUB_DIR" ]]; then
  # Filter out any /runtime/lib64 path (keep stub, not the real runtime).
  if [[ -n "${LD_LIBRARY_PATH:-}" ]]; then
    LP=$(echo "$LD_LIBRARY_PATH" | tr ':' '\n' | grep -v '/runtime/lib64' | paste -sd: -)
  else
    LP=""
  fi
  export LD_LIBRARY_PATH="$STUB_DIR:$LP"
fi
# Step 3: sim dir first, then CANN lib dirs.
export LD_LIBRARY_PATH="${SIM_LIB}:${ASCEND_HOME_PATH}/lib64:${ASCEND_HOME_PATH}/x86_64-linux/lib64:${LD_LIBRARY_PATH:-}"
# ── ptodsl launch-path sim mode (CRITICAL for VMI/DSL) ──────────────────────
# ptodsl's native launch .so is linked by runtime_library_flags(): it links
# -lruntime_camodel (sim) ONLY when MSPROF_SIMULATOR_MODE is set, else -lruntime
# (real NPU runtime) → the <<<>>> launch deadlocks waiting for hardware and
# sendStarsSQE never fires (aclrtSynchronizeStream hangs). simulator_library_dirs()
# also hardcodes A5 sims (Ascend950PR_9599/dav_3510) — SIM_LIB_DIR overrides it
# to our dav_9201 dir so the camodel runtime resolves. Without these two vars the
# VMI case compiles + aclrtMemcpy works but the kernel never dispatches (hang).
export MSPROF_SIMULATOR_MODE=1
export SIM_LIB_DIR="$SIM_LIB"
# NOTE: no LD_PRELOAD. The proven pto-isa A6 path (run_st.py) uses none — the
# dav_9201 camodel is reached via normal linking (-lruntime_camodel), and the
# runtime/lib64/stub ACL stubs above bridge aclInit/aclrt to the sim. The
# earlier LD_PRELOAD attempt caused the sim to init but stall at cycle 0.
unset LD_PRELOAD 2>/dev/null || true

# ── bisheng compiler ───────────────────────────────────────────────────────
# If ~/bin/bisheng wrapper exists (from patch_ptoas_a6.py), prepend it
if [[ -f "$HOME/bin/bisheng" ]]; then
  export PATH="$HOME/bin:$ASCEND_HOME_PATH/tools/bisheng_compiler/bin:${PATH}"
else
  export PATH="$ASCEND_HOME_PATH/tools/bisheng_compiler/bin:${PATH}"
fi

# ── pto-isa headers (optional — only if CANN headers lack A6 support) ──────
PTO_ISA="${PTO_ISA_PATH:-$HOME/pto-isa/include}"
if [[ -d "$PTO_ISA/pto" ]]; then
  export PTO_ISA_PATH="$PTO_ISA"
else
  export PTO_ISA_PATH=""
fi

# ── Python venv (ptoas + ptodsl, for VMI/DSL) ──────────────────────────────
# Auto-detect: try .venv-ptoas first (Python 3.12 + ptoas 0.64, accepts a6),
# then .venv-ptoas310 / .venv-ptoas312.
if [[ -z "${PTO_VENV:-}" ]]; then
  for venv in "$HOME/.venv-ptoas" "$HOME/.venv-ptoas310" "$HOME/.venv-ptoas312"; do
    if [[ -d "$venv" ]] && [[ -f "$venv/bin/ptoas" || -f "$venv/bin/python3" ]]; then
      PTO_VENV="$venv"
      break
    fi
  done
fi
if [[ -n "${PTO_VENV:-}" && -d "$PTO_VENV" ]]; then
  export PATH="$PTO_VENV/bin:${PATH}"
  # force the JIT to use THIS venv's ptoas (not a stale ~/.local/bin/ptoas)
  export PTOAS_BIN="$PTO_VENV/bin/ptoas"
  # Detect Python version for site-packages path
  PY_VER=$("$PTO_VENV/bin/python3" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null || echo "3.10")
  export PYTHONPATH="${PTO_VENV}/lib/python${PY_VER}/site-packages:${PYTHONPATH:-}"
fi

echo "[a6_env] CANN=$ASCEND_HOME_PATH  SOC=$SOC_VERSION  PTO_ISA=${PTO_ISA_PATH:-none}  VENV=${PTO_VENV:-none}"
