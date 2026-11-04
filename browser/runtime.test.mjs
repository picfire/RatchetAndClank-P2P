import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { openAsBlob } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { IsoReader } from './iso-reader.mjs';
import { initializeDiscTable } from './disc-loader.mjs';

const binary = await readFile(new URL('../build/browser/runtime.wasm', import.meta.url));
const module = await WebAssembly.compile(binary);

async function createRuntime() {
  const instance = await WebAssembly.instantiate(module, {});
  instance.exports._initialize?.();
  return instance.exports;
}

function payload(api, index) {
  return new Uint8Array(api.memory.buffer, api.runtime_buffer_address(index), api.runtime_buffer_size(index));
}

test('runtime has no unresolved host services or mock imports', () => {
  assert.deepEqual(WebAssembly.Module.imports(module), []);
});

test('original scene initializer clears all owned buffers and preserves guards', async () => {
  const api = await createRuntime();
  assert.equal(api.runtime_init(), 0);
  for (const [index, size] of [0x100, 0xC60, 0xC60].entries()) {
    assert.equal(api.runtime_buffer_size(index), size);
    assert.ok(payload(api, index).every(value => value === 0));
    assert.equal(api.runtime_buffer_address(index) % 16, 0);
  }
  assert.equal(api.runtime_guards_valid(), 1);
});

test('original scene reset runs repeatedly after nonzero native state changes', async () => {
  const api = await createRuntime();
  api.runtime_init();
  for (let cycle = 0; cycle < 20; cycle += 1) {
    for (let index = 0; index < 3; index += 1) {
      assert.equal(api.runtime_fill(index, 0x12345678, 0, api.runtime_buffer_size(index)), 0);
      assert.deepEqual([...payload(api, index).subarray(0, 4)], [0x78, 0x56, 0x34, 0x12]);
    }
    assert.equal(api.runtime_reset_scene(), 0);
    for (let index = 0; index < 3; index += 1) assert.ok(payload(api, index).every(value => value === 0));
    assert.equal(api.runtime_guards_valid(), 1);
  }
});

test('ported frame callback increments counters and preserves scene contents', async () => {
  const api = await createRuntime();
  api.runtime_init();
  api.runtime_fill(0, -1, 0, api.runtime_buffer_size(0));
  for (let frame = 1; frame <= 120; frame += 1) assert.equal(api.runtime_step(frame * 16667), 0);
  assert.equal(api.runtime_frame_count(), 120);
  assert.equal(api.runtime_time(), 120 * 16667);
  assert.ok(payload(api, 0).every(value => value === 255));
  assert.equal(api.runtime_reset_scene(), 0);
  assert.equal(api.runtime_frame_count(), 120);
  assert.equal(api.runtime_time(), 120 * 16667);
});

test('native clock preserves 64-bit time across low-counter rollover', async () => {
  const api = await createRuntime();
  api.runtime_init();
  for (const ticks of [0x7FFFFFFF, 0xFFFFFFFF, 0x100000000, 0x10000007B, Number.MAX_SAFE_INTEGER]) {
    assert.equal(api.runtime_step(ticks), 0);
    assert.equal(api.runtime_time(), ticks);
  }
  assert.equal(api.runtime_frame_count(), 5);
});

test('rejects invalid time and calls before initialization without mutation', async () => {
  const api = await createRuntime();
  assert.equal(api.runtime_step(0), -1);
  assert.equal(api.runtime_reset_scene(), -1);
  api.runtime_init();
  api.runtime_step(100);
  for (const value of [-1, 99, 100.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(api.runtime_step(value), -1);
    assert.equal(api.runtime_frame_count(), 1);
    assert.equal(api.runtime_time(), 100);
  }
});

test('rejects invalid, unaligned, and overflowing memory ranges', async () => {
  const api = await createRuntime();
  api.runtime_init();
  for (const args of [[3, 0, 0, 4], [0, 0, 256, 4], [0, 0, 1, 4],
    [0, 0, 0, 3], [0, 0, -1, 4], [0, 0, 0, -1]]) {
    assert.equal(api.runtime_fill(...args), -1);
  }
  assert.equal(api.runtime_buffer_address(3), 0);
  assert.equal(api.runtime_buffer_size(3), 0);
  assert.ok(payload(api, 0).every(value => value === 0));
  assert.equal(api.runtime_guards_valid(), 1);
});

test('guard corruption blocks reset and updates until explicit reinitialization', async () => {
  const api = await createRuntime();
  api.runtime_init();
  const memory = new Uint8Array(api.memory.buffer);
  memory[api.runtime_buffer_address(1) + api.runtime_buffer_size(1)] = 0;
  assert.equal(api.runtime_guards_valid(), 0);
  assert.equal(api.runtime_reset_scene(), -1);
  assert.equal(api.runtime_step(0), -1);
  assert.equal(api.runtime_init(), 0);
  assert.equal(api.runtime_guards_valid(), 1);
  assert.equal(api.runtime_time(), 0);
});

function stageDisc(api) {
  const bytes = new Uint8Array(api.runtime_disc_stage_size());
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 251;
  const view = new DataView(bytes.buffer);
  for (const offset of [0x8, 0x4F8, 0x12C0, 0x13B8]) {
    view.setInt32(offset, 1700, true);
    view.setInt32(offset + 4, 10, true);
  }
  new Uint8Array(api.memory.buffer, api.runtime_disc_stage_address(), bytes.length).set(bytes);
  return bytes;
}

test('original disc loader copies exactly the table prefix from six staged sectors', async () => {
  const api = await createRuntime();
  api.runtime_init();
  const bytes = stageDisc(api);
  assert.equal(api.runtime_disc_load(bytes.length, 2000), 1);
  assert.equal(api.runtime_disc_ready(), 1);
  const table = new Uint8Array(api.memory.buffer, api.runtime_disc_table_address(), bytes.length);
  assert.deepEqual(table.subarray(0, 0x2960), bytes.subarray(0, 0x2960));
  assert.ok(table.subarray(0x2960).every(value => value === 0));
  assert.equal(api.runtime_disc_guards_valid(), 1);
  for (let service = 0; service < 3; service += 1) assert.equal(api.runtime_disc_service_calls(service), 1);
  assert.equal(api.runtime_disc_entry_sector(0x12C0), 1700);
  assert.equal(api.runtime_disc_entry_count(0x12C0), 10);
});

test('disc loader rejects incomplete staging and invalid volume sizes before retry loops', async () => {
  const api = await createRuntime();
  api.runtime_init();
  const bytes = stageDisc(api);
  for (const [size, sectors] of [[0, 2000], [bytes.length - 1, 2000], [bytes.length + 1, 2000],
    [bytes.length, 0], [bytes.length, 1505]]) {
    assert.equal(api.runtime_disc_load(size, sectors), -1);
    assert.equal(api.runtime_disc_ready(), 0);
    assert.equal(api.runtime_disc_service_calls(0), 0);
  }
});

test('disc catalog queries reject unknown offsets and ranges outside the selected volume', async () => {
  const api = await createRuntime();
  api.runtime_init();
  const bytes = stageDisc(api);
  assert.equal(api.runtime_disc_entry_sector(0x12C0), -1);
  api.runtime_disc_load(bytes.length, 1705);
  assert.equal(api.runtime_disc_entry_sector(0x12C0), -1);
  assert.equal(api.runtime_disc_entry_count(0x12C0), -1);
  assert.equal(api.runtime_disc_entry_sector(0x2960), -1);
  assert.equal(api.runtime_disc_entry_sector(-1), -1);
});

test('disc guard corruption blocks initialization and reset clears stale tables', async () => {
  const api = await createRuntime();
  api.runtime_init();
  const bytes = stageDisc(api);
  const memory = new Uint8Array(api.memory.buffer);
  memory[api.runtime_disc_stage_address() + bytes.length] = 0;
  assert.equal(api.runtime_disc_load(bytes.length, 2000), -1);
  api.runtime_disc_reset();
  stageDisc(api);
  assert.equal(api.runtime_disc_load(bytes.length, 2000), 1);
  api.runtime_disc_reset();
  assert.equal(api.runtime_disc_ready(), 0);
  assert.equal(api.runtime_disc_entry_sector(0x12C0), -1);
  assert.ok(new Uint8Array(api.memory.buffer, api.runtime_disc_table_address(), bytes.length).every(value => value === 0));
});

test('disc bridge initializes native state only after verification and rejects cancellation', async () => {
  const api = await createRuntime();
  api.runtime_init();
  const bytes = stageDisc(api);
  let verified = false;
  const reader = { opened: true, volumeBytes: 2000 * 2048,
    async verifyBoot() { verified = true; return { sha256: 'fixture-only' }; },
    async readSectors(sector, count) {
      assert.equal(verified, true);
      assert.equal(sector, 0x5DC);
      assert.equal(count, 6);
      return bytes;
    },
  };
  const result = await initializeDiscTable(api, reader);
  assert.equal(result.copiedBytes, 0x2960);
  assert.equal(result.entries.length, 4);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(initializeDiscTable(api, reader, controller.signal), { name: 'AbortError' });
  assert.equal(api.runtime_disc_ready(), 0);
});

test('failed or superseded disc selection cannot publish stale native state', async () => {
  const api = await createRuntime();
  api.runtime_init();
  const bytes = stageDisc(api);
  const reader = { opened: true, volumeBytes: 2000 * 2048,
    async verifyBoot() { return { sha256: 'fixture-only' }; },
    async readSectors() { return bytes; },
  };
  await assert.rejects(initializeDiscTable(api, { ...reader, async verifyBoot() { throw new Error('Invalid checksum'); } }), /checksum/);
  assert.equal(api.runtime_disc_ready(), 0);
  let release;
  const pending = initializeDiscTable(api, { ...reader, verifyBoot() { return new Promise(resolve => { release = resolve; }); } });
  const current = await initializeDiscTable(api, reader);
  release({ sha256: 'old-fixture' });
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(api.runtime_disc_ready(), 1);
  assert.equal(api.runtime_disc_entry_sector(current.entries[0].offset), 1700);
  const malformed = bytes.slice();
  new DataView(malformed.buffer).setInt32(0x12C4, -1, true);
  await assert.rejects(initializeDiscTable(api, { ...reader, async readSectors() { return malformed; } }), /Boot archive/);
  assert.equal(api.runtime_disc_ready(), 0);
});

test('real-disc native initialization matches an independent Python table read', {
  skip: !process.env.RNC_ISO_PATH,
}, async () => {
  const imagePath = process.env.RNC_ISO_PATH;
  const reference = JSON.parse(execFileSync('python3', ['-c', `
import hashlib, json, struct, sys
with open(sys.argv[1], 'rb') as image:
    image.seek(0x5DC * 2048)
    data = image.read(6 * 2048)
    assert len(data) == 6 * 2048
    entries = [dict(offset=offset, sector=struct.unpack_from('<i', data, offset)[0],
                    count=struct.unpack_from('<i', data, offset + 4)[0])
               for offset in [0x8, 0x4F8, 0x12C0, 0x13B8]]
    print(json.dumps(dict(sha256=hashlib.sha256(data[:0x2960]).hexdigest(), entries=entries)))
`, imagePath], { encoding: 'utf8' }));
  const reader = new IsoReader(await openAsBlob(imagePath));
  await reader.open();
  const api = await createRuntime();
  api.runtime_init();
  const result = await initializeDiscTable(api, reader);
  assert.equal(result.tableSha256, reference.sha256);
  assert.deepEqual(result.entries.map(({ offset, sector, count }) => ({ offset, sector, count })), reference.entries);
  assert.equal(api.runtime_disc_guards_valid(), 1);
  assert.ok(reader.stats.largestRead <= 1024 * 1024);
  console.log(JSON.stringify({ nativeTableBytes: result.copiedBytes, tableSha256: result.tableSha256, entries: result.entries }));
});