import assert from 'node:assert/strict';
import { openAsBlob } from 'node:fs';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { IsoReader } from './iso-reader.mjs';
import { initializePlanetCollision, loadPlanetCore, VELDIN_ARCHIVE } from './level-loader.mjs';
import { HeroSwingState, readHeroAnimationRig, sampleHeroAnimationFrame } from './moby-animation.mjs';
import { readMobyGeometry } from './moby-geometry.mjs';

async function native(name = 'hero-locomotion') {
  const module = await WebAssembly.compile(await readFile(new URL(`../build/browser/${name}.wasm`, import.meta.url)));
  assert.equal(WebAssembly.Module.imports(module).length, 0);
  const api = (await WebAssembly.instantiate(module, {})).exports;
  api._initialize();
  return api;
}

function close(actual, expected) { assert.ok(Math.abs(actual - expected) < 0.00002, `${actual} != ${expected}`); }

test('gameplay frame markers map to interpolated pose time instead of seconds times 60', () => {
  const frames = [{ sourceFrame: 11, rate: 0.25 }, { sourceFrame: 13, rate: 0.5 },
    { sourceFrame: 14, rate: 0.5 }];
  close(sampleHeroAnimationFrame(frames, 0).sourceFrame, 11);
  close(sampleHeroAnimationFrame(frames, 1 / 30).sourceFrame, 12);
  close(sampleHeroAnimationFrame(frames, 1 / 15).sourceFrame, 13);
  close(sampleHeroAnimationFrame(frames, 1).sourceFrame, 14);
});

test('ground swing adapter bounds queued combos and clears canceled or completed attacks', () => {
  const swing = new HeroSwingState();
  assert.equal(swing.request(true), true);
  assert.equal(swing.sequence, 23);
  swing.finish(7, true);
  assert.equal(swing.sequence, 23);
  for (const next of [24, 25, 23]) {
    for (let press = 0; press < 10; press++) swing.request(true);
    const previous = swing.sequence;
    swing.finish(previous, true);
    assert.equal(swing.sequence, next);
    assert.equal(swing.queued, false);
    swing.finish(previous, true);
    assert.equal(swing.sequence, next);
  }
  swing.finish(23, true);
  assert.equal(swing.sequence, undefined);
  swing.request(true);
  swing.request(true);
  swing.finish(23, false);
  assert.equal(swing.sequence, undefined);
  assert.equal(swing.queued, false);
  swing.request(true);
  swing.request(true);
  swing.reset();
  assert.equal(swing.sequence, undefined);
  assert.equal(swing.queued, false);
});

test('airborne attacks select slam, survive held jump and clip completion, and recover on landing', () => {
  const swing = new HeroSwingState();
  assert.equal(swing.request(false), true);
  assert.equal(swing.sequence, 43);
  for (let frame = 0; frame < 60; frame++) swing.update(false);
  assert.equal(swing.sequence, 43);
  assert.equal(swing.request(false), false);
  assert.equal(swing.queued, false);
  swing.finish(23, false);
  assert.equal(swing.sequence, 43);
  swing.finish(43, false);
  assert.equal(swing.sequence, 43);
  swing.update(true);
  assert.equal(swing.sequence, undefined);
  swing.request(false);
  swing.update(true);
  assert.equal(swing.sequence, 43);
  swing.finish(43, true);
  assert.equal(swing.sequence, undefined);
  swing.request(true);
  swing.update(false);
  assert.equal(swing.sequence, undefined);
  swing.request(true);
  swing.request(false);
  assert.equal(swing.sequence, 43);
  swing.reset();
  assert.equal(swing.sequence, undefined);
});

function stage(api, bytes) {
  api.runtime_collision_reset();
  new Uint8Array(api.memory.buffer, api.runtime_collision_stage_address(), bytes.length).set(bytes);
  return api.runtime_collision_load(bytes.length);
}

function fixture(wall = false) {
  const bytes = new Uint8Array(128), view = new DataView(bytes.buffer);
  view.setUint32(0, 64, true);
  view.setUint16(66, 1, true);
  view.setUint16(68, 2, true);
  view.setUint16(74, 1, true);
  view.setUint32(76, 16, true);
  view.setUint16(82, 1, true);
  view.setUint32(84, (32 << 8) | 2, true);
  view.setUint16(96, 1, true);
  bytes[98] = 4;
  bytes[99] = 1;
  const positions = wall
    ? [[0, -16, -64], [0, 16, -64], [0, 16, 64], [0, -16, 64]]
    : [[-16, -16, 0], [16, -16, 0], [16, 16, 0], [-16, 16, 0]];
  positions.forEach((point, index) => view.setUint32(100 + index * 4,
    (point[0] & 1023) | ((point[1] & 1023) << 10) | ((point[2] & 4095) << 20), true));
  bytes.set([3, 2, 1, 7, 0], 116);
  return bytes;
}

function crouchTunnel() {
  const bytes = new Uint8Array(160), view = new DataView(bytes.buffer);
  bytes.set(fixture());
  view.setUint32(84, (32 << 8) | 3, true);
  view.setUint16(96, 2, true);
  bytes[98] = 8;
  bytes[99] = 2;
  for (let vertex = 0; vertex < 4; vertex++) {
    view.setUint32(116 + vertex * 4, view.getUint32(100 + vertex * 4, true) | (72 << 20), true);
  }
  bytes.set([3, 2, 1, 7, 7, 6, 5, 7, 0, 4], 132);
  return bytes;
}

test('native crouch stops, releases, blocks standing/jumping under ceilings, and resets', async () => {
  const api = await native();
  assert.equal(api.runtime_hero_control_crouch(1), -1);
  assert.equal(api.runtime_hero_control_crouch(2), -2);
  assert.equal(stage(api, fixture()), 1);
  assert.equal(api.runtime_hero_control_reset(2, 2, 2), 0);
  api.runtime_hero_control_step(0, 0, 0, 0);
  assert.equal(api.runtime_hero_control_crouch(1), 0);
  for (let frame = 0; frame < 40; frame++) api.runtime_hero_control_step(1, 0, 0, 0);
  assert.equal(api.runtime_hero_control_crouched(), 1);
  close(api.runtime_hero_collision_position(0), 2);
  close(api.runtime_hero_locomotion_speed(), 0);
  assert.equal(stage(api, crouchTunnel()), 1);
  assert.equal(api.runtime_hero_control_crouch(0), 0);
  for (let frame = 0; frame < 40; frame++) api.runtime_hero_control_step(0, 0, 0, 0);
  assert.equal(api.runtime_hero_control_crouched(), 1);
  api.runtime_hero_control_step(0, 0, 1, 0);
  assert.equal(api.runtime_hero_control_grounded(), 1);
  close(api.runtime_hero_collision_position(2), 2.00002);
  assert.equal(stage(api, fixture()), 1);
  api.runtime_hero_control_step(0, 0, 0, 0);
  assert.equal(api.runtime_hero_control_crouched(), 0);
  api.runtime_hero_control_crouch(1);
  api.runtime_hero_control_step(0, 0, 0, 0);
  api.runtime_hero_control_step(0, 0, 1, 0);
  assert.equal(api.runtime_hero_control_crouched(), 0);
  assert.equal(api.runtime_hero_control_grounded(), 0);
  assert.ok(api.runtime_hero_collision_position(2) > 2.1);
  api.runtime_hero_control_reset(2, 2, 2);
  api.runtime_hero_control_step(0, 0, 0, 0);
  assert.equal(api.runtime_hero_control_crouched(), 0);
  assert.equal(api.runtime_collision_guards_valid(), 1);
  const swing = new HeroSwingState();
  assert.equal(swing.request(true, true), true);
  assert.equal(swing.sequence, 26);
  assert.equal(swing.request(true, true), false);
  swing.finish(26, true);
  assert.equal(swing.sequence, undefined);
});

test('native capsules and spheres resolve floors, walls, edges, and separation', async () => {
  const api = await native();
  assert.equal(stage(api, fixture()), 1);
  for (const [posX, posY] of [[1.25, 1.25], [2.75, 2.75], [1.25, 2.75], [2.75, 1.25]]) {
    assert.equal(api.runtime_collision_capsule(posX, posY, 2.25, 1, 0.5), 1);
    close(api.runtime_collision_hit_position(2), 2.50001);
    close(api.runtime_collision_hit_normal(2), 1);
    assert.equal(api.runtime_collision_hit_material(), 7);
  }
  assert.equal(api.runtime_collision_capsule(2, 2, 2.6, 1, 0.5), 0);
  assert.equal(api.runtime_collision_hit_material(), -1);
  assert.equal(api.runtime_collision_capsule(2, 2, 1.75, 0, 0.5), 1);
  close(api.runtime_collision_hit_position(2), 1.49999);
  assert.equal(api.runtime_collision_capsule(3.2, 3.2, 2.2, 0, 0.5), 1);
  close(Math.hypot(...[0, 1, 2].map(axis => api.runtime_collision_hit_normal(axis))), 1);
  assert.equal(api.runtime_collision_capsule(4, 4, 2.2, 1, 0.5), 0);
  assert.equal(api.runtime_collision_capsule(2, 2, 2, 1, NaN), -2);
  assert.equal(api.runtime_collision_segment(2, 2, 10, 2, 2, -10), 1);
  close(api.runtime_collision_hit_point(2), 2);
  assert.equal(stage(api, fixture(true)), 1);
  assert.equal(api.runtime_collision_capsule(2.25, 2, 1.5, 1, 0.5), 1);
  close(api.runtime_collision_hit_position(0), 2.50001);
  close(api.runtime_collision_hit_normal(0), 1);
});

test('original C resolver updates Hero, preserves misses, and queries hero groups', async () => {
  const api = await native();
  assert.equal(api.runtime_hero_collision_probe(2, 2, 2.25, 0.5, 1), -1);
  assert.equal(stage(api, fixture()), 1);
  assert.equal(api.runtime_hero_collision_probe(2, 2, 2.25, 0.5, 1), 1);
  close(api.runtime_hero_collision_position(2), 2.50001);
  assert.equal(api.runtime_hero_collision_wall_hit(), 1);
  assert.equal(api.runtime_hero_collision_probe(2, 2, 3, 0.5, 1), 1);
  assert.equal(api.runtime_hero_collision_position(2), 3);
  assert.equal(api.runtime_hero_collision_wall_hit(), 0);
  assert.equal(api.runtime_hero_collision_probe(2, 2, 1048576, 0.5, 1), -2);
  const bytes = new Uint8Array(160), view = new DataView(bytes.buffer);
  view.setUint32(0, 64, true);
  view.setUint32(4, 80, true);
  view.setUint32(80, 1, true);
  for (const offset of [96, 98, 100, 102]) view.setUint16(offset, 128, true);
  view.setUint16(104, 1, true);
  view.setUint16(106, 3, true);
  view.setUint32(108, 32, true);
  [[1, 1, 2], [3, 1, 2], [1, 3, 2]].forEach((point, index) => {
    point.forEach((value, axis) => view.setUint16(112 + index * 8 + axis * 2, value * 64, true));
  });
  bytes.set([2, 1, 0, 0], 136);
  assert.equal(stage(api, bytes), 1);
  assert.equal(api.runtime_hero_collision_probe(1.5, 1.5, 2.25, 0.5, 1), 1);
  close(api.runtime_hero_collision_position(2), 2.50001);
  assert.equal(api.runtime_hero_collision_wall_hit(), 1);
  bytes[136] = 3;
  assert.ok(stage(api, bytes) < 0);
  assert.equal(api.runtime_hero_collision_probe(1.5, 1.5, 2.25, 0.5, 1), -1);
  assert.equal(api.runtime_collision_guards_valid(), 1);
});

test('native hero controls walk, jump, land, reject held-jump repeats, and stop at walls', async () => {
  const api = await native();
  assert.equal(api.runtime_hero_control_step(0, 0, 0, 0), -1);
  assert.equal(stage(api, fixture()), 1);
  assert.equal(api.runtime_hero_control_reset(2, 2, 2), 0);
  assert.equal(api.runtime_hero_control_step(NaN, 0, 0, 0), -2);
  assert.equal(api.runtime_hero_control_step(0, 0, 0, 0), 0);
  assert.equal(api.runtime_hero_control_grounded(), 1);
  assert.equal(api.runtime_hero_control_step(0, 0, 1, 0), 0);
  const takeoff = api.runtime_hero_collision_position(2);
  assert.ok(takeoff > 2.1);
  let apex = takeoff;
  for (let frame = 0; frame < 100; frame++) {
    assert.equal(api.runtime_hero_control_step(0, 0, 1, 0), 0);
    apex = Math.max(apex, api.runtime_hero_collision_position(2));
  }
  assert.ok(apex > 3.2 && apex < 3.6);
  assert.equal(api.runtime_hero_control_grounded(), 1);
  assert.ok(Math.abs(api.runtime_hero_collision_position(2) - 2) < 0.001);
  api.runtime_hero_control_step(0, 0, 0, 0);
  api.runtime_hero_control_step(0, 0, 1, 0);
  assert.ok(api.runtime_hero_collision_position(2) > 2.1);
  api.runtime_hero_control_reset(2, 2, 12);
  for (let frame = 0; frame < 180; frame++) api.runtime_hero_control_step(0, 0, 0, 0);
  assert.equal(api.runtime_hero_control_grounded(), 1);
  assert.ok(Math.abs(api.runtime_hero_collision_position(2) - 2) < 0.001);
  api.runtime_hero_control_reset(2, 2, 2);
  for (let frame = 0; frame < 10; frame++) api.runtime_hero_control_step(1, 0, 0, 0);
  assert.ok(api.runtime_hero_collision_position(0) > 2.2);
  api.runtime_hero_control_reset(2, 2, 2);
  for (let frame = 0; frame < 40; frame++) api.runtime_hero_control_step(1, 1, 0, 0);
  close(Math.hypot(api.runtime_hero_locomotion_velocity(0), api.runtime_hero_locomotion_velocity(1)), 5.7 / 60);
  assert.equal(stage(api, fixture(true)), 1);
  assert.equal(api.runtime_hero_control_reset(2.7, 2, 1.5), 0);
  for (let frame = 0; frame < 10; frame++) api.runtime_hero_control_step(-1, 0, 0, 0);
  assert.ok(api.runtime_hero_collision_position(0) >= 2.24);
  assert.equal(api.runtime_collision_guards_valid(), 1);
});

test('native double jump requires a fresh press, rejects a third jump, retimes poses, and resets on landing', async () => {
  const api = await native();
  stage(api, fixture());
  api.runtime_hero_control_reset(2, 2, 2);
  api.runtime_hero_control_step(0, 0, 0, 0);
  api.runtime_hero_control_step(0, 0, 1, 0);
  let time = 0, apexMarker;
  for (let frame = 0; frame < 24; frame++) {
    const rate = api.runtime_hero_jump_animation_speed(time * 30, 0.25);
    assert.ok(Number.isFinite(rate) && rate > 0);
    time += rate / 60;
    api.runtime_hero_control_step(0, 0, 1, 0);
    if (api.runtime_hero_locomotion_velocity(2) <= 0 && apexMarker === undefined) apexMarker = time * 30;
  }
  assert.ok(apexMarker > 16 && apexMarker < 21, `Apex marker ${apexMarker}`);
  assert.equal(api.runtime_hero_control_jump_count(), 1);
  api.runtime_hero_control_jump_release();
  const before = api.runtime_hero_collision_position(2);
  api.runtime_hero_control_step(0, 0, 1, 0);
  assert.equal(api.runtime_hero_control_jump_count(), 2);
  assert.ok(api.runtime_hero_collision_position(2) > before + 0.1);
  assert.ok(api.runtime_hero_jump_animation_speed(3, 0.25) > 0);
  assert.ok(Number.isNaN(api.runtime_hero_jump_animation_speed(NaN, 0.25)));
  api.runtime_hero_control_step(0, 0, 0, 0);
  const velocity = api.runtime_hero_locomotion_velocity(2);
  api.runtime_hero_control_step(0, 0, 1, 0);
  assert.ok(api.runtime_hero_locomotion_velocity(2) < velocity);
  assert.equal(api.runtime_hero_control_jump_count(), 2);
  let apex = before;
  for (let frame = 0; frame < 150; frame++) {
    api.runtime_hero_control_step(0, 0, 1, 0);
    apex = Math.max(apex, api.runtime_hero_collision_position(2));
  }
  assert.ok(apex > 4.2 && apex < 5.1);
  assert.equal(api.runtime_hero_control_grounded(), 1);
  assert.equal(api.runtime_hero_control_jump_count(), 0);
  close(api.runtime_hero_collision_position(2), 2.00002);
  api.runtime_hero_control_step(0, 0, 0, 0);
  api.runtime_hero_control_step(0, 0, 1, 0);
  assert.equal(api.runtime_hero_control_jump_count(), 1);
  api.runtime_hero_control_reset(2, 2, 2);
  assert.equal(api.runtime_hero_control_jump_count(), 0);
});

test('native airborne slam rises, drops, lands safely, and resets without held-jump repeats', async () => {
  const api = await native();
  assert.equal(api.runtime_hero_control_slam(1), -1);
  assert.equal(api.runtime_hero_control_slam(2), -2);
  assert.equal(stage(api, fixture()), 1);
  assert.equal(api.runtime_hero_control_reset(2, 2, 2), 0);
  api.runtime_hero_control_step(0, 0, 0, 0);
  assert.equal(api.runtime_hero_control_slam(1), 1);
  api.runtime_hero_control_step(0, 0, 1, 0);
  assert.equal(api.runtime_hero_control_slam(1), 0);
  assert.equal(api.runtime_hero_control_slam(1), 1);
  close(api.runtime_hero_slam_animation_speed(11, 0.25), 0.33);
  assert.ok(Number.isNaN(api.runtime_hero_slam_animation_speed(NaN, 0.25)));
  let animationTime = 0, landingFrame;
  let apex = api.runtime_hero_collision_position(2), descending = false;
  for (let frame = 0; frame < 120; frame++) {
    const height = api.runtime_hero_collision_position(2);
    assert.equal(api.runtime_hero_control_step(0, 0, 1, 0), 0);
    const next = api.runtime_hero_collision_position(2);
    assert.ok(next >= 1.999 && next - height >= -0.301);
    apex = Math.max(apex, next);
    descending ||= next < height - 0.01;
    const sourceFrame = 11 + animationTime * 30;
    const rate = api.runtime_hero_slam_animation_speed(sourceFrame, 0.25);
    assert.ok(Number.isFinite(rate) && rate > 0);
    animationTime += rate / 60;
    if (landingFrame === undefined && api.runtime_hero_control_grounded()) landingFrame = sourceFrame;
  }
  assert.ok(landingFrame > 23 && landingFrame < 29, `Impact frame ${landingFrame}`);
  assert.ok(apex > 3 && apex < 6);
  assert.equal(descending, true);
  assert.equal(api.runtime_hero_control_grounded(), 1);
  assert.ok(Math.abs(api.runtime_hero_collision_position(2) - 2) < 0.001);
  api.runtime_hero_control_step(0, 0, 0, 0);
  api.runtime_hero_control_step(0, 0, 1, 0);
  assert.equal(api.runtime_hero_control_slam(1), 0);
  assert.equal(api.runtime_hero_control_reset(2, 2, 2), 0);
  api.runtime_hero_control_step(0, 0, 0, 0);
  assert.equal(api.runtime_hero_control_grounded(), 1);
  assert.equal(api.runtime_hero_control_slam(0), 0);
  assert.equal(api.runtime_collision_guards_valid(), 1);
});

test('real Veldin assets drive native collision and original weighted hero clips', { skip: !process.env.RNC_ISO_PATH }, async () => {
  const reader = new IsoReader(await openAsBlob(process.env.RNC_ISO_PATH));
  await reader.open();
  const planet = await loadPlanetCore(reader, await native('planet-wad'), VELDIN_ARCHIVE);
  const api = await native();
  assert.equal(initializePlanetCollision(planet, api).cells, 5783);
  assert.equal(api.runtime_collision_segment(100, 180, 90, 100, 180, 0), 1);
  const ground = api.runtime_collision_hit_point(2);
  assert.equal(api.runtime_hero_collision_probe(100, 180, ground + 0.25, 0.5, 1), 1);
  assert.ok(api.runtime_hero_collision_position(2) > ground + 0.45);
  assert.equal(api.runtime_hero_collision_wall_hit(), 1);
  assert.equal(api.runtime_collision_guards_valid(), 1);
  const rig = readHeroAnimationRig(planet);
  assert.equal(rig.jointCount, 111);
  assert.deepEqual([...rig.clips.keys()], [0, 4, 7, 13, 22, 23, 24, 25, 26, 43]);
  assert.deepEqual([0, 4, 7].map(id => rig.clips.get(id).length), [10, 23, 29]);
  const slamDuration = rig.clips.get(43).slice(0, -1).reduce((time, frame) => time + 1 / (60 * frame.rate), 0);
  assert.ok(slamDuration > 26 / 60);
  close(sampleHeroAnimationFrame(rig.clips.get(43), 0.5).sourceFrame, 26);
  for (const frames of rig.clips.values()) {
    assert.ok(frames.slice(1).some(frame => frame.rotations.some((value, index) =>
      Math.abs(value - frames[0].rotations[index]) > 0.01)));
    for (const frame of frames) {
      assert.ok([...frame.positions, ...frame.scales].every(Number.isFinite));
      for (let joint = 0; joint < rig.jointCount; joint++) {
        assert.ok(Math.abs(Math.hypot(...frame.rotations.subarray(joint * 4, joint * 4 + 4)) - 1) < 0.000001);
      }
    }
  }
  assert.ok(rig.clips.get(0)[0].rotations[4] > 0);
  assert.ok(rig.clips.get(0)[0].rotations[5] < 0);
  const geometry = readMobyGeometry(planet), joints = new Set();
  assert.equal(geometry.triangles, 6856);
  for (const batch of geometry.batches) {
    assert.equal(batch.joints.length, batch.positions.length / 3 * 4);
    assert.equal(batch.weights.length, batch.joints.length);
    for (let vertex = 0; vertex < batch.weights.length; vertex += 4) {
      assert.ok(Math.abs(batch.weights.subarray(vertex, vertex + 4).reduce((sum, weight) => sum + weight, 0) - 1) < 0.000001);
      for (let influence = 0; influence < 4; influence++) {
        assert.ok(batch.joints[vertex + influence] < rig.jointCount);
        if (batch.weights[vertex + influence] > 0) joints.add(batch.joints[vertex + influence]);
      }
    }
  }
  assert.equal(joints.size, 107);
  const header = planet.header.slice();
  new DataView(header.buffer).setUint32(120, 0xFFFFFFFF, true);
  assert.throws(() => readHeroAnimationRig({ ...planet, header }), /animation table/);
});