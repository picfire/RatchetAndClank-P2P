/* Compiles the original pterodactyl update unchanged. It declares
   sample_camera_path as (path, progress, loop, position, rotation, flags);
   the definition takes the float last. The EE passes the float in $f12 and the
   integers in $a0-$t0 in order, so both describe the same call. WebAssembly
   arguments are positional, so the call is reordered to the definition's
   order here. Without this, LTO would replace the call with a trap. */
#define sample_camera_path(path, progress, loop, position, rotation, flags) \
    sample_camera_path_ee_order(path, loop, position, rotation, flags, progress)
#include "../src/overlays/shared/props/pterodactyl.c"
