import assert from 'node:assert/strict';
import { openAsBlob } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { IsoReader } from './iso-reader.mjs';
import { initializeDiscTable } from './disc-loader.mjs';
import {
  findHeroStart, loadLevelGameplay, PLACED_MOBY_RECORD_BYTES, readPlacedMobys, VELDIN_LEVEL,
} from './gameplay-loader.mjs';

const runtimeModule = await WebAssembly.compile(await readFile(new URL('../build/browser/runtime.wasm', import.meta.url)));
const wadModule = await WebAssembly.compile(await readFile(new URL('../build/browser/wad.wasm', import.meta.url)));
const isoPath = process.env.RNC_ISO_PATH;

async function instantiate(module) {
  const instance = await WebAssembly.instantiate(module, {});
  instance.exports._initialize?.();
  return instance.exports;
}

function syntheticGameplay(records) {
  const table = 0x60;
  const bytes = new Uint8Array(table + 16 + records.length * PLACED_MOBY_RECORD_BYTES);
  const view = new DataView(bytes.buffer);
  view.setUint32(0x44, table, true);
  view.setInt32(table, records.length, true);
  view.setInt32(table + 4, 3, true);
  records.forEach((record, index) => {
    const offset = table + 16 + index * PLACED_MOBY_RECORD_BYTES;
    view.setInt32(offset, record.size ?? PLACED_MOBY_RECORD_BYTES, true);
    view.setInt32(offset + 0x04, record.mission, true);
    view.setInt32(offset + 0x0C, record.uid, true);
    view.setInt32(offset + 0x18, record.classId, true);
    view.setFloat32(offset + 0x1C, 1, true);
    record.position.forEach((value, axis) => view.setFloat32(offset + 0x30 + axis * 4, value, true));
    view.setFloat32(offset + 0x44, record.yaw ?? 0, true);
    view.setInt32(offset + 0x74, -1, true);
  });
  return bytes;
}

test('placed moby records follow the load_level_gameplay field layout', () => {
  const bytes = syntheticGameplay([
    { mission: -1, uid: 7, classId: 0, position: [1, 2, 3], yaw: 0.5 },
    { mission: 0, uid: 9, classId: 834, position: [4, 5, 6] },
  ]);
  const placed = readPlacedMobys(bytes);
  assert.equal(placed.count, 2);
  assert.equal(placed.extraSlots, 3);
  assert.equal(placed.end, bytes.length);
  assert.deepEqual(placed.mobys.map(moby => [moby.classId, moby.uid, moby.mission]), [[0, 7, -1], [834, 9, 0]]);
  assert.deepEqual(findHeroStart(placed), { position: [1, 2, 3], rotation: [0, 0, 0.5] });
});

test('placed moby parsing rejects truncated, undersized, and missing-hero data', () => {
  const good = syntheticGameplay([{ mission: -1, uid: 1, classId: 5, position: [0, 0, 0] }]);
  assert.throws(() => readPlacedMobys(good.subarray(0, good.length - 4)), /truncated/);
  assert.throws(() => readPlacedMobys(syntheticGameplay([{ mission: -1, uid: 1, classId: 5, position: [0, 0, 0], size: 8 }])),
    /record size/);
  const outside = good.slice();
  new DataView(outside.buffer).setUint32(0x44, outside.length, true);
  assert.throws(() => readPlacedMobys(outside), /outside/);
  assert.throws(() => findHeroStart(readPlacedMobys(good)), /hero start/);
});

test('level header reads are refused before the disc table is initialized', async () => {
  const api = await instantiate(runtimeModule);
  api.runtime_init();
  api.runtime_disc_reset();
  assert.equal(api.runtime_disc_level_header_sector(0), -1);
  assert.equal(api.runtime_disc_level_header_load(0, 5 * 2048), -1);
  assert.equal(api.runtime_disc_level_slot_sector(2), -1);
});

test('original level header reader resolves Veldin gameplay on the local disc', {
  skip: isoPath ? false : 'Set RNC_ISO_PATH for the local-disc check',
}, async () => {
  const [api, decoder] = await Promise.all([instantiate(runtimeModule), instantiate(wadModule)]);
  api.runtime_init();
  const reader = new IsoReader(await openAsBlob(isoPath));
  await reader.open();
  await initializeDiscTable(api, reader);
  assert.equal(api.runtime_disc_level_header_sector(VELDIN_LEVEL), 1885903);
  assert.equal(api.runtime_disc_level_header_sector(19), -1);
  const gameplay = await loadLevelGameplay(api, reader, decoder, VELDIN_LEVEL);
  assert.equal(api.runtime_disc_level_header_ready(), VELDIN_LEVEL);
  assert.equal(api.runtime_disc_guards_valid(), 1);
  assert.deepEqual([gameplay.sector, gameplay.count], [1892470, 210]);
  assert.deepEqual([api.runtime_disc_level_slot_sector(3), api.runtime_disc_level_slot_count(3)], [1892680, 210]);
  assert.equal(gameplay.bytes.length, 1113280);
  const placed = gameplay.mobys;
  assert.equal(placed.count, 296);
  assert.equal(placed.end, new DataView(gameplay.bytes.buffer).getUint32(0x54, true));
  assert.ok(placed.mobys.every(moby => moby.mission === -1 || moby.mission === 0));
  const start = findHeroStart(placed);
  assert.deepEqual(start.position.map(value => Math.round(value * 10) / 10), [132.1, 115.5, 31.4]);
  const clank = placed.mobys.filter(moby => moby.classId === 834);
  assert.equal(clank.length, 1);
  assert.deepEqual(clank[0].position.map(value => Math.round(value)), [171, 271, 29]);
});
