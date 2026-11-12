/* Compiles the original init_moby_instance for wasm32 without editing src/.
   Its MobyI struct declares the 64-bit field at 0x38 as `unsigned long`, which
   the EE compiler makes 64 bits wide and wasm32 makes 32, shifting every later
   field. The headers it includes come first (their guards keep them from
   being re-read), then `long` is widened for the recovered file only. */
#include <stddef.h>
#include "types.h"
#include "rnc/mobys/moby_class_tables.h"
#include "rnc/data_labels.h"
#include "rnc/game/game_globals.h"

#define long long long
#include "../src/mobys/init_moby_instance.c"
#undef long

_Static_assert(sizeof(MobyI) == 0x100, "init_moby_instance's moby must be 0x100 bytes.");
_Static_assert(offsetof(MobyI, unk38) == 0x38 && sizeof(((MobyI *)0)->unk38) == 8, "64-bit field at 0x38");
_Static_assert(offsetof(MobyI, pClass) == 0x24, "Class pointer at 0x24");
_Static_assert(offsetof(MobyI, unk74) == 0x74, "Update at 0x74");
_Static_assert(offsetof(MobyI, original_class_id) == 0xA6, "Class id at 0xA6");
_Static_assert(offsetof(MobyI, unkAC) == 0xAC, "Pool slot at 0xAC");
_Static_assert(offsetof(MobyIClass, seq) == 0x48, "Class sequence pointer at 0x48");
