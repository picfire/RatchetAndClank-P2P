import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { openAsBlob } from 'node:fs';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { IsoReader } from './iso-reader.mjs';
import { decodeBootArchive, decodeResidentArchive, initializeDiscTable, inspectBootModules, inspectResidentArchive } from './disc-loader.mjs';

const binary = await readFile(new URL('../build/browser/wad.wasm', import.meta.url));
const module = await WebAssembly.compile(binary);

async function runtime() {
  const instance = await WebAssembly.instantiate(module, {});
  instance.exports._initialize();
  instance.exports.wad_reset();
  return instance.exports;
}

function archive(packets) {
  const bytes = new Uint8Array(16 + packets.length);
  bytes.set([87, 65, 68]);
  new DataView(bytes.buffer).setUint32(3, bytes.length, true);
  bytes.set(packets, 16);
  return bytes;
}

function decode(api, bytes, capacity = api.wad_output_capacity()) {
  new Uint8Array(api.memory.buffer, api.wad_input_address(), bytes.length).set(bytes);
  return api.wad_decode(bytes.length, capacity);
}

function output(api) {
  return new Uint8Array(api.memory.buffer, api.wad_output_address(), api.wad_output_size());
}

test('bounded source decoder has no host imports and decodes literals and overlapping matches', async () => {
  assert.deepEqual(WebAssembly.Module.imports(module), []);
  const api = await runtime();
  assert.equal(decode(api, archive([1, 65, 66, 67, 68, 0x40, 0])), 7);
  assert.equal(new TextDecoder().decode(output(api)), 'ABCDDDD');
  assert.equal(api.wad_ready(), 1);
  assert.equal(api.wad_guards_valid(), 1);
});

test('preflight rejects incomplete packets, invalid history and capacity before output writes', async () => {
  const api = await runtime();
  for (const [packets, capacity, error] of [
    [[1, 65], 100, -2],
    [[0x40, 0], 100, -3],
    [[1, 65, 66, 67, 68, 0x40, 0], 6, -4],
    [[1, 65, 66, 67, 68, 1, 69, 70, 71, 72], 100, -5],
    [[0x12, 0, 0], 100, -6],
  ]) {
    assert.equal(decode(api, archive(packets), capacity), error);
    assert.equal(api.wad_ready(), 0);
    assert.equal(api.wad_output_size(), 0);
    assert.deepEqual(new Uint8Array(api.memory.buffer, api.wad_output_address(), 16), new Uint8Array(16));
    assert.equal(api.wad_guards_valid(), 1);
  }
});

function literalHistory(bytes) {
  const packets = [];
  for (let offset = 0; offset < bytes.length;) {
    const count = Math.min(273, bytes.length - offset);
    if (offset) packets.push(0x11, 0, 0);
    if (count < 4) packets.push(0x11, count, 0);
    else if (count <= 18) packets.push(count - 3);
    else packets.push(0, count - 18);
    packets.push(...bytes.subarray(offset, offset + count));
    offset += count;
  }
  return packets;
}

test('all literal lengths and dummy literals decode exactly', async () => {
  const api = await runtime();
  for (const count of [0, 1, 2, 3, 4, 18, 19, 273, 274, 546]) {
    const bytes = Uint8Array.from({ length: count }, (_, index) => index % 251);
    assert.equal(decode(api, archive(literalHistory(bytes)), count), count);
    assert.deepEqual(output(api), bytes);
  }
});

test('short, medium, extended and both far match windows reproduce history', async () => {
  const api = await runtime();
  for (const [packet, distance, count] of [
    [[0xFC, 255], 2048, 8],
    [[0x23, 0, 0], 1, 5],
    [[0x3F, 252, 255], 16384, 33],
    [[0x20, 255, 0, 0], 1, 288],
    [[0x11, 4, 0], 16385, 3],
    [[0x10, 255, 4, 0], 16385, 264],
    [[0x19, 0, 0], 32768, 3],
    [[0x1F, 252, 255], 49151, 9],
  ]) {
    const history = Uint8Array.from({ length: distance }, (_, index) => index % 251);
    const expected = new Uint8Array(distance + count);
    expected.set(history);
    for (let index = distance; index < expected.length; index++) expected[index] = expected[index - distance];
    assert.equal(decode(api, archive([...literalHistory(history), ...packet]), expected.length), expected.length);
    assert.deepEqual(output(api), expected);
    assert.equal(api.wad_guards_valid(), 1);
  }
});

test('attached literals and block padding preserve the packet cursor', async () => {
  const api = await runtime();
  for (const packet of [[0x43, 0], [0x21, 3, 0], [0x11, 3, 0]]) {
    const bytes = archive([1, 65, 66, 67, 68, ...packet, 88, 89, 90]);
    const expected = packet[0] === 0x11 ? 'ABCDXYZ' : 'ABCDDDDXYZ';
    assert.equal(decode(api, bytes), expected.length);
    assert.equal(new TextDecoder().decode(output(api)), expected);
  }
  const packets = new Uint8Array(4096 + 6).fill(0xEE);
  packets.set([0x12, 0, 0]);
  packets.set([0x11, 3, 0, 65, 66, 67], 4096);
  assert.equal(decode(api, archive(packets)), 3);
  assert.equal(new TextDecoder().decode(output(api)), 'ABC');
});

test('bad headers, output limits and guard damage fail without publishing stale bytes', async () => {
  const api = await runtime();
  const valid = archive([1, 65, 66, 67, 68]);
  assert.equal(decode(api, valid), 4);
  const invalid = valid.slice();
  invalid[0] = 0;
  assert.equal(decode(api, invalid), -1);
  assert.equal(api.wad_ready(), 0);
  assert.equal(api.wad_output_size(), 0);
  assert.deepEqual(new Uint8Array(api.memory.buffer, api.wad_output_address(), 4), new Uint8Array(4));
  for (const size of [0, 15, 16, valid.length + 1, 0xFFFFFFFF]) {
    const bytes = valid.slice();
    new DataView(bytes.buffer).setUint32(3, size, true);
    const result = decode(api, bytes);
    assert.equal(result, size === 16 ? 0 : -1);
  }
  assert.equal(decode(api, valid, api.wad_output_capacity() + 1), -1);
  assert.equal(api.wad_decode(api.wad_input_capacity() + 1, 100), -1);
  for (const address of [api.wad_input_address() + api.wad_input_capacity(), api.wad_output_address() + api.wad_output_capacity()]) {
    new Uint8Array(api.memory.buffer)[address] = 0;
    assert.equal(decode(api, valid), -7);
    api.wad_reset();
    assert.equal(decode(api, valid), 4);
  }
});

test('deterministic malformed packet streams cannot escape fixed buffers', async () => {
  const api = await runtime();
  let seed = 0x12345678;
  for (let trial = 0; trial < 500; trial++) {
    const packets = Uint8Array.from({ length: trial % 129 }, () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed >>> 24;
    });
    const result = decode(api, archive(packets), 4096);
    assert.equal(api.wad_guards_valid(), 1);
    assert.equal(api.wad_ready(), result >= 0 ? 1 : 0);
    assert.equal(api.wad_output_size(), result >= 0 ? result : 0);
  }
});

const isoPath = process.env.RNC_ISO_PATH;
const referencePath = process.env.RNC_WAD_REFERENCE_PATH;

function residentFixture() {
  const bytes = new Uint8Array(0x200);
  const view = new DataView(bytes.buffer);
  for (const [offset, value] of [
    [0, 0x100], [4, 0x180], [8, 1], [0xC, 0x120],
    [0x10, 1], [0x14, 0xA0], [0x18, 2], [0x1C, 0x80], [0x30, 0x20],
  ]) view.setInt32(offset, value, true);
  return bytes;
}

test('resident header uses source-owned offsets and bounds fixed-size class tables', () => {
  const bytes = residentFixture();
  const padded = new Uint8Array(bytes.length + 3);
  padded.set(bytes, 3);
  assert.deepEqual(inspectResidentArchive(padded.subarray(3)), {
    dataOffset: 0x180, textureCount: 1, textureOffset: 0x100, textureInfoOffset: 0x120,
    classDataOffset: 0x1A0, skyOffset: 0x180,
    mobyClasses: { count: 1, offset: 0xA0, stride: 0x20 },
    textureClasses: { count: 2, offset: 0x80, stride: 0x10 },
  });
  assert.throws(() => inspectResidentArchive(bytes.subarray(0, 0x67)), /too short/);
  for (const [offset, value] of [
    [4, -1], [4, 0x200], [8, -1], [0, 0x200], [0xC, 0],
    [0x10, -1], [0x10, 0x7FFFFFFF], [0x14, 0x1F0],
    [0x18, -1], [0x1C, 0x1F0], [0x30, -0x180], [0x48, 0x80],
  ]) {
    const invalid = bytes.slice();
    new DataView(invalid.buffer).setInt32(offset, value, true);
    assert.throws(() => inspectResidentArchive(invalid), /outside|negative/);
  }
});

function bootFixture() {
  const bytes = new Uint8Array(0xC0 + 9 * 52);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < 9; index++) {
    const offset = 0xC0 + index * 52;
    view.setUint32(0x70 + index * 8, offset, true);
    view.setUint32(0x74 + index * 8, 52, true);
    bytes.set([0x7F, 69, 76, 70, 1, 1], offset);
    view.setUint16(offset + 18, 8, true);
  }
  return bytes;
}

test('decoded boot module table rejects invalid ranges and module identities', () => {
  assert.equal(inspectBootModules(bootFixture()).length, 9);
  assert.throws(() => inspectBootModules(new Uint8Array(100)), /too short/);
  for (const [offset, value] of [[0x70, 0xFFFFFFFF], [0x74, 0xFFFFFFFF], [0x70, 0], [0x74, 0]]) {
    const bytes = bootFixture();
    new DataView(bytes.buffer).setUint32(offset, value, true);
    assert.throws(() => inspectBootModules(bytes), /outside/);
  }
  const invalid = bootFixture();
  invalid[0xC0] = 0;
  assert.throws(() => inspectBootModules(invalid), /ELF32/);
});

test('boot bridge clears failures and cancellation without overwriting newer output', async () => {
  const api = await runtime();
  const compressed = new Uint8Array(2048);
  compressed.set(archive(literalHistory(bootFixture())));
  const entry = { sector: 1, count: 1 };
  const reader = { opened: true, readSectors: async () => compressed };
  const result = await decodeBootArchive(api, reader, entry);
  assert.equal(result.bytes, bootFixture().length);
  assert.equal(result.modules.length, 9);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(decodeBootArchive(api, reader, entry, abort.signal), { name: 'AbortError' });
  assert.equal(api.wad_ready(), 0);
  await assert.rejects(decodeBootArchive(api, reader, { sector: -1, count: 1 }), /Invalid/);
  await assert.rejects(decodeBootArchive(api, reader, { sector: 1, count: 513 }), /Invalid/);
  await assert.rejects(decodeBootArchive(api, { ...reader, readSectors: async () => new Uint8Array(1) }, entry), /Incomplete/);
  await assert.rejects(decodeBootArchive(api, { ...reader, readSectors: async () => new Uint8Array(2048) }, entry), /decoding failed/);
  let release;
  const old = decodeBootArchive(api, { ...reader, readSectors: () => new Promise(resolve => { release = resolve; }) }, entry);
  const rejected = assert.rejects(old, { name: 'AbortError' });
  await decodeBootArchive(api, reader, entry);
  release(compressed);
  await rejected;
  assert.equal(api.wad_ready(), 1);
  assert.deepEqual(output(api), bootFixture());
});

async function skyRuntime() {
  const nativeModule = await WebAssembly.compile(await readFile(new URL('../build/browser/runtime.wasm', import.meta.url)));
  assert.deepEqual(WebAssembly.Module.imports(nativeModule), []);
  const api = (await WebAssembly.instantiate(nativeModule, {})).exports;
  api._initialize();
  api.runtime_init();
  api.runtime_sky_reset();
  return api;
}

function skyFixture() {
  const bytes = new Uint8Array(0x200);
  const view = new DataView(bytes.buffer);
  view.setUint16(0x46, 1, true);
  view.setUint16(0x4C, 1, true);
  for (const [offset, value] of [
    [0x50, 0x30], [0x54, 0xC0], [0x58, 0xD0], [0x60, 0x40],
    [0x70, 0x100], [0x74, 0x200], [0x78, 128], [0x7C, 64],
    [0x80, 1], [0xA0, 0xA0],
  ]) view.setUint32(offset, value, true);
  return bytes;
}

function checkSkyRelocation(api, bytes, offset) {
  const original = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const expected = bytes.slice();
  const view = new DataView(expected.buffer);
  const base = api.runtime_sky_stage_address() + offset;
  const groups = original.getInt16(offset + 6, true);
  const textures = original.getInt16(offset + 0xC, true);
  view.setInt16(offset + 4, 1, true);
  for (const field of [0x10, 0x14, 0x18, 0x1C]) {
    const relative = original.getUint32(offset + field, true);
    if (field !== 0x1C || relative !== 0) view.setUint32(offset + field, base + relative, true);
  }
  for (let index = 0; index < textures; index++) {
    const entry = offset + original.getUint32(offset + 0x10, true) + index * 16;
    view.setBigUint64(entry, 0n, true);
    view.setInt16(entry + 8, original.getInt32(entry + 4, true) >> 4, true);
    view.setInt16(entry + 10, original.getInt32(entry, true) >> 4, true);
    view.setInt16(entry + 12, Math.log2(original.getInt32(entry + 8, true)), true);
    view.setInt16(entry + 14, Math.log2(original.getInt32(entry + 12, true)), true);
  }
  for (let index = 0; index < groups; index++) {
    const field = offset + 0x20 + index * 4;
    const relative = original.getUint32(field, true);
    view.setUint32(field, base + relative, true);
    const count = original.getInt32(offset + relative, true);
    for (let cluster = 0; cluster < count; cluster++) {
      const target = offset + relative + 0x20 + cluster * 0x20;
      view.setUint32(target, base + original.getUint32(target, true), true);
    }
  }
  new Uint8Array(api.memory.buffer, api.runtime_sky_stage_address(), bytes.length).set(bytes);
  assert.equal(api.runtime_sky_load(bytes.length, offset), 1,
    `Sky relocation failed: ${JSON.stringify({ offset, groups, textures })}`);
  assert.deepEqual(new Uint8Array(api.memory.buffer, api.runtime_sky_stage_address(), bytes.length), expected);
  assert.equal(api.runtime_sky_ready(), 1);
  assert.equal(api.runtime_sky_guards_valid(), 1);
  return { groups, textures };
}

test('unchanged original sky C relocates owned pointers and repacks texture records exactly', async () => {
  const api = await skyRuntime();
  checkSkyRelocation(api, skyFixture(), 0x40);
  const before = new Uint8Array(api.memory.buffer, api.runtime_sky_stage_address(), 0x200).slice();
  assert.equal(api.runtime_sky_load(0x200, 0x40), -1);
  assert.deepEqual(new Uint8Array(api.memory.buffer, api.runtime_sky_stage_address(), 0x200), before);
});

test('sky preflight rejects malformed offsets, dimensions, overlapping tables and damaged guards before mutation', async () => {
  const api = await skyRuntime();
  for (const [offset, value] of [
    [0x44, 1], [0x46, 65], [0x4C, 1025], [0x50, 0xFFFFFFFF],
    [0x54, 0xFFFFFFFF], [0x58, 0xFFFFFFFF], [0x5C, 0xFFFFFFFF],
    [0x70, 15], [0x78, 0], [0x78, 3], [0x7C, 2048],
    [0x60, 0x30], [0x60, 0x1C0], [0x80, 0xFFFFFFFF], [0xA0, 0xFFFFFFFF],
  ]) {
    api.runtime_sky_reset();
    const bytes = skyFixture();
    const view = new DataView(bytes.buffer);
    if (offset === 0x44 || offset === 0x46 || offset === 0x4C) view.setUint16(offset, value, true);
    else view.setUint32(offset, value, true);
    new Uint8Array(api.memory.buffer, api.runtime_sky_stage_address(), bytes.length).set(bytes);
    assert.ok(api.runtime_sky_load(bytes.length, 0x40) < 0, `Accepted invalid field ${offset.toString(16)}`);
    assert.equal(api.runtime_sky_ready(), 0);
    assert.equal(api.runtime_sky_guards_valid(), 1);
    assert.deepEqual(new Uint8Array(api.memory.buffer, api.runtime_sky_stage_address(), bytes.length), bytes);
  }
  api.runtime_sky_reset();
  const bytes = skyFixture();
  new DataView(bytes.buffer).setUint16(0x46, 2, true);
  new DataView(bytes.buffer).setUint32(0x64, 0x40, true);
  new Uint8Array(api.memory.buffer, api.runtime_sky_stage_address(), bytes.length).set(bytes);
  assert.equal(api.runtime_sky_load(bytes.length, 0x40), -4);
  for (const [size, offset] of [[api.runtime_sky_capacity() + 1, 0], [32, 64], [512, 65]]) {
    assert.equal(api.runtime_sky_load(size, offset), -1);
  }
  new Uint8Array(api.memory.buffer)[api.runtime_sky_stage_address() + api.runtime_sky_capacity()] = 0;
  assert.equal(api.runtime_sky_load(512, 64), -1);
  api.runtime_sky_reset();
  checkSkyRelocation(api, skyFixture(), 0x40);
});

test('resident bridge shares decoder ownership with boot loads and clears malformed output', async () => {
  const api = await runtime();
  const bytes = residentFixture();
  const compressed = new Uint8Array(2048);
  compressed.set(archive(literalHistory(bytes)));
  const entry = { sector: 1, count: 1 };
  const reader = { opened: true, readSectors: async () => compressed };
  const loaded = await decodeResidentArchive(api, reader, entry);
  assert.deepEqual(loaded.header, inspectResidentArchive(bytes));
  assert.equal(loaded.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(output(api), bytes);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(decodeResidentArchive(api, reader, entry, abort.signal), { name: 'AbortError' });
  assert.equal(api.wad_ready(), 0);
  await assert.rejects(decodeResidentArchive(api, reader, { sector: 0, count: 513 }), /Invalid/);
  let release;
  const older = decodeBootArchive(api, { ...reader, readSectors: () => new Promise(resolve => { release = resolve; }) }, entry);
  const rejected = assert.rejects(older, { name: 'AbortError' });
  await decodeResidentArchive(api, reader, entry);
  release(compressed);
  await rejected;
  assert.deepEqual(output(api), bytes);
  const invalid = new Uint8Array(2048);
  invalid.set(archive(literalHistory(new Uint8Array(100))));
  await assert.rejects(decodeResidentArchive(api, { ...reader, readSectors: async () => invalid }, entry), /too short/);
  assert.equal(api.wad_ready(), 0);
  assert.equal(api.wad_output_size(), 0);
  assert.equal(api.wad_guards_valid(), 1);
});

test('local resident archive matches the independent decoder and source layout', {
  skip: !isoPath || !referencePath ? 'Set RNC_ISO_PATH and RNC_WAD_REFERENCE_PATH for the independent check' : false,
}, async () => {
  const reader = new IsoReader(await openAsBlob(isoPath));
  await reader.open();
  await reader.verifyBoot();
  const table = await reader.readSectors(0x5DC, 6);
  const view = new DataView(table.buffer, table.byteOffset, table.byteLength);
  const sector = view.getInt32(0x13B8, true);
  const count = view.getInt32(0x13BC, true);
  const api = await runtime();
  const loaded = await decodeResidentArchive(api, reader, { sector, count });
  const reference = execFileSync(referencePath, [isoPath, String(sector * 2048), String(count * 2048)], {
    maxBuffer: api.wad_output_capacity(), timeout: 30000,
  });
  assert.deepEqual(output(api), new Uint8Array(reference));
  assert.equal(loaded.bytes, 2863552);
  assert.equal(loaded.sha256, '45da9ffad89ebfcc796af2d3a956ee7d493451322b3476d7b40afa23208874f8');
  assert.equal(loaded.header.mobyClasses.count, 3);
  assert.equal(loaded.header.textureClasses.count, 3);
  assert.equal(loaded.header.textureCount, 11);
  assert.equal(api.wad_guards_valid(), 1);
  assert.ok(reader.stats.largestRead <= 1048576);
  const native = await skyRuntime();
  const sky = checkSkyRelocation(native, output(api), loaded.header.skyOffset);
  console.log(JSON.stringify({ residentBytes: loaded.bytes, residentSha256: loaded.sha256, relocatedSky: sky }));
});

test('local boot archive matches the separately built upstream decoder byte-for-byte', {
  skip: !isoPath || !referencePath ? 'Set RNC_ISO_PATH and RNC_WAD_REFERENCE_PATH for the independent check' : false,
}, async () => {
  const reader = new IsoReader(await openAsBlob(isoPath));
  await reader.open();
  await reader.verifyBoot();
  const table = await reader.readSectors(0x5DC, 6);
  const view = new DataView(table.buffer, table.byteOffset, table.byteLength);
  const sector = view.getInt32(0x12C0, true);
  const sectors = view.getInt32(0x12C4, true);
  assert.ok(sector >= 0 && sectors > 0);
  const compressed = await reader.readSectors(sector, sectors);
  const api = await runtime();
  const bytes = decode(api, compressed);
  assert.ok(bytes > 0, `Decoder failed with ${bytes}`);
  const reference = execFileSync(referencePath, [isoPath, String(sector * 2048), String(sectors * 2048)], {
    maxBuffer: api.wad_output_capacity(), timeout: 30000,
  });
  assert.deepEqual(output(api), new Uint8Array(reference));
  const loaded = await decodeBootArchive(api, reader, { sector, count: sectors });
  assert.equal(loaded.bytes, bytes);
  assert.equal(loaded.modules.length, 9);
  assert.equal(loaded.sha256, createHash('sha256').update(reference).digest('hex'));
  assert.equal(api.wad_guards_valid(), 1);
  const nativeModule = await WebAssembly.compile(await readFile(new URL('../build/browser/runtime.wasm', import.meta.url)));
  const native = (await WebAssembly.instantiate(nativeModule, {})).exports;
  native._initialize();
  native.runtime_init();
  const initialized = await initializeDiscTable(native, reader, undefined, api);
  assert.deepEqual(initialized.bootArchive, loaded);
  assert.equal(initialized.residentArchive.bytes, 2863552);
  assert.equal(initialized.residentArchive.header.skyOffset, 305152);
  assert.deepEqual(initialized.residentArchive.sky, { shells: 6, textures: 6 });
  assert.equal(native.runtime_sky_ready(), 1);
  assert.equal(native.runtime_sky_guards_valid(), 1);
  assert.equal(native.runtime_disc_ready(), 1);
  const interrupted = {
    opened: reader.opened,
    volumeBytes: reader.volumeBytes,
    verifyBoot: signal => reader.verifyBoot(signal),
    readSectors: async (sector, count, signal) => {
      const bytes = await reader.readSectors(sector, count, signal);
      if (sector === 1880188) bytes[0] = 0;
      return bytes;
    },
  };
  await assert.rejects(initializeDiscTable(native, interrupted, undefined, api), /decoding failed/);
  assert.equal(native.runtime_disc_ready(), 0);
  assert.equal(native.runtime_sky_ready(), 0);
  assert.equal(native.runtime_sky_guards_valid(), 1);
  assert.equal(api.wad_ready(), 0);
  await initializeDiscTable(native, reader, undefined, api);
  assert.equal(native.runtime_sky_ready(), 1);
  console.log(JSON.stringify({ bootArchiveBytes: bytes, sha256: createHash('sha256').update(reference).digest('hex') }));
});