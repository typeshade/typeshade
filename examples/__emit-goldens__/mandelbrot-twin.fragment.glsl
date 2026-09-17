#version 300 es
precision highp float;
precision highp int;

layout(std140) uniform Uniforms {
  float time;
  vec2 resolution;
  float zoom;
  vec4 mouse;
} U;
vec2 screenCoords(vec2 uv, vec2 resolution) {
  float asp = (resolution.x / resolution.y);
  return vec2((((uv.x * 2.0) - 1.0) * asp), ((uv.y * 2.0) - 1.0));
}

vec3 palette(float t) {
  vec3 ph = vec3(0.0, 0.33, 0.67);
  return (vec3(0.5, 0.5, 0.5) + (cos(((t + ph) * 6.283)) * 0.5));
}
in vec2 uv;
layout(location = 0) out vec4 _ret;

void main() {
  vec2 res = U.resolution;
  vec2 p = screenCoords(uv, res);
  float s = (exp((-(U.zoom + ((sin((U.time * 0.2)) * 0.75) + 0.75)))) * 2.4);
  vec4 mu = U.mouse;
  vec2 pan = ((screenCoords(vec2((mu.x / res.x), (mu.y / res.y)), res) * s) * mu.w);
  vec2 c = vec2((((p.x * s) - 0.7453) + pan.x), (((p.y * s) + 0.1127) + pan.y));
  vec2 z = vec2(0.0, 0.0);
  float it = 0.0;
  for (uint i = 0u; (i < 120u); i = (i + 1u)) {
    if ((dot(z, z) > 16.0)) {
      break;
    }
    z = vec2((((z.x * z.x) - (z.y * z.y)) + c.x), (((z.x * z.y) * 2.0) + c.y));
    it = (it + 1.0);
  }
  float m = dot(z, z);
  float sn = ((it - log2(max(log2(max(m, 1.0001)), 0.0001))) + 1.0);
  float inside = step(119.5, it);
  vec3 col = (palette(((sn * 0.035) + (U.time * 0.02))) * (1.0 - inside));
  _ret = vec4(col, 1.0);
}
