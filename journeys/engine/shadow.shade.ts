"use typeshade";

// The shadow pass: the occluder's depth as the light sees it, and no colour. The engine draws it
// with no fragment entry into a depth texture, which the ground reads back by comparison.

class LightView {
  viewProj: mat4;
}

declare const light: uniform<LightView>;

class VsIn {
  @location(0) position: vec3;
}

@vertex
export function vs(v: VsIn): vec4 {
  return light.viewProj * vec4(v.position, 1.);
}
