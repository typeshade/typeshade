struct Body {
  at: vec2<f32>,
  vel: vec2<f32>,
  spin: f32,
}

fn Body_step(self_: ptr<function, Body>, dt: f32) {
  (*self_).at = ((*self_).at + ((*self_).vel * dt));
  (*self_).vel = ((*self_).vel * 0.985);
}

fn Body_turn(self_: ptr<function, Body>, dt: f32) {
  let a = ((*self_).spin * dt);
  let c = cos(a);
  let s = sin(a);
  (*self_).vel = vec2<f32>((((*self_).vel.x * c) - ((*self_).vel.y * s)), (((*self_).vel.x * s) + ((*self_).vel.y * c)));
}

fn Body_advance(self_: ptr<function, Body>, dt: f32) {
  Body_turn(self_, dt);
  Body_step(self_, dt);
}

fn Body_reach(self_: Body) -> f32 {
  return length(self_.at);
}

fn Body_new() -> Body {
  let _cse0 = vec2<f32>(0.0, 0.0);
  var self_: Body = Body(_cse0, _cse0, 0.0);
  return self_;
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  let xs = array<f32, 3>(-1.0, 3.0, -1.0);
  let ys = array<f32, 3>(-1.0, -1.0, 3.0);
  let i = i32(vi);
  return vec4<f32>(xs[i], ys[i], 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = (fract((frag.xy * 0.01)) - vec2<f32>(0.5, 0.5));
  var b: Body = Body_new();
  b.at = uv;
  b.vel = (vec2<f32>((-uv.y), uv.x) * 0.4);
  b.spin = 2.2;
  for (var n: i32 = 0; (n < 8); n = (n + 1)) {
    Body_advance(&b, 0.05);
  }
  let glow = (1.0 - smoothstep(0.0, 0.6, Body_reach(b)));
  return vec4<f32>(glow, ((glow * 0.4) + (b.spin * 0.1)), (0.6 - (glow * 0.3)), 1.0);
}
