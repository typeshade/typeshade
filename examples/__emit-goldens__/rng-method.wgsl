struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

struct FsOut {
  @location(0) color: vec4<f32>,
}

struct Rng {
  state: u32,
}

fn Rng_next(self_: ptr<function, Rng>) -> f32 {
  (*self_).state = (((*self_).state * 747796405u) + 2891336453u);
  let word = ((((*self_).state >> (((*self_).state >> 28u) + 4u)) ^ (*self_).state) * 277803737u);
  return (f32((((word >> 22u) ^ word) >> 8u)) * 5.960464477539063e-8);
}

fn Rng_new(seed: u32) -> Rng {
  var self_: Rng = Rng(0u);
  self_.state = seed;
  Rng_next(&self_);
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
  let cell = vec2<u32>(u32(((v.uv.x + 1.0) * 96.0)), u32(((v.uv.y + 1.0) * 96.0)));
  var rng: Rng = Rng_new((((cell.x * 1973u) + (cell.y * 9277u)) + 26699u));
  let _seq0 = Rng_next(&rng);
  let _seq1 = Rng_next(&rng);
  let _seq2 = Rng_next(&rng);
  let grain = vec3<f32>(_seq0, _seq1, _seq2);
  let _seq3 = Rng_next(&rng);
  var _seq4: f32;
  if ((_seq3 > 0.985)) {
    _seq4 = Rng_next(&rng);
  } else {
    _seq4 = 0.0;
  }
  let sparkle = _seq4;
  let base = mix(vec3<f32>(0.08, 0.1, 0.16), vec3<f32>(0.3, 0.22, 0.35), ((v.uv.y * 0.5) + 0.5));
  return FsOut(vec4<f32>(((base + ((grain - vec3<f32>(0.5, 0.5, 0.5)) * 0.12)) + vec3<f32>(sparkle, sparkle, sparkle)), 1.0));
}
