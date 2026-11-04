import { readMobyClass } from './moby-geometry.mjs';

export function readHeroSequences(planet) {
  const model = readMobyClass(planet);
  const { base, view, range } = model;
  const header = new DataView(planet.header.buffer, planet.header.byteOffset, planet.header.byteLength);
  if (header.byteLength < 124) throw new Error('Missing hero animation table.');
  const table = header.getUint32(120, true), count = view.getUint8(base + 12);
  if (table < 124 || table > header.byteLength || count * 4 > header.byteLength - table) throw new Error('Invalid hero animation table.');
  const sequences = Array.from({ length: count }, (_, id) => {
    const offset = header.getUint32(table + id * 4, true);
    if (!offset) return null;
    range(offset, 28);
    const frames = view.getUint8(offset + 16), triggers = view.getUint8(offset + 18);
    if (!frames) throw new Error('Hero animation has no frames.');
    range(offset + 28, (frames + triggers) * 4);
    const entries = Array.from({ length: frames }, (_, frame) => {
      const packed = view.getUint32(offset + 28 + frame * 4, true);
      return { offset: range(offset + (packed & 0x0FFFFFFF), 4), compressed: Boolean(packed >>> 28) };
    });
    return { id, offset, frames: entries, metadata: offset + 28 + (frames + triggers) * 4 };
  });
  return { ...model, sequences };
}

export function readHeroAnimationRig(planet) {
  const model = readHeroSequences(planet);
  const { base, view, range, jointCount } = model;
  const translations = range(base + view.getUint32(base + 24, true), jointCount * 16);
  const unit = model.scale / 1024;
  const parents = [], bindPositions = new Float32Array(jointCount * 3);
  for (let joint = 0; joint < jointCount; joint++) {
    const record = translations + joint * 16;
    const parent = view.getUint16(record + 12, true) / 64;
    if (!Number.isInteger(parent) || joint > 0 && parent >= joint) throw new Error('Invalid hero joint parent.');
    parents.push(joint === 0 ? -1 : parent);
    for (let axis = 0; axis < 3; axis++) {
      const position = view.getFloat32(record + axis * 4, true) * unit;
      if (!Number.isFinite(position) || Math.abs(position) > 10) throw new Error('Invalid hero bind translation.');
      bindPositions[joint * 3 + axis] = position;
    }
  }
  function readFrame(entry) {
    if (entry.compressed) throw new Error('Compressed hero animation frames are not supported.');
    const offset = range(entry.offset, 16);
    const bytes = view.getUint16(offset + 6, true) * 16;
    const rotationBytes = view.getUint16(offset + 8, true);
    const scaleCount = view.getUint16(offset + 10, true);
    const translationCount = view.getUint16(offset + 14, true);
    if (rotationBytes !== jointCount * 8 || scaleCount > jointCount || translationCount > jointCount ||
        rotationBytes + (scaleCount + translationCount) * 8 > bytes) throw new Error('Invalid hero pose layout.');
    range(offset + 16, bytes);
    const rotations = new Float32Array(jointCount * 4);
    const positions = bindPositions.slice(), scales = new Float32Array(jointCount * 3).fill(1);
    for (let joint = 0; joint < jointCount; joint++) {
      let length = 0;
      for (let axis = 0; axis < 4; axis++) {
        const value = view.getInt16(offset + 16 + joint * 8 + axis * 2, true) / 32767;
        rotations[joint * 4 + axis] = axis < 3 ? -value : value;
        length += value * value;
      }
      if (length < 0.9 || length > 1.1) throw new Error('Invalid hero pose quaternion.');
      for (let axis = 0; axis < 4; axis++) rotations[joint * 4 + axis] /= Math.sqrt(length);
    }
    for (let record = 0; record < scaleCount + translationCount; record++) {
      const start = offset + 16 + rotationBytes + record * 8;
      const flags = view.getUint16(start + 6, true);
      const joint = flags & 0x7FFF;
      const scale = record < scaleCount;
      if (joint >= jointCount || Boolean(flags & 0x8000) !== scale) throw new Error('Invalid hero pose transform index.');
      for (let axis = 0; axis < 3; axis++) {
        (scale ? scales : positions)[joint * 3 + axis] = view.getInt16(start + axis * 2, true) * (scale ? 1 / 4096 : unit);
      }
    }
    const rate = view.getFloat32(offset, true);
    if (!Number.isFinite(rate) || rate <= 0 || rate > 4) throw new Error('Invalid hero pose frame rate.');
    return { rotations, positions, scales, rate };
  }
  const clips = new Map();
  for (const id of [0, 4, 7]) {
    const sequence = model.sequences[id];
    if (!sequence) throw new Error(`Hero animation ${id} is missing.`);
    clips.set(id, sequence.frames.map(readFrame));
  }
  return { jointCount, parents, bindPositions, clips };
}