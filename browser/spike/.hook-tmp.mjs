process.on('exit', () => {
  const ctx = globalThis.__ctx; if (!ctx) return;
  const v = ctx.view(), h = 0x13F350;
  const moby = v.getUint32(h + 0x2080, true);
  console.log('level mode', v.getInt32(0x15F5C4, true), 'hero state', v.getInt32(h + 0x2084, true), 'control_mode', v.getInt32(h + 0x208C, true), 'pos', [0, 4, 8].map((o) => v.getFloat32(moby + 0x10 + o, true).toFixed(1)).join(','), 'hp', v.getInt32(h + 0x22A8, true));
});
process.on('exit', () => { const ctx = globalThis.__ctx; if (ctx) console.log('streams without header', ctx.exports.spike_streams_without_header?.(), 'started', ctx.exports.spike_sound_stream_starts?.()); });
