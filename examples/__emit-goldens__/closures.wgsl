struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

struct FsOut {
  @location(0) color: vec4<f32>,
}

struct Brush {
  paint: vec3<f32>,
  tint: vec3<f32>,
}

fn Brush_strokes(self_: ptr<function, Brush>, p: vec2<f32>) -> vec3<f32> {
  Brush_strokes_dab(self_, p, vec2<f32>(-0.5, 0.35), 0.18);
  Brush_strokes_dab(self_, p, vec2<f32>(0.5, -0.35), 0.14);
  return (*self_).paint;
}

fn Brush_new() -> Brush {
  let _cse0 = vec3<f32>(0.0, 0.0, 0.0);
  var self_: Brush = Brush(_cse0, _cse0);
  self_.paint = _cse0;
  self_.tint = vec3<f32>(0.3, 0.6, 0.95);
  return self_;
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  let x = ((f32((vi & 1u)) * 4.0) - 1.0);
  let y = ((f32((vi >> 1u)) * 4.0) - 1.0);
  return VsOut(vec4<f32>(x, y, 0.0, 1.0), vec2<f32>(x, y));
}

@fragment
fn fs(v: VsOut) -> FsOut {
  let p = v.uv;
  var glow: f32 = 0.0;
  fs_rings(&glow, 0.03, p, 0.3, 0.25);
  var col: vec3<f32> = fs_tone(glow, vec3<f32>(0.95, 0.75, 0.35));
  var brush: Brush = Brush_new();
  col += Brush_strokes(&brush, p);
  let spots = array<vec2<f32>, 3>(vec2<f32>(-0.6, 0.6), vec2<f32>(0.6, 0.6), vec2<f32>(0.0, -0.75));
  for (var i: i32 = 0; (i < 3); i = (i + 1)) {
    if (fs_near(p, spots, i)) {
      col = vec3<f32>(1.0, 1.0, 1.0);
    }
  }
  return FsOut(vec4<f32>(col, 1.0));
}

fn fs_ring(glow: ptr<function, f32>, width: f32, p: vec2<f32>, r: f32) {
  (*glow) += (1.0 - smoothstep((width * 0.5), width, abs((length(p) - r))));
}

fn fs_rings(glow: ptr<function, f32>, width: f32, p: vec2<f32>, first: f32, gap: f32) {
  fs_ring(glow, width, p, first);
  fs_ring(glow, width, p, (first + gap));
  fs_ring(glow, width, p, (first + (gap * 2.0)));
}

fn fs_tone(glow: f32, c: vec3<f32>) -> vec3<f32> {
  return mix(vec3<f32>(0.05, 0.06, 0.1), c, clamp(glow, 0.0, 1.0));
}

fn fs_near(p: vec2<f32>, spots: array<vec2<f32>, 3>, i: i32) -> bool {
  return (length((p - spots[i])) < 0.08);
}

fn Brush_strokes_dab(self_: ptr<function, Brush>, p: vec2<f32>, c: vec2<f32>, r: f32) {
  (*self_).paint += ((*self_).tint * (1.0 - smoothstep((r * 0.8), r, length((p - c)))));
}
