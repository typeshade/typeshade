import type { GlComputeProgram } from '../passes/gl-compute.js';

export const NO_FRAGMENTS = `#version 300 es
precision highp float;
out vec4 c;
void main() { c = vec4(0.0); }
`;

export function scatterSources(p: GlComputeProgram): { vs: string; fs: string } {
  const { width: W, layerRows: LH } = p.layout;
  const vs = `#version 300 es
precision highp int;
precision highp float;
precision highp usampler2DArray;
uniform usampler2DArray u_rec;
uniform uint u_root;
uniform uint u_layer;
uniform uint u_base;
uniform uint u_mh;
uniform uint u_slots;
flat out uint v;
uint word(uint local, uint w) {
  uvec4 t = texelFetch(u_rec, ivec3(int(w / 4u), int(local % ${String(LH)}u), int(local / ${String(LH)}u)), 0);
  return t[w % 4u];
}
void main() {
  uint i = uint(gl_VertexID) / u_slots;
  uint slot = uint(gl_VertexID) % u_slots;
  uint local = i - u_base;
  gl_PointSize = 1.0;
  gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
  v = 0u;
  if (slot >= word(local, ${String(p.countWord)}u)) return;
  uint key = word(local, ${String(p.keysAt)}u + slot);
  if ((key >> 28u) != u_root) return;
  uint w = key & 0x0fffffffu;
  uint row = w / ${String(W)}u;
  if (row / ${String(LH)}u != u_layer) return;
  v = word(local, ${String(p.valuesAt)}u + slot);
  gl_Position = vec4((float(w % ${String(W)}u) + 0.5) / ${String(W)}.0 * 2.0 - 1.0,
                     (float(row % ${String(LH)}u) + 0.5) / float(u_mh) * 2.0 - 1.0, 0.0, 1.0);
}
`;
  const fs = `#version 300 es
precision highp int;
precision highp float;
flat in uint v;
out uvec4 o;
void main() { o = uvec4(v, 0u, 0u, 0u); }
`;
  return { vs, fs };
}
