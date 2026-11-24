import type { GlState } from './state.js';

export function blitScreen(s: GlState, attachment: number, way: 'in' | 'out'): void {
  const gl = s.gl;
  const { w, h } = s.screen();
  const fbo = s.fbo;
  if (way === 'out') {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.readBuffer(gl.COLOR_ATTACHMENT0 + attachment);
  } else {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, fbo);
    gl.readBuffer(gl.BACK);
    const only = Array.from({ length: attachment + 1 }, (_, k) =>
      k === attachment ? gl.COLOR_ATTACHMENT0 + attachment : gl.NONE,
    );
    gl.drawBuffers(only);
  }
  gl.blitFramebuffer(0, 0, w, h, 0, h, w, 0, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
}
