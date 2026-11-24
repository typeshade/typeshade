import { gpuDone } from '../../core/gl-compute.js';
import type { GlFormat } from './format.js';
import type { GlState } from './state.js';
import { depthToColour } from './depth-readback.js';

export async function readTexels(
  s: GlState,
  tex: WebGLTexture,
  format: string,
  fmt: GlFormat,
  w: number,
  h: number,
  bytes: number,
): Promise<Uint8Array> {
  const gl = s.gl;
  let source = tex;
  let scratch: WebGLTexture | undefined;
  if (fmt.kind === 'depth') {
    // Why: WebGL2 reads no depth back, so a pass copies it into an r32float texture first.
    scratch = depthToColour(s, tex, w, h);
    source = scratch;
  }
  const cls: 'bytes' | 'float' | 'uint' | 'sint' | 'packed' =
    fmt.kind === 'depth'
      ? 'float'
      : fmt.kind === 'uint'
        ? 'uint'
        : fmt.kind === 'sint'
          ? 'sint'
          : format === 'rgb10a2unorm'
            ? 'packed'
            : fmt.type === gl.UNSIGNED_BYTE
              ? 'bytes'
              : 'float';
  const texels = w * h;
  const lanes = cls === 'packed' ? 1 : 4;
  const size = texels * lanes * (cls === 'bytes' ? 1 : 4);
  const buffer = gl.createBuffer()!;
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
  gl.bufferData(gl.PIXEL_PACK_BUFFER, size, gl.STREAM_READ);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, s.blitFbo);
  gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, source, 0);
  gl.readBuffer(gl.COLOR_ATTACHMENT0);
  gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
  const [f, t] =
    cls === 'bytes'
      ? [gl.RGBA, gl.UNSIGNED_BYTE]
      : cls === 'float'
        ? [gl.RGBA, gl.FLOAT]
        : cls === 'uint'
          ? [gl.RGBA_INTEGER, gl.UNSIGNED_INT]
          : cls === 'sint'
            ? [gl.RGBA_INTEGER, gl.INT]
            : [gl.RGBA, gl.UNSIGNED_INT_2_10_10_10_REV];
  gl.readPixels(0, 0, w, h, f, t, 0);
  gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  if (scratch !== undefined) gl.deleteTexture(scratch);
  await gpuDone(gl);
  const raw = new ArrayBuffer(size);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
  gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, new Uint8Array(raw));
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  gl.deleteBuffer(buffer);
  return texelBytes(raw, cls, format, fmt, texels, bytes);
}

function texelBytes(
  raw: ArrayBuffer,
  cls: 'bytes' | 'float' | 'uint' | 'sint' | 'packed',
  format: string,
  fmt: GlFormat,
  texels: number,
  bytes: number,
): Uint8Array {
  const out = new Uint8Array(texels * bytes);
  if (cls === 'packed') {
    out.set(new Uint8Array(raw));
    return out;
  }
  const c = fmt.channels;
  const order = fmt.bgra === true ? [2, 1, 0, 3] : [0, 1, 2, 3];
  if (cls === 'bytes') {
    const src = new Uint8Array(raw);
    for (let i = 0; i < texels; i++)
      for (let k = 0; k < c; k++) out[i * c + k] = src[i * 4 + order[k]!]!;
    return out;
  }
  if (format === 'rgb10a2uint') {
    const src = new Uint32Array(raw);
    const words = new Uint32Array(out.buffer);
    for (let i = 0; i < texels; i++)
      words[i] =
        (src[i * 4]! |
          (src[i * 4 + 1]! << 10) |
          (src[i * 4 + 2]! << 20) |
          (src[i * 4 + 3]! << 30)) >>>
        0;
    return out;
  }
  if (format === 'rg11b10ufloat') {
    const src = new Float32Array(raw);
    const words = new Uint32Array(out.buffer);
    for (let i = 0; i < texels; i++)
      words[i] =
        (smallBits(src[i * 4]!, 6) |
          (smallBits(src[i * 4 + 1]!, 6) << 11) |
          (smallBits(src[i * 4 + 2]!, 5) << 22)) >>>
        0;
    return out;
  }
  const per = bytes / c;
  const view = new DataView(out.buffer);
  const src =
    cls === 'float'
      ? new Float32Array(raw)
      : cls === 'uint'
        ? new Uint32Array(raw)
        : new Int32Array(raw);
  for (let i = 0; i < texels; i++)
    for (let k = 0; k < c; k++) {
      const v = src[i * 4 + order[k]!]!;
      const at = (i * c + k) * per;
      if (cls === 'float') {
        if (per === 4) view.setFloat32(at, v, true);
        else view.setUint16(at, halfBits(v), true);
      } else if (per === 4) view.setUint32(at, v >>> 0, true);
      else if (per === 2) view.setUint16(at, v & 0xffff, true);
      else view.setUint8(at, v & 0xff);
    }
  return out;
}

function halfBits(v: number): number {
  const sign = Object.is(v, -0) || v < 0 ? 0x8000 : 0;
  return sign | smallBits(Math.abs(v), 10);
}

function smallBits(v: number, m: number): number {
  if (Number.isNaN(v)) return (31 << m) | 1;
  if (v === Infinity) return 31 << m;
  if (v <= 0) return 0;
  let e = Math.floor(Math.log2(v));
  if (e < -14) return Math.round(v / 2 ** (-14 - m));
  let f = Math.round((v / 2 ** e - 1) * 2 ** m);
  if (f === 2 ** m) {
    f = 0;
    e++;
  }
  return ((e + 15) << m) | f;
}
