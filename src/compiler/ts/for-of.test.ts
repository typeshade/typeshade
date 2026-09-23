// `for (const x of xs)` over an array (Rules 7.2, 7.5).
//
// It is the loop a TypeScript author writes over data, and it was TS8013 ("for-of / for-in
// iterate JS objects"). Over an array it is a counted loop with nothing left to check: its
// trip count is the array's length, which the body cannot change. It lowers to a counted `for`
// over the indices with the element read at the top of each trip, so both CPU engines, both
// writers and the debugger see the one loop form the IR has.

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { compileTsSource } from './source-file.js';
import { compileModule } from '../../core/oracle.js';
import { compileModuleJs } from '../../core/cpu-codegen.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';
import type { CpuValue } from '../../core/cpu-runtime.js';

const errorsOf = (src: string): { code?: string; message: string }[] =>
  compileTsSource(src)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => ({ code: d.code, message: d.message }));

/** What the editor shows on the same source: nothing, for a program that compiles. */
function editorSays(src: string): string[] {
  const service = createTypeshadeLanguageService();
  service.openDocument('a.shade.ts', src);
  return service.getDiagnostics('a.shade.ts').map((d) => `${String(d.code)} ${d.message}`);
}

describe('for-of over an array', () => {
  it('sums a runtime-sized storage array, on both CPU engines and in the editor', () => {
    const src = `"use typeshade";
declare const data: storage<array<f32>>;
declare let out: storage<array<f32>>;
@compute([64])
export function sum(@builtin("global_invocation_id") gid: vec3u) {
  let s = 0;
  for (const x of data) {
    s += x;
  }
  out[gid.x] = s;
}
`;
    const r = compile(src);
    expect(r.diagnostics).toEqual([]);
    expect(editorSays(src)).toEqual([]);
    expect(r.wgsl).toContain('let x = data[_i];');
    expect(r.wgsl).toMatch(/for \(var _i: u32 = 0u; \(_i < \w+\); _i = \(_i \+ 1u\)\) \{/);
    expect(r.wgsl).toContain('arrayLength(&data)');
    for (const make of [compileModule, compileModuleJs]) {
      const cm = make(r.module);
      const out = [0];
      cm.setBinding('data', [1, 2, 3.5]);
      cm.setBinding('out', out);
      cm.fns['sum']!([0, 0, 0]);
      expect(out, make.name).toEqual([6.5]);
    }
  });

  it('iterates a sized local array and an array of structs in a uniform', () => {
    const src = `"use typeshade";
class Light { pos: vec3; power: f32; }
class Scene { lights: array<Light, 2>; }
declare const scene: uniform<Scene>;
export function total(): f32 {
  const ws: array<f32, 3> = [1, 2, 3];
  let s = 0;
  for (const w of ws) {
    s += w;
  }
  return s;
}
export function lit(p: vec3): f32 {
  let s = 0;
  for (const l of scene.lights) {
    s += l.power / (1 + distance(p, l.pos));
  }
  return s;
}
`;
    const r = compile(src);
    expect(r.diagnostics).toEqual([]);
    expect(editorSays(src)).toEqual([]);
    expect(r.wgsl).toContain('(_i < 3u)');
    for (const make of [compileModule, compileModuleJs]) {
      const cm = make(r.module);
      expect(cm.fns['total']!(), make.name).toBe(6);
      // A struct holding an array of structs, which `CpuValue` does not spell.
      cm.setBinding('scene', {
        lights: [
          { pos: [0, 0, 0], power: 2 },
          { pos: [3, 4, 0], power: 6 },
        ],
      } as unknown as CpuValue);
      // 2 / (1 + 0) + 6 / (1 + 5)
      expect(cm.fns['lit']!([0, 0, 0]), make.name).toBe(3);
    }
  });

  it('gives `let x` a copy, as TypeScript does, and keeps break and continue', () => {
    const r = compile(`"use typeshade";
export function f(): f32 {
  const ws: array<f32, 4> = [1, 2, 3, 4];
  let s = 0;
  for (let w of ws) {
    w = w * 10;
    if (w === 20) {
      continue;
    }
    if (w > 30) {
      break;
    }
    s += w;
  }
  return s + ws[0];
}
export function nested(): f32 {
  const a: array<f32, 2> = [1, 2];
  const b: array<f32, 3> = [10, 20, 30];
  let s = 0;
  for (const x of a) {
    for (const y of b) {
      s += x * y;
    }
  }
  return s;
}
`);
    expect(r.diagnostics).toEqual([]);
    // 10 + 30 (20 skipped, 40 stops), and the array still holds its 1.
    expect(r.eval('f', [])).toBe(41);
    expect(r.eval('nested', [])).toBe(180);
    // The two counters of the nest are two names.
    expect(r.wgsl).toMatch(/var _i: u32[\s\S]*var _i_1: u32/);
  });

  it('emits a sized array loop in GLSL ES 3.00 too', () => {
    const r = compile(`"use typeshade";
const WEIGHTS: array<f32, 3> = [0.25, 0.5, 0.25];
@fragment
export function fs(@builtin("position") p: vec4): vec4 {
  let c = 0;
  for (const w of WEIGHTS) {
    c += w * p.x;
  }
  return vec4(c, 0, 0, 1);
}
`);
    expect(r.diagnostics).toEqual([]);
    expect(r.glsl?.fragment).toContain('float w = WEIGHTS[_i];');
    expect(r.glsl?.fragment).toContain('for (uint _i = 0u; (_i < 3u); _i = (_i + 1u)) {');
  });
});

describe('what for-of refuses', () => {
  it('a vector, which is not an array', () => {
    expect(
      errorsOf(`"use typeshade";
export function f(v: vec3): f32 { let s = 0; for (const c of v) { s += c; } return s; }`),
    ).toEqual([
      {
        code: 'TS8003',
        message:
          'for-of iterates an array; this is a vec3<f32>. Index it with a counted for, or write ' +
          'the value into an array<T, N>.',
      },
    ]);
  });

  it('an array that is not a name', () => {
    expect(
      errorsOf(`"use typeshade";
function make(): array<f32, 2> { return [1, 2]; }
export function f(): f32 { let s = 0; for (const x of make()) { s += x; } return s; }`),
    ).toEqual([
      {
        code: 'TS8006',
        message:
          'for-of reads its array on every trip, so the array has to be a name: bind it first, ' +
          '`const xs = …; for (const x of xs)`.',
      },
    ]);
  });

  it('a destructuring or `var` declaration, and `for-in`', () => {
    const inFor = (head: string): string[] =>
      errorsOf(`"use typeshade";
class P { a: f32; b: f32; }
export function f(): f32 {
  const ps: array<P, 1> = [{ a: 1, b: 2 }];
  const xs: array<f32, 1> = [1];
  let s = 0;
  for (${head}) { s += 1; }
  return s;
}`).map((d) => d.code ?? '');
    expect(inFor('const { a } of ps')).toContain('TS8008');
    expect(inFor('var x of xs')).toContain('TS8008');
    expect(inFor('const k in xs')).toContain('TS8013');
    expect(
      errorsOf(`"use typeshade";
export function f(): f32 { const xs: array<f32, 1> = [1]; let s = 0; for (const k in xs) { s += 1; } return s; }`)[0]
        ?.message,
    ).toBe(
      "for-in enumerates a JS object's keys, which a shader value does not have. Iterate an " +
        'array with `for (const x of xs)`, or count with `for (let i = 0; i < n; i++)`.',
    );
  });
});
