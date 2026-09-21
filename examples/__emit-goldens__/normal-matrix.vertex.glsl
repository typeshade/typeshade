#version 300 es
precision highp float;
precision highp int;

struct VsOut {
  vec4 pos;
  vec2 uv;
  vec3 normal;
};
layout(std140) uniform Uniforms {
  mat4 model;
  mat3 tint;
} u;
mat3 normalMatrix(mat4 model) {
  return mat3(model[0].xyz, model[1].xyz, model[2].xyz);
}
out vec2 uv;
out vec3 normal;

VsOut vs_impl(uint idx) {
  float x = ((float((idx & 1u)) * 4.0) - 1.0);
  float y = ((float((idx >> 1u)) * 4.0) - 1.0);
  mat3 n = normalMatrix(u.model);
  float handed = ((determinant(n) < 0.0) ? -1.0 : 1.0);
  vec3 normal = (n * vec3(0.0, 0.0, handed));
  return VsOut(vec4(x, y, 0.0, 1.0), vec2(((x * 0.5) + 0.5), ((y * 0.5) + 0.5)), normal);
}

void main() {
  VsOut _out = vs_impl(uint(gl_VertexID));
  gl_Position = _out.pos;
  uv = _out.uv;
  normal = _out.normal;
}
