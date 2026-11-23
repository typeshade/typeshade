struct Frame {
  size: vec2<f32>,
  time: f32,
}

struct Ball {
  pos: vec2<f32>,
  rise: f32,
  radius: f32,
}

@group(0) @binding(0) var<uniform> frame: Frame;

fn Ball_bounce(self_: ptr<function, Ball>, time: f32) {
  (*self_).pos.y = (((*self_).radius - 0.8) + ((*self_).rise * abs(sin(((3.0 * time) + (4.0 * (*self_).pos.x))))));
}

fn Ball_cover(self_: ptr<function, Ball>, p: vec2<f32>) -> f32 {
  return (1.0 - smoothstep(0.0, 0.01, (length((p - (*self_).pos)) - (*self_).radius)));
}

fn drop(ball: ptr<function, Ball>, time: f32) {
  Ball_bounce(ball, time);
}

@fragment
fn fs(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = (((2.0 * p.xy) - frame.size) / frame.size.y);
  let flipped = vec2<f32>(uv.x, (-uv.y));
  var red: Ball = Ball(vec2<f32>(-0.5, 0.0), 1.2, 0.2);
  var blue: Ball = Ball(vec2<f32>(0.4, 0.0), 0.8, 0.15);
  drop(&red, frame.time);
  drop(&blue, frame.time);
  let a = Ball_cover(&red, flipped);
  let b = Ball_cover(&blue, flipped);
  return vec4<f32>((0.1 + (0.8 * a)), ((0.1 + (0.3 * a)) + (0.3 * b)), (0.15 + (0.8 * b)), 1.0);
}
