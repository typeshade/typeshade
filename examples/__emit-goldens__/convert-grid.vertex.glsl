#version 300 es
precision highp float;
precision highp int;

out vec2 uv;

void main() {
  uint vi = uint(gl_VertexID);
  uvec2 bits = uvec2((vi & 1u), (vi >> 1u));
  vec2 corner = vec2(bits);
  vec2 p = ((corner * 4.0) - vec2(1.0, 1.0));
  gl_Position = vec4(p, 0.0, 1.0);
  uv = corner;
}
