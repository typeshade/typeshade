#version 300 es
precision highp float;
precision highp int;

struct Brush {
  vec3 paint;
  vec3 tint;
};
void Brush_strokes_dab(inout Brush self_, vec2 p, vec2 c, float r) {
  self_.paint += (self_.tint * (1.0 - smoothstep((r * 0.8), r, length((p - c)))));
}

vec3 Brush_strokes(inout Brush self_, vec2 p) {
  Brush_strokes_dab(self_, p, vec2(-0.5, 0.35), 0.18);
  Brush_strokes_dab(self_, p, vec2(0.5, -0.35), 0.14);
  return self_.paint;
}

void fs_ring(inout float glow, float width, vec2 p, float r) {
  glow += (1.0 - smoothstep((width * 0.5), width, abs((length(p) - r))));
}

void fs_rings(inout float glow, float width, vec2 p, float first, float gap) {
  fs_ring(glow, width, p, first);
  fs_ring(glow, width, p, (first + gap));
  fs_ring(glow, width, p, (first + (gap * 2.0)));
}
in vec2 uv;
layout(location = 0) out vec4 color;

void main() {
  vec2 p = uv;
  float glow = 0.0;
  fs_rings(glow, 0.03, p, 0.3, 0.25);
  vec3 col = mix(vec3(0.05, 0.06, 0.1), vec3(0.95, 0.75, 0.35), clamp(glow, 0.0, 1.0));
  Brush brush = Brush(vec3(0.0, 0.0, 0.0), vec3(0.0, 0.0, 0.0));
  brush.paint = vec3(0.0);
  brush.tint = vec3(0.3, 0.6, 0.95);
  col += Brush_strokes(brush, p);
  vec2 spots_0 = vec2(-0.6, 0.6);
  vec2 spots_1 = vec2(0.6, 0.6);
  vec2 spots_2 = vec2(0.0, -0.75);
  col = mix(col, vec3(1.0), bvec3((length((p - spots_0)) < 0.08)));
  col = mix(col, vec3(1.0), bvec3((length((p - spots_1)) < 0.08)));
  col = mix(col, vec3(1.0), bvec3((length((p - spots_2)) < 0.08)));
  color = vec4(col, 1.0);
}
