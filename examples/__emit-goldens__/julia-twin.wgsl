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
  let uv = vo.uv;
  var z: vec2<f32> = (vec2<f32>(((uv.x * 2.0) - 1.0), ((uv.y * 2.0) - 1.0)) * U.zoom);
  let m = U.mouse;
  let res = U.resolution;
  let orbit = vec2<f32>(((cos((U.time * 0.31)) * 0.39) - 0.4), (sin((U.time * 0.41)) * 0.39));
  let held = vec2<f32>(((((m.x / res.x) * 2.0) - 1.0) * 0.8), ((((m.y / res.y) * 2.0) - 1.0) * 0.8));
  let c = mix(orbit, held, m.w);
  var it: f32 = 0.0;
  for (var i: u32 = 0u; (i < 96u); i = (i + 1u)) {
    if ((dot(z, z) > 4.0)) {
      break;
    }
    z = vec2<f32>((((z.x * z.x) - (z.y * z.y)) + c.x), (((z.x * z.y) * 2.0) + c.y));
    it = (it + 1.0);
  }
  let _gv0 = (it / 96.0);
  let col = palette((_gv0 + (U.time * 0.05)));
  return vec4<f32>((col * _gv0), 1.0);
}
