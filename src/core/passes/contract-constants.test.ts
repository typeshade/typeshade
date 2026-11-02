// Verifies: Rule 11.22 (docs/language-design.md; traced in reqs/).
// ═══ Constant arguments into a function under a numerical contract (#850 N5) ═══
//
// A call that hands a scalar literal to an opted-in function gets a copy with the literal in
// place, so `finite-math` folds what the literal decides; an exact function is never copied, so
// the default output does not move. Each source is read on both halves (Rule 12.7).

import { describe, expect, it } from 'vitest';
import { compile } from '../../compiler/ts/compile.js';
import { compileModule } from '../oracle.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';
import { specializeContractConstants } from './contract-constants.js';

function accepted(body: string): ReturnType<typeof compile> {
  const src = `"use typeshade";\n${body}\n`;
  const result = compile(src, { fileName: 'cc.shade.ts' });
  expect(result.diagnostics.map((d) => `${d.code} ${d.message}`)).toEqual([]);
  const service = createTypeshadeLanguageService();
  service.openDocument('cc.shade.ts', src);
  expect(service.getDiagnostics('cc.shade.ts')).toEqual([]);
  return result;
}

function fnText(wgsl: string, name: string): string {
  const at = wgsl.indexOf(`fn ${name}(`);
  expect(at, `fn ${name} is emitted`).toBeGreaterThanOrEqual(0);
  return wgsl.slice(at, wgsl.indexOf('\n}\n', at) + 2);
}

const TICK = (wrap: boolean): string => `function hash(p: vec2f): f32 {
  return fract(sin(dot(p, vec2f(12.9898, 78.233))) * 43758.5453);
}
${wrap ? 'const tick = numerics(["finite-math"], function tick' : 'function tick'}(base: vec3f, x: vec3f, curl: f32, spread: f32): vec3f {
  return mix(base, x, curl) + spread * hash(base.xy);
}${wrap ? ');' : ''}
export const fs = fragment(function fs(p: builtin<"position", vec4f>): vec4f {
  let b = p.xyz;
  let x = vec3f(sin(p.x), cos(p.y), 1.);
  return vec4f(tick(b, x, 0., 0.) + tick(b, x, 0.5, 0.) + tick(b, x, 0., 0.) + tick(b, x, p.w, 1.), 1.);
});`;

describe('constant arguments into a contract function (#850 N5)', () => {
  it('copies the function per literal set, folds what the literals decide, and drops the original', () => {
    const r = accepted(TICK(true));
    const wgsl = r.wgsl ?? '';
    expect(wgsl).not.toMatch(/fn tick\(/);
    // curl = 0 and spread = 0: mix(base, x, 0.0) is base, and 0.0 * hash(…) is 0.
    expect(fnText(wgsl, 'tick_k0')).toMatch(
      /fn tick_k0\(base: vec3<f32>, x: vec3<f32>\) -> vec3<f32> \{\n\s+return base;\n\}/,
    );
    // curl = 0.5 keeps the mix; spread = 0 still drops the hash.
    expect(fnText(wgsl, 'tick_k1')).toMatch(/return mix\(base, x, 0\.5\);/);
    // A runtime curl keeps its parameter; spread = 1 is a plain hash.
    expect(fnText(wgsl, 'tick_k2')).toMatch(/curl: f32\)/);
    expect(wgsl.match(/fn tick_k\d+\(/g)).toHaveLength(3);
  });

  it('keeps the copies under the contract, and leaves the oracle the source', () => {
    const r = accepted(TICK(true));
    const out = specializeContractConstants(r.module!);
    for (const f of out.funcs.filter((g) => g.name.startsWith('tick_k')))
      expect(f.numerics).toEqual(['finite-math']);
    // The oracle runs the authored module: tick with curl = 0 and an infinite x is NaN there.
    const tick = compileModule(r.module).fns['tick']!;
    expect((tick([1, 2, 3], [Infinity, 0, 0], 0, 0) as number[])[0]).toBeNaN();
  });

  it('copies no exact function, so the default output does not move', () => {
    const r = accepted(TICK(false));
    expect(specializeContractConstants(r.module!)).toBe(r.module);
    expect(r.wgsl).toMatch(/fn tick\(base: vec3<f32>, x: vec3<f32>, curl: f32, spread: f32\)/);
  });

  it('substitutes a scalar literal only, never a vector one', () => {
    const r =
      accepted(`const shift = numerics(["finite-math"], function shift(a: vec2f, b: vec2f, k: f32): vec2f {
  return a * k + b;
});
export const fs = fragment(function fs(p: builtin<"position", vec4f>): vec4f {
  return vec4f(shift(p.xy, vec2f(1., 2.), 0.), 0., 1.);
});`);
    const text = fnText(r.wgsl ?? '', 'shift_k0');
    expect(text).toMatch(/fn shift_k0\(a: vec2<f32>, b: vec2<f32>\)/);
    // k = 0 folds a * 0.0 to a zero vector; the vector b stays an argument.
    expect(text).not.toMatch(/a \*/);
    expect(text).toMatch(/vec2<f32>\(0\.0, 0\.0\)/);
  });

  it('leaves a module with no entry alone, since its helpers may be called by name', () => {
    const r = accepted(`const f = numerics(["finite-math"], function f(x: f32, k: f32): f32 {
  return x * k;
});
export function g(x: f32): f32 {
  return f(x, 0.);
}`);
    expect(specializeContractConstants(r.module!)).toBe(r.module);
  });
});
