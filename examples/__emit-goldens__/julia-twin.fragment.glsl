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
  float zoom;
  vec4 mouse;
} U;
vec3 palette(float t) {
  vec3 ph = vec3(0.0, 0.33, 0.67);
  return (vec3(0.5, 0.5, 0.5) + (cos(((t + ph) * 6.283)) * 0.5));
}
in vec2 uv;
layout(location = 0) out vec4 _ret;

void main() {
  VsOut vo;
  vo.pos = gl_FragCoord;
  vo.uv = uv;
  vec2 uv = vo.uv;
  vec2 z = (vec2(((uv.x * 2.0) - 1.0), ((uv.y * 2.0) - 1.0)) * U.zoom);
  vec4 m = U.mouse;
  vec2 res = U.resolution;
  vec2 orbit = vec2(((cos((U.time * 0.31)) * 0.39) - 0.4), (sin((U.time * 0.41)) * 0.39));
  vec2 held = vec2(((((m.x / res.x) * 2.0) - 1.0) * 0.8), ((((m.y / res.y) * 2.0) - 1.0) * 0.8));
  vec2 c = mix(orbit, held, m.w);
  float it = 0.0;
  for (uint i = 0u; (i < 96u); i = (i + 1u)) {
    if ((dot(z, z) > 4.0)) {
      break;
    }
    z = vec2((((z.x * z.x) - (z.y * z.y)) + c.x), (((z.x * z.y) * 2.0) + c.y));
    it = (it + 1.0);
  }
  float _gv0 = (it / 96.0);
  vec3 col = palette((_gv0 + (U.time * 0.05)));
  _ret = vec4((col * _gv0), 1.0);
}
