#include "types.h"
#include "rnc/math/fast_math.h"
#include "rnc/math/interpolation.h"

static f32 current_value;

f32 absolute_float(f32 value) {
    return __builtin_fabsf(value);
}

void smoke_set_value(f32 value) {
    current_value = value;
}

f32 smoke_get_value(void) {
    return current_value;
}

f32 smoke_step(f32 target, f32 step) {
    return approach_value(target, step, &current_value);
}

f32 smoke_absolute(f32 value) {
    return absolute_float(value);
}