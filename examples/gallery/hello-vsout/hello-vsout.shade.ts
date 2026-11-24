"use typeshade";

interface VsOut {
  pos: builtin<"position">;
  uv: vec2;
}

interface Color {
  color: vec4;
}

@vertex
export function vs(i: builtin<"vertex_index">): VsOut {
  let x = -0.8;
  let y = -0.8;
  let u = 0;
  let v = 0;
  if (i === 1) {
    x = 0.8;
    u = 1;
  }
  if (i === 2) {
    x = 0;
    y = 0.8;
    u = 0.5;
    v = 1;
  }
  return { pos: vec4(x, y, 0, 1), uv: vec2(u, v) };
}

@fragment
export function fs(v: VsOut): Color {
  return { color: vec4(v.uv.x, v.uv.y, 0.2, 1) };
}
