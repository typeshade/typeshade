struct Frame {
  size: vec2<f32>,
}

@group(0) @binding(0) var<uniform> frame: Frame;

fn rings(cell: vec2<f32>) -> f32 {
  var level: f32 = 0.0;
  let _cse0 = length(cell);
  level = select(level, (level + 1.0), (_cse0 < 0.15));
  level = select(level, (level + 1.0), (_cse0 < 0.25));
  level = select(level, (level + 1.0), (_cse0 < 0.35));
  return (level / 3.0);
}

@fragment
fn fs(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> {
  let grid = ((6.0 * p.xy) / frame.size.y);
  let tile = floor(grid);
  let level = rings((fract(grid) - 0.5));
  if ((((i32(tile.x) + i32(tile.y)) % 2) == 0)) {
    return vec4<f32>((0.2 + (0.7 * level)), (0.3 + (0.4 * level)), (0.9 - (0.5 * level)), 1.0);
  }
  return vec4<f32>((0.9 - (0.6 * level)), (0.4 + (0.2 * level)), (0.2 + (0.3 * level)), 1.0);
}
