// linked_launcher.cpp — launch a ptodsl-compiled kernel from a MINIMAL C++ host.
//
// Mirrors the working CCE run.sh host: link libascendcl + libruntime_camodel as
// DT_NEEDED, do ACL init, then load the ptodsl-generated launch .so (which contains
// the ptoas fatobj) and call its launch symbol. No python, no ctypes, no numpy.
//
// usage: linked_launcher <launch.so> <launch_symbol>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <dlfcn.h>
#include "acl/acl.h"

typedef void (*launch_fn_t)(unsigned int grid, void *stream, float *y, float *x);

static int g_rc_failures = 0;

static void chk(int rc, const char *what) {
    printf("[launcher] %-18s rc=%d\n", what, rc);
    if (rc != 0) g_rc_failures++;
}

int main(int argc, char **argv) {
    if (argc < 3) {
        fprintf(stderr, "usage: %s <launch.so> <launch_symbol>\n", argv[0]);
        return 2;
    }
    const char *so_path = argv[1];
    const char *sym = argv[2];

    printf("[launcher] aclInit\n");
    chk(aclInit(nullptr), "aclInit");
    chk(aclrtSetDevice(0), "aclrtSetDevice");
    aclrtStream st = nullptr;
    chk(aclrtCreateStream(&st), "aclrtCreateStream");

    const int N = 64;
    const size_t nb = (size_t)N * sizeof(float);
    float x_host[N], y_host[N];
    for (int i = 0; i < N; ++i) x_host[i] = (float)i;
    memset(y_host, 0, sizeof(y_host));

    void *xd = nullptr, *yd = nullptr;
    chk(aclrtMalloc(&xd, nb, ACL_MEM_MALLOC_HUGE_FIRST), "aclrtMalloc x");
    chk(aclrtMalloc(&yd, nb, ACL_MEM_MALLOC_HUGE_FIRST), "aclrtMalloc y");
    chk(aclrtMemcpy(xd, nb, x_host, nb, ACL_MEMCPY_HOST_TO_DEVICE), "aclrtMemcpy h2d");

    printf("[launcher] dlopen %s\n", so_path);
    void *h = dlopen(so_path, RTLD_NOW | RTLD_GLOBAL);
    if (!h) {
        fprintf(stderr, "[launcher] dlopen failed: %s\n", dlerror());
        return 3;
    }
    launch_fn_t fn = (launch_fn_t)dlsym(h, sym);
    if (!fn) {
        fprintf(stderr, "[launcher] dlsym %s failed: %s\n", sym, dlerror());
        return 4;
    }

    printf("[launcher] launching kernel grid=1 stream=%p\n", (void *)st);
    fn(1u, st, (float *)yd, (float *)xd);
    printf("[launcher] launch returned\n");
    chk(aclrtSynchronizeStream(st), "aclrtSynchronizeStream");
    chk(aclrtMemcpy(y_host, nb, yd, nb, ACL_MEMCPY_DEVICE_TO_HOST), "aclrtMemcpy d2h");

    int bad = -1;
    for (int i = 0; i < N; ++i) {
        if (y_host[i] != x_host[i]) { bad = i; break; }
    }
    if (bad >= 0) {
        printf("[launcher] MISMATCH at %d: got %f want %f\n", bad, y_host[bad], x_host[bad]);
        return 5;
    }
    printf("PASS linked_launcher (DSL kernel via C++ host)\n");

    aclrtFree(xd); aclrtFree(yd);
    aclrtDestroyStream(st);
    aclrtResetDevice(0);
    aclFinalize();
    printf("[launcher] teardown done\n");
    return g_rc_failures ? 6 : 0;
}
