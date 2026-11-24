import type { GlComputeProgram } from '../passes/gl-compute.js';
import { compile } from './program-cache.js';
import { drawn } from './refused-draw-check.js';
import type { Layered } from './word-textures.js';

type Image = NonNullable<GlComputeProgram['storageTextures']>[number] & {
  readonly texture: WebGLTexture;
  readonly width: number;
  readonly height: number;
  readonly layers: number;
  readonly root: number;
};

const TRIANGLE_VS = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

const PREFIX = { float: '', uint: 'u', sint: 'i' } as const;

function attach(gl: WebGL2RenderingContext, fbo: WebGLFramebuffer, t: Image, layer: number): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  if (t.dim === '2d-array')
    gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, t.texture, 0, layer);
  else gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.texture, 0);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
}

export function renderable(gl: WebGL2RenderingContext, fbo: WebGLFramebuffer, t: Image): void {
  if (/float$/.test(t.format)) gl.getExtension('EXT_color_buffer_float');
  attach(gl, fbo, t, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
  if (status !== gl.FRAMEBUFFER_COMPLETE)
    throw new Error(
      `typeshade/webgl2: the storage texture '${t.name}' is ${t.format}, which this WebGL2 context does not render to and the WebGL2 tier has no fallback for yet (Rule 10.5)${
        /float$/.test(t.format) && gl.getExtension('EXT_color_buffer_float') === null
          ? ' (it has no EXT_color_buffer_float)'
          : ''
      }; was it made with that format?`,
    );
}

function plainState(gl: WebGL2RenderingContext): void {
  for (const cap of [gl.BLEND, gl.DEPTH_TEST, gl.STENCIL_TEST, gl.SCISSOR_TEST, gl.CULL_FACE])
    gl.disable(cap);
  gl.disable(gl.RASTERIZER_DISCARD);
  gl.colorMask(true, true, true, true);
}

export function imageIn(
  gl: WebGL2RenderingContext,
  fbo: WebGLFramebuffer,
  p: GlComputeProgram,
  t: Image,
  mem: Layered,
): void {
  const { width: W, layerRows: LH } = p.layout;
  const arr = t.dim === '2d-array';
  const sampler = `${PREFIX[t.texel]}sampler2D${arr ? 'Array' : ''}`;
  const bits =
    t.texel === 'float' ? 'floatBitsToUint(v[c])' : t.texel === 'sint' ? 'uint(v[c])' : 'v[c]';
  const fs = `#version 300 es
precision highp float;
precision highp int;
precision highp ${sampler};
uniform ${sampler} u_src;
uniform uint u_layer;
uniform uint u_w;
uniform uint u_h;
uniform uint u_n;
out uvec4 o;
void main() {
  uint wi = (u_layer * ${String(LH)}u + uint(gl_FragCoord.y)) * ${String(W)}u + uint(gl_FragCoord.x);
  uint texel = wi / 4u;
  int c = int(wi % 4u);
  o = uvec4(0u);
  if (texel >= u_w * u_h * u_n) return;
  uint x = texel % u_w;
  uint y = (texel / u_w) % u_h;
  ${PREFIX[t.texel]}vec4 v = texelFetch(u_src, ${arr ? 'ivec3(int(x), int(y), int(texel / (u_w * u_h)))' : 'ivec2(int(x), int(y))'}, 0);
  o = uvec4(${bits}, 0u, 0u, 0u);
}
`;
  const program = compile(gl, TRIANGLE_VS, fs, `the read of storage texture '${t.name}'`);
  const nearest = gl.createSampler()!;
  gl.samplerParameteri(nearest, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.samplerParameteri(nearest, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const target = arr ? gl.TEXTURE_2D_ARRAY : gl.TEXTURE_2D;
  try {
    gl.useProgram(program);
    plainState(gl);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(target, t.texture);
    gl.bindSampler(0, nearest);
    gl.uniform1i(gl.getUniformLocation(program, 'u_src'), 0);
    gl.uniform1ui(gl.getUniformLocation(program, 'u_w'), t.width);
    gl.uniform1ui(gl.getUniformLocation(program, 'u_h'), t.height);
    gl.uniform1ui(gl.getUniformLocation(program, 'u_n'), t.layers);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.viewport(0, 0, W, mem.h);
    for (let l = 0; l < mem.layers; l++) {
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, mem.tex, 0, l);
      gl.uniform1ui(gl.getUniformLocation(program, 'u_layer'), l);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    drawn(gl, `${p.entry}'s read of storage texture '${t.name}'`);
  } finally {
    gl.bindSampler(0, null);
    gl.bindTexture(target, null);
    gl.deleteSampler(nearest);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
}

export function imageOut(
  gl: WebGL2RenderingContext,
  fbo: WebGLFramebuffer,
  p: GlComputeProgram,
  t: Image,
  mem: Layered,
): void {
  const { width: W, layerRows: LH } = p.layout;
  const out = `${PREFIX[t.texel]}vec4`;
  const value = t.texel === 'float' ? 'uintBitsToFloat(b)' : t.texel === 'sint' ? 'ivec4(b)' : 'b';
  const fs = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2DArray;
uniform usampler2DArray u_mem;
uniform uint u_layer;
uniform uint u_w;
uniform uint u_h;
out ${out} o;
uint word(uint w) {
  uint row = w / ${String(W)}u;
  return texelFetch(u_mem, ivec3(int(w % ${String(W)}u), int(row % ${String(LH)}u), int(row / ${String(LH)}u)), 0).x;
}
void main() {
  uint at = ((u_layer * u_h + uint(gl_FragCoord.y)) * u_w + uint(gl_FragCoord.x)) * 4u;
  uvec4 b = uvec4(word(at), word(at + 1u), word(at + 2u), word(at + 3u));
  o = ${value};
}
`;
  const program = compile(gl, TRIANGLE_VS, fs, `the write of storage texture '${t.name}'`);
  try {
    gl.useProgram(program);
    plainState(gl);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, mem.tex);
    gl.bindSampler(0, null);
    gl.uniform1i(gl.getUniformLocation(program, 'u_mem'), 0);
    gl.uniform1ui(gl.getUniformLocation(program, 'u_w'), t.width);
    gl.uniform1ui(gl.getUniformLocation(program, 'u_h'), t.height);
    gl.viewport(0, 0, t.width, t.height);
    for (let l = 0; l < t.layers; l++) {
      attach(gl, fbo, t, l);
      gl.uniform1ui(gl.getUniformLocation(program, 'u_layer'), l);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    drawn(gl, `${p.entry}'s write of storage texture '${t.name}'`);
  } finally {
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
}
