// The boot program page: runs main from the user's disc image (boot-runtime.mjs) and shows the
// frames the game's GS packets draw.
import { BootRuntime } from './boot-runtime.mjs';
import { GsRenderer } from './gs-renderer.mjs';
import { IsoReader } from './iso-reader.mjs';

const status = document.getElementById('status');
const canvas = document.getElementById('screen');
const context2d = canvas.getContext('2d');
const worldCanvas = document.getElementById('world');
const frontCanvas = document.getElementById('front');
const frontContext = frontCanvas.getContext('2d');
const frontImage = frontContext.createImageData(512, 416);
const say = (text) => { status.textContent = text; };

// Keyboard and gamepad -> DualShock buttons (include/rnc/input/pad_state.h bit order).
const PAD = { l2: 0x0001, r2: 0x0002, l1: 0x0004, r1: 0x0008, triangle: 0x0010, circle: 0x0020, cross: 0x0040,
  square: 0x0080, select: 0x0100, start: 0x0800, up: 0x1000, right: 0x2000, down: 0x4000, left: 0x8000 };
const KEYS = { ArrowUp: PAD.up, ArrowDown: PAD.down, ArrowLeft: PAD.left, ArrowRight: PAD.right, Enter: PAD.start,
  KeyX: PAD.cross, Space: PAD.cross, KeyC: PAD.circle, KeyZ: PAD.square, KeyV: PAD.triangle, Backspace: PAD.select,
  KeyQ: PAD.l1, KeyE: PAD.r1, Digit1: PAD.l2, Digit3: PAD.r2 };
let keys = 0;
// P: a small performance overlay (frames per second; milliseconds per frame in the GS rasterizer,
// the WebGL world, and everything else: the game's own code and the page).
const perf = document.createElement('div');
perf.style.cssText = 'position:fixed;top:8px;right:8px;z-index:9;padding:6px 10px;border-radius:6px;background:rgba(0,0,0,.72);color:#d9d6e6;font:12px/1.4 ui-monospace,monospace;white-space:pre;display:none';
document.body.append(perf);
addEventListener('keydown', (event) => {
  if (event.code !== 'KeyP' || event.repeat) return;
  const rt = globalThis.rncBoot;
  if (!rt) return;
  const on = perf.style.display === 'none';
  perf.style.display = on ? 'block' : 'none';
  rt.timing = rt.gs.timing = on ? { frames: 0, period: 0, gs: 0, world: 0 } : null;
  if (on) rt.gs.timing = rt.timing;
});
setInterval(() => {
  const t = globalThis.rncBoot?.timing;
  if (!t || !t.frames) return;
  const n = t.frames, frame = t.period / n;
  perf.textContent = `${(1000 / frame).toFixed(1)} fps   ${frame.toFixed(1)} ms/frame\nGS rasterizer ${(t.gs / n).toFixed(1)} ms\n3D world      ${(t.world / n).toFixed(1)} ms\ngame + page   ${Math.max(0, frame - (t.gs + t.world) / n).toFixed(1)} ms`;
  t.frames = 0; t.period = 0; t.gs = 0; t.world = 0;
}, 1000);
addEventListener('keydown', (event) => {
  if (event.code !== 'KeyF' || event.repeat) return;
  const stage = document.getElementById('stage');
  if (document.fullscreenElement) document.exitFullscreen?.(); else stage.requestFullscreen?.();
});
addEventListener('keydown', (event) => { if (KEYS[event.code]) { keys |= KEYS[event.code]; event.preventDefault(); } });
addEventListener('keyup', (event) => { if (KEYS[event.code]) keys &= ~KEYS[event.code]; });
const GAMEPAD = [PAD.cross, PAD.circle, PAD.square, PAD.triangle, PAD.l1, PAD.r1, PAD.l2, PAD.r2, PAD.select, PAD.start,
  0, 0, PAD.up, PAD.down, PAD.left, PAD.right];
// Analog sticks: keys (WASD or the arrows: left stick; IJKL: right stick) or a gamepad's axes.
// Packed as bytes right x, right y, left x, left y (0x80 centre, 0x00 up / left, 0xFF down / right).
const held = new Set();
addEventListener('keydown', (event) => held.add(event.code));
addEventListener('keyup', (event) => held.delete(event.code));
// Mouse look: click the picture to capture the mouse (Esc releases it); its movement drives the
// right stick, smoothed over a few frames. The PS2 game reads only the pad, so this is a mapping.
let mouseX = 0, mouseY = 0, lookX = 0, lookY = 0;
const MOUSE_GAIN = 0.045;
document.getElementById('stage').addEventListener('click', () => {
  if (document.pointerLockElement !== document.getElementById('stage')) document.getElementById('stage').requestPointerLock?.();
});
addEventListener('mousemove', (event) => {
  if (!document.pointerLockElement) return;
  mouseX += event.movementX; mouseY += event.movementY;
});
function mouseLook() {
  lookX = lookX * 0.5 + mouseX * MOUSE_GAIN * 0.5; lookY = lookY * 0.5 + mouseY * MOUSE_GAIN * 0.5;
  mouseX = 0; mouseY = 0;
  return [lookX, lookY];
}
function axisByte(value) { return Math.max(0, Math.min(255, Math.round(128 + value * 127))); }
function padSticks() {
  let lx = 0, ly = 0, rx = 0, ry = 0;
  if (held.has('KeyA') || held.has('ArrowLeft')) lx -= 1;
  if (held.has('KeyD') || held.has('ArrowRight')) lx += 1;
  if (held.has('KeyW') || held.has('ArrowUp')) ly -= 1;
  if (held.has('KeyS') || held.has('ArrowDown')) ly += 1;
  if (held.has('KeyJ')) rx -= 1;
  if (held.has('KeyL')) rx += 1;
  if (held.has('KeyI')) ry -= 1;
  if (held.has('KeyK')) ry += 1;
  const [mx, my] = mouseLook();
  rx += mx; ry += my;
  for (const pad of navigator.getGamepads?.() ?? []) {
    if (!pad || pad.axes.length < 4) continue;
    const dead = (v) => (Math.abs(v) < 0.15 ? 0 : v);
    lx += dead(pad.axes[0]); ly += dead(pad.axes[1]); rx += dead(pad.axes[2]); ry += dead(pad.axes[3]);
  }
  const c = (v) => Math.max(-1, Math.min(1, v));
  return (axisByte(c(rx)) | axisByte(c(ry)) << 8 | axisByte(c(lx)) << 16 | axisByte(c(ly)) << 24) >>> 0;
}

function padButtons() {
  let held = keys;
  for (const pad of navigator.getGamepads?.() ?? []) {
    if (!pad) continue;
    pad.buttons.forEach((button, index) => { if (button.pressed && GAMEPAD[index]) held |= GAMEPAD[index]; });
  }
  return held;
}

async function instantiate(url) {
  const { instance } = await WebAssembly.instantiateStreaming(fetch(url, { cache: 'no-cache' }), {});
  instance.exports._initialize?.();
  return instance.exports;
}

document.getElementById('disc').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  // Created here, inside the file-picker gesture, before any await: browsers only let audio start
  // from a user gesture. Any later key press or click also resumes it.
  const audioContext = new AudioContext();
  audioContext.resume().catch(() => {});
  const wake = () => { if (audioContext.state !== 'running') audioContext.resume().catch(() => {}); };
  addEventListener('keydown', wake);
  addEventListener('pointerdown', wake);
  try {
    say('Opening the disc image...');
    const reader = new IsoReader(file);
    await reader.open();
    const { entry } = await reader.verifyBoot();
    const elf = await reader.readFile(entry);
    say('Loading the GS rasterizer (gs-raster.wasm)...');
    await GsRenderer.loadNative(await (await fetch('./gs-raster.wasm', { cache: 'no-cache' })).arrayBuffer());
    say('Loading the boot program (boot.wasm)...');
    const [module, decoder, mpeg2] = await Promise.all([WebAssembly.compileStreaming(fetch('./boot.wasm', { cache: 'no-cache' })),
      instantiate('./planet-wad.wasm'), instantiate('./mpeg2.wasm')]);
    // The level's static world (world-renderer.mjs), loaded when the game enters Veldin.
    const loadWorld = async () => {
      const { WorldRenderer } = await import('./world-renderer.mjs');
      const [runtime, wad, planetWad] = await Promise.all([instantiate('./runtime.wasm'), instantiate('./wad.wasm'), instantiate('./planet-wad.wasm')]);
      runtime.runtime_init?.();
      return WorldRenderer.load(reader, { runtime, wad, planetWad }, document.getElementById('world'));
    };
    const image = context2d.createImageData(512, 416);
    let heroHidden = 0, worldHidden = 0;
    const report = (body) => fetch('/__report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {});
    let shown = 0;
    const runtime = await BootRuntime.create({
      module, reader, decoder, elf, padButtons, padSticks, mpeg2, audioContext, loadWorld,
      onMovieFrame: (rgba, width, height) => {
        const frame = width === 512 && height === 416 ? image : context2d.createImageData(width, height);
        frame.data.set(rgba);
        context2d.putImageData(frame, 0, 0);
      },
      onFrame: (rt) => {
        const picture = rt.picture(512, 416);
        const v = rt.view();
        const dispfb = v.getUint32(0x12000090, true) || v.getUint32(0x12000070, true);
        // The sky as it was at the first VU1 program start (boot-runtime.mjs), else at the world pass.
        // Layered while the game keeps running its world pass. A slow game frame can span several
        // vsyncs, so up to 20 frames since the last pass still count (the 3D layer blinking off,
        // hero and all, was the old 3-frame limit); the sky snapshot belongs with the latest pass.
        const bg = rt.skyLayer && rt.background && rt.skyLayer.frame >= rt.background.frame - 1 ? rt.skyLayer : rt.background;
        const layered = bg && rt.frames - bg.frame <= 20;
        void dispfb;
        worldCanvas.style.visibility = layered ? 'visible' : 'hidden';
        if (layered) {
          // Background: the frame as it was at the world pass. Foreground: every pixel the game
          // changed after it (HUD, text, effects); the rest is left transparent over the world.
          image.data.set(bg.rgba);
          const final32 = new Uint32Array(picture.buffer), bg32 = new Uint32Array(bg.rgba.buffer), out32 = new Uint32Array(frontImage.data.buffer);
          // Both come from the same draw buffer (the softening pass and the stretch to the display
          // buffer are skipped), so an unchanged pixel is exactly equal.
          for (let i = 0; i < out32.length; i++) { const a = final32[i]; out32[i] = a === bg32[i] ? 0 : a; }
          frontContext.putImageData(frontImage, 0, 0);
        } else {
          image.data.set(picture);
          frontContext.clearRect(0, 0, 512, 416);
        }
        context2d.putImageData(image, 0, 0);
        if (++shown % 60 === 0) say(`Running the game (${rt.program} program): frame ${rt.frames}.`);
        // Report the hero vanishing in gameplay: hidden for 30 frames in a row (once per spell).
        const heroStatus = layered ? rt.world?.heroStatus : null;
        if (heroStatus && heroStatus !== 'drawn' && !heroStatus.startsWith('hidden by the game')) {
          if (++heroHidden === 30) report({ message: `hero not drawn for 30 frames: ${heroStatus}`, frame: rt.frames, program: rt.program, kind: 'hero-hidden' });
        } else heroHidden = 0;
        // ... and the 3D layer switching off in a level (no world pass for more than 3 frames).
        if (rt.world && rt.program !== 'boot' && !layered) {
          if (++worldHidden === 30) report({ message: `3D world not drawn for 30 frames (last world pass at frame ${bg?.frame ?? '?'})`, frame: rt.frames, program: rt.program, kind: 'world-hidden' });
        } else worldHidden = 0;
      },
      onProgram: (program) => say(`The game loaded level ${program.level}'s program: switching to it (${program.url})...`),
      onMovie: (sector, bytes) => say(`Playing the game's movie (disc sector ${sector}, ${(bytes / 1048576).toFixed(1)} MB). Enter (START) skips.`),
    });
    globalThis.rncBoot = runtime; // for inspection from the console and page tests
    runtime.gs.skipFrameFeedback = true; // sharp picture, less GS work (gs-renderer.mjs)
    runtime.showDrawBuffer = true; // gameplay shows the draw buffer, not the stretched copy (boot-runtime.mjs)
    say('Running main...');
    await runtime.run();
    say('main returned.');
  } catch (error) {
    // Where the game stopped: the innermost WebAssembly functions (their names are the game's labels).
    // The stopping functions: Chrome writes "at level.wasm.NAME (...wasm-function...)", Safari "NAME@level.wasm:wasm-function[..]".
    const where = (error.stack ?? '').split('\n').map((line) => line.match(/at (?:\w+\.wasm\.)?([\w.$]+) \(.*wasm-function/)?.[1] ?? line.match(/^([\w.$]+)@[^@]*wasm-function/)?.[1]).filter(Boolean).slice(0, 6);
    say(`Stopped at frame ${globalThis.rncBoot?.frames ?? '?'} (${globalThis.rncBoot?.program ?? 'boot'} program): ${error.message}${where.length ? ` in ${where.join(' <- ')}` : ''}`);
    // Tell the local server (serve.py writes build/reports/stops.jsonl): the error, where it
    // stopped and where the hero stood, so the stop can be found again.
    try {
      const rt = globalThis.rncBoot, v = rt?.view?.();
      let hero = null;
      if (v && rt.program !== 'boot') {
        const start = v.getUint32(0x15FFD8, true), end = v.getUint32(0x15FFDC, true);
        for (let m = start; m && m < end; m += 0x100) if (v.getInt16(m + 0xA6, true) === 0) { hero = [0x10, 0x14, 0x18].map((o) => +v.getFloat32(m + o, true).toFixed(2)); break; }
      }
      fetch('/__report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        message: error.message, where, frame: rt?.frames, program: rt?.program, hero, stack: String(error.stack ?? '').slice(0, 4000),
      }) }).catch(() => {});
    } catch { /* reporting is best effort */ }
    console.error(error);
  }
});
