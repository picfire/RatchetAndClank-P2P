#ifndef RNC_BROWSER_RUNTIME_H
#define RNC_BROWSER_RUNTIME_H

#include "types.h"

s32 fill_transfer_words(void *destination, s32 value, s32 bytes) __asm__("FUN_001f97e8");
u32 browser_frame_timer_count(void);
s32 runtime_init(void);
s32 runtime_reset_scene(void);
s32 runtime_guards_valid(void);
u32 runtime_buffer_address(u32 index);
u32 runtime_buffer_size(u32 index);
s32 runtime_fill(u32 index, s32 value, u32 offset, u32 bytes);
s32 runtime_step(f64 elapsed_microseconds);
f64 runtime_frame_count(void);
f64 runtime_time(void);

void runtime_disc_reset(void);
s32 runtime_disc_guards_valid(void);
u32 runtime_disc_stage_address(void);
u32 runtime_disc_stage_size(void);
u32 runtime_disc_table_address(void);
u32 runtime_disc_table_size(void);
s32 runtime_disc_load(u32 bytes, u32 sectors);
s32 runtime_disc_ready(void);
s32 runtime_disc_entry_sector(u32 offset);
s32 runtime_disc_entry_count(u32 offset);
u32 runtime_disc_service_calls(u32 service);
s32 runtime_disc_level_header_sector(u32 level);
s32 runtime_disc_level_header_load(u32 level, u32 bytes);
s32 runtime_disc_level_header_ready(void);
s32 runtime_disc_level_slot_sector(u32 slot);
s32 runtime_disc_level_slot_count(u32 slot);

void runtime_sky_reset(void);
s32 runtime_sky_guards_valid(void);
u32 runtime_sky_stage_address(void);
u32 runtime_sky_capacity(void);
s32 runtime_sky_ready(void);
s32 runtime_sky_load(u32 bytes, u32 sky_offset);

#endif