import { SECTOR_BYTES } from './iso-reader.mjs';

const activeLoads = new WeakMap();
const activeArchiveLoads = new WeakMap();
const ARCHIVES = [
  { name: 'Debug font', offset: 0x8 },
  { name: 'Level chunk', offset: 0x4F8 },
  { name: 'Boot archive', offset: 0x12C0 },
  { name: 'Resident archive', offset: 0x13B8 },
];

export async function initializeDiscTable(api, reader, signal, decoder) {
  const ticket = {};
  activeLoads.set(api, ticket);
  api.runtime_disc_reset();
  api.runtime_sky_reset();
  if (decoder) {
    activeArchiveLoads.set(decoder, {});
    decoder.wad_reset();
  }
  function checkActive() {
    signal?.throwIfAborted();
    if (activeLoads.get(api) !== ticket) throw new DOMException('Disc selection was superseded.', 'AbortError');
  }
  try {
    checkActive();
    if (!reader.opened) throw new Error('Open the disc catalog before initializing native state.');
    const boot = await reader.verifyBoot(signal);
    checkActive();
    const bytes = await reader.readSectors(0x5DC, 6, signal);
    checkActive();
    if (bytes.length !== 6 * SECTOR_BYTES || api.runtime_disc_stage_size() !== bytes.length) {
      throw new Error('Native disc staging size does not match the six-sector loader.');
    }
    const sectors = reader.volumeBytes / SECTOR_BYTES;
    if (!Number.isInteger(sectors) || sectors <= 0 || sectors > 0x7FFFFFFF) {
      throw new Error('Invalid disc volume size for native initialization.');
    }
    new Uint8Array(api.memory.buffer, api.runtime_disc_stage_address(), bytes.length).set(bytes);
    if (api.runtime_disc_load(bytes.length, sectors) !== 1) {
      throw new Error('Original disc-table initialization failed.');
    }
    const entries = ARCHIVES.map(entry => {
      const sector = api.runtime_disc_entry_sector(entry.offset);
      const count = api.runtime_disc_entry_count(entry.offset);
      if (sector < 0 || count <= 0) throw new Error(`${entry.name} is outside the selected disc volume.`);
      return { ...entry, sector, count, bytes: count * SECTOR_BYTES };
    });
    const table = new Uint8Array(api.memory.buffer, api.runtime_disc_table_address(), api.runtime_disc_table_size());
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', table));
    checkActive();
    const bootArchive = decoder ? await decodeBootArchive(decoder, reader, entries.find(entry => entry.offset === 0x12C0), signal) : undefined;
    checkActive();
    const residentArchive = decoder ? await decodeResidentArchive(decoder, reader, entries.find(entry => entry.offset === 0x13B8), signal) : undefined;
    checkActive();
    if (residentArchive) {
      if (residentArchive.bytes > api.runtime_sky_capacity()) throw new Error('Resident archive exceeds native sky staging capacity.');
      const bytes = new Uint8Array(decoder.memory.buffer, decoder.wad_output_address(), residentArchive.bytes);
      new Uint8Array(api.memory.buffer, api.runtime_sky_stage_address(), bytes.length).set(bytes);
      if (api.runtime_sky_load(bytes.length, residentArchive.header.skyOffset) !== 1) {
        throw new Error('Original C resident sky relocation failed.');
      }
      const sky = new DataView(api.memory.buffer, api.runtime_sky_stage_address() + residentArchive.header.skyOffset, 0x20);
      residentArchive.sky = { shells: sky.getInt16(6, true), textures: sky.getInt16(0xC, true) };
    }
    return {
      bootSha256: boot.sha256,
      tableSha256: [...digest].map(value => value.toString(16).padStart(2, '0')).join(''),
      copiedBytes: table.length,
      entries,
      ...(decoder ? { bootArchive, residentArchive } : {}),
    };
  } catch (error) {
    if (activeLoads.get(api) === ticket) {
      api.runtime_disc_reset();
      api.runtime_sky_reset();
      if (decoder) {
        activeArchiveLoads.set(decoder, {});
        decoder.wad_reset();
      }
    }
    throw error;
  } finally {
    if (activeLoads.get(api) === ticket) activeLoads.delete(api);
  }
}

export function inspectBootModules(bytes) {
  if (bytes.length < 0xC0) throw new Error('Decoded boot archive is too short for its module table.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from({ length: 9 }, (_, index) => {
    const offset = view.getUint32(0x70 + index * 8, true);
    const size = view.getUint32(0x74 + index * 8, true);
    if (offset < 0xC0 || size < 52 || offset > bytes.length || size > bytes.length - offset) {
      throw new Error(`Boot module ${index} is outside the decoded archive.`);
    }
    if (view.getUint32(offset, true) !== 0x464C457F || bytes[offset + 4] !== 1 ||
        bytes[offset + 5] !== 1 || view.getUint16(offset + 18, true) !== 8) {
      throw new Error(`Boot module ${index} is not a little-endian ELF32 MIPS module.`);
    }
    return { index, offset, bytes: size };
  });
}

export function inspectResidentArchive(bytes) {
  if (bytes.length < 0x68) throw new Error('Decoded resident archive is too short for its header.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  function range(offset, size, name) {
    if (!Number.isSafeInteger(offset) || offset < 0x68 || size < 0 ||
        offset > bytes.length || size > bytes.length - offset) {
      throw new Error(`Resident ${name} is outside the decoded archive.`);
    }
    return offset;
  }
  function table(countOffset, offsetOffset, stride, name) {
    const count = view.getInt32(countOffset, true);
    const offset = view.getInt32(offsetOffset, true);
    if (count < 0) throw new Error(`Resident ${name} count is negative.`);
    if (count !== 0 || offset !== 0) range(offset, count * stride, name);
    return { count, offset, stride };
  }
  const dataOffset = range(view.getInt32(4, true), 1, 'data');
  const textureCount = view.getInt32(8, true);
  if (textureCount < 0) throw new Error('Resident texture count is negative.');
  const textureOffset = view.getInt32(0, true);
  const textureInfoOffset = view.getInt32(0xC, true);
  if (textureCount !== 0) {
    range(textureOffset, 1, 'textures');
    range(textureInfoOffset, 1, 'texture information');
  }
  const classDataOffset = range(dataOffset + view.getInt32(0x30, true), 1, 'class data');
  const skyOffset = range(dataOffset + view.getInt32(0x48, true), 1, 'sky');
  return {
    dataOffset, textureCount, textureOffset, textureInfoOffset, classDataOffset, skyOffset,
    mobyClasses: table(0x10, 0x14, 0x20, 'moby classes'),
    textureClasses: table(0x18, 0x1C, 0x10, 'texture classes'),
  };
}

export function decodeBootArchive(decoder, reader, entry, signal) {
  return decodeArchive(decoder, reader, entry, signal, 'boot', bytes => ({ modules: inspectBootModules(bytes) }));
}

export function decodeResidentArchive(decoder, reader, entry, signal) {
  return decodeArchive(decoder, reader, entry, signal, 'resident', bytes => ({ header: inspectResidentArchive(bytes) }));
}

async function decodeArchive(decoder, reader, entry, signal, name, inspect) {
  const ticket = {};
  activeArchiveLoads.set(decoder, ticket);
  decoder.wad_reset();
  function checkActive() {
    signal?.throwIfAborted();
    if (activeArchiveLoads.get(decoder) !== ticket) throw new DOMException('Archive selection was superseded.', 'AbortError');
  }
  try {
    checkActive();
    if (!reader.opened || !Number.isSafeInteger(entry?.sector) || entry.sector < 0 ||
        !Number.isSafeInteger(entry.count) || entry.count <= 0 ||
        entry.count > decoder.wad_input_capacity() / SECTOR_BYTES) {
      throw new Error(`Invalid ${name} archive range for the bounded decoder.`);
    }
    const compressed = await reader.readSectors(entry.sector, entry.count, signal);
    checkActive();
    if (compressed.length !== entry.count * SECTOR_BYTES) throw new Error(`Incomplete ${name} archive read.`);
    new Uint8Array(decoder.memory.buffer, decoder.wad_input_address(), compressed.length).set(compressed);
    const size = decoder.wad_decode(compressed.length, decoder.wad_output_capacity());
    if (size < 0 || decoder.wad_ready() !== 1 || decoder.wad_guards_valid() !== 1) {
      throw new Error(`Native ${name} archive decoding failed (${size}).`);
    }
    const decoded = new Uint8Array(decoder.memory.buffer, decoder.wad_output_address(), size);
    const details = inspect(decoded);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', decoded));
    checkActive();
    return { bytes: size, sha256: [...digest].map(value => value.toString(16).padStart(2, '0')).join(''), ...details };
  } catch (error) {
    if (activeArchiveLoads.get(decoder) === ticket) decoder.wad_reset();
    throw error;
  } finally {
    if (activeArchiveLoads.get(decoder) === ticket) activeArchiveLoads.delete(decoder);
  }
}