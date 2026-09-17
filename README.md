# a6-vmi-dashboard

**A6 (dav_9201) CCE vs VMI/DSL dashboard** — a separate repo from the A5
`vmi-dashboard`, with its own **light/teal themed UI** so the two dashboards are
visually unmistakable at a glance.

| | A5 (`vmi-dashboard`) | A6 (`a6-vmi-dashboard`) |
|---|---|---|
| Chip | A5 (dav-c310) | A6 (dav_9201) |
| UI | dark navy / blue | **light / teal** + `A6 · dav_9201` badge |
| Serve port | 8001 | **8002** |

## What's here

```
env.sh                 # source this first (CANN/dav_9201/pto-isa/venv env)
build_dashboard.sh     # collect dumps → parse CCE/VMI → build data.js (→ --serve on 8002)
ops/                   # run/diagnose tooling
  run_cce.sh run_vmi.sh diag_dsl_crash.sh
  linked_launcher_poc.sh gen_launch_lib.py probe_a6_shift.sh
  cann_bug_experiments.sh simple_dsl_test.sh
scripts/
  build_data.py cce_vmi_breakdown.py serve.sh
docs/                  # camodel bug report + yellow-zone runbook
web/                   # themed A6 frontend (index.html, styles.css, app.js, favicon)
data/                  # generated: cce/vmi CA json + report + web/data.js
```

## Quick start (yellow zone)

```bash
git clone git@gitcode.com:ivanmang/a6-vmi-dashboard.git ~/a6-vmi-dashboard
cd ~/a6-vmi-dashboard
source env.sh

# produce dumps (CCE + DSL), then build + serve
cd ~/pto-vmi/cce/a6/VcvtMergeModeKernel && bash run.sh -r sim -v dav_9201 -c case0
cd ~/pto-vmi/dsl/VcvtMergeModeKernel && PTO_TARGET=a6 ~/.venv-ptoas/bin/python3 VcvtMergeModeKernel_case0_bf16_fp8_128_128_w0_setdev_before_pto.py

cd ~/a6-vmi-dashboard && bash build_dashboard.sh --serve
# open http://localhost:8002
```

## Status

- CCE `VcvtMergeModeKernel` on A6 → **PASS** (642 EX, IPC 2.194, 457 cycles)
- DSL `VcvtMergeModeKernel` on A6 → **PASS** (1158 EX, IPC 1.486, 1185 cycles) —
  the pre-merge-mode-optimization gap the case is designed to expose.
- The dav_9201 camodel bugs (teardown + UB-parser) are sidestepped, not fixed;
  full diagnosis + reproduction in `docs/cann-a6-camodel-bug-report.md`.

## Repo notes

- Analysis scripts shared with A5 live in `npu_skills` (`ChanKaLok/npu_skills`);
  this repo carries a local, A6-patched `scripts/cce_vmi_breakdown.py` (handles
  the `cce/<arch>/<Kernel>/` layout) and uses it in preference to the shared one.
- `pto-vmi` (kernels) and `npu_skills` (analysis) are dependencies, not submodules.
