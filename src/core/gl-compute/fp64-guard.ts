export const GUARD = '_fp64';

export function declaresGuard(vertex: string): boolean {
  return new RegExp(`^uniform (?:\\w+ )*sampler2D ${GUARD};$`, 'm').test(vertex);
}

export function guardTexture(gl: WebGL2RenderingContext, t: WebGLTexture): WebGLTexture {
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 1, 1);
  gl.texSubImage2D(
    gl.TEXTURE_2D,
    0,
    0,
    0,
    1,
    1,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([255, 255, 255, 255]),
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return t;
}
