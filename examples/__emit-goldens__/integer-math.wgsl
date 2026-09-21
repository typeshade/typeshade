struct Grid {
  origin: vec2<i32>,
  span: vec2<u32>,
}

struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@group(0) @binding(0) var<uniform> grid: Grid;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  let xs = array<f32, 3>(-1.0, 3.0, -1.0);
  let ys = array<f32, 3>(-1.0, -1.0, 3.0);
  let i = i32(vi);
  let p = vec2<f32>(xs[i], ys[i]);
  return VsOut(vec4<f32>(p, 0.0, 1.0), ((p * 0.5) + vec2<f32>(0.5, 0.5)));
}

@fragment
fn fs(v: VsOut) -> @location(0) vec4<f32> {
  let at = vec2<i32>(i32((v.uv.x * 64.0)), i32((v.uv.y * 64.0)));
  let cell = vec2<u32>(u32(at.x), u32(at.y));
  let magnitude = abs(cell);
  let width = abs(grid.span.x);
  let offset = abs((at - grid.origin));
  let squared = dot(offset, offset);
  let spread = dot(magnitude, magnitude);
  let _cse0 = (v.uv - vec2<f32>(0.5, 0.5));
  let radial = dot(_cse0, _cse0);
  let rings = (f32((squared % 97)) / 97.0);
  let bands = (f32((spread % 53u)) / 53.0);
  let edge = (f32((width % 7u)) / 7.0);
  return vec4<f32>(rings, bands, ((edge * 0.5) + (radial * 0.5)), (1.0 - ((f32(squared) * 0.000244140625) * 0.0)));
}
