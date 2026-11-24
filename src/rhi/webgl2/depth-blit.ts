import { compile } from '../../core/gl-compute.js';
import type { GlState } from './state.js';

const BLIT_VS = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

const DEPTH_FS = `#version 300 es
precision highp float;
uniform highp sampler2D d;
layout(location = 0) out vec4 o;
void main() {
  o = vec4(texelFetch(d, ivec2(gl_FragCoord.xy), 0).r, 0.0, 0.0, 1.0);
}
`;

export function depthToColour(s: GlState, tex: WebGLTexture, w: number, h: number): WebGLTexture {
  const gl = s.gl;
  const out = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, out);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32F, w, h);
  gl.bindTexture(gl.TEXTURE_2D, null);
  const program = compile(gl, BLIT_VS, DEPTH_FS, 'the depth read-back');
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, s.blitFbo);
  gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, out, 0);
  gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, null, 0);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
  gl.viewport(0, 0, w, h);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);
  gl.disable(gl.CULL_FACE);
  gl.disable(gl.SCISSOR_TEST);
  gl.colorMask(true, true, true, true);
  gl.useProgram(program);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.bindSampler(0, s.nearest);
  gl.uniform1i(gl.getUniformLocation(program, 'd'), 0);
  gl.bindVertexArray(null);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  return out;
}

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
