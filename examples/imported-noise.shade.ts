"use typeshade";

/* @example
{
  "title": "Imported noise",
  "blurb": "Clouds drawn with the `fbm` of another shader file: `import { fbm } from \"./lib/noise.shade.ts\"` links the library into this module, which holds what the fragment entry reaches and nothing else. The two files are one program, and each keeps its own scope.",
  "renderable": true
}
*/

// A shader file imports what another one exports (Rule 3.9, surface §68). `compile()` reads the
// library through its `readDocument` option, the Vite plugin and `tshc sync` read it from
// disk, and the editor resolves the import as TypeScript does. The module holds this file's
// declarations and, of the library, `fbm` and what it calls: `noise`, `hash` and `hash32`.

import { fbm } from "./lib/noise.shade.ts";

class Uniforms {
  time: f32;
  resolution: vec2;
}

declare const U: uniform<Uniforms>;

class VsOut {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
}

// Oversized fullscreen triangle: 3 vertices, no vertex buffer.
@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  const x = f32(vi & 1) * 4. - 1.;
  const y = f32(vi >> 1) * 4. - 1.;
  return { pos: vec4(x, y, 0., 1.), uv: vec2(x * 0.5 + 0.5, y * 0.5 + 0.5) };
}

@fragment
export function fs(vo: VsOut): vec4 {
  const aspect = U.resolution.x / U.resolution.y;
  const p = vec2(vo.uv.x * aspect, vo.uv.y) * 4. + vec2(U.time * 0.05, 0.);
  const cover = smoothstep(0.35, 0.75, fbm(p));
  const sky = mix(vec3(0.18, 0.36, 0.7), vec3(0.55, 0.72, 0.92), vo.uv.y);
  return vec4(mix(sky, vec3(1.), cover), 1.);
}
