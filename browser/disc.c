#include <stdint.h>
#include "runtime.h"
#include "rnc/streaming/disc_table.h"
#include "rnc/sdk/storage/cdvd.h"
#include "rnc/sdk/graph.h"

enum {
    DISC_SECTOR_BYTES = 2048,
    DISC_TABLE_SECTOR = 0x5DC,
    DISC_TABLE_SECTORS = 6,
    DISC_STAGE_BYTES = DISC_SECTOR_BYTES * DISC_TABLE_SECTORS,
    DISC_COPY_BYTES = 0x2960,
    DISC_GUARD_BYTES = 16
};

u8 disc_table_storage[DISC_STAGE_BYTES + DISC_GUARD_BYTES] __asm__("D_00137B80") __attribute__((aligned(16)));
u8 D_0015ED58 = 0;

static u8 staged_sectors[DISC_STAGE_BYTES + DISC_GUARD_BYTES] __attribute__((aligned(16)));
static u32 volume_sectors;
static u32 read_calls;
static u32 sync_calls;
static u32 error_checks;
static s32 load_active;
static s32 read_state;
static s32 table_ready;

extern s32 load_disc_sectors_into_global_buffer(void) __asm__("FUN_0012f2b8");

_Static_assert(sizeof(struct DiscTable) <= DISC_STAGE_BYTES, "Disc table must fit the owned storage.");

s32 runtime_disc_guards_valid(void) {
    u32 index;
    for (index = 0; index < DISC_GUARD_BYTES; index++) {
        if (staged_sectors[DISC_STAGE_BYTES + index] != 0xA5 ||
            disc_table_storage[DISC_STAGE_BYTES + index] != 0xA5) {
            return 0;
        }
    }
    return 1;
}

void runtime_disc_reset(void) {
    u32 index;
    for (index = 0; index < DISC_STAGE_BYTES + DISC_GUARD_BYTES; index++) {
        staged_sectors[index] = index < DISC_STAGE_BYTES ? 0 : 0xA5;
        disc_table_storage[index] = index < DISC_STAGE_BYTES ? 0 : 0xA5;
    }
    volume_sectors = 0;
    read_calls = 0;
    sync_calls = 0;
    error_checks = 0;
    load_active = 0;
    read_state = 0;
    table_ready = 0;
}

u32 runtime_disc_stage_address(void) {
    return (u32)(uintptr_t)staged_sectors;
}

u32 runtime_disc_stage_size(void) {
    return DISC_STAGE_BYTES;
}

u32 runtime_disc_table_address(void) {
    return (u32)(uintptr_t)disc_table_storage;
}

u32 runtime_disc_table_size(void) {
    return DISC_COPY_BYTES;
}

s32 sceCdRead(u32 sector, u32 count, void *destination, struct sceCdRMode *mode) {
    const u8 *bytes = (const u8 *)mode;
    uintptr_t address = (uintptr_t)destination;
    uintptr_t memory_bytes = (uintptr_t)__builtin_wasm_memory_size(0) * 65536U;
    u32 index;

    if (!load_active || read_state != 0 || !runtime_disc_guards_valid() ||
        sector != DISC_TABLE_SECTOR || count != DISC_TABLE_SECTORS ||
        address > memory_bytes || DISC_STAGE_BYTES > memory_bytes - address ||
        bytes[0] != 0x20 || bytes[1] != D_0015ED58 || bytes[2] != 0 || bytes[3] != 0) {
        __builtin_trap();
    }
    for (index = 0; index < DISC_STAGE_BYTES; index++) {
        ((u8 *)destination)[index] = staged_sectors[index];
    }
    read_calls++;
    read_state = 1;
    return 1;
}

s32 sceCdSync(s32 mode) {
    if (!load_active || mode != 1 || read_state != 1) {
        __builtin_trap();
    }
    sync_calls++;
    read_state = 2;
    return 0;
}

s32 sceCdGetError(void) {
    if (!load_active || read_state != 2) {
        __builtin_trap();
    }
    error_checks++;
    read_state = 3;
    return 0;
}

s32 sceGsSyncV(s32 mode) {
    (void)mode;
    __builtin_trap();
}

s32 runtime_disc_load(u32 bytes, u32 sectors) {
    s32 result;
    table_ready = 0;
    if (load_active || bytes != DISC_STAGE_BYTES ||
        sectors < DISC_TABLE_SECTOR + DISC_TABLE_SECTORS || !runtime_disc_guards_valid()) {
        return -1;
    }
    volume_sectors = sectors;
    read_calls = 0;
    sync_calls = 0;
    error_checks = 0;
    read_state = 0;
    load_active = 1;
    result = load_disc_sectors_into_global_buffer();
    load_active = 0;
    if (result != 1 || read_state != 3 || !runtime_disc_guards_valid()) {
        return -1;
    }
    table_ready = 1;
    return 1;
}

s32 runtime_disc_ready(void) {
    return table_ready && runtime_disc_guards_valid();
}

static s32 known_entry(u32 offset) {
    const s32 *entry;
    if (!runtime_disc_ready() || (offset != 0x8 && offset != 0x4F8 &&
        offset != 0x12C0 && offset != 0x13B8)) {
        return 0;
    }
    entry = (const s32 *)(disc_table_storage + offset);
    return entry[0] >= 0 && entry[1] > 0 && (u32)entry[0] <= volume_sectors &&
        (u32)entry[1] <= volume_sectors - (u32)entry[0];
}

s32 runtime_disc_entry_sector(u32 offset) {
    return known_entry(offset) ? *(s32 *)(disc_table_storage + offset) : -1;
}

s32 runtime_disc_entry_count(u32 offset) {
    return known_entry(offset) ? *(s32 *)(disc_table_storage + offset + 4) : -1;
}

u32 runtime_disc_service_calls(u32 service) {
    if (service == 0) return read_calls;
    if (service == 1) return sync_calls;
    if (service == 2) return error_checks;
    return 0;
}