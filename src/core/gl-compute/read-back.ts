import { gpuDone } from '../gl-fence.js';

export interface Rect {
  readonly tex: WebGLTexture;
  readonly layer: number;
  readonly x: number;
  readonly w: number;
  readonly h: number;
}

export interface PackBuffer {
  readonly buffer: WebGLBuffer;
  bytes: number;
}

export async function readBack(
  gl: WebGL2RenderingContext,
  fbo: WebGLFramebuffer,
  pack: PackBuffer,
  rects: readonly Rect[],
): Promise<Uint32Array> {
  const words = rects.reduce((n, r) => n + r.w * r.h * 4, 0);
  const buffer = pack.buffer;
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
  if (pack.bytes < words * 4) {
    gl.bufferData(gl.PIXEL_PACK_BUFFER, words * 4, gl.STREAM_READ);
    pack.bytes = words * 4;
  }
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fbo);
  let at = 0;
  for (const r of rects) {
    gl.framebufferTextureLayer(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, r.tex, 0, r.layer);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(r.x, 0, r.w, r.h, gl.RGBA_INTEGER, gl.UNSIGNED_INT, at * 4);
    at += r.w * r.h * 4;
  }
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  await gpuDone(gl);
  const out = new Uint32Array(words);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
  gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, out);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  return out;
}
