#version 300 es
precision highp float;
precision highp int;

layout(location = 0) out vec4 _ret;

void main() {
  vec4 p = gl_FragCoord;
  vec2 uv = fract((p.xy * 0.01));
  float gain = ((uv.x > 0.5) ? 1.2 : 0.6);
  vec3 tint = ((uv.y > 0.5) ? vec3(0.9, 0.4, 0.3) : vec3(0.2, 0.6, 0.9));
  float _i0a0 = uv.x;
  float _i0a1 = uv.y;
  _ret = vec4(((tint * gain) * ((_i0a0 + _i0a1) + 0.2)), 1.0);
}
