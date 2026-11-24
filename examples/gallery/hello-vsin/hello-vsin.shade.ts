"use typeshade";

interface VsIn {
  position: vec3;
  uv: vec2;
}

interface VsOut {
  pos: builtin<"position">;
  uv: vec2;
}

interface Color {
  color: vec4;
}

@vertex
export function vs(vin: VsIn): VsOut {
  return { pos: vec4(vin.position, 1), uv: vin.uv };
}

@fragment
export function fs(v: VsOut): Color {
  return { color: vec4(v.uv, 0.2, 1) };
}
