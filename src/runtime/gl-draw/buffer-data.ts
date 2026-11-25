import { byteSize, describe, Misfit, pack, type Layout } from '../../core/host-entry.js';
import type { PackBinding, PackEntry } from '../../core/manifest-types.js';
import { decide, geometryKind, residentState } from '../../core/resident.js';
import { hostSite } from '../../core/submission.js';
import { at } from '../program.js';
import type { RhiBuffer, RhiDevice } from '../../rhi/rhi.js';
import type { GlDrawing } from './drawing.js';

export const dataElemOf = (b: PackBinding): 'f32' | 'i32' | 'u32' => {
  const format = b.dataTexture?.format ?? 'r32float';
  return format === 'r32uint' ? 'u32' : format === 'r32sint' ? 'i32' : 'f32';
};

export function fresh(
  rhi: RhiDevice,
  made: RhiBuffer[],
  kind: 'uniform' | 'storage' | 'vertex' | 'index',
  bytes: ArrayBufferView,
  elem?: 'f32' | 'i32' | 'u32',
): RhiBuffer {
  const b = rhi.createBuffer({
    size: bytes.byteLength,
    usage: [kind, 'copy-dst'],
    ...(kind === 'storage' && elem !== undefined ? { elem } : {}),
  });
  made.push(b);
  rhi.writeBuffer(b, 0, bytes);
  return b;
}

export function bufferSource(
  d: GlDrawing,
  v: unknown,
  field: 'vertices' | 'indices',
  entry: PackEntry,
): (made: RhiBuffer[]) => RhiBuffer {
  const usage = field === 'indices' ? 'index' : 'vertex';
  const state = residentState(v);
  if (state !== undefined) {
    decide(
      state,
      geometryKind(field, entry.vertex?.attributes),
      `"${entry.name}"${at(entry)}: the geometry's ${field}`,
      hostSite,
    );
    const host = state.view();
    const takes =
      field === 'indices'
        ? host instanceof Uint32Array
        : host instanceof Float32Array || host instanceof Int32Array || host instanceof Uint32Array;
    if (!takes)
      throw new TypeError(
        `"${entry.name}"${at(entry)}: the geometry's ${field} is a Buffer of ${describe(host)}; ${
          field === 'indices'
            ? 'indices take a Buffer<u32>'
            : 'vertices take a Buffer<f32>, a Buffer<i32> or a Buffer<u32>'
        }.`,
      );
    return () =>
      d.uploaded(state, field, state.host as ArrayBufferView, (size) =>
        d.rhi.createBuffer({ size, usage: [usage, 'copy-dst'] }),
      );
  }
  if (ArrayBuffer.isView(v)) {
    const copy = new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
    return (made) => fresh(d.rhi, made, usage, copy);
  }
  const host = typeof v === 'object' && v !== null ? d.rhi.fromNative('buffer', v) : undefined;
  if (host !== undefined) return () => host;
  throw new TypeError(
    `"${entry.name}"${at(entry)}: the geometry's ${field} on WebGL2 take a typed array, a Buffer or a WebGLBuffer; got ${describe(v)}.`,
  );
}

export function packed(layout: Layout, v: unknown, name: string, where: string): Uint8Array {
  try {
    const bytes = new ArrayBuffer(byteSize(layout, v, name));
    pack(new DataView(bytes), 0, layout, v, name);
    return new Uint8Array(bytes);
  } catch (err) {
    if (err instanceof Misfit) throw new TypeError(`${where}: ${err.path} ${err.problem}.`);
    throw err;
  }
}
