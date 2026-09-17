struct Uniforms {
  time: f32,
  resolution: vec2<f32>,
  zoom: f32,
  mouse: vec4<f32>,
}

struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@group(0) @binding(0) var<uniform> U: Uniforms;

fn screenCoords(uv: vec2<f32>, resolution: vec2<f32>) -> vec2<f32> {
  let asp = (resolution.x / resolution.y);
  return vec2<f32>((((uv.x * 2.0) - 1.0) * asp), ((uv.y * 2.0) - 1.0));
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  let x = ((f32((vi & 1u)) * 4.0) - 1.0);
  let y = ((f32((vi >> 1u)) * 4.0) - 1.0);
  return VsOut(vec4<f32>(x, y, 0.0, 1.0), vec2<f32>(((x * 0.5) + 0.5), ((y * 0.5) + 0.5)));
}

fn palette(t: f32) -> vec3<f32> {
  let ph = vec3<f32>(0.0, 0.33, 0.67);
  return (vec3<f32>(0.5, 0.5, 0.5) + (cos(((t + ph) * 6.283)) * 0.5));
}

@fragment
fn fs(vo: VsOut) -> @location(0) vec4<f32> {
  let res = U.resolution;
  let p = screenCoords(vo.uv, res);
  let s = (exp((-(U.zoom + ((sin((U.time * 0.2)) * 0.75) + 0.75)))) * 2.4);
  let mu = U.mouse;
  let pan = ((screenCoords(vec2<f32>((mu.x / res.x), (mu.y / res.y)), res) * s) * mu.w);
  let c = vec2<f32>((((p.x * s) - 0.7453) + pan.x), (((p.y * s) + 0.1127) + pan.y));
  var z: vec2<f32> = vec2<f32>(0.0, 0.0);
  var it: f32 = 0.0;
  for (var i: u32 = 0u; (i < 120u); i = (i + 1u)) {
    if ((dot(z, z) > 16.0)) {
      break;
    }
    z = vec2<f32>((((z.x * z.x) - (z.y * z.y)) + c.x), (((z.x * z.y) * 2.0) + c.y));
    it = (it + 1.0);
  }
  let m = dot(z, z);
  let sn = ((it - log2(max(log2(max(m, 1.0001)), 0.0001))) + 1.0);
  let inside = step(119.5, it);
  let col = (palette(((sn * 0.035) + (U.time * 0.02))) * (1.0 - inside));
  return vec4<f32>(col, 1.0);
}
