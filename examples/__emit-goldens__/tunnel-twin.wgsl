struct Uniforms {
  time: f32,
  resolution: vec2<f32>,
  twist: f32,
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

@fragment
fn fs(vo: VsOut) -> @location(0) vec4<f32> {
  let t = U.time;
  let res = U.resolution;
  let p = screenCoords(vo.uv, res);
  let r = length(p);
  let a = atan2(p.y, p.x);
  let depth = ((0.3 / max(r, 0.001)) + (t * 1.4));
  let ang = ((a / 3.14159265) + ((depth * U.twist) * 0.08));
  let cw = (sin((ang * 12.566)) * sin((depth * 9.4248)));
  let shade = ((smoothstep(-0.6, 0.6, cw) * 0.55) + 0.35);
  let tint = mix(vec3<f32>(1.0, 0.62, 0.28), vec3<f32>(0.42, 0.3, 0.55), ((sin((depth * 0.9)) * 0.5) + 0.5));
  let fog = smoothstep(0.0, 0.55, r);
  let vig = clamp((1.15 - (r * 0.35)), 0.0, 1.0);
  return vec4<f32>((((tint * shade) * fog) * vig), 1.0);
}
