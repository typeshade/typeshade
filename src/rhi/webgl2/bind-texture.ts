import type { GL } from './types.js';

export function bindTexture(gl: GL, unit: number, tex: WebGLTexture, sampler: WebGLSampler): void {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.bindSampler(unit, sampler);
}
