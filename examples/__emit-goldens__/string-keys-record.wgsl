const GAIN: array<f32, 3> = array<f32, 3>(0.5, 1.0, 1.5);

struct Clip {
  @builtin(position) pos: vec4<f32>,
}

struct Color {
  @location(0) color: vec4<f32>,
}

fn gain(c: u32, x: f32, by: ptr<function, array<f32, 3>>) -> f32 {
  let _cse0 = ((x * GAIN[c]) * (*by)[c]);
  switch c {
    case 2u: {
      return _cse0;
    }
    case 1u: {
      return _cse0;
    }
    default: {
      return _cse0;
    }
  }
}

@vertex
fn vs(@builtin(vertex_index) i: u32) -> Clip {
  var p: vec2<f32> = vec2<f32>(-1.0, -1.0);
  if ((i == 1u)) {
    p = vec2<f32>(3.0, -1.0);
  }
  if ((i == 2u)) {
    p = vec2<f32>(-1.0, 3.0);
  }
  return Clip(vec4<f32>(p, 0.0, 1.0));
}

@fragment
fn fs(@builtin(position) p: vec4<f32>) -> Color {
  let c = select(select(0u, 1u, (p.x < 32.0)), 2u, (p.x < 16.0));
  var by: array<f32, 3> = array<f32, 3>(0.5, 0.5, 0.5);
  return Color(vec4<f32>(gain(c, 1.0, &by), 0.25, 0.5, 1.0));
}
