#include "runtime.h"
#include "rnc/runtime/callbacks/count_vsync.h"

s64 frm_clock_time __asm__("D_0015ED40") = 0;
s64 frm_vsync_cnt __asm__("D_0015ED48") = 0;
s64 frm_vsync_time __asm__("D_0015ED50") = 0;

s32 count_vsync(void) {
    frm_vsync_cnt++;
    frm_vsync_time = frm_clock_time + browser_frame_timer_count();
    return 0;
}