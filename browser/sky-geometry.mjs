export function readSkyGeometry(bytes, skyOffset, nativeBase) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  function range(offset, length) {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) ||
        length < 0 || offset > bytes.length || length > bytes.length - offset) {
      throw new Error('Sky geometry points outside the decoded resident archive.');
    }
    return offset;
  }
  const pointer = offset => range(view.getUint32(range(offset, 4), true) - nativeBase, 0);
  range(skyOffset, 0x20);
  const count = view.getInt16(skyOffset + 6, true);
  if (count < 0 || count > 64) throw new Error('Unsupported sky shell count.');
  range(skyOffset + 0x20, count * 4);
  const shells = [];
  let totalTriangles = 0;
  for (let shellIndex = 0; shellIndex < count; shellIndex++) {
    const shell = pointer(skyOffset + 0x20 + shellIndex * 4);
    range(shell, 16);
    const clusters = view.getInt32(shell, true);
    if (clusters < 0 || clusters > 65536) throw new Error('Unsupported sky cluster count.');
    range(shell + 16, clusters * 32);
    const coloured = view.getInt32(shell + 4, true) !== 0;
    const positions = [];
    const colours = [];
    const uvs = [];
    const materials = [];
    for (let cluster = 0; cluster < clusters; cluster++) {
      const tile = shell + 16 + cluster * 32;
      const payload = pointer(tile + 16);
      const vertices = view.getUint16(tile + 20, true);
      const triangles = view.getUint16(tile + 22, true);
      const vertexOffset = payload + view.getUint16(tile + 24, true);
      const attributeOffset = payload + view.getUint16(tile + 26, true);
      const triangleOffset = payload + view.getUint16(tile + 28, true);
      totalTriangles += triangles;
      if (totalTriangles > 250000) throw new Error('Sky geometry exceeds the triangle budget.');
      range(payload, view.getUint16(tile + 30, true));
      range(vertexOffset, vertices * 8);
      range(attributeOffset, vertices * 4);
      range(triangleOffset, triangles * 4);
      for (let triangle = 0; triangle < triangles; triangle++) {
        const entry = triangleOffset + triangle * 4;
        materials.push(bytes[entry + 3]);
        for (let corner = 0; corner < 3; corner++) {
          const index = bytes[entry + corner];
          if (index >= vertices) throw new Error('Sky triangle references an absent vertex.');
          const vertex = vertexOffset + index * 8;
          positions.push(view.getInt16(vertex, true) / 1024,
            view.getInt16(vertex + 2, true) / 1024, view.getInt16(vertex + 4, true) / 1024);
          const attribute = attributeOffset + index * 4;
          colours.push(...[0, 1, 2].map(channel => Math.min(bytes[attribute + channel] / 128, 1)));
          uvs.push(view.getUint16(attribute, true) / 4096, view.getUint16(attribute + 2, true) / 4096);
        }
      }
    }
    shells.push({ index: shellIndex, coloured, positions: new Float32Array(positions),
      colours: new Float32Array(colours), uvs: new Float32Array(uvs), materials });
  }
  return shells;
}

export function readSkyTextures(bytes, skyOffset, nativeBase) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const table = view.getUint32(skyOffset + 0x10, true) - nativeBase;
  const payload = view.getUint32(skyOffset + 0x14, true) - nativeBase;
  const count = view.getUint16(skyOffset + 0xC, true);
  if (count > 1024 || table < 0 || table + count * 16 > bytes.length || payload < 0) {
    throw new Error('Sky texture table is outside the resident archive.');
  }
  return Array.from({ length: count }, (_, index) => {
    const entry = table + index * 16;
    const width = 2 ** view.getUint16(entry + 12, true);
    const height = 2 ** view.getUint16(entry + 14, true);
    const palette = payload + view.getUint16(entry + 10, true) * 16;
    const pixels = payload + view.getUint16(entry + 8, true) * 16;
    if (width > 1024 || height > 1024 || palette + 1024 > bytes.length || pixels + width * height > bytes.length) {
      throw new Error('Sky texture pixels are outside the resident archive.');
    }
    const rgba = new Uint8Array(width * height * 4);
    for (let pixel = 0; pixel < width * height; pixel++) {
      const colour = bytes[pixels + pixel];
      const clut = (colour & 0xE7) | ((colour & 8) << 1) | ((colour & 16) >> 1);
      const source = palette + clut * 4;
      rgba.set([bytes[source], bytes[source + 1], bytes[source + 2], Math.min(bytes[source + 3] * 2, 255)], pixel * 4);
    }
    return { width, height, rgba };
  });
}