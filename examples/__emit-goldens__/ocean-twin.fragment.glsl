#version 300 es
precision highp float;
precision highp int;

layout(std140) uniform Uniforms {
  float time;
  vec2 resolution;
  float swell;
} U;
float hash(vec2 p) {
  return fract((sin(dot(p, vec2(127.1, 311.7))) * 43758.5453));
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = ((f * f) * (vec2(3.0, 3.0) - (f * 2.0)));
  return mix(mix(hash(i), hash((i + vec2(1.0, 0.0))), u.x), mix(hash((i + vec2(0.0, 1.0))), hash((i + vec2(1.0, 1.0))), u.x), u.y);
}
in vec2 uv;
layout(location = 0) out vec4 _ret;

void main() {
  float t = U.time;
  vec2 res = U.resolution;
  float asp = (res.x / res.y);
  float x = (((uv.x * 2.0) - 1.0) * asp);
  float y = uv.y;
  vec3 sky = mix(vec3(0.83, 0.58, 0.38), vec3(0.12, 0.28, 0.48), smoothstep(0.58, 1.0, y));
  float y2 = ((y * 2.0) - 1.0);
  float dSun = distance(vec2(x, y2), vec2(0.42, 0.56));
  float sun = (1.0 - smoothstep(0.035, 0.06, dSun));
  float halo = (exp((-(dSun * 4.0))) * 0.35);
  vec3 _cse0 = vec3(1.0, 0.85, 0.6);
  vec3 skyCol = (sky + (_cse0 * (sun + halo)));
  float dpt = max((0.58 - y), 0.0008);
  float wz = (0.06 / dpt);
  vec2 sp = (vec2(((x * wz) * 0.6), (wz + (t * 0.6))) * 3.0);
  float h = 0.0;
  float amp = 0.5;
  float freq = 1.0;
  for (uint i = 0u; (i < 4u); i = (i + 1u)) {
    h = (h + (amp * noise(((sp * freq) + vec2((t * 0.12), 0.0)))));
    freq = (freq * 2.03);
    amp = (amp * 0.5);
  }
  float wave = ((h * U.swell) * smoothstep(0.0, 0.05, dpt));
  vec3 sea = (mix(vec3(0.05, 0.18, 0.28), vec3(0.55, 0.5, 0.45), exp((-(dpt * 7.0)))) + (vec3(0.3, 0.38, 0.36) * wave));
  float glint = ((pow((max((wave - 0.32), 0.0) * 2.6), 3.0) * exp((-(abs((x - 0.42)) * 2.2)))) * exp((-(dpt * 2.5))));
  vec3 seaCol = (sea + (_cse0 * clamp(glint, 0.0, 1.2)));
  vec3 col = mix(seaCol, skyCol, step(0.58, y));
  _ret = vec4(col, 1.0);
}
