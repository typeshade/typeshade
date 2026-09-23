struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

struct Color {
  @location(0) color: vec4<f32>,
}

struct Frame {
  steps: i32,
  depth: i32,
}

@group(0) @binding(0) var<uniform> frame: Frame;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  let _cse0 = i32(vi);
  let x = ((f32((_cse0 / 2)) * 4.0) - 1.0);
  let y = ((f32((_cse0 % 2)) * 4.0) - 1.0);
  return VsOut(vec4<f32>(x, y, 0.0, 1.0), ((vec2<f32>(x, y) * 0.5) + vec2<f32>(0.5, 0.5)));
}

fn march(uv: vec2<f32>, steps: i32) -> f32 {
  let _licm0 = length((uv - vec2<f32>(0.5, 0.5)));
  var acc: f32 = 0.0;
  let _cse0 = f32(steps);
  for (var i: i32 = 0; (i < steps); i = (i + 1)) {
    let t = ((f32(i) + 0.5) / _cse0);
    let d = abs((_licm0 - (t * 0.5)));
    acc += (exp(((-d) * 60.0)) / _cse0);
  }
  return acc;
}

fn leaves(depth: i32) -> i32 {
  var stack: array<i32, 16> = array<i32, 16>(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  var sp: i32 = 1;
  stack[0] = depth;
  var count: i32 = 0;
  for (var _w: i32 = 0; (sp > 0); _w = (_w + 1)) {
    sp -= 1;
    let d = stack[sp];
    if (((d <= 0) || (sp >= 14))) {
      count += 1;
    } else {
      let _gv0 = (d - 1);
      stack[sp] = _gv0;
      stack[(sp + 1)] = _gv0;
      sp += 2;
    }
  }
  return count;
}

fn isqrt(x: f32) -> f32 {
  let a = max(x, 0.0);
  var r: f32 = max(a, 1.0);
  for (var _w: i32 = 0; true; _w = (_w + 1)) {
    let next = (0.5 * (r + (a / r)));
    if ((abs((next - r)) < 0.0001)) {
      break;
    }
    r = next;
  }
  return r;
}

@fragment
fn fs(v: VsOut) -> Color {
  let ring = march(v.uv, frame.steps);
  let n = f32(leaves(frame.depth));
  let s = (isqrt((v.uv.x * 4.0)) * 0.5);
  return Color(vec4<f32>(ring, fract((n / 7.0)), s, 1.0));
}
