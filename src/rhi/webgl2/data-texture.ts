import type { GL } from './types.js';

export const DATA_WIDTH = 2048;

export function dataTexture(gl: GL, elem: 'f32' | 'i32' | 'u32', bytes: Uint8Array): WebGLTexture {
  const words = Math.max(1, Math.ceil(bytes.byteLength / 4));
  const w = Math.min(words, DATA_WIDTH);
  const h = Math.ceil(words / w);
  const data = new Uint8Array(w * h * 4);
  data.set(bytes);
  const [internal, fmt, type, view] =
    elem === 'u32'
      ? [gl.R32UI, gl.RED_INTEGER, gl.UNSIGNED_INT, new Uint32Array(data.buffer)]
      : elem === 'i32'
        ? [gl.R32I, gl.RED_INTEGER, gl.INT, new Int32Array(data.buffer)]
        : [gl.R32F, gl.RED, gl.FLOAT, new Float32Array(data.buffer)];
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texStorage2D(gl.TEXTURE_2D, 1, internal, w, h);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, fmt, type, view);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return t;
}

export function bindTexture(gl: GL, unit: number, tex: WebGLTexture, sampler: WebGLSampler): void {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.bindSampler(unit, sampler);
}
