// The stage call of change 0111 (decision D1, amendment 1): an entry point written as
// `export const vs = vertex(function vs(…) { … })`, which a plain `tsc --strict` accepts, beside
// the decorated form, which it refuses (TS1206). The call stands for a function declaration made
// of the wrapped function's own nodes, so each program here is read by both halves and the emit
// of each pair is the decorated form's, byte for byte.
//
// Verifies: Rule 6.7, Rule 8.1, Rule 8.22 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { hostFace } from './host-face.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const RUNTIME = '/runtime.ts';

const compiled = (source: string) => compile(source, { fileName: 'file:///a.shade.ts' });
const errors = (source: string): string[] =>
  compiled(source)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => `${d.code} ${d.message}`);
const editor = (source: string): string[] => {
  const service = createTypeshadeLanguageService();
  service.openDocument('a.ts', source);
  return service.getDiagnostics('a.ts').map((d) => `${String(d.code)} ${String(d.message)}`);
};

const IO = `class VsOut {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
}
`;

const PAIRS: readonly { name: string; decorated: string; called: string }[] = [
  {
    name: 'a vertex and a fragment entry, the fragment an arrow function',
    decorated: `"use typeshade";
${IO}
@vertex
export function vs(@builtin("vertex_index") i: u32): VsOut {
  const x = i === 1 ? 0.8 : -0.8;
  return { pos: vec4(x, -0.8, 0., 1.), uv: vec2(x, 0.) };
}
@fragment
export function fs(v: VsOut): vec4 {
  return vec4(v.uv.x, v.uv.y, 0.2, 1.);
}
`,
    called: `"use typeshade";
${IO}
export const vs = vertex(function vs(@builtin("vertex_index") i: u32): VsOut {
  const x = i === 1 ? 0.8 : -0.8;
  return { pos: vec4(x, -0.8, 0., 1.), uv: vec2(x, 0.) };
});
export const fs = fragment((v: VsOut): vec4 => vec4(v.uv.x, v.uv.y, 0.2, 1.));
`,
  },
  {
    name: 'a compute entry with its workgroup shape, and a kernel function with its extent',
    decorated: `"use typeshade";
declare const src: storage<array<f32>>;
declare const dst: storage<array<f32>, "read_write">;
const TILE: u32 = 128;
@compute([8, 8, 1])
export function main(@builtin("global_invocation_id") gid: vec3u): void {
  if (gid.x >= src.length) { return; }
  dst[gid.x] = src[gid.x] * 2.;
}
@workgroup_size([TILE])
export function scale(xs: array<f32>, k: f32): void {
  for (let i = 0; i < xs.length; i++) { xs[i] = xs[i] * k; }
}
`,
    called: `"use typeshade";
declare const src: storage<array<f32>>;
declare const dst: storage<array<f32>, "read_write">;
const TILE: u32 = 128;
export const main = compute([8, 8, 1], function main(@builtin("global_invocation_id") gid: vec3u): void {
  if (gid.x >= src.length) { return; }
  dst[gid.x] = src[gid.x] * 2.;
});
export const scale = workgroup_size([TILE], function scale(xs: array<f32>, k: f32): void {
  for (let i = 0; i < xs.length; i++) { xs[i] = xs[i] * k; }
});
`,
  },
  {
    // A local function and an arrow handed to a helper inside the entry: the closure walk finds
    // the entry through the function the call wraps (#886 left `fs_petal` out of the WGSL).
    name: 'an entry that declares a local function and hands an arrow to a helper',
    decorated: `"use typeshade";
function twice(f: (x: f32) => f32, x: f32): f32 { return f(f(x)); }
@fragment
export function fs(@builtin("position") p: vec4): vec4 {
  const r = 0.1;
  const petal = (q: vec2): f32 => length(q) - r;
  return vec4(petal(p.xy), twice((x) => x * r, p.x), 0., 1.);
}
`,
    called: `"use typeshade";
function twice(f: (x: f32) => f32, x: f32): f32 { return f(f(x)); }
export const fs = fragment(function fs(p: builtin<"position", vec4>): vec4 {
  const r = 0.1;
  const petal = (q: vec2): f32 => length(q) - r;
  return vec4(petal(p.xy), twice((x) => x * r, p.x), 0., 1.);
});
`,
  },
];

describe('a stage call compiles as the decorated entry does (change 0111, D1)', () => {
  for (const { name, decorated, called } of PAIRS) {
    it(`${name}: the same WGSL and GLSL ES 3.00, and no diagnostic`, () => {
      const a = compiled(decorated);
      const b = compiled(called);
      expect(b.diagnostics).toEqual([]);
      expect(a.diagnostics).toEqual([]);
      expect(b.wgsl).toBe(a.wgsl);
      expect(JSON.stringify(b.glsl)).toBe(JSON.stringify(a.glsl));
    });
  }

  it('the entry takes the constant name, and a function expression named otherwise is refused', () => {
    const source = `"use typeshade";
export const fs = fragment(function main(): vec4 { return vec4(1., 0., 0., 1.); });
`;
    expect(errors(source)).toEqual([
      expect.stringContaining(
        'TS8020 The function "main" is the entry "fs": name it as the constant',
      ),
    ]);
  });

  it('reads a diagnostic option as @diagnostic, and refuses another option', () => {
    const SAMPLE = `"use typeshade";
declare const t: texture_2d<f32>;
declare const s: sampler;
export const fs = fragment(
  function fs(@builtin("position") p: vec4): vec4 {
    if (p.x > 10.) { return textureSample(t, s, p.xy); }
    return vec4(0.);
  },
  OPTIONS,
);
`;
    const off = compiled(
      SAMPLE.replace('OPTIONS', '{ diagnostic: ["off", "derivative_uniformity"] }'),
    );
    expect(off.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(off.wgsl).toContain('diagnostic(off, derivative_uniformity);');
    expect(errors(SAMPLE.replace('OPTIONS', '{ blend: "add" }'))).toContainEqual(
      expect.stringContaining('TS8028 A stage call takes one option, "diagnostic"'),
    );
  });
});

describe('the editor reads a stage call as the compiler does', () => {
  it('reports nothing on an entry the compiler accepts', () => {
    const source = `"use typeshade";
${IO}
export const fs = fragment(function fs(v: VsOut): vec4 {
  return vec4(v.uv.x, v.uv.y, 0.2, 1.);
});
`;
    expect(errors(source)).toEqual([]);
    expect(editor(source)).toEqual([]);
  });

  it('reports the compiler refusal of a misnamed function expression', () => {
    const source = `"use typeshade";
export const fs = fragment(function main(): vec4 { return vec4(1., 0., 0., 1.); });
`;
    expect(editor(source)).toContainEqual(expect.stringContaining('is the entry "fs"'));
  });
});

describe('the host face reads a stage call', () => {
  it('a fragment entry a host draws, a compute entry and a kernel function a host calls', () => {
    const source = `"use typeshade";
declare const data: storage<array<f32>, "read_write">;
export const fs = fragment(function fs(@builtin("position") p: vec4): vec4 {
  return vec4(p.x, 0., 0., 1.);
});
export const main = compute([64], function main(@builtin("global_invocation_id") gid: vec3u): void {
  data[gid.x] = 1.;
});
export const scale = workgroup_size([128], function scale(xs: array<f32>): void {
  for (let i = 0; i < xs.length; i++) { xs[i] = xs[i] * 2.; }
});
`;
    const face = hostFace(source, { fileName: '/app/m.shade.ts', runtime: RUNTIME });
    const kinds = Object.fromEntries((face.exports ?? []).map((e) => [e.name, e.kind]));
    expect(kinds).toEqual({ fs: 'fragment', main: 'compute', scale: 'kernel' });
  });
});
