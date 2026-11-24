import type { GL } from './types.js';

export function texelView(gl: GL, type: number, data: ArrayBufferView): ArrayBufferView {
  const at = [data.buffer, data.byteOffset] as const;
  const n = (size: number): number => Math.floor(data.byteLength / size);
  switch (type) {
    case gl.FLOAT:
      return new Float32Array(...at, n(4));
    case gl.HALF_FLOAT:
    case gl.UNSIGNED_SHORT:
      return new Uint16Array(...at, n(2));
    case gl.SHORT:
      return new Int16Array(...at, n(2));
    case gl.UNSIGNED_INT:
    case gl.UNSIGNED_INT_2_10_10_10_REV:
    case gl.UNSIGNED_INT_10F_11F_11F_REV:
    case gl.UNSIGNED_INT_24_8:
      return new Uint32Array(...at, n(4));
    case gl.INT:
      return new Int32Array(...at, n(4));
    case gl.BYTE:
      return new Int8Array(...at, data.byteLength);
    default:
      return new Uint8Array(...at, data.byteLength);
  }
}
