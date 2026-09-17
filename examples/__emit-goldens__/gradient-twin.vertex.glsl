#version 300 es
precision highp float;
precision highp int;

out vec2 uv;

void main() {
  uint idx = uint(gl_VertexID);
  vec2 pos = vec2(-1.0, -1.0);
  if ((idx == 1u)) {
    pos = vec2(3.0, -1.0);
  } else if ((idx == 2u)) {
    pos = vec2(-1.0, 3.0);
  }
  gl_Position = vec4(pos, 0.0, 1.0);
  uv = vec2(((pos.x + 1.0) * 0.5), ((pos.y + 1.0) * 0.5));
}
