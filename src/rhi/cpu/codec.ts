import type { PackLayout } from '../../core/manifest-types.js';

function readNumber(dv: DataView, at: number, type: string, lo = 4): number {
  switch (type) {
    case 'f32':
      return dv.getFloat32(at, true);
    case 'i32':
      return dv.getInt32(at, true);
    case 'u32':
      return dv.getUint32(at, true);
    default:
      return dv.getFloat32(at, true) + dv.getFloat32(at + lo, true);
  }
}

function writeNumber(dv: DataView, at: number, type: string, x: number, lo = 4): void {
  switch (type) {
    case 'f32':
      dv.setFloat32(at, x, true);
      return;
    case 'i32':
      dv.setInt32(at, x | 0, true);
      return;
    case 'u32':
      dv.setUint32(at, x >>> 0, true);
      return;
    default: {
      const hi = Math.fround(x);
      dv.setFloat32(at, hi, true);
      dv.setFloat32(at + lo, Math.fround(x - hi), true);
    }
  }
}

export function decode(dv: DataView, at: number, layout: PackLayout, end: number): unknown {
  switch (layout.kind) {
    case 'scalar':
      return readNumber(dv, at, layout.type);
    case 'vector': {
      const out: number[] = [];
      for (let i = 0; i < layout.size; i++)
        out.push(readNumber(dv, at + 4 * i, layout.type, layout.lo ?? 4 * layout.size));
      return out;
    }
    case 'matrix': {
      const out: number[] = [];
      for (let c = 0; c < layout.columns; c++)
        for (let r = 0; r < layout.rows; r++)
          out.push(dv.getFloat32(at + c * layout.columnStride + 4 * r, true));
      return out;
    }
    case 'array': {
      const n = layout.length ?? Math.max(0, Math.floor((end - at) / layout.stride));
      const out: unknown[] = [];
      for (let i = 0; i < n; i++) out.push(decode(dv, at + i * layout.stride, layout.element, end));
      return out;
    }
    case 'struct': {
      const out: Record<string, unknown> = {};
      for (const f of layout.fields) out[f.name] = decode(dv, at + f.offset, f.layout, end);
      return out;
    }
  }
}

export function encode(
  dv: DataView,
  at: number,
  layout: PackLayout,
  v: unknown,
  end: number,
): void {
  switch (layout.kind) {
    case 'scalar':
      writeNumber(dv, at, layout.type, v as number);
      return;
    case 'vector': {
      const xs = v as readonly number[];
      for (let i = 0; i < layout.size; i++)
        writeNumber(dv, at + 4 * i, layout.type, xs[i]!, layout.lo ?? 4 * layout.size);
      return;
    }
    case 'matrix': {
      const xs = v as readonly number[];
      for (let c = 0; c < layout.columns; c++)
        for (let r = 0; r < layout.rows; r++)
          dv.setFloat32(at + c * layout.columnStride + 4 * r, xs[c * layout.rows + r]!, true);
      return;
    }
    case 'array': {
      const xs = v as readonly unknown[];
      for (let i = 0; i < xs.length; i++) {
        const where = at + i * layout.stride;
        if (layout.length === null && where + layout.stride > end) break;
        encode(dv, where, layout.element, xs[i], end);
      }
      return;
    }
    case 'struct': {
      const o = v as Readonly<Record<string, unknown>>;
      for (const f of layout.fields) encode(dv, at + f.offset, f.layout, o[f.name], end);
      return;
    }
  }
}
