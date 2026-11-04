import { MAX_READ_BYTES, SECTOR_BYTES } from './iso-reader.mjs';

export const VELDIN_ARCHIVE = Object.freeze({ name: 'Veldin', sector: 1885908, count: 6989 });
const activeLoads = new WeakMap();

export function initializePlanetCollision(planet, api) {
  api.runtime_collision_reset();
  const header = new DataView(planet.header.buffer, planet.header.byteOffset, planet.header.byteLength);
  if (header.byteLength < 100) throw new Error('Planet header has no collision range.');
  const start = header.getUint32(20, true);
  const end = header.getUint32(96, true);
  const bytes = end - start;
  if (start >= end || end > planet.core.length || bytes > api.runtime_collision_capacity()) {
    throw new Error('Planet collision exceeds native staging capacity.');
  }
  new Uint8Array(api.memory.buffer, api.runtime_collision_stage_address(), bytes).set(planet.core.subarray(start, end));
  const result = api.runtime_collision_load(bytes);
  if (result !== 1 || api.runtime_collision_guards_valid() !== 1) {
    api.runtime_collision_reset();
    throw new Error(`Native planet collision initialization failed (${result}).`);
  }
  return { bytes, cells: api.runtime_collision_cells(), faces: api.runtime_collision_faces() };
}

export async function loadPlanetCore(reader, decoder, entry, signal) {
  if (!reader.opened || !Number.isSafeInteger(entry.sector) || entry.sector < 0 ||
      !Number.isSafeInteger(entry.count) || entry.count <= 0) throw new Error('Invalid planet archive range.');
  const start = entry.sector * SECTOR_BYTES;
  const size = entry.count * SECTOR_BYTES;
  if (start > reader.volumeBytes || size > reader.volumeBytes - start) throw new Error('Planet archive is outside the disc.');
  function range(offset, length) {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) ||
        length <= 0 || offset > size || length > size - offset) throw new Error('Planet asset is outside its archive.');
    return start + offset;
  }
  const owner = {};
  activeLoads.set(decoder, owner);
  function checkOwner() {
    signal?.throwIfAborted();
    if (activeLoads.get(decoder) !== owner) throw new DOMException('Planet load superseded.', 'AbortError');
  }
  decoder.wad_reset();
  try {
    const bytes = await reader.read(start, 0x80, signal);
    const root = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const headerOffset = root.getUint32(0x10, true);
    const headerSize = root.getUint32(0x14, true);
    const coreOffset = root.getUint32(0x50, true);
    if (headerSize < 0x80 || headerSize > MAX_READ_BYTES) throw new Error('Unsupported planet header size.');
    const header = await reader.read(range(headerOffset, headerSize), headerSize, signal);
    const prefix = await reader.read(range(coreOffset, 16), 16, signal);
    if (prefix[0] !== 87 || prefix[1] !== 65 || prefix[2] !== 68) throw new Error('Planet core is not a WAD stream.');
    const compressedBytes = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength).getUint32(3, true);
    range(coreOffset, compressedBytes);
    if (compressedBytes > decoder.wad_input_capacity()) {
      throw new Error(`Planet core requires ${compressedBytes} compressed bytes; decoder capacity is ${decoder.wad_input_capacity()}.`);
    }
    for (let offset = 0; offset < compressedBytes; offset += MAX_READ_BYTES) {
      const count = Math.min(MAX_READ_BYTES, compressedBytes - offset);
      const chunk = await reader.read(start + coreOffset + offset, count, signal);
      checkOwner();
      new Uint8Array(decoder.memory.buffer, decoder.wad_input_address() + offset, count).set(chunk);
    }
    const decodedBytes = decoder.wad_decode(compressedBytes, decoder.wad_output_capacity());
    if (decodedBytes <= 0 || decoder.wad_ready() !== 1 || decoder.wad_guards_valid() !== 1) {
      throw new Error(`Planet core decoding failed (${decodedBytes}).`);
    }
    signal?.throwIfAborted();
    const core = new Uint8Array(decoder.memory.buffer, decoder.wad_output_address(), decodedBytes).slice();
    const textureSize = root.getUint32(0x1C, true);
    if (textureSize > MAX_READ_BYTES) throw new Error('Unsupported planet texture upload size.');
    const textureImages = await reader.read(range(root.getUint32(0x18, true), textureSize), textureSize, signal);
    checkOwner();
    return { name: entry.name, header, core, textureImages, compressedBytes, archiveStart: start,
      archiveBytes: size, textureOffset: root.getUint32(0x18, true) };
  } catch (error) {
    if (activeLoads.get(decoder) === owner) decoder.wad_reset();
    throw error;
  } finally {
    if (activeLoads.get(decoder) === owner) activeLoads.delete(decoder);
  }
}