#include <stdint.h>
#include <string.h>

#ifndef INPUT_LIMIT
#define INPUT_LIMIT (1024u * 1024u)
#endif
#ifndef OUTPUT_LIMIT
#define OUTPUT_LIMIT (16u * 1024u * 1024u)
#endif
#define GUARD_BYTES 16u

static uint8_t input[INPUT_LIMIT + GUARD_BYTES];
static uint8_t output[OUTPUT_LIMIT + GUARD_BYTES];
static uint32_t output_size;
static int ready;

struct Cursor {
    uint32_t position;
    uint32_t end;
    uint32_t written;
    uint32_t capacity;
    int materialize;
};

int wad_guards_valid(void) {
    for (uint32_t index = 0; index < GUARD_BYTES; index++) {
        if (input[INPUT_LIMIT + index] != 0xA5 ||
            output[OUTPUT_LIMIT + index] != 0xA5) return 0;
    }
    return 1;
}

void wad_reset(void) {
    memset(input, 0, sizeof(input));
    memset(output, 0, sizeof(output));
    memset(input + INPUT_LIMIT, 0xA5, GUARD_BYTES);
    memset(output + OUTPUT_LIMIT, 0xA5, GUARD_BYTES);
    output_size = 0;
    ready = 0;
}

uint32_t wad_input_address(void) { return (uint32_t)(uintptr_t)input; }
uint32_t wad_input_capacity(void) { return INPUT_LIMIT; }
uint32_t wad_output_address(void) { return (uint32_t)(uintptr_t)output; }
uint32_t wad_output_capacity(void) { return OUTPUT_LIMIT; }
uint32_t wad_output_size(void) { return output_size; }
int wad_ready(void) { return ready; }

static int read_byte(struct Cursor *cursor) {
    if (cursor->position == cursor->end) return -1;
    return input[cursor->position++];
}

static int literals(struct Cursor *cursor, uint32_t count) {
    if (count > cursor->end - cursor->position) return -2;
    if (count > cursor->capacity - cursor->written) return -4;
    if (cursor->materialize) {
        memcpy(output + cursor->written, input + cursor->position, count);
    }
    cursor->position += count;
    cursor->written += count;
    return 0;
}

static int packets(struct Cursor cursor) {
    while (cursor.position < cursor.end) {
        int flag = read_byte(&cursor);
        if (flag < 16) {
            int extension = flag ? 0 : read_byte(&cursor);
            if (extension < 0) return -2;
            uint32_t count = flag ? (uint32_t)flag + 3 : (uint32_t)extension + 18;
            int result = literals(&cursor, count);
            if (result) return result;
            if (cursor.position < cursor.end && input[cursor.position] < 16) return -5;
            continue;
        }

        uint32_t count;
        uint32_t distance;
        int trailing;
        if (flag >= 64) {
            int major = read_byte(&cursor);
            if (major < 0) return -2;
            count = ((uint32_t)flag >> 5) + 1;
            distance = (uint32_t)major * 8 + (((uint32_t)flag >> 2) & 7) + 1;
            trailing = flag & 3;
        } else {
            count = (uint32_t)flag & (flag < 32 ? 7u : 31u);
            if (!count) {
                int extension = read_byte(&cursor);
                if (extension < 0) return -2;
                count = (uint32_t)extension + (flag < 32 ? 7u : 31u);
            }
            int minor = read_byte(&cursor);
            int major = read_byte(&cursor);
            if (minor < 0 || major < 0) return -2;
            trailing = minor & 3;
            distance = (uint32_t)major * 64 + ((uint32_t)minor >> 2);
            if (flag >= 32) {
                distance++;
                count += 2;
            } else {
                distance += ((uint32_t)flag & 8) * 0x800;
                if (distance) {
                    distance += 0x4000;
                    count += 2;
                } else if (count != 1) {
                    uint32_t aligned = 16 + ((cursor.position - 16 + 4095) & ~4095u);
                    if (aligned > cursor.end) return -6;
                    cursor.position = aligned;
                    continue;
                } else {
                    count = 0;
                }
            }
        }
        if (count) {
            if (!distance || distance > cursor.written) return -3;
            if (count > cursor.capacity - cursor.written) return -4;
            if (cursor.materialize) {
                for (uint32_t index = 0; index < count; index++) {
                    output[cursor.written + index] = output[cursor.written - distance + index];
                }
            }
            cursor.written += count;
        }
        int result = literals(&cursor, (uint32_t)trailing);
        if (result) return result;
    }
    return (int)cursor.written;
}

int wad_decode(uint32_t bytes, uint32_t capacity) {
    memset(output, 0, output_size);
    output_size = 0;
    ready = 0;
    if (!wad_guards_valid()) return -7;
    if (bytes < 16 || bytes > INPUT_LIMIT || capacity > OUTPUT_LIMIT) return -1;
    if (input[0] != 'W' || input[1] != 'A' || input[2] != 'D') return -1;
    uint32_t end = (uint32_t)input[3] | ((uint32_t)input[4] << 8) |
                   ((uint32_t)input[5] << 16) | ((uint32_t)input[6] << 24);
    if (end < 16 || end > bytes) return -1;
    struct Cursor cursor = {16, end, 0, capacity, 0};
    int result = packets(cursor);
    if (result < 0) return result;
    cursor.materialize = 1;
    int decoded = packets(cursor);
    if (decoded != result || !wad_guards_valid()) return -7;
    output_size = (uint32_t)decoded;
    ready = 1;
    return decoded;
}