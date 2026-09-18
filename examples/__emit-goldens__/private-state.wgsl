struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

struct FsOut {
  @location(0) color: vec4<f32>,
}

var<private> seed: u32 = 7u;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  let x = ((f32((vi & 1u)) * 4.0) - 1.0);
  let y = ((f32((vi >> 1u)) * 4.0) - 1.0);
  return VsOut(vec4<f32>(x, y, 0.0, 1.0), vec2<f32>(x, y));
}

fn next() -> f32 {
  seed = ((seed * 1664525u) + 1013904223u);
  return (f32((seed >> 8u)) * 5.960464477539063e-8);
}

@fragment
fn fs(v: VsOut) -> FsOut {
  let cell = vec2<u32>(u32(((v.uv.x + 1.0) * 32.0)), u32(((v.uv.y + 1.0) * 32.0)));
  seed = (((cell.x * 1973u) + (cell.y * 9277u)) + 26699u);
  let r = next();
  let g = next();
  let b = next();
  return FsOut(vec4<f32>(r, g, b, 1.0));
}
