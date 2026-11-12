/* Compiles the original sample_camera_path unchanged. Its local prototypes of
   three assembly helpers use the uppercase `func_` labels, which conflict with
   the shared asm_helpers.h names. The header is read first, then the file's
   own declarations are given distinct C names; both labels are defined in
   browser/level-math.c. */
#include "types.h"
#include "rnc/sdk/eetypes.h"
#include "qcopy.h"
#include "rnc/math/vector.h"
#include "rnc/math/fast_math.h"
#include "rnc/math/asm_helpers.h"

#define fast_add_rotations camera_path_fast_add_rotations
#define fast_subtract_rotations camera_path_fast_subtract_rotations
#define truncate_float_to_s32 camera_path_truncate_float_to_s32
#include "../src/camera/sample_camera_path.c"
