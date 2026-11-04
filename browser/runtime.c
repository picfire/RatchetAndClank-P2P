#include <stdint.h>
#include "runtime.h"
#include "rnc/runtime/callbacks/count_vsync.h"

enum { BUFFER_COUNT = 3, GUARD_BYTES = 16 };

u8 scene_state_reset_buffer[0x100 + GUARD_BYTES] __asm__("D_001D63D0") __attribute__((aligned(16)));
u8 D_001D64D0[0xC60 + GUARD_BYTES] __attribute__((aligned(16)));
u8 D_001D7130[0xC60 + GUARD_BYTES] __attribute__((aligned(16)));

typedef struct {
    u8 *data;
    u32 bytes;
} SceneBuffer;

static const SceneBuffer buffers[BUFFER_COUNT] = {
    { scene_state_reset_buffer, 0x100 },
    { D_001D64D0, 0xC60 },
    { D_001D7130, 0xC60 }
};

extern s64 frm_clock_time __asm__("D_0015ED40");
extern s64 frm_vsync_cnt __asm__("D_0015ED48");
extern s64 frm_vsync_time __asm__("D_0015ED50");
extern void clear_scene_state_buffers(void) __asm__("FUN_00226f50");

static u32 elapsed_counter;
static u64 previous_ticks;
static s32 initialized;

_Static_assert(sizeof(void *) == 4, "The browser runtime requires wasm32 pointers.");
_Static_assert(sizeof(s64) == 8, "The browser clock requires 64-bit storage.");

u32 browser_frame_timer_count(void) {
    return elapsed_counter;
}

s32 fill_transfer_words(void *destination, s32 value, s32 bytes) {
    u32 index;
    u32 offset;
    u32 cursor;
    uintptr_t address = (uintptr_t)destination;

    if (bytes < 0 || (bytes & 3) != 0 || (address & 3) != 0) {
        __builtin_trap();
    }
    for (index = 0; index < BUFFER_COUNT; index++) {
        uintptr_t start = (uintptr_t)buffers[index].data;
        if (address < start || address - start > buffers[index].bytes) {
            continue;
        }
        offset = (u32)(address - start);
        if ((u32)bytes > buffers[index].bytes - offset) {
            __builtin_trap();
        }
        for (cursor = 0; cursor < (u32)bytes; cursor += sizeof(u32)) {
            *(u32 *)(buffers[index].data + offset + cursor) = (u32)value;
        }
        return 0;
    }
    __builtin_trap();
}

s32 runtime_guards_valid(void) {
    u32 index;
    u32 cursor;
    for (index = 0; index < BUFFER_COUNT; index++) {
        for (cursor = 0; cursor < GUARD_BYTES; cursor++) {
            if (buffers[index].data[buffers[index].bytes + cursor] != 0xA5) {
                return 0;
            }
        }
    }
    return 1;
}

s32 runtime_reset_scene(void) {
    if (!initialized || !runtime_guards_valid()) {
        return -1;
    }
    clear_scene_state_buffers();
    return runtime_guards_valid() ? 0 : -1;
}

s32 runtime_init(void) {
    u32 index;
    u32 cursor;
    for (index = 0; index < BUFFER_COUNT; index++) {
        for (cursor = 0; cursor < buffers[index].bytes + GUARD_BYTES; cursor++) {
            buffers[index].data[cursor] = cursor < buffers[index].bytes ? 0xCD : 0xA5;
        }
    }
    frm_clock_time = 0;
    frm_vsync_cnt = 0;
    frm_vsync_time = 0;
    elapsed_counter = 0;
    previous_ticks = 0;
    initialized = 1;
    runtime_disc_reset();
    return runtime_reset_scene();
}

u32 runtime_buffer_address(u32 index) {
    return index < BUFFER_COUNT ? (u32)(uintptr_t)buffers[index].data : 0;
}

u32 runtime_buffer_size(u32 index) {
    return index < BUFFER_COUNT ? buffers[index].bytes : 0;
}

s32 runtime_fill(u32 index, s32 value, u32 offset, u32 bytes) {
    if (!initialized || index >= BUFFER_COUNT || offset > buffers[index].bytes ||
        bytes > buffers[index].bytes - offset || (offset & 3) != 0 || (bytes & 3) != 0 ||
        !runtime_guards_valid()) {
        return -1;
    }
    return fill_transfer_words(buffers[index].data + offset, value, (s32)bytes);
}

s32 runtime_step(f64 elapsed_microseconds) {
    u64 ticks;
    if (!initialized || !runtime_guards_valid() || !__builtin_isfinite(elapsed_microseconds) ||
        elapsed_microseconds < 0.0 || elapsed_microseconds > 9007199254740991.0) {
        return -1;
    }
    ticks = (u64)elapsed_microseconds;
    if ((f64)ticks != elapsed_microseconds || ticks < previous_ticks) {
        return -1;
    }
    previous_ticks = ticks;
    frm_clock_time = (s64)(ticks & ~((u64)0xFFFFFFFF));
    elapsed_counter = (u32)ticks;
    return count_vsync();
}

f64 runtime_frame_count(void) {
    return (f64)frm_vsync_cnt;
}

f64 runtime_time(void) {
    return (f64)frm_vsync_time;
}