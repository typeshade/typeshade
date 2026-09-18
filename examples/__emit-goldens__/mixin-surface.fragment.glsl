#version 300 es
precision highp float;
precision highp int;

struct TintedDisc {
  vec2 center;
  float radius;
  vec3 tint;
  float softness;
};

struct TintedBar {
  vec2 center;
  float halfWidth;
  vec3 tint;
  float softness;
};
vec3 TintedDisc_lit(TintedDisc self_, float cover) {
  return (self_.tint * smoothstep(0.0, 1.0, cover));
}

float TintedDisc_cover(TintedDisc self_, vec2 p) {
  return (1.0 - smoothstep((self_.radius - self_.softness), self_.radius, length((p - self_.center))));
}

TintedDisc TintedDisc_new(vec2 center, float radius, float softness, vec3 tint) {
  TintedDisc self_ = TintedDisc(vec2(0.0, 0.0), 0.0, vec3(0.0, 0.0, 0.0), 0.0);
  self_.center = center;
  self_.radius = radius;
  self_.softness = softness;
  self_.tint = tint;
  return self_;
}

vec3 TintedBar_lit(TintedBar self_, float cover) {
  return (self_.tint * smoothstep(0.0, 1.0, cover));
}

float TintedBar_cover(TintedBar self_, vec2 p) {
  return (1.0 - smoothstep((self_.halfWidth - self_.softness), self_.halfWidth, abs((p.x - self_.center.x))));
}

TintedBar TintedBar_new(vec2 center, float halfWidth, float softness, vec3 tint) {
  TintedBar self_ = TintedBar(vec2(0.0, 0.0), 0.0, vec3(0.0, 0.0, 0.0), 0.0);
  self_.center = center;
  self_.halfWidth = halfWidth;
  self_.softness = softness;
  self_.tint = tint;
  return self_;
}
layout(location = 0) out vec4 _ret;

void main() {
  vec4 frag = gl_FragCoord;
  vec2 p = (frag.xy * 0.004);
  TintedDisc disc = TintedDisc_new(vec2(0.6, 0.6), 0.35, 0.08, vec3(0.95, 0.4, 0.25));
  TintedBar bar = TintedBar_new(vec2(1.4, 0.0), 0.25, 0.05, vec3(0.2, 0.55, 0.9));
  vec3 rgb = (TintedDisc_lit(disc, TintedDisc_cover(disc, p)) + TintedBar_lit(bar, TintedBar_cover(bar, p)));
  _ret = vec4(rgb, 1.0);
}
