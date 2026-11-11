# Lombyte — Ratchet & Clank (PS2, USA) matching decompilation
#
# The boot ELF is recompiled and must match retail byte-for-byte (full-ELF
# SHA gate); `make overlays` proves the level overlay C function by function.
# `make iso` patches the ELF into a copy of your legally owned disc image,
# leaving the raw game data untouched.
#
# Setup: put a legally owned disc dump in dumps/ (e.g. dumps/game.iso) and
# install the toolchain (docs/build/building.md). Then run `make elf`.

.DEFAULT_GOAL := check
.PHONY: elf iso clean-iso check progress overlays format lint browser-smoke browser-assets browser-assets-test
.PHONY: browser-runtime browser-runtime-test
.PHONY: browser-wad browser-wad-test browser-game browser-hero browser-collision browser-collision-test

EMCC ?= emcc
EMCC_VERSION ?= 6.0.13-git
NODE ?= node
BROWSER_HERO_CFLAGS := -O2 -flto -Wno-unknown-attributes -Wno-incompatible-pointer-types -Wno-int-conversion -Wno-pointer-sign -Wno-deprecated-non-prototype -Ibrowser/include -Iinclude

browser-collision: ## Build native queries over the original static collision mesh
	mkdir -p build/browser
	$(EMCC) -O2 -Wall -Wextra -Werror -Ibrowser/include -Iinclude \
	  browser/collision.c src/world/collision/probe_ground_height.c \
	  --no-entry -sSTANDALONE_WASM=1 -sFILESYSTEM=0 -sERROR_ON_UNDEFINED_SYMBOLS=1 \
	  -sINITIAL_MEMORY=16777216 \
	  -sEXPORTED_FUNCTIONS='["_runtime_collision_reset","_runtime_collision_stage_address","_runtime_collision_capacity","_runtime_collision_load","_runtime_collision_guards_valid","_runtime_collision_cells","_runtime_collision_faces","_runtime_collision_segment","_runtime_collision_capsule","_runtime_collision_hit_position","_runtime_collision_hit_fraction","_runtime_collision_hit_material","_runtime_collision_hit_point","_runtime_collision_hit_normal","_runtime_collision_ground_height"]' \
	  -o build/browser/collision.wasm

browser-hero: ## Build native hero locomotion/collision; compile additional frame and Novalis motion files
	mkdir -p build/browser
	$(EMCC) $(BROWSER_HERO_CFLAGS) \
	  -c src/overlays/shared/hero/update_hero_frame_pipeline.c -o build/browser/hero-frame.o
	$(EMCC) $(BROWSER_HERO_CFLAGS) \
	  -c src/overlays/l01/hero/update_hero_motion_for_current_state.c -o build/browser/hero-motion.o
	$(EMCC) $(BROWSER_HERO_CFLAGS) \
	  -c src/overlays/shared/hero/set_hero_animation.c -o build/browser/hero-animation.o
	$(EMCC) $(BROWSER_HERO_CFLAGS) \
	  -c src/overlays/shared/hero/hero_switch_item.c -o build/browser/hero-collision.o
	$(EMCC) $(BROWSER_HERO_CFLAGS) \
	  -c src/overlays/shared/hero/hero_frame_update.c -o build/browser/hero-ground.o
	$(EMCC) $(BROWSER_HERO_CFLAGS) \
	  -c src/overlays/shared/hero/hero_idle_sequence.c -o build/browser/hero-timing.o
	$(EMCC) $(BROWSER_HERO_CFLAGS) \
	  '-Dapproach_value(target,step,value)=approach_value(value,target,step)' \
	  -c src/math/interpolation/approach_value.c -o build/browser/hero-approach.o
	$(EMCC) $(BROWSER_HERO_CFLAGS) \
	  '-Dcompute_directed_angle_delta(direction,target,current)=compute_directed_angle_delta(target,direction,current)' \
	  -c src/overlays/shared/math/interpolation/compute_directed_angle_delta.c -o build/browser/hero-angle.o
	$(EMCC) $(BROWSER_HERO_CFLAGS) \
	  -c src/overlays/shared/mobys/find_moby_hit.c -o build/browser/hero-damping.o
	$(EMCC) $(BROWSER_HERO_CFLAGS) \
	  -c src/camera/build_spherical_offset.c -o build/browser/hero-spherical.o
	$(EMCC) -O2 -flto -Wall -Wextra -Werror -Ibrowser/include -Iinclude browser/hero.c browser/collision.c \
	  src/world/collision/probe_ground_height.c \
	  build/browser/hero-collision.o build/browser/hero-approach.o build/browser/hero-angle.o build/browser/hero-damping.o build/browser/hero-spherical.o build/browser/hero-timing.o \
	  --no-entry -sSTANDALONE_WASM=1 -sFILESYSTEM=0 -sERROR_ON_UNDEFINED_SYMBOLS=1 \
	  -sINITIAL_MEMORY=16777216 \
	  -sEXPORTED_FUNCTIONS='["_runtime_hero_control_reset","_runtime_hero_control_step","_runtime_hero_control_jump_count","_runtime_hero_control_jump_release","_runtime_hero_jump_animation_speed","_runtime_hero_control_crouch","_runtime_hero_control_crouched","_runtime_hero_control_slam","_runtime_hero_slam_animation_speed","_runtime_hero_control_grounded","_runtime_hero_locomotion_reset","_runtime_hero_locomotion_step","_runtime_hero_locomotion_speed","_runtime_hero_locomotion_yaw","_runtime_hero_locomotion_yaw_rate","_runtime_hero_collision_probe","_runtime_hero_collision_position","_runtime_hero_collision_wall_hit","_runtime_collision_reset","_runtime_collision_stage_address","_runtime_collision_capacity","_runtime_collision_load","_runtime_collision_guards_valid","_runtime_collision_cells","_runtime_collision_faces","_runtime_collision_segment","_runtime_collision_capsule","_runtime_collision_hit_position","_runtime_collision_hit_point","_runtime_collision_hit_normal","_runtime_collision_hit_material","_runtime_hero_locomotion_velocity"]' \
	  -o build/browser/hero-locomotion.wasm

browser-collision-test: browser-hero ## Check static capsule queries and the original hero resolver
	$(NODE) --test browser/collision.test.mjs

browser-wad: ## Build the bounded native WAD decoder separately from game startup
	@command -v $(EMCC) >/dev/null 2>&1 || { echo "Emscripten is required" >&2; exit 1; }
	@version="$$($(EMCC) --version | sed -n '1s/.* //p')"; \
	  test "$$version" = "$(EMCC_VERSION)" || { echo "Expected emcc $(EMCC_VERSION), found $$version" >&2; exit 1; }
	mkdir -p build/browser
	$(EMCC) -O2 -Wall -Wextra -Werror browser/wad.c \
	  --no-entry -sSTANDALONE_WASM=1 -sFILESYSTEM=0 -sERROR_ON_UNDEFINED_SYMBOLS=1 \
	  -sINITIAL_MEMORY=33554432 \
	  -sEXPORTED_FUNCTIONS='["_wad_reset","_wad_guards_valid","_wad_input_address","_wad_input_capacity","_wad_output_address","_wad_output_capacity","_wad_output_size","_wad_ready","_wad_decode"]' \
	  -o build/browser/wad.wasm

browser-wad-test: browser-runtime ## Test bounded WAD packets and optional combined initialization
	$(NODE) --test browser/wad.test.mjs

browser-runtime: browser-wad ## Build native state, original disc loader, and bounded archive decoder
	@command -v $(EMCC) >/dev/null 2>&1 || { echo "Emscripten is required" >&2; exit 1; }
	@version="$$($(EMCC) --version | sed -n '1s/.* //p')"; \
	  test "$$version" = "$(EMCC_VERSION)" || { echo "Expected emcc $(EMCC_VERSION), found $$version" >&2; exit 1; }
	mkdir -p build/browser
	$(EMCC) -O2 -Wall -Wextra -Werror -Wno-deprecated-non-prototype -Iinclude \
	  -c src/game/clear_scene_state_buffers.c -o build/browser/scene-reset.o
	$(EMCC) -O2 -Wall -Wextra -Werror -Wno-incompatible-pointer-types -Wno-unknown-attributes -Iinclude \
	  -c src/streaming/load_disc_sectors_into_global_buffer.c -o build/browser/disc-loader.o
	$(EMCC) -O2 -Wall -Wextra -Werror -Iinclude \
	  build/browser/scene-reset.o build/browser/disc-loader.o browser/count_vsync.c browser/runtime.c browser/disc.c \
	  src/world/loaders/relocate_sky_definition.c browser/sky.c \
	  --no-entry -sSTANDALONE_WASM=1 -sFILESYSTEM=0 -sERROR_ON_UNDEFINED_SYMBOLS=1 \
	  -sEXPORTED_FUNCTIONS='["_runtime_init","_runtime_reset_scene","_runtime_guards_valid","_runtime_buffer_address","_runtime_buffer_size","_runtime_fill","_runtime_step","_runtime_frame_count","_runtime_time","_runtime_disc_reset","_runtime_disc_guards_valid","_runtime_disc_stage_address","_runtime_disc_stage_size","_runtime_disc_table_address","_runtime_disc_table_size","_runtime_disc_load","_runtime_disc_ready","_runtime_disc_entry_sector","_runtime_disc_entry_count","_runtime_disc_service_calls","_runtime_sky_reset","_runtime_sky_guards_valid","_runtime_sky_stage_address","_runtime_sky_capacity","_runtime_sky_ready","_runtime_sky_load"]' \
	  -o build/browser/runtime.wasm
	cp browser/runtime.html build/browser/runtime.html
	cp browser/iso-reader.mjs browser/disc-loader.mjs build/browser/

browser-game: browser-runtime browser-hero ## Build the native game viewport with local Three.js
	@test -f build/browser/node_modules/three/build/three.module.js || npm install --prefix build/browser --no-save --ignore-scripts --package-lock=false three@0.180.0
	$(EMCC) -O2 -Wall -Wextra -Werror -DINPUT_LIMIT=16777216 -DOUTPUT_LIMIT=33554432 browser/wad.c \
	  --no-entry -sSTANDALONE_WASM=1 -sFILESYSTEM=0 -sERROR_ON_UNDEFINED_SYMBOLS=1 \
	  -sINITIAL_MEMORY=67108864 \
	  -sEXPORTED_FUNCTIONS='["_wad_reset","_wad_guards_valid","_wad_input_address","_wad_input_capacity","_wad_output_address","_wad_output_capacity","_wad_output_size","_wad_ready","_wad_decode"]' \
	  -o build/browser/planet-wad.wasm
	cp browser/game.html browser/game.mjs browser/sky-geometry.mjs browser/level-loader.mjs browser/terrain-geometry.mjs browser/moby-geometry.mjs browser/moby-animation.mjs build/browser/
	cp browser/game.html build/browser/index.html

browser-runtime-test: browser-runtime ## Execute the original scene and frame-counter checks
	$(NODE) --test browser/runtime.test.mjs

browser-assets-test: ## Test bounded ISO reads; set RNC_ISO_PATH for the local-disc check
	$(NODE) --test browser/iso-reader.test.mjs

browser-assets: browser-assets-test ## Copy the local-only disc inspector into build/browser
	mkdir -p build/browser
	cp browser/iso-reader.mjs browser/iso.html build/browser/

browser-smoke: ## Compile original C and a browser test into build/browser
	@command -v $(EMCC) >/dev/null 2>&1 || { echo "Emscripten is required: install it, then retry make browser-smoke" >&2; exit 1; }
	@version="$$($(EMCC) --version | sed -n '1s/.* //p')"; \
	  test "$$version" = "$(EMCC_VERSION)" || { echo "Expected emcc $(EMCC_VERSION), found $$version" >&2; exit 1; }
	mkdir -p build/browser
	$(EMCC) -O2 -Wall -Wextra -Werror -Iinclude \
	  src/math/interpolation/approach_value.c browser/smoke.c \
	  --no-entry -sSTANDALONE_WASM=1 -sFILESYSTEM=0 \
	  -sERROR_ON_UNDEFINED_SYMBOLS=1 \
	  -sEXPORTED_FUNCTIONS='["_smoke_set_value","_smoke_get_value","_smoke_step","_smoke_absolute"]' \
	  -o build/browser/approach-value.wasm
	cp browser/smoke.html build/browser/index.html

check: ## Run the public CI checks locally (tests, script parse, progress report)
	python3 scripts/test_public_tools.py -v
	python3 -m py_compile scripts/*.py scripts/lib/*.py
	python3 scripts/progress-report.py
	python3 scripts/progress-map.py
	@# Struct layout checks (src/check/*_layout_check.c), compiled with the EE compiler when present.
	@cc=tools/compilers/game-compiler; if [ -x $$cc/cc1 ]; then \
	  for f in $$(find src/check -name '*_layout_check.c' | sort); do \
	    $$cc/cpp -Iinclude $$f | $$cc/cc1 -quiet -o /dev/null || exit 1; done; \
	  echo "layout checks: OK"; else echo "layout checks: skipped (no $$cc)"; fi

format: ## Format the C sources the human-first way (scripts/format.py)
	python3 scripts/format.py

lint: ## Lint browser JavaScript and spell-check browser comments and maintained docs
	npm run lint

progress: ## After `make elf`: measure C_FUZZY and preview the report and map in build/progress/
	.venv/bin/python scripts/progress-report.py --workspace build/baseline
	.venv/bin/python scripts/progress-map.py

elf: ## Rebuild the boot ELF byte-for-byte (full baseline + SHA gate)
	scripts/verify-baseline.sh
	@ls -l build/baseline/config/us/build/SCUS_971.99

overlays: ## Build src/overlays and prove every overlay function in C against retail (docs/build/overlays.md)
	.venv/bin/python configure.py --overlays
	.venv/bin/python scripts/overlay-check.py

iso: elf ## Patch the rebuilt boot ELF into a copy of the disc image
	@iso="$$(ls dumps/*.iso 2>/dev/null | head -1)"; \
	test -n "$$iso" || { echo "no dumps/*.iso found; place a legally owned dump in dumps/" >&2; exit 1; }; \
	python3 scripts/rebuild-iso.py --iso "$$iso"

clean-iso:
	@rm -f "build/Ratchet & Clank (USA) - rebuilt.iso"
