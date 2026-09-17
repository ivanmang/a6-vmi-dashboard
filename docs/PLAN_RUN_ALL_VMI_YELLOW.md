# Plan — Run ALL VMI Cases on A6 in the Yellow Zone

**Goal:** The `a6/` dashboard currently runs only the **31 matched** VMI kernels
(`a6_run_vmi.sh` hardcodes a `KERNELS=(...)` array). There are **153 runnable
VMI/DSL cases** (157 dirs, 153 with `<Kernel>_case0_*.py` / `<Kernel>_real_*.py`).
This plan runs **all 153** on the A6 sim (`dav_9201`) inside the yellow zone
(download-OK, upload-blocked) and surfaces them in the dashboard.

---

## Current state (verified)

| Item | Value |
|---|---|
| DSL kernel dirs | 157 |
| Kernels with a runnable case file | 153 |
| Cases `a6_run_vmi.sh` runs today | **31** (hardcoded, matched only) |
| Run mode | **Sequential** (no `JOBS`/parallel) |
| Per-case timeout | `PER_CASE_TIMEOUT=600` s |
| A6 arch patch (Patch 1: cmpw `a5`→`a6`) | ✅ in `ptoas-…_a6patched.whl` (9 occ.) |
| A6 store patch (Patch 2: `ALIGN.V2.DV`→`.V920`) | ❌ **NOT** in the whl → must run `patch_ptoas_a6.py` |
| bisheng load-intrinsic wrapper (Patch 3) | ❌ must run `patch_ptoas_a6.py` |
| VMI-only cases (no CCE match) shown in dashboard | ❌ dropped — `cce_vmi_ca_report.py` builds rows from CCE only |

**Root cause of "only 31":** `a6_run_vmi.sh` line `KERNELS=(… 31 …)` + the report
builder iterates `cce.items()`, so unmatched VMI cases never become dashboard rows.

---

## Phase 0 — Yellow-zone environment (one-time, download-only)

Everything below is **inbound** (clone/install), which the yellow zone permits.

1. **CANN 9.1.0 with A6 support** (dav_9201 sim + bisheng `dav-920r1-vec`):
   ```bash
   ls ~/Ascend/cann-9.1.0/tools/simulator/dav_9201   # must exist
   ```
2. **ptoas 0.59** in a venv — install the whl **matching both host arch AND venv python**:
   - **aarch64 + Python 3.12** → `ptoas-0.59-cp312-cp312-manylinux_2_34_aarch64.whl`  ← yellow zone
   - **aarch64 + Python 3.10** → `ptoas-0.59-cp310-cp310-manylinux_2_34_aarch64.whl`
   - **x86_64 + Python 3.12** → `ptoas-0.59-cp312-cp312-manylinux_2_34_x86_64.whl`
   - **x86_64 + Python 3.10** → `ptoas-0.59-cp310-cp310-manylinux_2_34_x86_64[_a6patched].whl`
   (the wheel tag cp310/cp312 must match the venv's Python minor version exactly;
   the platform tag x86_64/aarch64 must match `uname -m`. x86_64 whl will NOT
   install on aarch64 — pip rejects the platform.)
   ```bash
   # aarch64 + Python 3.12 (yellow zone) — create venv with host's python3.12:
   python3 -m venv ~/.venv-ptoas312
   source ~/.venv-ptoas312/bin/activate
   pip install --upgrade pip
   pip install ~/ptoas-0.59-cp312-cp312-manylinux_2_34_aarch64.whl ptodsl
   ```
   > Whl choice doesn't matter much: `patch_ptoas_a6.py` is **arch-aware**
   > (x86_64 `cmpw` or aarch64 `movz`/literal-pool) and applies all 3 patches
   > regardless of which whl you start from. `a6_env.sh` auto-detects both
   > `~/.venv-ptoas310` and `~/.venv-ptoas312`. Patches 2+3 are string/shell,
   > arch-independent.
3. **Apply the remaining A6 patches locally** (Patch 2 + Patch 3):
   ```bash
   source ~/vmi-dashboard/a6/a6_env.sh
   python3 ~/vmi-dashboard/a6/patch_ptoas_a6.py
   #   → Patch 2: ALIGN.V2.DV → ALIGN.V2.DV.V920  (store intrinsic)
   #   → Patch 3: bisheng wrapper (load intrinsics f32.DV→s32.V920, …)
   ```
4. **Verify the whole stack in one command** (no upload needed):
   ```bash
   bash ~/vmi-dashboard/a6/a6_yellow_readiness.sh            # static checks
   bash ~/vmi-dashboard/a6/a6_yellow_readiness.sh --smoke    # + run one kernel
   ```
   It checks: 3 repos · DSL case inventory (≥150) · CANN+A6 sim (dav_9201/Ascend920A)
   · bisheng · ptoas venv (Py3.10) · Patch 1 (ptoas `--pto-arch=a6`) · Patch 2
   (store `.V920`) · Patch 3 (bisheng wrapper) · end-to-end smoke dump.

**Gate:** `a6_yellow_readiness.sh` prints `✓ YELLOW ZONE READY` (FAIL=0) and the
`--smoke` run produces a non-empty
`~/pto-vmi/logs/a6_vmi_logs/ActMinMaxClamp/core0.veccore0.instr_log.dump`.

---

## Phase 1 — Make `a6_run_vmi.sh` discover ALL cases  ✅ DONE

Replaced the hardcoded 31-entry array with **dynamic discovery**, keeping the
existing per-case isolation, continue-on-fail, dump collection, and status
tracking. `--matched` remains as an opt-in subset (legacy 31).

**Implemented** (`a6_run_vmi.sh`):
1. `MATCHED_KERNELS=(31)` kept for back-compat; `--all` (default) walks every
   `dsl/<Kernel>/` and picks the first `<Kernel>_case0_*.py` (else
   `<Kernel>_real_*.py`). **One case per kernel, kernel-only log dirs** — this
   is what `cce_vmi_ca_report.py` expects (it joins VMI cases by kernel name).
   Verified: `--list --all` → 153, `--list --matched` → 31.
2. CLI flags: `--all` (default) · `--matched` · `-c/-v/--list` · `--resume`
   (skip PASS) · `--retry-failed` (re-run non-PASS after a patch update).
3. Discovery moved **before** env/ptoas checks, so `--list` works as a dry-run
   without CANN/ptoas installed.
4. Target patching (`target="a5"→"a6"`) + restore now iterate a `PATCH_FILES[]`
   built from discovered cases (covers all 153, not just 31).
5. Emits `~/pto-vmi/logs/a6_vmi_logs/_manifest.tsv`
   (`kernel⇥case⇥status⇥dump_bytes⇥elapsed_s⇥error`) for Phase 2 triage
   (`column -t -s$'\t'` renders it).

**Acceptance:** `a6_run_vmi.sh --list` prints 153 cases; `--all` runs all and
produces a manifest + per-case dumps. ✅ verified on dev box (syntax + discovery).

---

## Phase 2 — Extend A6 patch coverage (iterative, until convergence)

Some of the 122 *new* cases will hit intrinsics the current wrapper doesn't
cover. Run all, then triage by failure category:

| Category | Detect | Fix |
|---|---|---|
| **Unsupported intrinsic** (compile error) | `grep -i "error\|cannot select\|unknown"` in `run.log` + `cat` the IR | extend the bisheng wrapper's `sed` list (Patch 3) and/or `patch_ptoas_a6.py` Patch 2 for new `ALIGN.V2.*.DV` / store strings |
| **Empty/no dump** | `dump_bytes==0` | usually a ptoas codegen issue for that op on a6 → file per-case note; may need ptodsl/ptoas update |
| **Timeout (>600s)** | `rc==124` | raise `PER_CASE_TIMEOUT` for that case or mark as long-running |
| **camodel crash (post-dump)** | non-zero rc but dump present | already treated as PASS (expected A6 behavior) |

**Loop:**
```bash
bash a6_run_vmi.sh --all                       # run all
bash a6_run_vmi.sh --retry-failed _manifest.tsv # after extending patches
# repeat until manifest shows ~0 hard failures
```

Track the residual unsupported set explicitly (these are real A6-toolchain gaps,
useful to report upstream).

---

## Phase 3 — CCE counterparts (for matched pairs; optional)

To populate **matched pairs** in the dashboard, run CCE for every kernel that
has a DSL counterpart. `a6_run_cce.sh` today targets the same 31; apply the
same **dynamic discovery** to it (iterate `cce/*/main.cpp` `TEST_F` case0 specs).

- Cases with a CCE counterpart → **matched pairs** (CCE vs VMI comparison).
- Cases with VMI only (no CCE dir or no `TEST_F case0`) → **VMI-only** rows.

**Acceptance:** CCE dumps exist for all matched kernels; `a6_build_dashboard.sh`
auto-detects both `a6_cce_logs/` and `a6_vmi_logs/`.

---

## Phase 4 — Surface VMI-only cases in the dashboard

Today the pipeline **drops** unmatched VMI cases:
- `cce_vmi_breakdown.py` *does* compute `unmatched_vmi` and writes it to the
  breakdown JSON ✅
- but `cce_vmi_ca_report.py` builds `rows` from `cce.items()` only ❌ →
  VMI-only never become rows
- `web/app.js` has a **CCE-only** tab but **no VMI-only** tab ❌

Three small changes:

1. **`cce_vmi_ca_report.py`** — append VMI-only rows:
   ```python
   matched_cce = {p["cce"] for p in match.get("matched", [])} if isinstance(match, dict) else set()
   matched_vmi = {p["vmi"] for p in match.get("matched", [])} if isinstance(match, dict) else set()
   for vid, rec in vmi.items():
       if rec["kernel"] in matched_vmi: continue          # already paired
       rows.append(build_row(vid, rec["kernel"], rec["kernel"], None, rec))  # cce=None, vmi=rec
   ```
   (`extract(None)` already returns all-zero / None metrics — verify it tolerates `None`.)
2. **`build_data.py`** — pass through `vmi_only_count` + ensure VMI-only rows
   carry `vmi` populated and `cce` null (mirror how CCE-only rows are built).
3. **`web/app.js`** — add a **VMI-only** tab mirroring the CCE-only view, keyed
   on `r.cce && r.cce.ex==null && r.vmi && r.vmi.ex!=null`.

**Acceptance:** dashboard shows Matched pairs + CCE-only + VMI-only tabs, with
all ~153 A6 VMI cases represented somewhere.

---

## Phase 5 — Build & serve

```bash
bash ~/vmi-dashboard/a6/a6_build_dashboard.sh --serve --port 8001
# auto-detects ~/pto-vmi/logs/a6_cce_logs + a6_vmi_logs
```

Verify: KPI counts = matched + cce_only + vmi_only ≈ 153 (VMI side fully covered).

---

## Phase 6 — Automation for a long sequential run

153 cases × ~30 s avg ≈ **75 min**, but a few 290 s+ cases and possible timeouts
push it toward **2–4 h**. Because the run is sequential and A6 camodel may not
be safe to parallelize:

```bash
nohup bash a6_run_vmi.sh --all --resume > a6_vmi_all.log 2>&1 &
# or: tmux new -s a6vmi 'bash a6_run_vmi.sh --all --resume'
```

`--resume` (Phase 1) lets you restart safely after a network drop or a patch
update without re-running PASS cases. If profiling shows camodel is CPU-bound on
a single core, add bounded parallelism (e.g. `xargs -P 2`) as a later
optimization — validate correctness first.

---

## Risk register

| Risk | Mitigation |
|---|---|
| ptoas/bisheng can't lower some A6 intrinsic across the extra cases | Phase 2 iterative patch extension; residual set reported as toolchain gaps |
| A6 `set_env.sh` auto-detect picks wrong CANN | set `CANN_HOME` explicitly before sourcing `a6_env.sh` |
| Yellow zone has no upload → can't push new whl | all patches are local (binary patch + wrapper script); only inbound clone/install needed |
| Sequential run too slow | `--resume` + bounded `-P 2` after correctness validated |
| VMI-only cases invisible in dashboard | Phase 4 report + frontend changes |

---

## Quick checklist

- [x] Phase 0: `a6_yellow_readiness.sh` gate (CANN 9.1.0 + a6patched whl + `patch_ptoas_a6.py` + `--smoke`)
- [x] Phase 1: `a6_run_vmi.sh` discovers 153 cases, `--all/--matched/--resume/--retry-failed` flags, manifest
- [ ] Phase 2: run all → triage → extend patches → `--retry-failed` until converged
- [ ] Phase 3: `a6_run_cce.sh` dynamic discovery for matched CCE counterparts
- [ ] Phase 4: report emits VMI-only rows + `build_data.py` + VMI-only tab in `app.js`
- [ ] Phase 5: `a6_build_dashboard.sh --serve` shows all ~153 VMI cases
- [ ] Phase 6: `nohup`/`tmux` + `--resume` for resilient long runs
