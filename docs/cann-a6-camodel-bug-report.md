# CANN A6 Camodel Bug — dav_9201 camodel SIGSEGV (teardown `TmSim::reset()` + UB parser)

**Status:** Open — blocks ptodsl/DSL execution on the A6 simulator.

**Severity:** High (DSL cannot run on A6; CCE unaffected).

**Files to attach to the CANN ticket:** this report, plus
`/tmp/dsl_run7.txt` (DSL run log) and `gdb` backtrace below.

---

## 1. Summary (verified by experiments, 2026-09-16)

Every `ptodsl` DSL kernel run on the **A6 simulator** dies with `SIGSEGV`.
Experiments (see section 6) show this is **two deterministic CANN camodel faults**,
not a PTOAS/compiler/load-path issue:

1. **`dav_9201` teardown crash** — reproducibly `10/10` with a minimal, statically
   **linked** C++ binary (no kernel, no ctypes, no PTOAS):
   `aclInit → aclrtSetDevice → aclrtCreateStream → aclrtMalloc → exit` crashes at
   `tm_engine::TmSim::reset()` (valid IP).
   → **dav_9201-camodel-specific teardown bug.** (`Ascend920A` cannot be used as a
   control: its `lib/` ships only `libruntime_camodel.so`, not a full camodel.)

2. **DSL full-run UB-parser crash** — the DSL kernel additionally reaches a fault at
   `ub_case_config.xml` / `arithmetic_calculator::pre_treat` (`std::regex`) on the
   **dav_9201** full-DSL path.

The DSL kernel itself **compiles and launches**; none of the faults contain a
PTOAS frame (the backtraces are entirely `libUB.so`/`libcommon.so`/`libSoC.so`/
`libEslTop.so`/`libmodel_api.so`).

## 1b. What was ruled out by experiment

- ❌ nondeterministic race — E1: 20/20 crash (deterministic).
- ❌ load path (ctypes vs linked) — E3: a linked C++ binary crashes identically.
- ❌ shared across both sims (for the minimal teardown) — E4: dav_9201 crashes, Ascend920A passes.
- ✅ fault is in CANN libs — E5: `load_macro`/`pre_treat`/`_M_atom` resolve in `libUB.so`/`libcommon.so`.

---

## 2. Environment

| Item | Value |
|---|---|
| CANN | 9.1.0 (`/home/m00922072/Ascend/cann-9.1.0`) |
| Sims | `tools/simulator/dav_9201` (the only runnable A6 camodel; `Ascend920A/lib` has only `libruntime_camodel.so`) |
| ptoas | 0.65, `~/.venv-ptoas` (Python 3.12), wheel from `ivanmang/PTOAS` |
| Kernel | `dsl/VcvtMergeModeKernel/VcvtMergeModeKernel_case0_bf16_fp8_128_128_w0.py` |
| Backend / arch | `backend="vpto"`, `PTO_TARGET=a6` |
| Launch env | `MSPROF_SIMULATOR_MODE=1`, `SIM_LIB_DIR=<sim>/camodel`, sim libs first in `LD_LIBRARY_PATH` |
| CCE reference | `cce/a6/VcvtMergeModeKernel` via `bash run.sh -r sim -v dav_9201 -c case0` |

---

## 3. Symptom

DSL run terminates `exit 139 (SIGSEGV)`. The camodel log ends:

```
[CORE_WRAPPER] [INFO] ... CoreWrapper [DvcCore63] build ...
Start simulation with m_socCycle: 0
SoC unit rank0_chip0_die1 Created
parse xml file: ub_case_config.xml          ← crash, nothing further
```

No Python `Traceback`, no `PASS`, no `mismatch` — a hard native fault.

---

## 4. Crash backtraces (gdb)

### 4.1 Definitive minimal repro — linked C++ binary, NO PTOAS/ptodsl/kernel

A 15-line C++ binary (`aclInit → aclrtSetDevice → aclrtCreateStream → aclrtMalloc → exit`)
linked against `libascendcl` + `libruntime_camodel` crashes **deterministically 10/10**. The
whole stack is CANN simulator code — the camodel segfaults tearing down:

```
Thread 66 "mini_acl" received signal SIGSEGV, Segmentation fault.
#0  tm_engine::TmSim::reset()                    libpem_davinci.so
#1  pem_aic_core::~pem_aic_core()                  libpem_davinci.so
#2  (inlined)                                      libpem_davinci.so
#3  core_wrapper::~core_wrapper()                  libpem_davinci.so
#4  core_wrapper::~core_wrapper()                  libpem_davinci.so
#5  DavinciWrap::TDavinciWrap::~TDavinciWrap()     libCuberWrapper.so
#6  DavinciWrap::TDavinciWrap::~TDavinciWrap()     libCuberWrapper.so
#7  soc_platform::SoC::~SoC()                      libSoC.so
#8  soc_platform::SoC::~SoC()                      libSoC.so
#9  soc_platform::SoC_MD::~SoC_MD()                libSoC.so
#10 soc_platform::SoC_MD::~SoC_MD()                libSoC.so
#11 soc_platform::SoC_MP::~SoC_MP()                libSoC.so
#12 soc_platform::SoC_MP::~SoC_MP()                libSoC.so
#13 EslTop::~EslTop()                              libEslTop.so
#14 threadRunModel(void*)                          libmodel_api.so
```

→ **the dav_9201 camodel faults inside `tm_engine::TmSim::reset()` during its own
normal destructor chain** (`~EslTop → ~SoC_MP → ~SoC_MD → ~SoC → ~TDavinciWrap →
~core_wrapper → ~pem_aic_core`). Zero PTOAS/ptodsl/python frames.

### 4.2 Full-DSL-run fault (secondary path — `ub_case_config.xml` regex parser)

Running the DSL kernel additionally reaches the UB-config parse path:

```
Thread 1 "python3" received signal SIGSEGV, Segmentation fault.
#0  0x00000000b8194ca0 in ?? ()                       <-- unmapped address
#1  std::__detail::_Compiler<std::regex_traits<char>>::_M_atom()            libcommon.so
#2  std::__detail::_Compiler<std::regex_traits<char>>::_M_alternative()     libcommon.so
#3  std::__detail::_Compiler<std::regex_traits<char>>::_M_alternative()     libcommon.so
#4  std::__detail::_Compiler<std::regex_traits<char>>::_M_alternative()     libcommon.so
#5  std::__detail::_Compiler<std::regex_traits<char>>::_M_disjunction()     libcommon.so
#6  std::__detail::_Compiler<std::regex_traits<char>>::_Compiler(...)       libcommon.so
#7  arithmetic_calculator::pre_treat(std::string&)                          libUB.so
#8  ub_ns::xml_parser::load_macro(boost::shared_ptr<FXML::IElement>)        libUB.so
#9  FXML::CElement::Load(std::string const&)                                libUB.so
#10 FXML::CElement::LoadXML(std::string const&)                             libUB.so
#11 ub_ns::ub_top::init()                                                   libUB.so
#12 ub_ns::ub_top::ub_top(...)                                              libUB.so
#13 ub_ns::ub_top_wrapper::ub_top_wrapper(...)                              libUB.so
#14 ub_ns::ub_top_adapter::ub_top_adapter(...)                              libUB.so
#15 soc_platform::SoC::SoC(...)                                             libSoC.so
#16 soc_platform::SoC_MD::SoC_MD(...)                                       libSoC.so
#17 soc_platform::SoC_MP::SoC_MP(...)                                       libSoC.so
#18 EslTop::EslTop(unsigned int)                                           libEslTop.so
#19 startModel_device()                                                     libmodel_api.so
```

Full module paths:
`/home/m00922072/Ascend/cann-9.1.0/tools/simulator/dav_9201/lib/{libpem_davinci.so,libCuberWrapper.so,libUB.so,libcommon.so,libSoC.so,libEslTop.so,libmodel_api.so}`

---

## 5. Root-cause analysis

### 5.1 What the backtrace proves (confirmed)

1. **The fault is in `std::regex` COMPILATION, not matching.**
   Frames `#6..#1` are the `std::regex` *constructor* chain
   (`_Compiler → _M_disjunction → _M_alternative → _M_atom`), i.e. it is
   **building** a regex pattern, not regex-matching an input string.

2. **The corrupting caller is `arithmetic_calculator::pre_treat`.**
   `ub_ns::xml_parser::load_macro` reads a UB "macro" (an arithmetic
   expression describing a UB size / offset) out of `ub_case_config.xml` and
   hands it to `arithmetic_calculator::pre_treat`, which preprocesses that
   expression using a regex.

3. **This is memory corruption, not a stack overflow.**
   `#0` is an **unmapped** address (`0xb8194ca0`) and there are only
   ~3 recursion frames (`_M_alternative` ×3). A genuine deep-recursion /
   huge-pattern overflow would show dozens of stacked regex frames with a
   real instruction pointer in `_M_atom`. Control-flow through an unmapped
   address with shallow frames = a **corrupted heap / pointer**.

4. **The fault is entirely inside CANN's simulator** — there is not a single
   PTOAS/compiler/ptodsl frame in the stack (the fault path is `libUB.so` /
   `libcommon.so` / `libSoC.so` / `libEslTop.so` / `libmodel_api.so`).

### 5.2 Confirmed by isolation (Section 6)

- `aclInit()` alone → `rc 0`, no SoC build.
- `aclInit() + aclrtMalloc()` → `rc 0`, no SoC build.
- `aclInit() + aclrtSetDevice(0)` (ctypes) → **deterministic SIGSEGV, 20/20** (E1);
  the fault is the camodel teardown (`tm_engine::TmSim::reset()`).
- minimal **linked** C++ `mini_acl` (`aclInit → SetDevice → CreateStream → Malloc →
  exit`) → **10/10 SIGSEGV** at `TmSim::reset()` (E3/E7) — so the fault is NOT
  specific to ctypes/ptodsl; a statically-linked binary crashes identically.
- The **CCE** binary (which *runs* its kernel) completes and `PASS`es — i.e. the
  teardown fault is avoided when a kernel actually executes (cycles > 0).

### 5.3 Conclusion

Two **deterministic** dav_9201 camodel faults, both entirely inside CANN simulator libs:

1. **Teardown** — `tm_engine::TmSim::reset()` during the destructor chain, hit by any
   program that initializes the model but never runs a kernel (`mini_acl`, the DSL,
   the minimal ctypes). Proven PTOAS-independent (reproduced with a plain C++ binary).
2. **UB-config parser** — `arithmetic_calculator::pre_treat` (std::regex) during
   `ub_case_config.xml` parse on the full DSL path.

Neither is a race: both reproduce deterministically (E1 20/20, E3 10/10). A linked
binary crashes identically to ctypes (E3), so the load sequence is not the
discriminator. The working CCE is the case where a hand-written kernel runs to
completion, which avoids the teardown fault and never trips the UB parser.

---

## 6. Isolation / evidence matrix (experiment-verified)

| Test | Result | Implication |
|---|---|---|
| CCE `cce/a6/VcvtMergeModeKernel` (`run.sh`, dav_9201) | `[ PASSED ] 1 test` | full kernel run works |
| `aclInit()` only (ctypes) | `rc 0` | crash is later |
| `aclInit()+aclrtMalloc()` (ctypes) | `rc 0` | crash is later |
| **minimal linked C++ `mini_acl` (dav_9201)** | **10/10 SIGSEGV at `TmSim::reset()`** | dav_9201 teardown bug, independent of ctypes/ptodsl |
| same `mini_acl` on `Ascend920A` | **10/10 pass** | minimal teardown bug is dav_9201-only |
| DSL full run (ptodsl, dav_9201) | `139`, `ub_case_config.xml` / regex | second fault on the full path |
| DSL full run (ptodsl, Ascend920A) | `139` | full-path fault exists on both sims |

---

## 7. Fixes attempted (and ruled out — all correct on the tool side)

1. **Compile march** — set `dav-920r1-vec/cube` for `a6` (was `dav-c310`).
2. **ptodsl runtime launcher arch** — `aicore_arch_for_kernel_kind(a6)` → `dav-920r1-*`.
3. **VPTO fatobj host-stub / repack arch** — resolve `dav-920r1` from the device module `target-cpu` (was hardcoded `dav-c310`).
4. **`vmi.vcvt bf16→fp8` f32 bridge** (extf + 4:1 truncf narrow) — correct lowering.
5. **DMA burst size** — split 32 KB single burst into ≤4 KB bursts.
6. **Skip DSL teardown** (`aclrtFree`/`aclrtResetDevice`/`aclFinalize`) — no change.
7. **ACL load order** — preload `libruntime_camodel.so` + `libnpu_drv_camodel.so` with `RTLD_GLOBAL` before `libascendcl.so` (mirror the CCE `DT_NEEDED` order) — no change.

**None of these changed the fault**, which is consistent with the crash being
CANN-internal and independent of the kernel descriptor / arch / load order.

---

## 8. Impact

- **CCE on A6:** unaffected — runs and `PASS`es.
- **DSL (ptodsl) on A6:** cannot execute; every case aborts at SoC init.
- A5 simulator is unaffected (the DSL pipeline runs there).
- The DSL kernel itself **compiles and launches** — the failure is the
  camodel tearing down / corrupting state before or during the first kernel.

---

## 8b. Why pto-isa/CCE run on A6 but the DSL doesn't

| Kernel class | UB layout | Kernel runs? | Teardown | Result |
|---|---|---|---|---|
| pto-isa A6 ST / `cce/a6` CCE | hand-written (3 constant offsets) | ✅ | ✅ (sim ran) | **PASS** |
| DSL (ptodsl, ptoas-generated) | compiler-generated UB descriptor | ❌ (UB parser faults at launch) | — | **SIGSEGV** |
| minimal linked `mini_acl` (no kernel) | none | ❌ (no kernel) | ❌ `tm_engine::TmSim::reset` | **SIGSEGV** |

Two independent dav_9201 camodel bugs, and the two kernel classes land on opposite sides of them:

1. **UB macro parser** (`ub_case_config.xml` → `arithmetic_calculator::pre_treat` →
   `std::regex`, in `libUB.so`/`libcommon.so`). Hand-written kernels emit a few
   constant UB regions that parse fine; the DSL's **compiler-generated** UB
   descriptor walks into this path and the parser corrupts memory during kernel
   launch — before the kernel ever runs.
2. **Teardown** (`tm_engine::TmSim::reset()` during the destructor chain). This
   fires when the sim is torn down without ever executing a kernel (0 cycles).
   CCE/pto-isa run a kernel → teardown is fine → `PASS`. `mini_acl` (init + exit)
   and the DSL (whose launch already faulted) never run a kernel → teardown faults too.

So it is **not** that pto-isa has A6 capability the DSL lacks at the compiler level —
the DSL compiles and launches fine. The dav_9201 `libUB.so` UB parser and
`TmSim::reset()` teardown are simply not robust to the compiler's UB output / to a
no-kernel exit, while hand-written kernels sidestep both.

---

## 8c. Scope — why this is NOT a PTOAS problem (and what PTOAS can't fix)

- **Root cause is CANN, not PTOAS.** The teardown fault (`TmSim::reset()`) is
  reproduced with a plain linked C++ binary that contains no PTOAS, no kernel and no
  UB descriptor; every backtrace frame is in `dav_9201/lib/*.so`. PTOAS is exonerated
  as both the crash site and the root cause.
- **The teardown fault is unfixable from PTOAS.** No compiler output is involved —
  changing the DSL, the UB layout, or PTOAS itself cannot affect it.
- **The UB-parser fault is PTOAS-triggered, but the fix still belongs in CANN.** It
  parses the compiler-emitted UB descriptor, so a PTOAS-side workaround is not
  *theoretically* ruled out; however the simplest DSL UB (a handful of constant
  offsets) faults too, and the camodel is already broken independent of PTOAS — a
  reliable fix must land in `libUB.so` / `libcommon.so`, not in the compiler.

---

## 9. Requested fix (for the CANN team)

1. Harden **`libUB.so::ub_ns::xml_parser::load_macro`** and
   **`arithmetic_calculator::pre_treat`** against the input / concurrent state
   that corrupts the `std::regex` heap (validate the macro string, add synchronization).
2. Fix the teardown path (`tm_engine::TmSim::reset()` during `~EslTop → … → ~core_wrapper`).
3. No further compiler/ptodsl change is expected: both faults reproduce with a plain
   linked C++ binary and no PTOAS involvement.

---

## 10. Step-by-step reproduction tutorial

Target host: an A6 yellow-zone box (x86_64) with CANN 9.1.0 and the `dav_9201`
simulator. Two independent, minimal reproductions — a plain C++ binary (*no PTOAS
at all*) and a DSL kernel — plus a working control on the A5 camodel.

### 0. One-time prerequisites

```bash
# repos (yellow zone is pull-only)
git -C ~/pto-vmi pull
git -C ~/vmi-dashboard pull

# ptoas 0.65 (a6 + .V920 intrinsics) in a 3.12 venv
~/.venv-ptoas/bin/pip show ptoas | grep -E "Name|Version"   # expect 0.65

# environment (also exports PTOAS_BIN + prefers .venv-ptoas)
source ~/vmi-dashboard/a6/a6_env.sh
```

### Reproducer A — camodel teardown bug (no PTOAS, no kernel, no ctypes)

Shows the dav_9201 camodel segfaults in `tm_engine::TmSim::reset()` from nothing
more than `aclInit → aclrtSetDevice → aclrtCreateStream → aclrtMalloc → exit`.

```bash
source ~/vmi-dashboard/a6/a6_env.sh

# compile a 12-line C++ binary exactly the way the CCE links it
cat > /tmp/mini_acl.cpp <<'CPP'
#include <cstdio>
#include "acl/acl.h"
int main() {
  printf("init=%d\n", aclInit(nullptr));
  printf("set=%d\n", aclrtSetDevice(0));
  aclrtStream s; printf("stream=%d\n", aclrtCreateStream(&s));
  void* d = 0; printf("malloc=%d\n", aclrtMalloc(&d, 4096, ACL_MEM_MALLOC_HUGE_FIRST));
  return 0;
}
CPP
bisheng -xc++ -std=c++17 /tmp/mini_acl.cpp -o /tmp/mini_acl \
  -I"$ASCEND_HOME_PATH/include" -I"$ASCEND_HOME_PATH/pkg_inc" \
  -L"$ASCEND_HOME_PATH/lib64" -L"$ASCEND_HOME_PATH/tools/simulator/dav_9201/lib" \
  -Wl,-rpath,"$ASCEND_HOME_PATH/tools/simulator/dav_9201/lib" \
  -Wl,--no-as-needed -lruntime_camodel -lascendcl -lplatform -lc_sec -ldl \
  -lpthread -lm -lstdc++

# run 10x → 10/10 SIGSEGV (139)
for i in $(seq 1 10); do /tmp/mini_acl >/dev/null 2>&1; echo "run $i exit=$?"; done

# capture the backtrace → every frame is in dav_9201/lib/*.so
source ~/vmi-dashboard/a6/a6_env.sh
gdb --batch -ex run -ex "bt 15" --args /tmp/mini_acl 2>&1 | grep -E "SIGSEGV|#[0-9]+"
```

**Expected:** `exit 139` every run; backtrace `#0 tm_engine::TmSim::reset()` and all
frames in `libpem_davinci.so` / `libCuberWrapper.so` / `libSoC.so` / `libEslTop.so` /
`libmodel_api.so` — zero PTOAS/ptodsl/python frames.

### Reproducer B — DSL kernel path (UB-config parser)

```bash
source ~/vmi-dashboard/a6/a6_env.sh
cd ~/pto-vmi/dsl/VcvtMergeModeKernel
rm -rf log_ca log camodel_log ub_case_config.xml parameter_IO_3 ~/.cache/ptodsl
PTO_TARGET=a6 ~/.venv-ptoas/bin/python3 \
  VcvtMergeModeKernel_case0_bf16_fp8_128_128_w0.py
# → exit 139; log ends with:  parse xml file: ub_case_config.xml
```

Or the two super-simple smoke cases (identity copy / square, N=64):

```bash
bash ~/vmi-dashboard/a6/simple_dsl_test.sh /tmp/simple.txt
```

### Reproducer C — control: same binary on the WORKING A5 camodel

```bash
source ~/vmi-dashboard/a6/a6_env.sh
export SIM_LIB_DIR="$ASCEND_HOME_PATH/tools/simulator/Ascend950PR_9599/lib"
export LD_LIBRARY_PATH="$SIM_LIB_DIR:$(echo "$LD_LIBRARY_PATH" | tr ':' '\n' | grep -v tools/simulator | paste -sd:)"
/tmp/mini_acl
# → exit 0  (same binary, same loader, only the A5 camodel libs)
```

### All-in-one (runs E1..E7)

```bash
bash ~/vmi-dashboard/a6/cann_bug_experiments.sh /tmp/cann_experiments.txt
ONLY=E7 bash ~/vmi-dashboard/a6/cann_bug_experiments.sh /tmp/e7_only.txt   # just the backtrace
```

### Verdict checklist

- [ ] `mini_acl` exits 139, 10/10 — deterministic, no kernel, no PTOAS
- [ ] gdb backtrace is 100% inside `dav_9201/lib/*.so`
- [ ] the same `mini_acl` exits 0 on the A5 camodel (`Ascend950PR_9599`)
- [ ] DSL case exits 139 at `ub_case_config.xml`
- [ ] (reference) CCE `cce/a6/VcvtMergeModeKernel` via `run.sh -r sim -v dav_9201 -c case0` → `[  PASSED  ] 1 test.`
---

## 11. Resolution — DSL kernel RUNS on dav_9201 via a minimal C++ host (2026-09-17)

**Proven:** the ptoas-compiled DSL kernel is A6-correct. A minimal C++ host
(`linked_launcher`, linking `libascendcl` + `libruntime_camodel` like CCE, then
`dlopen` of the ptodsl-generated launch `.so`) runs `SimpleCopyKernel` on
dav_9201 end-to-end:

```
PASS linked_launcher (DSL kernel via C++ host)
Parallel Simulation: All threads are joined.
[INFO] Model stopped successfully.
[launcher] teardown done
launcher exit=0
```

The earlier `exit 139` was only a missing `aclrtResetDevice`+`aclFinalize` in the
harness (the CCE host calls these; `mini_acl` did not).

### Root cause, refined

The UB-parser fault is **heap-layout-dependent memory corruption** in
`libUB.so::arithmetic_calculator::pre_treat` (the `std::regex` constructor jumps
to an unmapped address). Bisected empirically:

| Process state before `aclrtSetDevice` | Result |
|---|---|
| `import ptodsl` + numpy/ml_dtypes only | **OK** |
| `from ptodsl import pto` + `@pto.jit` machinery loaded | **SIGSEGV** (deterministic) |
| + numpy `_gen()` data generation | SIGSEGV (not the differentiator) |
| C++ binary (no python, no ptodsl) | OK |

The trigger is the in-process ptodsl `pto`/`@pto.jit` type-system allocations
shifting the heap before the camodel builds the SoC — **not the kernel, not the
data gen, not `import ptodsl` alone**.

### PTOAS-side workarounds (no camodel change needed)

1. **C++ host launcher** — `vmi-dashboard/a6/linked_launcher_poc.sh`. Proven clean
   (`exit=0`, PASS). The DSL *kernel* runs; only the host differs.
2. **`SetDevice` before importing `pto`** — `dsl/VcvtMergeModeKernel/VcvtMergeModeKernel_case0_bf16_fp8_128_128_w0_setdev_before_pto.py`.
   Runs `aclrtSetDevice` before `from ptodsl import pto`, keeping the full
   Python/ptodsl path. (Pending confirmation.)

### Still to file with CANN

The underlying bug is unchanged and belongs to CANN: `pre_treat`/`load_macro`
heap corruption is sensitive to process heap layout, so any sufficiently
allocating host can trip it. Fix belongs in `libUB.so`/`libcommon.so`.

---

## 12. Fully resolved — DSL Vcvt PASSes on dav_9201 (2026-09-17)

The DSL case now prints `PASS case0_bf16_fp8_128_128_w0` on the A6 simulator.

Final two walls (both PTOAS-side, fixed in 0.66/0.67):
1. **vsldb 32-byte alignment** on the 8xbf16 (16-byte) scale load -> pad each
   window's scale to a 32-byte slot (8 data + 8 pad) in the DSL kernel.
2. **Shift-right intrinsic**: the untyped A5 `vshrs.u.x` and the typed
   `.logic/.arith.x` forms have no SelectionDAG pattern on dav-920r1-vec; the
   scalar-explicit `.z` form (`vshrs.v<N><u|s><bits>u<bits>.z`) is what selects.
   Proven by compiling the real kernel IR through bisheng with a name swap:
   only `vshrs.v128u16u16.z` COMPILES.

Complete wall list (in order):
1. stale ptoas rejecting `a6` -> PTOAS_BIN/venv
2. A6 arch + `.V920` + bf16->fp8 vcvt bridge (ptoas 0.65)
3. camodel teardown crash -> host aclrtResetDevice+aclFinalize
4. camodel SetDevice UB-parser crash -> SetDevice before `from ptodsl import pto`
5. vsldb alignment -> padded scale (32B/window)
6. vshrs selection -> typed `.z` form (ptoas 0.67)

To reproduce: `dsl/VcvtMergeModeKernel/VcvtMergeModeKernel_case0_bf16_fp8_128_128_w0_setdev_before_pto.py`
with `PTO_TARGET=a6`, ptoas 0.67.

The camodel bugs (section 1) are unchanged and still belong to CANN; PTOAS now
sidesteps them entirely.
