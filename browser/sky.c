#include "runtime.h"

#define SKY_CAPACITY (4u * 1024u * 1024u)
#define SKY_GUARD_BYTES 16u
#define SKY_MAX_GROUPS 64u
#define SKY_MAX_CLUSTERS 65536u

static struct {
    u8 bytes[SKY_CAPACITY];
    u8 guard[SKY_GUARD_BYTES];
} sky_storage __attribute__((aligned(16)));
static s32 sky_ready;
void *level_sky_effect_data __asm__("D_0016045C");

extern void relocate_sky_definition(void *definition) __asm__("FUN_002028e0");
s16 log2dim(s32 dimension) __asm__("FUN_001f97a0");

s16 log2dim(s32 dimension) {
    return (s16)(31 - __builtin_clz((u32)dimension));
}

static u32 word_at(u32 offset) {
    const u8 *bytes = sky_storage.bytes + offset;
    return (u32)bytes[0] | ((u32)bytes[1] << 8) | ((u32)bytes[2] << 16) | ((u32)bytes[3] << 24);
}

static u32 half_at(u32 offset) {
    const u8 *bytes = sky_storage.bytes + offset;
    return (u32)bytes[0] | ((u32)bytes[1] << 8);
}

static s32 valid_range(u32 offset, u32 length, u32 size) {
    return offset <= size && length <= size - offset;
}

static s32 overlap(u32 first, u32 first_bytes, u32 second, u32 second_bytes) {
    return first < second + second_bytes && second < first + first_bytes;
}

s32 runtime_sky_guards_valid(void) {
    u32 index;
    for (index = 0; index < SKY_GUARD_BYTES; index++) {
        if (sky_storage.guard[index] != 0xA5) return 0;
    }
    return 1;
}

void runtime_sky_reset(void) {
    u32 index;
    for (index = 0; index < SKY_CAPACITY; index++) sky_storage.bytes[index] = 0;
    for (index = 0; index < SKY_GUARD_BYTES; index++) sky_storage.guard[index] = 0xA5;
    sky_ready = 0;
    level_sky_effect_data = 0;
}

u32 runtime_sky_stage_address(void) { return (u32)sky_storage.bytes; }
u32 runtime_sky_capacity(void) { return SKY_CAPACITY; }
s32 runtime_sky_ready(void) { return sky_ready; }

s32 runtime_sky_load(u32 size, u32 sky_offset) {
    u32 groups[SKY_MAX_GROUPS];
    u32 group_bytes[SKY_MAX_GROUPS];
    u32 relative_size;
    u32 group_count;
    u32 texture_count;
    u32 texture_offset;
    u32 texture_bytes;
    u32 header_bytes;
    u32 clusters = 0;
    u32 index;
    u32 previous;

    if (sky_ready || !runtime_sky_guards_valid() || size > SKY_CAPACITY ||
        sky_offset % 16 != 0 || !valid_range(sky_offset, 0x20, size)) return -1;
    level_sky_effect_data = 0;
    relative_size = size - sky_offset;
    if (half_at(sky_offset + 4) != 0) return -2;
    group_count = half_at(sky_offset + 6);
    texture_count = half_at(sky_offset + 0xC);
    if (group_count > SKY_MAX_GROUPS || texture_count > 1024) return -2;
    header_bytes = 0x20 + group_count * 4;
    texture_offset = word_at(sky_offset + 0x10);
    texture_bytes = texture_count * 16;
    if (!valid_range(0, header_bytes, relative_size) || texture_offset % 16 != 0 ||
        !valid_range(texture_offset, texture_bytes, relative_size) ||
        (texture_count && texture_offset < header_bytes)) return -2;
    for (index = 0x14; index <= 0x1C; index += 4) {
        u32 offset = word_at(sky_offset + index);
        if (!valid_range(offset, offset != 0, relative_size)) return -2;
    }
    for (index = 0; index < texture_count; index++) {
        u32 entry = sky_offset + texture_offset + index * 16;
        u32 width = word_at(entry + 8);
        u32 height = word_at(entry + 12);
        if (!width || width > 1024 || (width & (width - 1)) ||
            !height || height > 1024 || (height & (height - 1)) ||
            word_at(entry) % 16 || word_at(entry) > 0xFFFF0 ||
            word_at(entry + 4) % 16 || word_at(entry + 4) > 0xFFFF0) return -3;
    }
    for (index = 0; index < group_count; index++) {
        u32 offset = word_at(sky_offset + 0x20 + index * 4);
        u32 count;
        u32 cluster;
        if (offset % 16 || offset < header_bytes || !valid_range(offset, 0x20, relative_size)) return -4;
        count = word_at(sky_offset + offset);
        if (count > SKY_MAX_CLUSTERS - clusters) return -4;
        clusters += count;
        groups[index] = offset;
        group_bytes[index] = 0x20 + count * 0x20;
        if (!valid_range(offset, group_bytes[index], relative_size) ||
            overlap(offset, group_bytes[index], texture_offset, texture_bytes)) return -4;
        for (previous = 0; previous < index; previous++) {
            if (overlap(offset, group_bytes[index], groups[previous], group_bytes[previous])) return -4;
        }
        for (cluster = 0; cluster < count; cluster++) {
            u32 target = word_at(sky_offset + offset + 0x20 + cluster * 0x20);
            if (!valid_range(target, 1, relative_size)) return -4;
        }
    }
    relocate_sky_definition(sky_storage.bytes + sky_offset);
    if (!runtime_sky_guards_valid()) return -5;
    sky_ready = 1;
    return 1;
}