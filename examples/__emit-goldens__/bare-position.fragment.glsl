#version 300 es
precision highp float;
precision highp int;

layout(location = 0) out vec4 _ret;

void main() {
  vec4 p = gl_FragCoord;
  vec2 uv = fract((p.xy * 0.01));
  _ret = vec4(uv, 0.4, 1.0);
}
