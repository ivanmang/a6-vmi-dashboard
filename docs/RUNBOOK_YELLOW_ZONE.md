# Runbook — Run A6 kernels + dashboard on the Yellow Zone (10.194.43.138)

The yellow zone is **download-only**: it can `git pull` from gitcode but cannot
push back. Run every command below **on the yellow zone** and paste the output
back to the blue zone for triage. The A6 simulator (`dav_9201`) exists **only**
here.

## 0. Pull the latest (gets the aclInit-500000 fix in `a6_env.sh`)

```bash
cd ~/vmi-dashboard && git pull
cd ~/pto-vmi       && git pull
cd ~/npu_skills    && git pull
cd ~/pto-isa       && git pull
```

> Commit `2811b58` (2026-09-09) fixed `a6_env.sh`: it now searches both `lib/`
> and `camodel/` for the dav_9201 camodel libs and `LD_PRELOAD`s
> `libruntime_camodel.so` + `libnpu_drv_camodel.so` (mirrors the proven A5
> `vmi_sim_env.sh`). Without this, VMI/DSL cases hit `aclInit failed 500000`.

## 1. Apply the ptoas/bisheng A6 patches (idempotent, backs up originals)

```bash
source ~/vmi-dashboard/a6/a6_env.sh   # auto-detects CANN + ptoas venv
python3 ~/vmi-dashboard/a6/patch_ptoas_a6.py
```

If `a6_env.sh` prints `VENV=none` or picks the wrong CANN, set overrides first:
```bash
export PTO_VENV=~/.venv-ptoas312                      # wherever cp312 ptoas lives
export CANN_HOME=$(dirname $(dirname $(find ~/Ascend -path '*dav_9201*' -name set_env.sh | head -1)))
source ~/vmi-dashboard/a6/a6_env.sh
```

## 2. Readiness gate (static + one-kernel smoke) — PASTE THIS OUTPUT BACK

```bash
bash ~/vmi-dashboard/a6/a6_yellow_readiness.sh --smoke 2>&1 | tee /tmp/yellow_readiness.txt
```

**Gate = `✓ YELLOW ZONE READY` with `FAIL=0` AND a non-empty smoke dump:"
```bash
ls -l ~/pto-vmi/logs/a6_vmi_logs/S8ToS32Cast64In/core0.veccore0.instr_log.dump
```

The new `camodel ACL shims present` line tells us if dav_9201 has both
`libruntime_camodel.so` + `libnpu_drv_camodel.so`. If it says `camodel
INCOMPLETE … libruntime_camodel.so MISSING`, the CANN install on this host
cannot serve ACL runtime and VMI cases cannot run (toolchain gap to report
upstream) — stop here and paste back.

## 3. Run the A6 VMI/DSL demo kernels (50 cases, ~20-40 min sequential)

By default `a6_run_vmi.sh` runs only the **demo kernels** (~52 listed in
`pto-vmi/docs/demo_kernels.md`, 50 of which have runnable case files), not all
157. This is the curated set for the dashboard demo.

```bash
nohup bash ~/vmi-dashboard/a6/a6_run_vmi.sh --resume \
  > ~/a6_vmi_demo.log 2>&1 &
tail -f ~/a6_vmi_demo.log      # Ctrl-C to detach (run continues)
```

To run all 157 instead: add `--all`. To run only the 31 legacy matched
kernels: add `--matched`.

Triage after: `column -t -s$'\t' ~/pto-vmi/logs/a6_vmi_logs/_manifest.tsv`

## 4. (Optional) Run A6 CCE counterparts for matched pairs

```bash
bash ~/vmi-dashboard/a6/a6_run_cce.sh    # → ~/pto-vmi/logs/a6_cce_logs/
```

> Known: `pto-vmi/cce/*/run.sh` hardcodes `…/$SOC/lib` in LD_LIBRARY_PATH.
> If dav_9201 uses `camodel/`, CCE binaries may fail to find the sim libs.
> VMI-only dashboard rows still work without CCE.

## 5. Build + serve the dashboard

```bash
bash ~/vmi-dashboard/a6/a6_build_dashboard.sh --serve --port 8001
# → http://<yellow-zone-ip>:8001
```

KPI count should be ≈157 VMI cases (matched + vmi-only).

## What to paste back to blue zone

1. `/tmp/yellow_readiness.txt` (the full `--smoke` output).
2. `ls -l` of the ActMinMaxClamp smoke dump.
3. If you ran step 3: `column -t -s$'\t' ~/pto-vmi/logs/a6_vmi_logs/_manifest.tsv | head -40` + the summary line.
