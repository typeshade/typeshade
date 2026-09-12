"use typeshade"

class VsIn {
  @location(0) position: vec3
  @location(1) uv: vec2
}

class VsOut {
  @builtin("position") pos: vec4
  @location(0) uv: vec2
}

class Color {
  @location(0) color: vec4
}

@vertex
export function vs(vin: VsIn): VsOut {
  return { pos: vec4(vin.position, 1.), uv: vin.uv }
}

@fragment
export function fs(v: VsOut): Color {
  return { color: vec4(v.uv, 0.2, 1.) }
}
