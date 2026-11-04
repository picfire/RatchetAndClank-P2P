export const SECTOR_BYTES = 2048;
export const MAX_READ_BYTES = 1024 * 1024;
export const BOOT_SHA256 = 'e050581032e4bb3f20341307da5b69b76f1574910519155380ea771e55c3c0c9';
const MAX_FILE_BYTES = 16 * MAX_READ_BYTES;
const MAX_ENTRIES = 4096;
const MAX_DIRECTORY_BYTES = 8 * MAX_READ_BYTES;

function requireValid(condition, message) {
  if (!condition) throw new Error(message);
}

function pairedInteger(view, offset, width) {
  const little = width === 4 ? view.getUint32(offset, true) : view.getUint16(offset, true);
  const big = width === 4 ? view.getUint32(offset + width, false) : view.getUint16(offset + width, false);
  requireValid(little === big, 'ISO byte-order fields disagree.');
  return little;
}

export class IsoReader {
  constructor(file) {
    requireValid(file && Number.isSafeInteger(file.size) && typeof file.slice === 'function', 'A local disc file is required.');
    this.file = file;
    this.entries = [];
    this.opened = false;
    this.volumeBytes = file.size;
    this.stats = { reads: 0, bytes: 0, largestRead: 0 };
  }

  async read(offset, length, signal) {
    signal?.throwIfAborted();
    requireValid(Number.isSafeInteger(offset) && Number.isSafeInteger(length) && offset >= 0 && length >= 0,
      'Read offset and length must be nonnegative safe integers.');
    requireValid(length <= MAX_READ_BYTES, 'Read exceeds the 1 MiB request limit.');
    requireValid(offset <= this.volumeBytes && length <= this.volumeBytes - offset,
      'Read is outside the disc image or declared volume.');
    const bytes = new Uint8Array(await this.file.slice(offset, offset + length).arrayBuffer());
    signal?.throwIfAborted();
    requireValid(bytes.byteLength === length, 'Disc read was truncated.');
    this.stats.reads += 1;
    this.stats.bytes += length;
    this.stats.largestRead = Math.max(this.stats.largestRead, length);
    return bytes;
  }

  async readSectors(sector, count, signal) {
    requireValid(Number.isSafeInteger(sector) && Number.isSafeInteger(count) && sector >= 0 && count >= 0,
      'Sector and count must be nonnegative safe integers.');
    return this.read(sector * SECTOR_BYTES, count * SECTOR_BYTES, signal);
  }

  record(bytes, offset, parent) {
    const length = bytes[offset];
    requireValid(length >= 34 && offset + length <= bytes.length &&
      length <= SECTOR_BYTES - offset % SECTOR_BYTES, 'Invalid ISO directory record length.');
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, length);
    const nameLength = bytes[offset + 32];
    requireValid(nameLength > 0 && 33 + nameLength <= length, 'Invalid ISO file name length.');
    requireValid(bytes[offset + 1] === 0 && bytes[offset + 26] === 0 && bytes[offset + 27] === 0,
      'Extended attributes and interleaved files are not supported.');
    const flags = bytes[offset + 25];
    requireValid((flags & 0x80) === 0, 'Multi-extent ISO files are not supported.');
    const sector = pairedInteger(view, 2, 4);
    const size = pairedInteger(view, 10, 4);
    requireValid(pairedInteger(view, 28, 2) === 1, 'Multi-volume ISO files are not supported.');
    requireValid(sector * SECTOR_BYTES <= this.volumeBytes && size <= this.volumeBytes - sector * SECTOR_BYTES,
      'ISO file extent is outside the declared volume.');
    const identifier = bytes.subarray(offset + 33, offset + 33 + nameLength);
    if (nameLength === 1 && identifier[0] <= 1) return null;
    requireValid([...identifier].every(value => value >= 32 && value < 127), 'Unsupported ISO file name encoding.');
    const name = String.fromCharCode(...identifier).replace(/;\d+$/, '');
    requireValid(name !== '.' && name !== '..' && !/[\\/]/.test(name), 'Invalid ISO file name.');
    return { path: `${parent}/${name}`, sector, size, directory: Boolean(flags & 2) };
  }

  async open(signal) {
    this.opened = false;
    this.entries = [];
    this.volumeBytes = this.file.size;
    let descriptor;
    for (let sector = 16; sector < 80; sector += 1) {
      const bytes = await this.readSectors(sector, 1, signal);
      requireValid(String.fromCharCode(...bytes.subarray(1, 6)) === 'CD001' && bytes[6] === 1,
        'Not a supported ISO9660 image.');
      if (bytes[0] === 1) { descriptor = bytes; break; }
      if (bytes[0] === 255) break;
    }
    requireValid(descriptor, 'ISO primary volume descriptor was not found.');
    const view = new DataView(descriptor.buffer, descriptor.byteOffset, descriptor.byteLength);
    requireValid(pairedInteger(view, 128, 2) === SECTOR_BYTES, 'Only 2048-byte ISO sectors are supported.');
    this.volumeBytes = pairedInteger(view, 80, 4) * SECTOR_BYTES;
    requireValid(this.volumeBytes > 0 && this.volumeBytes <= this.file.size, 'Disc image is truncated.');
    const rootLength = descriptor[156];
    requireValid(rootLength >= 34 && 156 + rootLength <= SECTOR_BYTES, 'Invalid ISO root directory record.');
    const rootView = new DataView(descriptor.buffer, descriptor.byteOffset + 156, rootLength);
    const rootSector = pairedInteger(rootView, 2, 4);
    const rootSize = pairedInteger(rootView, 10, 4);
    requireValid(Boolean(descriptor[181] & 2), 'ISO root is not a directory.');
    const pending = [{ sector: rootSector, size: rootSize, path: '', depth: 0 }];
    const visited = new Set();
    const paths = new Set();
    const entries = [];
    let directoryBytes = 0;
    while (pending.length) {
      signal?.throwIfAborted();
      const directory = pending.shift();
      const key = `${directory.sector}:${directory.size}`;
      requireValid(!visited.has(key) && directory.depth <= 16, 'Cyclic or excessively deep ISO directory tree.');
      visited.add(key);
      directoryBytes += directory.size;
      requireValid(directory.size > 0 && directoryBytes <= MAX_DIRECTORY_BYTES, 'ISO directory budget exceeded.');
      const bytes = await this.read(directory.sector * SECTOR_BYTES, directory.size, signal);
      for (let offset = 0; offset < bytes.length;) {
        if (bytes[offset] === 0) {
          offset = (Math.floor(offset / SECTOR_BYTES) + 1) * SECTOR_BYTES;
          continue;
        }
        const entry = this.record(bytes, offset, directory.path);
        offset += bytes[offset];
        if (!entry) continue;
        requireValid(entries.length < MAX_ENTRIES && !paths.has(entry.path), 'Duplicate paths or excessive ISO file count.');
        entries.push(entry);
        paths.add(entry.path);
        if (entry.directory) pending.push({ ...entry, depth: directory.depth + 1 });
      }
    }
    this.entries = entries;
    this.opened = true;
    return entries;
  }

  async readFile(entry, signal) {
    requireValid(this.opened && this.entries.includes(entry) && !entry.directory, 'Select a cataloged disc file.');
    requireValid(entry.size <= MAX_FILE_BYTES, 'File exceeds the 16 MiB buffer limit; use bounded sector reads.');
    const bytes = new Uint8Array(entry.size);
    for (let offset = 0; offset < entry.size; offset += MAX_READ_BYTES) {
      signal?.throwIfAborted();
      bytes.set(await this.read(entry.sector * SECTOR_BYTES + offset,
        Math.min(MAX_READ_BYTES, entry.size - offset), signal), offset);
    }
    signal?.throwIfAborted();
    return bytes;
  }

  async verifyBoot(signal) {
    const boot = this.entries.find(entry => entry.path === '/SCUS_971.99' && !entry.directory);
    requireValid(this.opened && boot, 'USA boot executable SCUS_971.99 was not found.');
    const bytes = await this.readFile(boot, signal);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    signal?.throwIfAborted();
    const sha256 = [...digest].map(value => value.toString(16).padStart(2, '0')).join('');
    requireValid(sha256 === BOOT_SHA256, 'Boot executable checksum does not match the supported USA release.');
    return { entry: boot, sha256 };
  }
}