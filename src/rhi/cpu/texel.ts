import type { CpuTexture } from './canvas.js';

const unorm8 = (v: number): number =>
  Number.isNaN(v) ? 0 : Math.round(Math.min(1, Math.max(0, v)) * 255);

export function writeTexel(t: CpuTexture, i: number, c: readonly number[], mask = 0xf): void {
  const f = t.kind;
  const at = i * f.bytes;
  const dv = new DataView(t.bytes.buffer);
  f.channels.forEach((ch, k) => {
    if ((mask & (1 << ch)) === 0) return;
    const v = c[ch] ?? (ch === 3 ? 1 : 0);
    switch (f.store) {
      case 'unorm8':
        t.bytes[at + k] = unorm8(v);
        return;
      case 'u8':
        t.bytes[at + k] = v & 0xff;
        return;
      case 'f32':
        dv.setFloat32(at + 4 * k, v, true);
        return;
      case 'u32':
        dv.setUint32(at + 4 * k, v >>> 0, true);
        return;
      case 'i32':
        dv.setInt32(at + 4 * k, v | 0, true);
        return;
    }
  });
}

export function clearTexture(t: CpuTexture, value: readonly number[]): void {
  if (t.kind.store === 'opaque')
    throw new TypeError(`A "${t.format}" target clear is not supported yet on the CPU tier.`);
  const texels = t.width * t.height;
  for (let i = 0; i < texels; i++) writeTexel(t, i, value);
}

export function clearDepth(t: CpuTexture, depth: number): void {
  const f = new Float32Array(t.bytes.buffer, 0, t.width * t.height);
  f.fill(depth);
}
