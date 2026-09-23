struct VsOut {
  @invariant @builtin(position) pos: vec4<f32>,
  @location(0) @interpolate(flat) id: u32,
  @location(1) @interpolate(perspective, centroid) uv: vec2<f32>,
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  let xs = array<f32, 3>(-1.0, 3.0, -1.0);
  let ys = array<f32, 3>(-1.0, -1.0, 3.0);
  let i = i32(vi);
  let p = vec2<f32>(xs[i], ys[i]);
  return VsOut(vec4<f32>(p, 0.0, 1.0), (vi + 1u), ((p * 0.5) + vec2<f32>(0.5, 0.5)));
}

@fragment
fn fs(v: VsOut) -> @location(0) vec4<f32> {
  let band = (f32((v.id & 3u)) / 3.0);
  let grid = fract((v.uv * 8.0));
  let line = (1.0 - step(0.06, min(grid.x, grid.y)));
  let _lc0 = (line * 0.4);
  return (vec4<f32>(band, (v.uv.x * 0.5), (v.uv.y * 0.5), 1.0) + vec4<f32>(_lc0, _lc0, _lc0, 0.0));
}
