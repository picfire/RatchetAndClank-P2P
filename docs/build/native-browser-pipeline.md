# Native Browser Implementation Pipeline

## Project Summary

Port recovered Ratchet & Clank C to WebAssembly without PS2 emulation, using
local user-owned USA disc assets, then add two-player P2P co-op.

There is no single completion percentage: a rendered scene, a working mission,
and online co-op are different-sized deliverables. The browser port currently has
one partial world slice, Veldin; no complete mission is playable. See
[Browser Port Progress](#browser-port-progress) for the measured status. The
Lombyte decompilation map in the README measures matching source coverage, not
browser-port functionality.

## Browser Port Progress

### Shared Systems

| Area | Verified now | Still needed |
| --- | --- | --- |
| Browser build and launch | Selected recovered C and adapters compile to WASM; local page loads user-selected ISO data. | Original game startup and a complete browser runtime. |
| Disc/assets | Bounded local ISO reads; WAD decoding; Veldin terrain, sky, textures, Ratchet mesh, and selected animation poses are decoded. | General level/mission discovery and loading beyond the hardcoded Veldin archive. |
| Rendering | Veldin terrain, sky, and skinned Ratchet render through Three.js. | Original render pipeline, scene objects/effects, and parity with PS2 output. |
| Hero controls | Bounded native C adapter provides movement, jump/double-jump, crouch, and slam motion; static collision is tested. Browser JavaScript selects swing clips and coordinates animation playback. | Full original hero state machine, combat/damage, weapons, dynamic collision, and original gameplay camera. |
| Mission flow | None verified. The current scene has no implemented mission objectives or completion loop. | Mission actors, objective state, success/failure, restart, exits, saves, and transitions. |
| Local multiplayer | None. The native hero state is a single global context. | Two independent hero/input contexts and shared-world rules. |
| P2P | None. | Network synchronization, signaling, authority, recovery, and multiplayer testing. |

### World / Level Ledger

These are level/overlay entries, not a claim that each entry equals exactly one
mission. “Partial scene” means assets and a limited player-control slice are
visible; it does not mean the level's mission is playable.

| Level | World | Browser-port status |
| --- | --- | --- |
| 00 | Veldin | Partial scene/control slice: terrain, sky, Ratchet, static collision, and bounded controls. Mission objectives, level actors, full camera, and completion/transition loop are not implemented. |
| 01 | Novalis | Not started |
| 02 | Aridia | Not started |
| 03 | Kerwan | Not started |
| 04 | Eudora | Not started |
| 05 | Rilgar | Not started |
| 06 | Nebula G34 | Not started |
| 07 | Umbris | Not started |
| 08 | Batalia | Not started |
| 09 | Gaspar | Not started |
| 10 | Orxon | Not started |
| 11 | Pokitaru | Not started |
| 12 | Hoven | Not started |
| 13 | Oltanis Orbit | Not started |
| 14 | Oltanis | Not started |
| 15 | Quartu | Not started |
| 16 | Kalebo III | Not started |
| 17 | Veldin Orbit | Not started |
| 18 | Veldin | Not started |

### World And Mission Task Template

Track shared systems separately from world work. For each world/mission task,
record the source/archive evidence and define these checks before calling it done:

1. Load that level's data from the local disc with bounds and cancellation checks.
2. Render its terrain, sky, collision, and required scene objects.
3. Verify player movement, collision, and camera behavior in that world.
4. Identify mission objectives from source/data, implement their state and actors,
   and demonstrate success, failure/restart, and the level exit/transition.
5. Add a focused regression check and record a browser run for the completed slice.

Do not invent mission names or completion criteria from the overlay list alone.
The first complete browser mission should be finished and measured in Veldin
before marking another world playable. Do not copy upstream decompilation
percentages into this ledger.

## Held Crouch Slice

`C`, either Control key, or the held touch crouch button requests crouch.
Original clip 13 plays while crouched; attacking selects original clip 26.
The bounded native controller targets zero planar speed but permits turning,
using the recovered crouch deceleration (6.48), turning constants, and original
`speed_step`, `spring_angle`, and `approach_value` helpers. The full recovered
crouch state and capsule-update functions are not executed.

The browser feet-origin capsule keeps its existing radius/bottom and lowers
its top from 1.15 to 0.70, preserving the original 0.45 reduction rather than
claiming exact retail dimensions. The original interpolation step is 0.02.
An upper-capsule clearance query prevents standing or jumping through ceilings;
release retains crouch if headroom is blocked. Clear-headroom jumping restores
standing height before takeoff. Reset clears stance; focus loss releases input.
Clip 13 loops its decoded poses, not the full original queued-animation logic.
Dedicated crouch-turn clips, high/long jumps, wrench attachment, damage, and
retail animation/state-machine parity remain unimplemented.

Validation command:

```sh
RNC_ISO_PATH="$PWD/dumps/Ratchet & Clank (USA) (En,Fr,De,Es,It).iso" make browser-collision-test
make browser-game
```

All ten focused checks passed with the local ISO, including a low-ceiling
fixture, blocked jump, clear release/jump, reset, and crouched swing selection.
Browser checks verified `C`, Control, blur cleanup, and touch hold/release;
direct WebGL captures showed standing and held crouch. Mobile rendering was
nonblank with matching canvas dimensions and no overflow at 390px; direction
and action controls did not overlap at 351px. Original source trees remain
unchanged. Stage 3/4 gates and the provisional scope estimate are unchanged.

## Architecture

Recovered game C -> WebAssembly game code -> browser platform adapters.
Game assets come from a user-selected local USA disc image. Rendering uses a
native browser graphics backend; audio, input, storage, and file access use
browser APIs. Co-op is added to the game before WebRTC networking is added.

No PS2 emulation, MIPS instruction execution, replacement mini-game, or remote
game streaming. The ISO supplies data, not machine code for an emulator.
PS2 assembly routines needed by the port require equivalent portable source.

This is a substantial source port, not a compiler flag that makes the whole
game portable. Preserve the existing PS2 build as a separate reference path.

## Execution Rules

- Select one stage and a small source-owned behavior to implement.
- Name its expected behavior and cheapest failing check before editing.
- Implement and run that check before widening scope.
- Record the command, result, remaining dependencies, and next step below.
- Do not advance on placeholder output, silent no-op hardware stubs, or
  unresolved symbols hidden by permissive linker options.
- If a gate is blocked, report the exact blocker. Do not switch to emulation.
- Install toolchains only with user permission; pin versions once selected.
- Do not promise dates or playability before measuring actual execution.

## Stages And Gates

### 0. Agree On Scope

Deliverable: this pipeline and repository instructions.

Gate: native C-to-WebAssembly, local game assets, and no emulation are recorded.

### 1. Compile And Execute Original C

Deliverable: a separate reproducible browser build target and a small automated
smoke test compiling a real recovered C function, not a JavaScript rewrite.
Start with [approach_value.c](../../src/math/interpolation/approach_value.c).
Its dependency on `absolute_float` needs a tested portable implementation;
PS2 symbol labels and aliases must be checked against the selected compiler.

Gate: build a real `.wasm` module and execute it in a browser. Test increasing,
decreasing, clamping, and already-at-target behavior. Build failures and missing
dependencies must fail clearly. This gate proves toolchain reuse, not gameplay.

### 2. Load Local Assets Safely

Deliverable: local file selection, bounded ISO sector reads, supported-executable
checksum validation, and an asset catalog based on the actual disc formats.
Use the existing [streaming source](../../src/streaming) and extraction tools as
references, not an invented asset format. Read slices, not the entire ISO into
WebAssembly memory. Keep user-owned data out of tracked files and web uploads.

Gate: compare selected files and sectors with an independent reader. Reject
truncated, unsupported, or out-of-range data; verify cancellation and failures.
Loading an ISO is not booting the game.

### 3. Establish A Portable Game Runtime

Deliverable: port a dependency-bounded portion of the original startup/update
path. Resolve fixed-address globals, pointer assumptions, data relocation,
allocation, timing, and level-overlay symbols with explicit native C ownership.
Replace necessary PS2 assembly with tested C; compile level code as native
WebAssembly code rather than executing extracted MIPS overlays.

Gate: the selected original initialization and update slice executes repeatedly
with checked memory access and verified state. Inventory unresolved dependencies
explicitly. Do not claim full startup until its actual call path executes.

### 4. Render An Actual Level

Deliverable: decode real level assets and replace the relevant PS2 rendering
passes with a browser graphics backend. Convert required VU behavior into native
source or shaders; do not build a PS2 instruction interpreter. Integrate the
original world loading, collision, hero update, camera, and browser input paths.

Gate: one real level supports visible movement and collision with a working
camera. Verify textures, framing, resizing, and frame-time measurements with
browser screenshots and execution checks. A static model viewer does not pass.

### 5. Finish The Single-Player Vertical Slice

Deliverable: the selected level's required audio, HUD, combat, pickups, save
behavior, death/restart, and level transition services using the original logic.

Gate: demonstrate the selected level's core loop and a transition or reload;
record browser/device performance, remaining gaps, and repeatable test steps.

### 6. Implement Local Co-op

Deliverable: two independent hero contexts and inputs. Audit single-player
globals; define camera, shared world ownership, damage, death/revival, pickups,
cutscenes, saving, and level-transition behavior before replicating them.

Gate: two local players move and interact independently in the same real level.
Test both players dying, simultaneous interactions, and transition handling.
Do not treat a second controller as a second character.

### 7. Add Peer-To-Peer Networking

Deliverable: WebRTC transport, signaling, host-authoritative simulation, guest
inputs, snapshots, entity/event identities, version checks, and disconnect
handling. Choose prediction/interpolation based on measured gameplay needs.
Validate bounded messages and reject invalid state. No ISO or asset transfer.

Gate: two separate machines play the same level with independent characters;
test latency, packet loss, reconnects, and incompatible builds. Test separate
networks and document signaling and any TURN-relay requirements. A VS Code
HTTP tunnel shares the site; it does not replace these networking services.

## Local PS2 Static Analysis

REA is analysis tooling only, not a browser runtime or an emulator. The official
`rea-agents@6.8.0` release rejects this executable's machine-specific MIPS flags;
its Ghidra adapter also rejects Homebrew Ghidra 12.2. Do not mask ELF flags or
interpret a successful generic tool installation as PS2 support.

A separate experimental installation under `$HOME/.local/share/rea-ps2` was
validated on 2026-11-03. The official installation under
`$HOME/.local/share/rea-tools` remains unchanged. Compatible components:

- REA 6.8.0, locally patched in its shared MIPS profile and both packaged CLI/MCP
  provider bundles. This is not upstream PS2 support.
- Ghidra 12.1.4 with a locally built macOS ARM64 decompiler and Homebrew JDK 25.
  Official archive SHA-256:
  `ddac49f903da9d5bac833e5cc79395098b9c33cfd3279be5f31bd00387d2d4db`.
- [ghidra-emotionengine-reloaded](https://github.com/chaoticgd/ghidra-emotionengine-reloaded)
  at commit `4c787f8adcfa426031bd892c76ffc68368d3894e`, built with Gradle 9.8.2
  against that Ghidra installation. The older beardypig extension failed to
  compile against this API and is not the installed backend.

The pilot admits only executable ELF32 little-endian MIPS with flags
`0x20924001`, inspected absence of ABI records and GNU attributes, and no known
incomplete declaration inspection. It pins `r5900:LE:32:default`, compiler
`default`, and records lane `ps2-elf32-exec-r5900-pilot-v1`, experimental static
analysis status, and an explicitly unverified full ABI. ELF bytes are unchanged.
Other executable revisions, overlays, relocatable IRX modules, and runtime
behavior have not been validated by this pilot.

Local verification commands:

```sh
node --test "$HOME/.local/share/rea-ps2/profile.test.mjs"

export GHIDRA_INSTALL_DIR="$HOME/.local/share/rea-ps2/ghidra_12.1.4_PUBLIC"
export JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home
export GHIDRA_HEADLESS_MAXMEM=1536M
export REA_GHIDRA_STARTUP_TIMEOUT_MS=600000
export REA_GHIDRA_DECOMPILE_TIMEOUT_SECONDS=45
node "$HOME/.local/share/rea-ps2/rea-agents/scripts/rea.mjs" decompile \
  "$PWD/build/rea/SCUS_971.99" --procedure=0x213ed8 --provider ghidra --json
```

The executable was extracted locally using the existing ISO reader. Its SHA-256
is `e050581032e4bb3f20341307da5b69b76f1574910519155380ea771e55c3c0c9`.
Keep it and all analysis output in ignored `build/rea`, outside the served
`build/browser` directory. No game instructions were executed or uploaded.

Actual validation results:

- All 15 saved profile tests passed, including incompatible flags, endianness,
  ELF class, object type, present/uninspected ABI declarations, and incomplete
  inspection. A generated three-file patch at
  `$HOME/.local/share/rea-ps2/rea-6.8.0-ps2.patch` passed `git apply --check`
  against the unchanged official package. Reapply only to a fresh isolated copy
  of the same release; updates can replace these release-specific bundles.
- The CLI decompiled original `approach_value` at `0x213ed8`. Its clamp and
  pointer-update structure match the recovered C, but it incorrectly inferred
  `void` instead of the source's floating-point return. This is static evidence,
  not execution equivalence or automatically portable C.
- Through the actual MCP protocol, `open_binary` with `provider_id: "ghidra"`
  and `procedure_pseudo_code` at `0x20b618` returned the original unresolved
  [decompressor](../../src/assembly/textbin/runtime/memory/fast_decompress.c).
  Output includes its header check, scratchpad address, `_pcpyld`, `_qmtc2`, and
  unresolved register/helper dependencies. These need source-owned types and
  portable services before any recovered implementation can enter the browser.
- Full MCP evidence is local at `build/rea/fast-decompress-mcp.json`.
  `close_binary` published `build/rea/ps2-analysis.snapshot.json` and the client
  closed cleanly. The snapshot contains an evidence record, not a persisted
  Ghidra project or proof that later analysis will skip import/autoanalysis.
- VS Code's user MCP configuration preserves `rea` and adds `rea-ps2` with the
  isolated launcher and explicit Ghidra/JDK environment. Launching the exact
  saved command passed a real MCP handshake and advertised all 229 tools,
  including open/decompile/close. Restart that MCP server or reload VS Code
  before expecting its tools in an existing chat; registration alone is not
  an editor-session connection.

This setup unblocks static investigation; it does not advance a gameplay gate.
The browser WAD decoder remains a separately implemented format decoder, not
recovered C from this PS2 routine. Do not paste inferred pseudocode into the
runtime without recovering types and validating behavior independently.

## Current Progress

- Stage 0: complete; native-only scope recorded.
- Stage 1: complete for the selected original C function; build and all 10
  browser tests passed on 2026-11-03. No game startup or level is implemented.
- Asset prerequisite: the local boot executable checksum matches the supported
  USA release. This is not validation of all disc assets.
- Stage 2: complete for bounded local sector access, ISO9660 file cataloging,
  and boot checksum verification. Selected Veldin assets now decode locally.
- Stage 3: scene reset, a source-ported frame counter, asset-backed original
  disc-table initialization, bounded boot/resident/Veldin archive decoding, and
  unchanged original C resident/planet-sky relocation verified.
  Original C world-down acceleration, heading spring, and velocity construction
  now execute in a separate native module. Original C ground-height probing now
  runs against a portable static-world collision query and real Veldin data.
  The original C current-position collision resolver now executes against native
  sphere/capsule and optional hero-group queries in that same module.
  Full startup/update dependencies remain.
- Stage 4: Veldin terrain, indexed textures, and native-relocated sky now render
  in Three.js, with native static collision data loaded alongside the scene.
  Ratchet's actual model now has a bounded native world-down walk/jump controller,
  static collision resolution, browser controls, and a following orbit camera.
  Original idle/run/jump poses now play on the skinned model. The complete original
  hero and animation state machines and gameplay camera remain unfinished;
  this stage is not complete.
- Stages 5-7: not implemented or validated.

## Original Hero C Port

`make browser-hero` builds `build/browser/hero-locomotion.wasm` and compiles the
original frame pipeline, Novalis movement, gravity, collision-history, and
ground-contact owning files into WebAssembly bitcode. Those full update files
compile; their complete gameplay path does **not** link or execute yet. This
target is not a playable hero build and is not connected to the viewer controls.

The linked world-down locomotion slice executes these original implementations:

- `speed_step` from `src/overlays/shared/hero/hero_switch_item.c`.
- `approach_value` from `src/math/interpolation/approach_value.c`.
- `spring_angle` and `compute_directed_angle_delta` from
  `src/overlays/shared/math/interpolation/compute_directed_angle_delta.c`.
- `advance_damped_scalar_velocity` from
  `src/overlays/shared/mobys/find_moby_hit.c`.
- `build_spherical_offset` from `src/camera/build_spherical_offset.c`.

`browser/hero.c` owns the original `struct Hero`, asserts its 0x2300 size and
critical field offsets at compile time, validates inputs, and connects those
functions for world-down motion only. It supplies explicit portable trig and
wrapped-angle helpers; numerical equivalence to PS2 approximations is unverified.
There is no position integration, input loop, ground collision, animation, or
Ratchet mesh in this slice. Alternate gravity is not exposed or silently stubbed.

Two recovered mixed-integer/float function declarations disagree with their
callers under the WebAssembly ABI: interpolation's pointer argument and the
directed-angle helper's integer argument appear in different positions. Scoped
function-like compile definitions reorder those function signatures for this
module while preserving their bodies and all original files. These are local
ABI adaptations, not a general repair of every prototype in the recovered tree.
The browser-only `qcopy.h` substitutes fixed 16-byte copies for MIPS lq/sq.
LTO removes unrelated functions and their conflicting prototypes before linking.
New adapter compilation and undefined-symbol checks remain strict; legacy-C
compatibility flags apply only to the recovered files.

Verification performed:

- `make browser-hero` succeeds, including strict linking with no host imports.
- An inline Node execution and browser execution through the existing game page
  both accelerated to speed 1, converged to heading pi/2, and produced velocity
  approximately `(0, 1, 0)`. Braking reached zero. Invalid inputs were rejected
  and reset cleared owned state. These exercise the native C functions, not a
  JavaScript implementation of their logic.
- Original `src/`, `include/`, `scripts/`, and `config/` remain unchanged.

The earlier complete Novalis movement link probe had 50 unique unresolved symbols, including
owned world/collision state, assembly math helpers, and these low-level queries:
`FUN_001efa68` (line), `FUN_L00_001f0d60` (sphere),
`FUN_L00_001f19a0` (capsule/rig probe), and `FUN_L00_001f3170`.
That inventory predates the native static sphere/capsule and hero-group bindings
below; it is not the current resolver's unresolved count. For example,
`src/assembly/textbin/world/collision/coll_line_fix.c` is an
`INCLUDE_ASM` declaration, not a portable C collision implementation. Original
high-level collision history and ground-contact C are available, but cannot run
correctly without those queries and their actual world data. They are not bound
to success-returning stubs or hidden with permissive linker options.

There is also a recovered return-type mismatch: `FUN_L00_00213350` is defined
as void while movement consumes a float. Its documented behavior is the velocity
dot product with hero heading; it needs a validated native correction before
full movement integration. Next work is these collision/math services and real
world-state bindings, then original hero initialization/frame execution. Do not
substitute new JavaScript gameplay or another viewer feature for that work.

## Controlled Hero Slice

`browser/hero.c` now exposes persistent `runtime_hero_control_reset`,
`runtime_hero_control_step`, and `runtime_hero_control_grounded` in the combined
zero-import native module. The bounded 60 Hz driver reuses unchanged original
`speed_step`, heading spring, spherical velocity construction, and current-position
collision resolution. It does not claim to execute the full original
`apply_hero_motion_and_resolve_collisions` or the complete hero state machine.

World-down integration, static floor grounding, landing, ceiling response, and
grounded-only jump admission are explicit browser-port C adaptations. Running
uses the recovered 5.7 units/second; walking uses 2.5. The jump setup derives from
normal-jump values in `hero_set_state.c`: 1.47-unit target rise, gravity 29.7,
and falling gravity multiplied by 1.17. Immediate takeoff uses a derived vertical
impulse, not the original animation-keyed takeoff timeline. Fixed steps and a
bounded fall displacement keep the capsule within the static collision query's
resolution range. Held jump cannot retrigger on landing. Unsupported original
platform/gravity/gameplay systems have not been replaced by success stubs.

The viewport maps WASD or arrow keys into camera-relative movement, Space into
jump, Shift into walking, and R into reset. Dragging orbits and the wheel zooms;
the camera follows position while preserving its orbit offset. Narrow/coarse
screens have captured multi-pointer direction, jump, and reset buttons.
Blur/visibility changes release input and discard elapsed simulation time;
falling 40 units below the starting surface resets the native hero. Loading a
different disc disables controls and clears input. `readHeroState()` provides a
read-only snapshot for verification, without an in-game diagnostic panel.

Validation on 2026-11-04:

```sh
make browser-game
RNC_ISO_PATH="$PWD/dumps/Ratchet & Clank (USA) (En,Fr,De,Es,It).iso" \
  node --test browser/collision.test.mjs
node --check browser/game.mjs
```

- All four focused tests pass, including original resolver regression, real
  Veldin data, walk displacement, jump/landing, held-jump rejection, diagonal
  normalization, long falls, wall blocking, readiness, and invalid input.
- Actual browser keyboard execution moved Ratchet 1.25 units during the sampled
  W hold; Space rose approximately 1.39 units and landed. The follow-camera
  offset error was zero in that check.
- At 390x844, touch movement covered 0.60 units; touch jump rose 1.39 and landed.
  Lost-focus settling drift was 0.0035 units. Control bounds fit without
  horizontal overflow. Desktop/mobile canvas captures remain nonblank.
- Native compilation/linking, module syntax, editor diagnostics, cleanup, and
  original-source preservation checks pass. No original `src/`, `include/`,
  `scripts/`, or `config/` files changed.

The subsequent animation slice below adds original idle/run/jump poses. Combat,
moving platforms, alternate gravity, complete retail collision filtering, and
original camera behavior remain unsupported. Stage 3/4 gates remain incomplete.

## Original Hero Animations

`browser/moby-geometry.mjs` preserves original matrix-palette transfers and
one-, two-, and three-joint skin weights, including delayed cached vertices.
The 6,856-triangle mesh has normalized influences spanning 107 of 111 joints.
`browser/moby-animation.mjs` independently reads the original pose data; no
Wrench implementation or PS2 instruction interpreter is linked into the viewer.

Veldin's model has 134 empty sequence pointers. The owning original
`load_level_gameplay.c` installs them from the level header's word `0x1E`:
table offset 30,800, entries relative to the decoded core. Frame pointers are
relative to each sequence, as in `relocate_asset_entry_pointers.c`. The selected
level frames are expanded, not the separate compressed animation format.
Idle selection comes from `hero_idle_sequence.c`; run and normal jump from
`hero_set_state.c`: sequences 0, 4, and 7 respectively, with 10, 23, and 29 frames.

The bounded reader validates frame ranges, normalized signed-16-bit quaternion
records, indexed scale/translation records, source rates, and joint parents.
Translations use model scale / 1024, scales / 4096. Stored quaternion rotations
are conjugated for Three.js; the opposite convention visibly raised idle arms
above the head. Skeleton bind translations and original per-vertex influences
drive four shared-skeleton `SkinnedMesh` batches. Three.js interpolates poses
and crossfades transitions over 0.12 seconds.

Native grounded state and speed select the clips. Idle and running loop at
source rates, with run playback scaled to movement speed; walking slows the
same run clip. Jump plays once at 3.2 times its source rate to match this slice's
immediate takeoff, then returns to idle/run on landing. This selection/timing is
an explicit browser adapter, not execution of the original animation evaluator,
animation-keyed takeoff, full hero state machine, or verified retail pose parity.
Hidden views pause playback; reset, reload, and errors clear mixer resources.

Validation on 2026-11-04:

```sh
make browser-game
RNC_ISO_PATH="$PWD/dumps/Ratchet & Clank (USA) (En,Fr,De,Es,It).iso" \
  node --test browser/collision.test.mjs
node --check browser/game.mjs
node --check browser/moby-animation.mjs
```

- All four tests pass with no skips, including all 62 decoded clip frames,
  changing rotations, finite transforms, normalized quaternions/skin weights,
  valid joint indices, malformed animation-table rejection, and native controls.
- Actual browser idle poses change over time, movement selects run 4, and
  keyboard/touch jumps select 7 before landing back in idle 0. Original textured
  limbs visibly articulate without stretched geometry in inspected captures.
- Desktop 1280x800 and mobile 390x844 captures render the character. Mobile
  canvas pixel sampling is nonblank, has no horizontal overflow, and touch jump
  returns to grounded idle. Existing controls and camera following remain active.
- ISO and decoded assets remain local/ignored. Full scene rendering, the full
  original frame/animation pipeline, combat, co-op, and P2P are not complete.

## Ground Swing Animation Slice

This ground-only slice was extended by the airborne slam fix recorded below.

The original `hero_set_state.c` selects sequences `0x17 + k` for the three
ground wrench swings. The bounded pose reader now decodes those original clips
(23, 24, 25) alongside idle/run/jump. `F` or the touch Swing button plays a
ground swing once at the stored pose rates. Another press queues at most one
next swing; keyboard autorepeat does not queue attacks. Horizontal input pauses
during a swing, while jump, reset, lost focus, and airborne state cancel it.

`HeroSwingState` is a browser animation adapter, not execution of the original
combat state machine. Queued swings advance at clip completion, not the retail
attack-record windows. There is no attached wrench model, hit detection, damage,
breakable object interaction, or sound in this slice. No gameplay gate advances.

Validation on 2026-11-04:

```sh
RNC_ISO_PATH="$PWD/dumps/Ratchet & Clank (USA) (En,Fr,De,Es,It).iso" \
  node --test browser/collision.test.mjs
node --check browser/game.mjs
make browser-game
```

- All five focused checks passed with the local USA disc and no skips. Existing
  native movement/collision checks and finite normalized poses cover all six clips;
  the swing adapter check covers bounded queuing, completion, and cancellation.
- Actual browser keyboard execution traced `23 -> 24 -> 25 -> 0`, with changing
  poses and autorepeat rejected. Jump canceled a swing and airborne input was
  rejected. Actual touch input traced `23 -> 0` at 390x844.
- Desktop 1280x800 and mobile 390x844 canvas center samples were nonblank
  (4096/4096 pixels); no horizontal overflow, and mobile controls fit their bounds.
  Editor screenshot capture changed viewport/compositor state, so explicit CDP
  metrics and live canvas sampling were used to verify sizing and rendering.
- Build, editor diagnostics, cleanup rules, whitespace, and original source-tree
  preservation checks passed. Only generated `build/browser` is served locally.

## Airborne Slam Input Fix

The ground-only adapter rejected airborne attack requests and reset attacks on
every held-jump/airborne update. Jump plus attack therefore could not work.
Requests now wait for the fixed simulation tick: jump is processed before attack,
so both same-frame key orders select the airborne attack correctly. Ground
swings still cancel on takeoff; slam sequence 43 persists through landing.

The original `hero_set_state.c` selects `0x2B` for wrench slam. The disc stores
13 expanded poses at rate 0.25, spanning 0.8 seconds at base playback rate.
Each pose also stores a signed-16 gameplay-frame marker at byte 4, divided by 16,
as read by original `compute_interpolated_record_value.c`. These markers run
from 11 to 35 in steps of 2. Original impact frame 26 maps to 0.5 seconds of
clip time, not `26 / 60` seconds or stored pose index 26. The initial adapter
incorrectly froze a middle pose and snapped forward on landing; that behavior
has been removed. A slam cannot queue itself; reset or lost focus cancels it.

`sampleHeroAnimationFrame` interpolates those source markers from clip time.
The original unchanged `adjust_hero_animation_speed_for_target_frame` from
`hero_idle_sequence.c` now links and runs in the native hero module. A bounded
wrapper uses 0.33-speed wind-up, predicts touchdown with the actual capped
downward steps, and calls the original helper toward frame 26 during descent.
Landing uses the original 2x/1x recovery rules without seeking or freezing the
mixer. This is still an adapter around selected original logic, not the complete
retail animation evaluator or combat state machine. The recovered owning file
emits six existing macro-redefinition warnings during compilation.

`runtime_hero_control_slam` adds a bounded world-down phase to the existing native
controller. It adapts the original movement code's rise through tick 9, drop
after tick 14, rise target 7.7 units/s, distance-dependent rise reduction, and
150/130 units/s-squared acceleration values. The existing 0.3-unit downward
step cap and static collision resolver remain active. This does not execute the
complete recovered slam function, retail animation-speed predictor, targeting,
or hit-descriptor path. Wrench attachment, damage, objects, and sound remain absent.

Validation on 2026-11-04:

```sh
RNC_ISO_PATH="$PWD/dumps/Ratchet & Clank (USA) (En,Fr,De,Es,It).iso" \
  make browser-collision-test
make browser-game
node --check browser/game.mjs
```

- Seven focused checks pass with no skips, including airborne animation state,
  native rise/drop/landing, held-jump suppression, cancellation/reset, existing
  collision/movement checks, and all seven original pose clips from the disc.
- Desktop 1280x800 execution verifies both same-frame jump/attack orders, delayed
  attack after jump, airborne and landed sequence 43, and recovery to idle.
  Holding jump through landing does not repeat it. Actual Veldin landing heights
  remain within 0.002 units of their starting heights in these stationary checks.
- Mobile 390x844 two-finger jump/attack traces `0 -> 7 -> 43 -> 0`, recovering
  grounded without horizontal overflow. Ground combo still traces `23 -> 24 ->
  25 -> 0`; focus loss during slam recovers without a stuck attack.
- Desktop canvas sampling is nonblank. Build, editor diagnostics, cleanup,
  whitespace, and original source-tree preservation checks pass. No gate advances.

Visual timing correction verified on 2026-11-04 with the same commands above:
eight focused checks pass, including source-marker interpolation, actual disc
frame 26 at clip time 0.5, and native touchdown near the intended impact frame.
Desktop pose captures cover wind-up, overhead strike, impact, and recovery;
direct canvas exports were inspected because editor compositor captures were
stale. Desktop touchdown measured frame 26.1; real mobile two-finger input at
390x844 measured frame 27.1, with no frozen pose frames, nonblank pixels, and no
horizontal overflow. The character remains empty-handed: wrench attachment,
damage, sound, and retail visual parity are not delivered by this correction.

## Native Static Collision

`make browser-collision` builds a strict, zero-host-import `collision.wasm`.
`make browser-game` includes it and initializes collision from the same local
planet core used by the renderer. Failed loads and reloads reset collision state.
The original `src/world/collision/probe_ground_height.c` compiles unchanged and
executes through a narrow native line-query binding. No viewer physics or hero
movement has been substituted for the recovered game code.

`browser/collision.c` independently implements the static asset reader and
segment/triangle intersection; it is **not** a recovered complete `FUN_001efa68`.
That assembly query's REA output still contains unmodelled vector operations.
The serialized format was checked against the pinned Wrench collision format
reference (`46e80430158a4a11e9cbd51424c84a015bbab058`); no Wrench implementation
is copied or linked into this runtime.

For Veldin, core header offset 0x14 selects collision at 2,090,944; header offset
0x60 selects the following texture payload at 2,889,472. The 798,528-byte block
contains a mesh offset and optional hero-group offset. Its mesh uses Z/Y/X tables
of 4-unit cells, signed packed 10/10/12-bit vertices, triangle/quad index records,
and material IDs. The reader validates ranges, indices, encoded cell sizes, and
traversal budgets before enabling queries. The native result reuses the original
`CollisionHit` point/normal layout, with compile-time offset assertions.

Supported: double-sided static segment hits, nearest hit fraction, world point,
normalized face normal, material ID, original C ground-height probing, and the
static sphere/capsule and hero-group resolution described below.
The original probe's line binding accepts only its flags-2/null-object call;
unsupported arguments trap. This does not establish retail flag/filter semantics.
Dynamic mobys, full collision-history integration, PS2 numerical parity,
and the complete original hero frame
are still unimplemented. This module must not be used as their success stub.

Verification on 2026-11-04:

- `make browser-collision` and `make browser-game` succeeded with strict errors
  and undefined-symbol checks; the collision module has zero host imports.
- Inline Node fixture checks passed for signed vertices, both quad halves,
  normals/materials, original C ground height, misses, degenerate segments,
  nonfinite inputs, truncated data, invalid indices, and corrupted guards.
- Local ISO execution and actual browser execution both loaded 5,783 cells and
  53,411 stored faces. The original C probe at `(100, 180, 90)` with offset 10
  returned height `45.02499008178711`, material 12, and normal approximately
  `(0.026597, 0.084521, 0.996067)`. A miss cleared the prior hit.
- An inline Node sweep made 2,000 real-world queries in 42.65 ms, averaging
  0.0213 ms/query on this development machine; browser/device performance is not
  established by that measurement.
- The live browser rejected a non-disc file, cleared collision metadata, then
  successfully reloaded Veldin. No character or movement controls were added.

### Original Hero Collision Resolution

The combined `hero-locomotion.wasm` now includes the unchanged
`resolve_hero_current_position_collisions` from
`src/overlays/shared/hero/hero_switch_item.c`. Its eight-attempt loop consumes
native capsule/sphere push-out, contact points, and normals, and updates the
original `struct Hero`. The browser-only collision header binds offset hit fields
to one owned `CollisionHit`; it does not allocate disconnected global copies.
The live browser loads this combined module instead of the standalone line module.

Portable sphere/capsule services compute the closest capsule-axis/triangle
points over the original collision mesh, including quad halves and expanded cell
bounds. Optional hero-group triangles are validated and queried separately,
preserving a prior capsule hit when the group query misses. Veldin's actual group
table is present but empty. Static null-object mask-0x24 calls are admitted;
other masks, moving objects, alternate gravity, and pending path clearance are
unsupported, with explicit traps rather than success-returning stubs. Portable
vector services replace the assembly helpers used by this selected C loop.
This establishes geometric behavior, not full retail collision/filter parity.

The real Veldin query moved the original Hero capsule from
`(100, 180, 45.274990)` to approximately `(100.006676, 180.021210, 45.524998)`
and set `hero.wall_hit`. Focused floor/wall/edge/separation fixtures, a nonempty
hero-group fixture, malformed data, readiness, and real-disc execution run with:

```sh
RNC_ISO_PATH="$PWD/dumps/Ratchet & Clank (USA) (En,Fr,De,Es,It).iso" \
  make browser-collision-test
```

Level-label correction: Veldin Tutorial is overlay **L00**, while **L01 is
Novalis**. Earlier notes calling the L01 motion file Veldin were incorrect.
The shared Veldin-compatible motion integration function is
`apply_hero_motion_and_resolve_collisions` (`FUN_L00_00213880`) in
`hero_switch_item.c`; it is not yet linked or executed. Next are its original
ground-contact helpers, attachment/world-state ownership, remaining math, and
the forward-component return-ABI correction, followed by full input/frame and
character rendering. The current resolver probe is not a hero initialization or
playable movement loop.

For static investigation, the existing overlay extractor reconstructed Veldin
Tutorial as `build/rea/veldin-overlay.elf`, matching pinned SHA-256
`8f1e00c8be75635db809679890fb5c128ba208e780461699f73e3a5344356ec9`.
Direct Ghidra analysis with `r5900:LE:32:default` at 0x1F3170 confirmed the
extra query's optional group traversal. Boot-file addresses must not be used
for overlay code. REA numeric procedure selectors here used source file
offsets; the mapped overlay routine was not automatically discovered there.
Analysis artifacts remain ignored outside the served browser directory.

## Native Viewport

Run `make browser-game` and use `http://127.0.0.1:8765/game.html` on the existing
`build/browser` server. This build also sets that server's default page to the
viewport; `make browser-smoke` can overwrite the default with its diagnostic.
The parent checkout's HTML prototype is untouched. Three.js 0.180.0 is installed
locally under ignored `build/browser/node_modules`; the page uses no remote CDN.

Selecting the local USA disc initializes the native C runtime and renders the
original resident transition sky while loading Veldin. The planet then renders
460 terrain fragments, 24,520 triangles, 78 indexed textures, and its own sky:
five shells, eight textures, and 2366 sky triangles. Terrain geometry, UVs,
material assignments, and baked vertex colours come from the actual level core.
Dragging orbits the view; panning and zooming are available. Initial framing
accounts for both viewport dimensions.

The browser graphics adapters read stored packed asset arrays and convert them
to WebGL meshes; they do not execute MIPS/VU programs or provide a PS2 runtime.
Terrain positions combine their signed 16-bit values with the stored origin,
then divide by 1024. Full-detail strips supply triangle indices. Palette
locations follow the original texture-upload allocation order. Format notes at
the pinned Wrench commit were consulted, but no Wrench implementation is linked
or copied into the browser runtime. Texturing, sky blending, and shell transforms
remain an initial browser interpretation, not verified PS2 visual parity.

Actual textured rendering and camera interaction were checked in the browser.
This is a real planet-asset scene, not playable Ratchet gameplay or completed
Stage 4. No replacement hero or gameplay was invented. Ratchet's actual class-zero
model initially rendered in a static pose. The controlled hero and animation
slices above now add movement and original idle/run/jump poses; remaining scene
objects, sky fidelity, and full original hero/collision/camera integration remain
unfinished.

### Ratchet Visual Record

- The original hero initializer selects moby class zero. Veldin's 125-entry
  class table contains that model at core offset 7,574,848, with texture
  remapping `[0, 1, 2, 3]`. The resident classes 531-533 are not this model.
- `browser/moby-geometry.mjs` independently decodes its 63 high-detail packets
  into 6,856 triangles and four material batches. Positions use class scale
  divided by 1024; delayed vertex IDs and duplicate records reconstruct cached
  vertices. Packed draw records provide UVs, texture changes, restart flags,
  and end padding. Padding is excluded rather than drawn as stretched triangles.
- The existing indexed texture decoder also reads the moby texture table.
  Ratchet's four original images are 256, 128, 64, and 32 pixels square.
  No game assets or upstream Wrench implementation are copied into source.
- The viewport places this static model on a ray-verified rendered terrain
  surface at `(145, 140, 30.179)` and starts with a close front camera.
  This is visual placement, not the original hero spawn or gameplay state.
  Resources are disposed on disc reload and load failure.
- Verification: `make browser-game`; module syntax, cleanup, whitespace, and
  unchanged original-source checks; focused real-disc mesh/texture decoding
  and truncated-data rejection. Browser loading reaches `Veldin / Ratchet`.
  Direct canvas captures at 1280x800 and 390x844 show the textured character,
  nonblank pixels, no horizontal overflow, and interactive orbiting.
- The controlled hero and original animation slices now move, jump, and skin
  this mesh. They do not execute the full original frame loop or add co-op,
  networking, or verified PS2 visual parity.
  Stage 3 and Stage 4 remain incomplete.

### Veldin Asset Record

- The known enclosing archive starts at sector 1885907; its reserved first
  sector is empty. The asset root starts at sector 1885908, with 6989 sectors
  available. Asset offsets are relative to that root, not the reserved sector.
- The level header is 32,160 bytes. Its compressed core is 9,515,621 bytes,
  decoding to 16,766,912 bytes. Disc requests remain at most 1 MiB each.
- A separate `planet-wad.wasm` uses fixed 64 MiB memory, a 16 MiB input buffer,
  and a 32 MiB output buffer. Existing boot/resident decoder limits are unchanged.
  Planet loads have decoder ownership checks for cancellation/supersession.
- Terrain begins at core offset zero. Its 64-byte records reference shared and
  full-detail arrays. The reconstructed world bounds are approximately
  `(86.669, 67.960, 5.999)` to `(233.084, 307.479, 43.509)`.
- Terrain pixel data begins at core offset 2,889,472. The separate 586,496-byte
  upload block supplies palettes; all 78 terrain textures decode successfully.
- Veldin sky occupies core offsets 1,556,416 through 2,090,944. Only that
  534,528-byte block is staged in the existing 4 MiB native sky buffer. Original
  C relocation succeeds and native guards remain valid.
- Verification: `make browser-game`; `node --check` on the changed modules;
  focused real-ISO terrain/texture/sky decoding; actual browser scene loading
  and interactive rendering. Original source trees remain unchanged. No game
  assets are uploaded or committed.

## Stage 3 Resident And Sky Execution Record

The resident archive at table offset `0x13B8` is read by
[initialize_level_runtime.c](../../src/game/initialize_level_runtime.c).
Its source-defined header, moby-class table (32-byte records), and texture-class
table (16-byte records) are now range-checked in the
[disc bridge](../../browser/disc-loader.mjs). This is not a complete asset
validator: class bodies, texture encodings, geometry, and collision still need
their own parsers. The `0x4F8` level chunk is used for boot graphics; it is not
the selected gameplay level's geometry archive.

The same bounded WebAssembly decoder now handles boot and resident archives.
Shared decoder ownership tickets reject older loads across archive types.
Initialization retains boot metadata, decodes resident data, and stages a copy
into a separate native buffer; the decoder's current output is then resident
data, not the previously decoded boot modules. Failure clears native disc,
sky, and decoder readiness. No extracted machine code is executed.

The original [sky relocation C](../../src/world/loaders/relocate_sky_definition.c)
is compiled unchanged into `runtime.wasm`. The
[native sky adapter](../../browser/sky.c) owns a 4 MiB aligned staging buffer
and a trailing 16-byte guard. Before invoking the original routine it validates
all mutation ranges, disjoint shell/texture tables, shell reference bounds,
unrelocated status, and texture dimensions. This deliberately bounded contract
allows at most 64 shells, 1024 textures, and 65536 total clusters; dimensions
must be powers of two up to 1024. Its portable integer `log2dim` dependency is
validated only for those admitted dimensions, not every possible PS2 input.
Successful relocation is one-shot until explicit reset; native pointers refer
only to owned wasm32 storage, not original console addresses. Geometry pointed
to by these records is not yet decoded or submitted for rendering.

From the fork root, the exact validation command on 2026-11-03 was:

```sh
RNC_ISO_PATH="$PWD/dumps/Ratchet & Clank (USA) (En,Fr,De,Es,It).iso" \
RNC_WAD_REFERENCE_PATH="$PWD/build/wad-reference" \
make browser-runtime-test browser-wad-test
```

All 30 tests passed with zero skips. They include exact original-C fixture
mutations, malformed counts/offsets/dimensions, overlapping mutation tables,
damaged guards, double-relocation rejection, cross-archive supersession, and
failed resident loading followed by recovery. Actual disc results:

- Resident input: sector 1880188, 510 sectors (1,044,480 bytes).
- Decoded output: 2,863,552 bytes, byte-for-byte identical to the separate
  upstream decoder; SHA-256
  `45da9ffad89ebfcc796af2d3a956ee7d493451322b3476d7b40afa23208874f8`.
- Header: 11 textures, three moby classes, and three texture-class records.
- Resident sky at decoded offset 305152: six shells and six textures. Every
  mutated byte after executing the original C matched independently computed
  relocation/texture-record expectations; untouched bytes matched as well.
- Browser automation passed all six runtime checks, actual ISO initialization,
  native sky guards, cancellation during the resident read, and recovery.
  Disc selection made zero network requests. Desktop 1280x900 and mobile
  390x844 had no horizontal document overflow; browser focus was temporarily
  enabled to permit hidden-tab actionability and frame/layout checks.

Open the existing diagnostic at `http://127.0.0.1:8765/runtime.html`, served only
from `build/browser`. Original sources, headers, scripts, and config remain
unchanged. Stage 3 is still incomplete: texture upload/decoding, remaining
class and scene relocation, selected-level geometry, and original update-path
services are unresolved. No level is rendered, and movement, collision,
camera, co-op, and P2P are not implemented by this slice.

## Stage 1 Execution Record

Toolchain: Homebrew Emscripten package 6.0.13, reporting `emcc 6.0.13-git`.
The build checks this compiler version; changing `EMCC_VERSION` explicitly
requires rerunning the browser checks before claiming support.

From the fork root:

```sh
make browser-smoke
python3 -m http.server 8765 --bind 127.0.0.1 --directory build/browser
```

Open `http://127.0.0.1:8765/`. Do not serve the checkout root. Port 8765 must
be available; choose another port if it is occupied.

The [smoke adapter](../../browser/smoke.c) calls the unchanged recovered
`approach_value` and implements its `absolute_float` dependency using the
compiler's floating-point absolute-value intrinsic. The
[browser checks](../../browser/smoke.html) load the compiled module directly,
invoke its exports, and fail visibly on loading or assertion errors. They set
`body[data-result]` to `passed` or `failed` for browser automation.

Validation: `make browser-smoke` passed with `-Wall -Wextra -Werror` and undefined
symbol errors enabled. Browser automation asserted `data-result="passed"` and
`data-passed="10"`: increasing, decreasing, clamping in both directions,
already-at-target, zero-step, negative values, fractional steps, repeated
updates, and the portable absolute-value dependency, including negative zero,
infinity, and NaN. Original source/header diff checks were clean; generated
artifacts are ignored by Git. No ISO data was read or served by this test.

Memory ownership, rendering, game startup, overlays, audio, and co-op remain
unverified; Stage 1 proves only the selected C function and build toolchain.

## Stage 2 Execution Record

The [local disc adapter](../../browser/iso-reader.mjs) reads browser `File` slices
with a 1 MiB per-request limit. Sector addresses use the original 2048-byte
logical sector size. It checks declared volume/file extents, paired byte-order
fields, record boundaries, duplicate paths, directory cycles, and directory
budgets. Unsupported interleaving, extended attributes, and multi-extent files
fail explicitly. Buffered file reads are capped at 16 MiB; only the small boot
executable is buffered for Web Crypto SHA-256 verification. No whole-ISO read
or copy into WebAssembly memory is performed.

The [disc inspector](../../browser/iso.html) offers local file selection,
cancellation, a verified file catalog, and first-sector hash/hex previews.
Selection does not upload the ISO. This is diagnostic tooling, not gameplay.

From the fork root, run the focused build and optional real-disc comparison:

```sh
make browser-assets
RNC_ISO_PATH="$PWD/dumps/Ratchet & Clank (USA) (En,Fr,De,Es,It).iso" make browser-assets-test
```

Use the isolated `build/browser` server from Stage 1 and open
`http://127.0.0.1:8765/iso.html`. Use the actual ISO filename on other machines.
The real-disc test is explicitly skipped when `RNC_ISO_PATH` is unset.

Validation on 2026-11-03:

- All 11 [reader tests](../../browser/iso-reader.test.mjs) passed with the local
  ISO enabled, including malformed/truncated data, invalid ranges, oversized
  reads, incorrect/missing executable, and cancellation before/during reads.
- An independent Python reader matched the three ISO9660 entries, the full
  boot SHA-256, and hashes of six sampled sectors. The adapter read 1,397,642
  bytes in 10 requests; the largest request was 1,048,576 bytes.
- Browser automation selected the actual local ISO, verified its boot checksum,
  and previewed its executable sector. There were zero network requests during
  selection/inspection after the inspector module had loaded.
- Browser checks rejected a non-ISO file, cleared stale catalog contents,
  cancelled a delayed local read, and recovered on reselecting the valid ISO.
- Screenshots and document-width checks passed at 1280x900 and 390x844.

Important boundary: this disc exposes only `SYSTEM.CNF`, `SCUS_971.99`, and
`IOPRP243.IMG` through ISO9660. The catalog is not a list of every game asset.
Level data also occupies raw disc ranges documented in the existing
[overlay extractor](../../scripts/overlay-extract.py). The bounded sector API
can address such ranges, but game-specific asset decoding and integrity checks
have not yet been implemented. Boot validation does not validate all assets.

Stage 2 provides bounded data reads; it does not execute PS2 machine code.

## Stage 3 First-Slice Execution Record

The [native runtime](../../browser/runtime.c) owns three aligned scene-state
buffers: 256, 3168, and 3168 bytes, each followed by a 16-byte guard. They bind
to the original C symbols without using the original PS2 memory addresses.
The [original scene reset](../../src/game/clear_scene_state_buffers.c) is
compiled unchanged and calls the native range-checked fill implementation.
The fill service supports only these owned buffers; unknown destinations and
invalid alignment/length trap rather than silently pretending to work.

The [native counter port](../../browser/count_vsync.c) retains the counter
increment and clock-addition logic from
[count_vsync.c](../../src/runtime/callbacks/count_vsync.c), replacing its PS2
timer-register read with a browser-owned counter. It uses explicit 64-bit C
storage because wasm32 `long` cannot be assumed to have the PS2 ABI's width.
This is a small C source adaptation, not the unchanged original callback or
an instruction-level hardware implementation. The diagnostic uses monotonic
elapsed microseconds; equivalence to PS2 hardware timer units is not claimed.

The [browser harness](../../browser/runtime.html) checks the compiled runtime
and can drive the native callback from `requestAnimationFrame`. Scene reset
does not reset the clock. Full runtime initialization resets both owned scene
state and counters. Invalid input or a damaged guard blocks further updates.
The [typed header](../../browser/runtime.h) defines the native adapter API.

From the fork root:

```sh
make browser-runtime-test
```

Open `http://127.0.0.1:8765/runtime.html` using the isolated `build/browser`
server from Stage 1. Browser animation callbacks normally pause in hidden tabs;
this harness counts display callbacks, not fixed-rate gameplay simulation ticks.

Validation on 2026-11-03:

- All eight [WebAssembly tests](../../browser/runtime.test.mjs) passed: module
  imports, initialization, 20 scene-mutation/reset cycles, 120 frame updates,
  32-bit low-counter rollover and safe 64-bit clock values, rejected clock and
  memory ranges, guard-corruption detection, and reinitialization.
- The module has zero unresolved host imports. There are no no-op hardware
  mocks. All native adapter sources use `-Wall -Wextra -Werror` and linking
  rejects undefined symbols. Only the unchanged old-C scene source disables
  `-Wdeprecated-non-prototype` for its legacy function declaration.
- Five browser assertions passed. A live `requestAnimationFrame` test advanced
  five native callbacks and checked that scene reset preserved the clock.
  The editor browser was hidden; the test temporarily enabled browser focus/
  visibility through CDP, then restored it. No emulator was used.
- `git diff --exit-code -- src include` passed: original recovered sources and
  headers remain unchanged. `/opt/homebrew/bin/python3.13 scripts/check-cleanup.py`
  passed. The system Python is too old for this checker's tar extraction API.
- The PS2 matching build was not run; this work does not establish a new
  byte-matching result. The original source path and PS2 build targets remain.

Unresolved before full game initialization/update: boot archive decompression,
asset-backed global initialization, allocation/relocation, level-overlay symbol
ownership, gameplay dispatch, and platform rendering/audio/input services.
The first slice did not wire ISO data into original initialization; the disc-table
slice below now does so for one startup helper, not full level initialization.
No level, hero update, camera, or rendered game is running. Do not mark Stage 3
fully complete or advance to rendering on the strength of this bounded slice.

## Stage 3 Disc-Table Execution Record

The original [disc-table loader](../../src/streaming/load_disc_sectors_into_global_buffer.c)
is now compiled unchanged into `runtime.wasm`. This helper is called by
[init_once.c](../../src/runtime/startup/init_once.c) before the boot archive is
loaded. It reads six sectors at `0x5DC` and copies exactly `0x2960` bytes into
the original `disc_table` symbol, backed by browser-owned WebAssembly storage.

The [native disc adapter](../../browser/disc.c) owns the staged six-sector
buffer and disc-table storage with trailing guards. Its read service copies the
prefetched bytes into the original function's local buffer; completion and error
queries enforce a read -> sync -> error-check sequence. Unsupported reads or a
graphics-wait call trap. This is a narrow synchronous adapter for one known,
fully prefetched read, not a general CD/DVD or graphics implementation. Missing
or wrong-sized data is rejected before entering the original retry loop.

The [local bridge](../../browser/disc-loader.mjs) verifies the USA executable,
reads six sectors through the bounded ISO adapter, stages them, and invokes
the original C loader. It checks known archive ranges against the selected
volume. Cancellation, failed checks, and superseded selections cannot publish
stale table state. No ISO bytes are fetched from or uploaded to a server.
The runtime page's disc picker now performs this initialization.

Reproduce the real-disc test from the fork root:

```sh
RNC_ISO_PATH="$PWD/dumps/Ratchet & Clank (USA) (En,Fr,De,Es,It).iso" make browser-runtime-test
```

Validation on 2026-11-03:

- All 15 runtime tests passed with the local ISO enabled, including the original
  loader's exact copy length, untouched table tail, guard preservation, read
  sequence, incomplete input, invalid archive ranges, cancellation, checksum
  failure, and selection supersession. Without `RNC_ISO_PATH`, 14 run and the
  real-disc comparison is explicitly skipped.
- An independent Python read matched all 10,592 copied bytes by SHA-256:
  `71eb079fa2b64f3b5fe606581539d0c919e908bf9d3a530309ea09ad383c5368`.
  All four exposed archive records matched the independent table read.
- Browser automation selected the actual local ISO and matched that same native
  table hash, with exactly one read, one sync query, one error query, intact
  guards, and zero network requests during selection/initialization.
- Browser checks rejected a non-ISO file, cleared stale details, cancelled a
  delayed read, recovered with the valid ISO, and found no page overflow at
  1280x900 or 390x900. The five existing native browser checks still passed.
- Original `src/` and `include/` files remain unchanged. The loader translation
  unit alone disables incompatible-pointer and unknown-attribute warnings for
  its legacy four-byte read-mode array and PS2 `sda` header attributes. Native
  adapters still use strict warnings, and linking rejects unresolved symbols.

Known records on the local supported disc:

| Record | First sector | Sector count |
| --- | --- | --- |
| Debug font | 1506 | 9 |
| Level chunk | 4984 | 444 |
| Boot archive | 14345 | 162 |
| Resident archive | 1880188 | 510 |

These are validated locations, not decoded or relocated assets. The table hash
validates this experiment against an independent read, not every disc asset.

The next dependency after the disc-table slice was archive decompression.
The [boot decompressor](../../src/assembly/textbin/runtime/memory/fast_decompress.c)
and [overlay variant](../../src/overlays/shared/runtime/fast_decompress.c) are
assembly includes in this checkout, not portable recovered C implementations.
The bounded decoder slice below now resolves the boot archive experiment;
these original assembly source files remain unchanged.

## Stage 3 Boot Archive Execution Record

[wad.c](../../browser/wad.c) is a new portable C implementation of the WAD
packet format, not a recovered or byte-matched version of the PS2 assembly.
It builds into a separate `wad.wasm` with no host imports. Its 1 MiB input
buffer and 16 MiB output buffer have trailing guards. A preflight pass validates
the header, compressed extent, packet bounds, lookback history, and output
capacity before a second pass materializes any new decoded data. Invalid calls
clear previously published output. Allocation, scratchpad DMA, and instruction
execution are not involved; the module has a fixed 32 MiB linear memory.

Packet behavior covers medium/extended literals, short/medium/extended/far
matches with overlapping copies, attached literals, dummy packets, and block
padding. The header's compressed length is read little-endian at offset 3;
sector padding outside that extent is not decoded.

The [disc bridge](../../browser/disc-loader.mjs) optionally decodes the boot
archive after executable verification and original C disc-table initialization.
It validates nine active module records at offset `0x70` against the decoded
buffer and checks their ELF32 little-endian MIPS identities. The startup C uses
slots 0 through 8; slot 9 is zero on this disc and is not loaded. These ELF bytes
are inspected as data, never executed, linked, or treated as browser services.
Cancellation, malformed input, and superseded selections clear stale output.

The runtime page displays decoded size, SHA-256, guards, and module ranges after
the existing local ISO selection. `make browser-runtime` now builds both native
modules; `make browser-wad-test` builds its prerequisites and runs synthetic
tests without downloading anything. Its real-disc comparison is opt-in.

With explicit user permission, Wrench's existing GPL-3.0-or-later decoder was
downloaded and compiled only as a local test oracle, pinned to commit
`46e80430158a4a11e9cbd51424c84a015bbab058`. Its source, license, and executable
stay under ignored `build/`, outside served `build/browser/`. No upstream source
or binary is linked into the browser runtime. The small
[reference harness](../../browser/wad-reference.cpp) is not part of that runtime.
The upstream oracle is for the known local disc, not arbitrary untrusted inputs.

Reproduce the already-approved optional reference build from the fork root:

```sh
mkdir -p build
reference=https://raw.githubusercontent.com/chaoticgd/wrench/46e80430158a4a11e9cbd51424c84a015bbab058
curl -fsSL "$reference/src/engine/compression.cpp" -o build/compression.cpp
curl -fsSL "$reference/src/engine/compression.h" -o build/compression.h
curl -fsSL "$reference/COPYING" -o build/wrench-COPYING
shasum -a 256 build/compression.cpp build/compression.h
c++ -std=c++17 -O2 -include stdexcept -Ibuild browser/wad-reference.cpp build/compression.cpp -o build/wad-reference
RNC_ISO_PATH="$PWD/dumps/Ratchet & Clank (USA) (En,Fr,De,Es,It).iso" \
RNC_WAD_REFERENCE_PATH="$PWD/build/wad-reference" \
make browser-runtime-test browser-wad-test
```

Expected upstream source SHA-256 values:

- `compression.cpp`: `fa6f6c92778a11313cb0d2307fc5b66d6600fabe9d45f1edcb0b36a045aeebbf`
- `compression.h`: `d59749d6524b966cbd289e5626a409332367805a11213b9009a7a8a42834bb10`

Validation on 2026-11-03:

- All 10 decoder/bridge tests and all 15 existing runtime tests passed with the
  real ISO and reference enabled. The decoder tests include all packet families,
  guard damage, malformed module ranges, cancellation, supersession, and 500
  deterministic malformed streams. The optional comparison is explicitly
  skipped when either environment variable is absent.
- All 668,780 decoded boot archive bytes matched the separately built upstream
  decoder byte-for-byte, SHA-256
  `bfa898b04e3c056e9c3c7cfa6a0b0a2648b464c8d5a770a965ef37ac5ba6c88e`.
  The combined original-C table / native decoder initialization also passed.
- The browser matched that hash and all nine module records, passed six native
  checks, preserved guards, and made zero network requests during ISO selection
  and initialization. Total bounded local reads were 1,729,418 bytes.
- Browser automation rejected a non-ISO selection, cancelled during the boot
  archive read, cleared stale details, recovered with the valid ISO, and found
  no page overflow at 1280x900 or 390x900.
- Original `src/`, `include/`, `scripts/`, and `config/` remain unchanged. The
  recovered PS2 decoder still has not been compiled or run in the browser.

Next Stage 3 slice: decode a bounded resident or level asset range, validate its
actual header layout, and bring up a source-owned pointer-relocation dependency
against owned native memory. Decoded IRX modules are PS2 hardware components,
not a way to run startup in the browser; their required services need native
browser implementations. Full startup, level initialization, rendering, hero
updates, local co-op, and P2P remain unimplemented.

For each completed slice, append the exact command, result, touched original
source, and any unverified dependency here. Never mark later stages complete
because an earlier smoke test passed.