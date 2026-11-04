import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { openAsBlob } from 'node:fs';
import { test } from 'node:test';
import { IsoReader, SECTOR_BYTES, MAX_READ_BYTES, BOOT_SHA256 } from './iso-reader.mjs';

function fixture(edit = () => {}) {
  const bytes = new Uint8Array(24 * SECTOR_BYTES);
  const view = new DataView(bytes.buffer);
  function pair(offset, value, width = 4) {
    if (width === 4) { view.setUint32(offset, value, true); view.setUint32(offset + 4, value, false); }
    else { view.setUint16(offset, value, true); view.setUint16(offset + 2, value, false); }
  }
  function record(offset, name, sector, size, directory = false) {
    const identifier = typeof name === 'number' ? [name] : [...new TextEncoder().encode(name)];
    const length = 33 + identifier.length + (identifier.length % 2 === 0 ? 1 : 0);
    bytes[offset] = length;
    pair(offset + 2, sector);
    pair(offset + 10, size);
    bytes[offset + 25] = directory ? 2 : 0;
    pair(offset + 28, 1, 2);
    bytes[offset + 32] = identifier.length;
    bytes.set(identifier, offset + 33);
    return length;
  }
  const primary = 16 * SECTOR_BYTES;
  bytes[primary] = 1;
  bytes.set(new TextEncoder().encode('CD001'), primary + 1);
  bytes[primary + 6] = 1;
  pair(primary + 80, 24);
  pair(primary + 128, SECTOR_BYTES, 2);
  record(primary + 156, 0, 20, SECTOR_BYTES, true);
  let offset = 20 * SECTOR_BYTES;
  offset += record(offset, 0, 20, SECTOR_BYTES, true);
  offset += record(offset, 1, 20, SECTOR_BYTES, true);
  record(offset, 'SCUS_971.99;1', 21, 4);
  bytes.set([1, 2, 3, 4], 21 * SECTOR_BYTES);
  edit({ bytes, view, pair, record, fileRecord: offset, primary });
  return new Blob([bytes]);
}

test('catalog and file/sector reads match fixture bytes', async () => {
  const reader = new IsoReader(fixture());
  const entries = await reader.open();
  assert.deepEqual(entries, [{ path: '/SCUS_971.99', sector: 21, size: 4, directory: false }]);
  assert.deepEqual([...await reader.readFile(entries[0])], [1, 2, 3, 4]);
  assert.deepEqual([...(await reader.readSectors(21, 1)).subarray(0, 4)], [1, 2, 3, 4]);
  assert.ok(reader.stats.largestRead <= MAX_READ_BYTES);
});

test('rejects invalid format and truncated volume', async () => {
  await assert.rejects(new IsoReader(fixture(({ bytes, primary }) => { bytes[primary + 1] = 0; })).open(), /ISO9660/);
  await assert.rejects(new IsoReader(fixture().slice(0, 22 * SECTOR_BYTES)).open(), /truncated/);
});

test('rejects mismatched byte-order fields', async () => {
  await assert.rejects(new IsoReader(fixture(({ bytes, primary }) => { bytes[primary + 84] = 1; })).open(), /byte-order/);
});

test('rejects malformed record and file extent', async () => {
  await assert.rejects(new IsoReader(fixture(({ bytes, fileRecord }) => { bytes[fileRecord] = 2; })).open(), /record length/);
  await assert.rejects(new IsoReader(fixture(({ pair, fileRecord }) => { pair(fileRecord + 2, 30); })).open(), /extent/);
});

test('rejects unsupported multi-extent files', async () => {
  await assert.rejects(new IsoReader(fixture(({ bytes, fileRecord }) => { bytes[fileRecord + 25] = 128; })).open(), /Multi-extent/);
});

test('rejects cyclic directories', async () => {
  await assert.rejects(new IsoReader(fixture(({ bytes, record, fileRecord }) => {
    bytes.fill(0, fileRecord, 21 * SECTOR_BYTES);
    record(fileRecord, 'LOOP', 20, SECTOR_BYTES, true);
  })).open(), /Cyclic/);
});

test('rejects negative, fractional, overflowing, and oversized reads', async () => {
  const reader = new IsoReader(fixture());
  for (const [offset, length] of [[-1, 1], [0.5, 1], [0, -1], [Number.MAX_SAFE_INTEGER, 2],
    [0, MAX_READ_BYTES + 1], [reader.file.size - 1, 2]]) {
    await assert.rejects(reader.read(offset, length));
  }
  await assert.rejects(reader.readSectors(Number.MAX_SAFE_INTEGER, 1));
  await assert.rejects(reader.readSectors(0, -1));
});

test('rejects missing and incorrect USA executables', async () => {
  const wrongBoot = new IsoReader(fixture());
  await wrongBoot.open();
  await assert.rejects(wrongBoot.verifyBoot(), /checksum/);
  const missingBoot = new IsoReader(fixture(({ bytes, fileRecord }) => { bytes[fileRecord + 33] = 88; }));
  await missingBoot.open();
  await assert.rejects(missingBoot.verifyBoot(), /not found/);
});

test('cancellation before and during reads does not publish a catalog', async () => {
  const controller = new AbortController();
  controller.abort();
  const reader = new IsoReader(fixture());
  await assert.rejects(reader.open(controller.signal), { name: 'AbortError' });
  const during = new AbortController();
  const file = fixture();
  const delayed = new IsoReader({ size: file.size, slice(start, end) {
    return { async arrayBuffer() { during.abort(); return file.slice(start, end).arrayBuffer(); } };
  } });
  await assert.rejects(delayed.open(during.signal), { name: 'AbortError' });
  assert.equal(delayed.opened, false);
  assert.deepEqual(delayed.entries, []);
});

test('rejects short reads and buffers above the file limit', async () => {
  const reader = new IsoReader({ size: 1024, slice() { return new Blob([]); } });
  await assert.rejects(reader.read(0, 4), /truncated/);
  const large = new IsoReader(fixture());
  large.opened = true;
  const entry = { directory: false, size: 17 * MAX_READ_BYTES, sector: 0 };
  large.entries = [entry];
  await assert.rejects(large.readFile(entry), /16 MiB/);
});

test('local ISO matches an independent Python file catalog and sector hashes', {
  skip: !process.env.RNC_ISO_PATH,
}, async () => {
  const imagePath = process.env.RNC_ISO_PATH;
  const reference = JSON.parse(execFileSync('python3', ['-c', `
import hashlib, json, struct, sys
with open(sys.argv[1], 'rb') as image:
    def read(offset, size):
        image.seek(offset)
        data = image.read(size)
        assert len(data) == size
        return data
    primary = read(16 * 2048, 2048)
    assert primary[:7] == b'\\x01CD001\\x01'
    root = primary[156:190]
    pending = [(struct.unpack_from('<I', root, 2)[0], struct.unpack_from('<I', root, 10)[0], '')]
    entries = []
    while pending:
        sector, size, parent = pending.pop(0)
        data = read(sector * 2048, size)
        offset = 0
        while offset < len(data):
            length = data[offset]
            if length == 0:
                offset = (offset // 2048 + 1) * 2048
                continue
            record = data[offset:offset + length]
            offset += length
            name = record[33:33 + record[32]]
            if name in (b'\\x00', b'\\x01'):
                continue
            name = name.decode('ascii').split(';')[0]
            entry = dict(path=parent + '/' + name, sector=struct.unpack_from('<I', record, 2)[0],
                         size=struct.unpack_from('<I', record, 10)[0], directory=bool(record[25] & 2))
            entries.append(entry)
            if entry['directory']:
                pending.append((entry['sector'], entry['size'], entry['path']))
    boot = next(entry for entry in entries if entry['path'] == '/SCUS_971.99')
    digest = hashlib.sha256(read(boot['sector'] * 2048, boot['size'])).hexdigest()
    sample_sectors = sorted(set([0, 16, boot['sector'], (4214095872 // 2048) - 1] +
                               [entry['sector'] for entry in entries[:8]]))
    sectors = [dict(sector=sector, sha256=hashlib.sha256(read(sector * 2048, 2048)).hexdigest())
               for sector in sample_sectors]
    print(json.dumps(dict(entries=entries, bootSha256=digest, sectors=sectors)))
`, imagePath], { encoding: 'utf8' }));
  const reader = new IsoReader(await openAsBlob(imagePath));
  assert.deepEqual(await reader.open(), reference.entries);
  assert.equal((await reader.verifyBoot()).sha256, reference.bootSha256);
  assert.equal(reference.bootSha256, BOOT_SHA256);
  for (const sample of reference.sectors) {
    const bytes = await reader.readSectors(sample.sector, 1);
    const digest = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
    assert.equal(digest, sample.sha256, `Sector ${sample.sector}`);
  }
  assert.ok(reader.stats.largestRead <= MAX_READ_BYTES);
  assert.ok(reader.stats.bytes < 32 * MAX_READ_BYTES);
  console.log(JSON.stringify({ files: reader.entries.length, comparedSectors: reference.sectors.length, ...reader.stats }));
});