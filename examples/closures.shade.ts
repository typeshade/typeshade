"use typeshade";

/* @example
{
  "title": "Local functions that read and write the variables around them",
  "blurb": "`ring` reads `p` and `width` from the fragment entry and adds to its `glow`, as a TypeScript closure does: each variable is a parameter the emitted function takes, and `glow`, which it writes, is passed by reference, so every call's write lands in the entry's variable (Rule 8.17). `rings` calls `ring`, so it takes `glow` by reference too and hands it on. `tone` is a function declaration called above its statement, as TypeScript hoists it. `Brush.strokes` declares an arrow function that writes `this`, so the method takes its brush by reference, and `near`, declared in a loop's body, reads that trip's `i`. Renders three rings, two dabs of paint and three white spots.",
  "renderable": true
}
*/

// A local function reads and writes the variables of the function around it, as a TypeScript
// closure does (Rule 8.17, surface §14):
//
// - a variable it reads is a parameter of the emitted function, which every call passes;
// - one it writes, or that a local function it calls writes, is passed by reference;
// - `this` in an arrow function is the method's object;
// - a `function` declaration may be called above its statement;
// - a loop's variable is read like any other, the value of the trip the call is in.

class VsOut {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
}

class FsOut {
  @location(0) color: vec4;
}

// Fullscreen triangle, as `rng-method.shade.ts` draws it.
@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  const x = f32(vi & u32(1)) * 4. - 1.;
  const y = f32(vi >> u32(1)) * 4. - 1.;
  return { pos: vec4(x, y, 0., 1.), uv: vec2(x, y) };
}

/** Paint laid down in dabs: the arrow function in `strokes` writes the brush it belongs to. */
class Brush {
  paint: vec3 = vec3(0.);
  tint: vec3 = vec3(0.3, 0.6, 0.95);
  strokes(p: vec2): vec3 {
    // `Brush_strokes_dab(self_: ptr<function, Brush>, p: vec2<f32>, c: vec2<f32>, r: f32)`.
    const dab = (c: vec2, r: f32): void => {
      this.paint += this.tint * (1. - smoothstep(r * 0.8, r, length(p - c)));
    };
    dab(vec2(-0.5, 0.35), 0.18);
    dab(vec2(0.5, -0.35), 0.14);
    return this.paint;
  }
}

@fragment
export function fs(v: VsOut): FsOut {
  const p = v.uv;
  const width = 0.03;
  let glow = 0.;
  // Reads `width` and `p`, writes `glow`, in the order it first names them: `fs_ring(glow:
  // ptr<function, f32>, width: f32, p: vec2<f32>, r: f32)`.
  const ring = (r: f32): void => {
    glow += 1. - smoothstep(width * 0.5, width, abs(length(p) - r));
  };
  // Writes `glow` through `ring`, so it takes `glow` by reference as well.
  const rings = (first: f32, gap: f32): void => {
    ring(first);
    ring(first + gap);
    ring(first + gap * 2.);
  };
  rings(0.3, 0.25);
  // Called above its statement: a function declaration is hoisted.
  let col = tone(vec3(0.95, 0.75, 0.35));
  function tone(c: vec3): vec3 {
    return mix(vec3(0.05, 0.06, 0.1), c, clamp(glow, 0., 1.));
  }
  let brush = new Brush();
  col += brush.strokes(p);
  // `near` reads `p`, `spots` and the `i` of the trip it is called in.
  const spots = array<vec2, 3>(vec2(-0.6, 0.6), vec2(0.6, 0.6), vec2(0., -0.75));
  for (let i = 0; i < 3; i++) {
    const near = (): bool => length(p - spots[i]) < 0.08;
    if (near()) {
      col = vec3(1.);
    }
  }
  return { color: vec4(col, 1.) };
}
