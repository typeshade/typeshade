#version 300 es
precision highp float;
precision highp int;

layout(std140) uniform Uniforms {
  mat4 model;
  mat3 tint;
} u;
in vec2 uv;
in vec3 normal;
layout(location = 0) out vec4 _ret;

void main() {
  mat3 basis = mat3(vec3(1.0, 0.0, 0.0), vec3(0.0, 1.0, 0.0), vec3(0.0, 0.0, 1.0));
  mat3 scaled = ((0.5 * basis) * 2.0);
  mat2x3 wide = mat2x3(vec3(uv.x, uv.y, 1.0), vec3(uv.y, uv.x, 1.0));
  mat3x2 tall = transpose(wide);
  vec2 row = (normal * wide);
  vec2 col = (tall * normal);
  vec3 rgb = ((scaled * u.tint) * vec3(row.x, col.y, abs((row.y - col.x))));
  _ret = vec4(rgb, 1.0);
}
