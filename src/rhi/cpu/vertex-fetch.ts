import type { CpuBuffer } from './buffer.js';

interface AttributeFormat {
  readonly kind: 'float' | 'uint' | 'sint' | 'unorm' | 'snorm';
  readonly bits: 8 | 16 | 32;
  readonly n: number;
}

export function attributeFormat(format: string): AttributeFormat {
  const m = /^(float|uint|sint|unorm|snorm)(8|16|32)(?:x([234]))?$/.exec(format);
  if (m === null || (m[1] === 'float' && m[2] === '8'))
    throw new TypeError(`Vertex format "${format}" is not supported yet on the CPU tier.`);
  return {
    kind: m[1] as AttributeFormat['kind'],
    bits: Number(m[2]) as 8 | 16 | 32,
    n: m[3] === undefined ? 1 : Number(m[3]),
  };
}

function half(h: number): number {
  const e = (h >> 10) & 0x1f;
  const m = h & 0x3ff;
  const s = h & 0x8000 ? -1 : 1;
  if (e === 0) return s * m * 2 ** -24;
  if (e === 31) return m === 0 ? s * Infinity : NaN;
  return s * (1 + m / 1024) * 2 ** (e - 15);
}

function readComponent(dv: DataView, at: number, f: AttributeFormat): number {
  switch (f.bits) {
    case 32:
      return f.kind === 'float'
        ? dv.getFloat32(at, true)
        : f.kind === 'sint'
          ? dv.getInt32(at, true)
          : dv.getUint32(at, true);
    case 16: {
      if (f.kind === 'float') return half(dv.getUint16(at, true));
      const v =
        f.kind === 'sint' || f.kind === 'snorm' ? dv.getInt16(at, true) : dv.getUint16(at, true);
      return f.kind === 'unorm' ? v / 65535 : f.kind === 'snorm' ? Math.max(-1, v / 32767) : v;
    }
    case 8: {
      const v = f.kind === 'sint' || f.kind === 'snorm' ? dv.getInt8(at) : dv.getUint8(at);
      return f.kind === 'unorm' ? v / 255 : f.kind === 'snorm' ? Math.max(-1, v / 127) : v;
    }
  }
}

export interface Attribute {
  readonly slot: number;
  readonly stride: number;
  readonly offset: number;
  readonly format: AttributeFormat;
}

export function attributeValue(
  a: Attribute,
  buffers: readonly (CpuBuffer | undefined)[],
  i: number,
  width: number,
): unknown {
  const buffer = buffers[a.slot];
  if (buffer === undefined)
    throw new TypeError(`The draw reads vertex buffer slot ${a.slot}, which no buffer is set to.`);
  const dv = new DataView(buffer.bytes.buffer);
  const at = i * a.stride + a.offset;
  const size = (a.format.bits / 8) * a.format.n;
  if (at + size > buffer.size)
    throw new TypeError(
      `The draw reads vertex ${i} of slot ${a.slot} at byte ${at}, past the buffer's ${buffer.size} bytes.`,
    );
  const out: number[] = [];
  for (let c = 0; c < width; c++) {
    const v =
      c < a.format.n ? readComponent(dv, at + (c * a.format.bits) / 8, a.format) : c === 3 ? 1 : 0;
    out.push(
      a.format.kind === 'float' || a.format.kind === 'unorm' || a.format.kind === 'snorm'
        ? Math.fround(v)
        : v,
    );
  }
  return width === 1 ? out[0] : out;
}
