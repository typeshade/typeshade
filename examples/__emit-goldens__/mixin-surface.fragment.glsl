#version 300 es
precision highp float;
precision highp int;

layout(location = 0) out vec4 _ret;

void main() {
  vec4 frag = gl_FragCoord;
  vec2 p = (frag.xy * 0.004);
  vec2 _i0a0 = vec2(0.6, 0.6);
  vec3 _i0a3 = vec3(0.95, 0.4, 0.25);
  vec3 _i1a3 = vec3(0.2, 0.55, 0.9);
  vec3 rgb = ((_i0a3 * smoothstep(0.0, 1.0, (1.0 - smoothstep(0.26999999999999996, 0.35, length((p - _i0a0)))))) + (_i1a3 * smoothstep(0.0, 1.0, (1.0 - smoothstep(0.2, 0.25, abs((p.x - 1.4)))))));
  _ret = vec4(rgb, 1.0);
}
