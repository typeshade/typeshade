"use typeshade"

class Clip {
  @builtin("position") pos: vec4
}

class Color {
  @location(0) color: vec4
}

@vertex
export function vs(@builtin("vertex_index") i: u32): Clip {
  let x = -0.8
  let y = -0.8
  if (i === 1) {
    x = 0.8
  }
  if (i === 2) {
    x = 0.
    y = 0.8
  }
  return { pos: vec4(x, y, 0., 1.) }
}

@fragment
export function fs(): Color {
  return { color: vec4(1., 0., 0., 1.) }
}
