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
layout(location = 0) out vec4 _ret;

void main() {
  vec4 frag = gl_FragCoord;
  vec2 p = (frag.xy * 0.004);
  vec2 _i0a0 = vec2(0.6, 0.6);
  vec3 _i0a3 = vec3(0.95, 0.4, 0.25);
  vec2 _cse0 = vec2(0.0, 0.0);
  vec3 _cse1 = vec3(0.0, 0.0, 0.0);
  TintedDisc _i0_self_ = TintedDisc(_cse0, 0.0, _cse1, 0.0);
  _i0_self_.center = _i0a0;
  _i0_self_.radius = 0.35;
  _i0_self_.softness = 0.08;
  _i0_self_.tint = _i0a3;
  TintedDisc disc = _i0_self_;
  vec2 _i1a0 = vec2(1.4, 0.0);
  vec3 _i1a3 = vec3(0.2, 0.55, 0.9);
  TintedBar _i1_self_ = TintedBar(_cse0, 0.0, _cse1, 0.0);
  _i1_self_.center = _i1a0;
  _i1_self_.halfWidth = 0.25;
  _i1_self_.softness = 0.05;
  _i1_self_.tint = _i1a3;
  TintedBar bar = _i1_self_;
  vec3 rgb = ((disc.tint * smoothstep(0.0, 1.0, (1.0 - smoothstep((disc.radius - disc.softness), disc.radius, length((p - disc.center)))))) + (bar.tint * smoothstep(0.0, 1.0, (1.0 - smoothstep((bar.halfWidth - bar.softness), bar.halfWidth, abs((p.x - bar.center.x)))))));
  _ret = vec4(rgb, 1.0);
}
