#version 300 es
precision highp float;
precision highp int;

struct VsOut {
  vec4 pos;
  vec2 uv;
};
layout(std140) uniform Uniforms {
  float time;
  vec2 resolution;
} U;
in vec2 uv;
layout(location = 0) out vec4 _ret;

void main() {
  VsOut vo;
  vo.pos = gl_FragCoord;
  vo.uv = uv;
  float t = U.time;
  vec2 uv = vo.uv;
  float v = ((sin(((uv.x * 10.0) + t)) + sin(((uv.y * 10.0) + t))) + sin((((uv.x + uv.y) * 10.0) + (t * 0.7))));
  vec3 col = ((vec3(sin(v), sin((v + 2.094)), sin((v + 4.188))) * 0.5) + 0.5);
  _ret = vec4(col, 1.0);
}
