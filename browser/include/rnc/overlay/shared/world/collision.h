#ifndef RNC_BROWSER_COLLISION_BINDINGS_H
#define RNC_BROWSER_COLLISION_BINDINGS_H

#include_next "rnc/overlay/shared/world/collision.h"

extern CollisionHit browser_collision_hit __asm__("D_L00_00173E40");
#define coll_hit_position (*(OvlVec4 *)browser_collision_hit.pad30)
#define coll_hit_normal (*(OvlVec4 *)&browser_collision_hit.normal_x)

#endif