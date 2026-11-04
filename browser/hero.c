#include <math.h>
#include <stddef.h>
#include <string.h>
#include "rnc/hero/hero.h"
#include "rnc/math/fast_math.h"
#include "rnc/math/asm_helpers.h"

_Static_assert(sizeof(struct Hero) == 0x2300, "Hero size must match the recovered layout");
_Static_assert(offsetof(struct Hero, motion.pos) == 0x80, "Hero position layout mismatch");
_Static_assert(offsetof(struct Hero, motion.velocity) == 0xE0, "Hero velocity layout mismatch");
_Static_assert(offsetof(struct Hero, target_speed) == 0x190, "Hero target speed layout mismatch");

struct Hero hero;
f32 frame_scale __asm__("D_0015ED60") = 1;

extern s32 resolve_hero_current_position_collisions(s32) __asm__("FUN_L00_002133a8");
extern s32 runtime_collision_ready(void);
extern s32 runtime_collision_segment(f32, f32, f32, f32, f32, f32);
extern f32 runtime_collision_hit_point(s32);
extern f32 runtime_collision_hit_normal(s32);

static s32 control_ready;
static s32 control_grounded;
static s32 control_jump_held;

void clear_u64_value(void *output) { memset(output, 0, 16); }

void fast_vec_add(void *output, void *first, void *second) {
    f32 result[4];
    for (u32 axis = 0; axis < 4; axis++) result[axis] = ((f32 *)first)[axis] + ((f32 *)second)[axis];
    memcpy(output, result, sizeof(result));
}

void fast_vec_sub(void *output, void *first, void *second) {
    f32 result[4];
    for (u32 axis = 0; axis < 4; axis++) result[axis] = ((f32 *)first)[axis] - ((f32 *)second)[axis];
    memcpy(output, result, sizeof(result));
}

f32 fast_vec_length(void *input) {
    f32 *vector = input;
    return sqrtf(vector[0] * vector[0] + vector[1] * vector[1] + vector[2] * vector[2]);
}

void fast_vec_normalize(void *output, void *input, f32 length) {
    f32 magnitude = fast_vec_length(input), result[4] = { 0, 0, 0, 0 };
    if (magnitude > 0) {
        for (u32 axis = 0; axis < 3; axis++) result[axis] = ((f32 *)input)[axis] * length / magnitude;
    }
    memcpy(output, result, sizeof(result));
}

void unsupported_path_clearance(void) __asm__("FUN_L00_002347c0");
void unsupported_path_clearance(void) { __builtin_trap(); }

void hero_up_offset(void *output, void *input, f32 offset) __asm__("FUN_L00_00233810");
void hero_gravity_offset(void *output, void *input, f32 offset) __asm__("FUN_L00_002334d0");

void hero_up_offset(void *output, void *input, f32 offset) {
    if (hero.gravity_mode != 0) __builtin_trap();
    memmove(output, input, 16);
    ((f32 *)output)[2] += offset;
}

void hero_gravity_offset(void *output, void *input, f32 offset) {
    hero_up_offset(output, input, -offset);
}

extern void speed_step(f32 acceleration, f32 deceleration) __asm__("FUN_L00_00212088");
extern f32 spring_angle(f32 *angle, f32 *velocity, s32 direction, f32 target,
                        f32 strength, f32 damping, f32 limit) __asm__("FUN_L00_0025bc98");
extern void build_spherical_offset(f32 *output, f32 length, f32 yaw, f32 pitch) __asm__("FUN_00214db0");

f32 absolute_float(f32 value) { return fabsf(value); }
f32 fast_cos(f32 radians) { return cosf(radians); }
f32 fast_sin(f32 radians) { return sinf(radians); }
extern __typeof__(fast_cos) func_001F9DC8 __attribute__((alias("FUN_001f9dc8")));
extern __typeof__(fast_sin) func_001F9DE0 __attribute__((alias("FUN_001f9de0")));

f32 fast_add_rotations(f32 first, f32 second) __asm__("FUN_001fa580");
f32 fast_subtract_rotations(f32 first, f32 second) __asm__("FUN_001fa5c8");

static f32 wrap_angle(f32 radians) {
    const f32 pi = 3.14159265358979323846f;
    const f32 turn = 6.28318530717958647692f;
    f32 result = fmodf(radians, turn);
    if (result > pi) result -= turn;
    if (result < -pi) result += turn;
    return result;
}

f32 fast_add_rotations(f32 first, f32 second) { return wrap_angle(first + second); }
f32 fast_subtract_rotations(f32 first, f32 second) { return wrap_angle(first - second); }

void runtime_hero_locomotion_reset(void) {
    memset(&hero, 0, sizeof(hero));
}

s32 runtime_hero_locomotion_step(f32 target_speed, f32 target_yaw, f32 acceleration,
                               f32 deceleration, f32 turn_strength, f32 turn_damping,
                               f32 turn_limit) {
    if (!isfinite(target_speed) || !isfinite(target_yaw) || !isfinite(acceleration) ||
        !isfinite(deceleration) || !isfinite(turn_strength) || !isfinite(turn_damping) ||
        !isfinite(turn_limit) || target_speed < 0 || target_speed > 100 ||
        acceleration < 0 || acceleration > 100 || deceleration < 0 || deceleration > 100 ||
        turn_strength < 0 || turn_strength > 1 || turn_damping < 0 || turn_damping > 1 ||
        turn_limit < 0 || turn_limit > 3.1415927f) return -1;
    hero.target_speed = target_speed;
    hero.motion.move_yaw = wrap_angle(target_yaw);
    speed_step(acceleration, deceleration);
    hero.motion.yaw_error = spring_angle(&hero.motion.rot.f[2], &hero.motion.yaw_rate, 0,
                                         hero.motion.move_yaw, turn_strength, turn_damping, turn_limit);
    build_spherical_offset(hero.motion.velocity.f, hero.ground_speed, hero.motion.rot.f[2], 0);
    return 0;
}

f32 runtime_hero_locomotion_speed(void) { return hero.ground_speed; }
f32 runtime_hero_locomotion_yaw(void) { return hero.motion.rot.f[2]; }
f32 runtime_hero_locomotion_yaw_rate(void) { return hero.motion.yaw_rate; }
f32 runtime_hero_locomotion_velocity(s32 axis) {
    return axis >= 0 && axis < 3 ? hero.motion.velocity.f[axis] : NAN;
}

s32 runtime_hero_collision_probe(f32 pos_x, f32 pos_y, f32 pos_z, f32 radius, f32 height) {
    if (!runtime_collision_ready()) return -1;
    if (!isfinite(radius) || !isfinite(height) ||
        radius <= 0 || radius > 16 || height < 0.05f || height > 16 ||
        fabsf(pos_z + height) > 1048576) return -2;
    f32 position[4] = { pos_x, pos_y, pos_z, 0 };
    for (u32 axis = 0; axis < 3; axis++) {
        if (!isfinite(position[axis]) || fabsf(position[axis]) > 1048576) return -2;
    }
    runtime_hero_locomotion_reset();
    memcpy(hero.motion.pos.f, position, sizeof(position));
    hero.capsule_radius = radius;
    hero.capsule_top = height;
    return resolve_hero_current_position_collisions(0);
}

f32 runtime_hero_collision_position(s32 axis) {
    return axis >= 0 && axis < 3 ? hero.motion.pos.f[axis] : NAN;
}

s32 runtime_hero_collision_wall_hit(void) { return hero.wall_hit; }

s32 runtime_hero_control_reset(f32 pos_x, f32 pos_y, f32 pos_z) {
    control_ready = control_grounded = control_jump_held = 0;
    s32 result = runtime_hero_collision_probe(pos_x, pos_y, pos_z + 0.25f, 0.25f, 0.9f);
    if (result != 1) return result;
    hero.motion.pos.f[2] -= 0.25f;
    hero.capsule_bottom = 0.25f;
    hero.capsule_top = 1.15f;
    hero.gravity_dir.f[2] = -1.0f;
    hero.ground_normal.f[2] = 1.0f;
    hero.jump_gravity = 29.7f / 3600.0f;
    hero.fall_gravity = hero.jump_gravity * 1.17f;
    control_ready = 1;
    return 0;
}

s32 runtime_hero_control_step(f32 input_x, f32 input_y, s32 jump, s32 walk) {
    if (!control_ready || !runtime_collision_ready()) return -1;
    if (!isfinite(input_x) || !isfinite(input_y) || fabsf(input_x) > 1 || fabsf(input_y) > 1 ||
        (jump != 0 && jump != 1) || (walk != 0 && walk != 1)) return -2;
    f32 old_position[4];
    memcpy(old_position, hero.motion.pos.f, sizeof(old_position));
    f32 vertical = hero.motion.velocity.f[2];
    f32 magnitude = hypotf(input_x, input_y);
    f32 yaw = magnitude > 0.001f ? atan2f(input_y, input_x) : hero.motion.move_yaw;
    f32 speed = fminf(magnitude, 1.0f) * (walk ? 2.5f : 5.7f) / 60.0f;
    runtime_hero_locomotion_step(speed, yaw, 20.0f / 3600.0f, 30.0f / 3600.0f,
                               0.12f, 0.65f, 0.35f);
    if (jump && !control_jump_held && control_grounded) {
        vertical = sqrtf(2.0f * 29.7f * 1.47f) / 60.0f;
        control_grounded = 0;
    }
    control_jump_held = jump;
    if (!control_grounded) vertical -= vertical > 0 ? hero.jump_gravity : hero.fall_gravity;
    else vertical = 0;
    hero.motion.velocity.f[2] = fmaxf(vertical, -0.3f);
    hero.wall_hit = 0;
    for (u32 axis = 0; axis < 3; axis++) hero.motion.pos.f[axis] += hero.motion.velocity.f[axis];
    if (resolve_hero_current_position_collisions(0) != 1) {
        memcpy(hero.motion.pos.f, old_position, sizeof(old_position));
        memset(hero.motion.velocity.f, 0, sizeof(hero.motion.velocity.f));
    }
    if (hero.wall_hit && hero.wall_contact_normal.f[2] < -0.5f && hero.motion.velocity.f[2] > 0) {
        hero.motion.velocity.f[2] = 0;
    }
    control_grounded = 0;
    f32 *position = hero.motion.pos.f;
    if (hero.motion.velocity.f[2] <= 0 && runtime_collision_segment(position[0], position[1], position[2] + 0.3f,
        position[0], position[1], position[2] - 0.12f) == 1 && runtime_collision_hit_normal(2) >= 0.55f) {
        f32 height = runtime_collision_hit_point(2);
        if (height <= position[2] + 0.02f && height >= position[2] - 0.12f) {
            position[2] = height + 0.00002f;
            hero.motion.velocity.f[2] = 0;
            control_grounded = 1;
        }
    }
    hero.air_frames.s = control_grounded ? 0 : 1;
    return 0;
}

s32 runtime_hero_control_grounded(void) { return control_ready && control_grounded; }