struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

struct Color {
  @location(0) color: vec4<f32>,
}

@vertex
fn vs(@builtin(vertex_index) i: u32) -> VsOut {
  var x: f32;
  var y: f32;
  x = -1.0;
  y = -1.0;
  if ((i == 1u)) {
    x = 3.0;
  }
  if ((i == 2u)) {
    y = 3.0;
  }
  let pos = vec4<f32>(x, y, 0.0, 1.0);
  let uv = ((vec2<f32>(x, y) * 0.5) + vec2<f32>(0.5, 0.5));
  return VsOut(pos, uv);
}

@fragment
fn fs(v: VsOut) -> Color {
  var band: i32 = i32((v.uv.x * 4.0));
  band &= 3;
  band |= 0;
  var shade: i32 = band;
  let amount = i32((v.uv.y * 2.0));
  let _gv0 = u32(amount);
  shade <<= _gv0;
  shade >>= _gv0;
  shade <<= 1u;
  shade >>= 1u;
  shade ^= 0;
  var rgb: vec3<f32>;
  rgb = vec3<f32>(0.0, 0.0, 0.0);
  switch shade {
    case 0: {
      rgb = vec3<f32>(0.1, 0.1, 0.12);
    }
    case 1: {
      rgb = vec3<f32>(0.95, 0.55, 0.2);
    }
    case 2: {
      if ((v.uv.y > 0.5)) {
        rgb = vec3<f32>(0.2, 0.5, 0.95);
        break;
      }
      rgb = vec3<f32>(0.15, 0.35, 0.7);
    }
    default: {
      rgb = vec3<f32>(0.85, 0.85, 0.9);
    }
  }
  return Color(vec4<f32>(rgb, 1.0));
}
