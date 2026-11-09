// An image source uploaded to a WebGL2 texture, as the call layer's WebGL2 draws and entry calls
// upload one (change 0050). The render hardware interface (`rhi/`, change 0120) takes no image
// source yet, so the call layer uploads it into the context the backend runs on. It imports one
// type, so a closure that reaches it reaches no backend.

import type { Sampling } from './host-entry.js';

/** The part of `WebGL2RenderingContext` an image upload uses. */
export interface GlImage {
  pixelStorei(p: number, v: number | boolean): void;
  texImage2D(
    t: number,
    level: number,
    internal: number,
    format: number,
    type: number,
    source: object,
  ): void;
  texParameteri(t: number, p: number, v: number): void;
  createTexture(): object | null;
  activeTexture(unit: number): void;
  bindTexture(t: number, tex: object | null): void;
  deleteTexture(t: object | null): void;
}

/** The constants of `WebGL2RenderingContext` an image upload uses; the values are the
 *  specification's. */
export const GL_IMAGE = {
  TEXTURE_2D: 0x0de1,
  TEXTURE0: 0x84c0,
  RGBA: 0x1908,
  UNSIGNED_BYTE: 0x1401,
  TEXTURE_MIN_FILTER: 0x2801,
  TEXTURE_MAG_FILTER: 0x2800,
  TEXTURE_WRAP_S: 0x2802,
  TEXTURE_WRAP_T: 0x2803,
  NEAREST: 0x2600,
  LINEAR: 0x2601,
  CLAMP_TO_EDGE: 0x812f,
  REPEAT: 0x2901,
  MIRRORED_REPEAT: 0x8370,
  UNPACK_FLIP_Y_WEBGL: 0x9240,
  UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,
} as const;

const GL_WRAP = {
  clamp: GL_IMAGE.CLAMP_TO_EDGE,
  repeat: GL_IMAGE.REPEAT,
  mirror: GL_IMAGE.MIRRORED_REPEAT,
} as const;

/** Upload an image source into the `TEXTURE_2D` bound to `gl`'s active unit as `RGBA8`, with the
 *  filter and the address of `s`. The first row of the image is texture coordinate 0, as it is
 *  on WebGPU. A compute entry's call in the plan of a `fuse` scope (`host-compute.ts`) uploads
 *  its images here; a draw and an entry call outside a scope upload into a texture the WebGL2
 *  backend made (`glImageTexture` in `host-draw.ts`, change 0120). */
export function uploadImage(
  gl: Pick<GlImage, 'pixelStorei' | 'texImage2D' | 'texParameteri'>,
  source: object,
  s: Sampling,
): void {
  gl.pixelStorei(GL_IMAGE.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(GL_IMAGE.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(
    GL_IMAGE.TEXTURE_2D,
    0,
    GL_IMAGE.RGBA,
    GL_IMAGE.RGBA,
    GL_IMAGE.UNSIGNED_BYTE,
    source,
  );
  const filter = s.filter === 'nearest' ? GL_IMAGE.NEAREST : GL_IMAGE.LINEAR;
  gl.texParameteri(GL_IMAGE.TEXTURE_2D, GL_IMAGE.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(GL_IMAGE.TEXTURE_2D, GL_IMAGE.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(GL_IMAGE.TEXTURE_2D, GL_IMAGE.TEXTURE_WRAP_S, GL_WRAP[s.address]);
  gl.texParameteri(GL_IMAGE.TEXTURE_2D, GL_IMAGE.TEXTURE_WRAP_T, GL_WRAP[s.address]);
}
