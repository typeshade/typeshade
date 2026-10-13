// `Math.cbrt(x)` and the free `cbrt(x)` give ECMAScript's cube root for a negative `x` (#614).
//
// The expansion was `pow(x, 1/3)`. WGSL leaves `pow` outside its domain for every `x < 0`
// (§17.5.46) and GLSL ES 3.00 leaves the result undefined (§8.2): `x = -8` gave NaN on the CPU
// oracle and 2 on WebGPU and WebGL2 over SwiftShader (measured on 2a120ad, 2026-10-12), where
// `Math.cbrt(-8)` is -2. Rule 2.4 keeps `cbrt` an ECMAScript name whatever it expands to, and
// Rule 1.3 makes the oracle's answer the one WGSL fixes, which here the expansion decides. The
// expansion is now `sign(x) * pow(abs(x), 1/3)`: inside the domain of `pow` for every `x`, and 0
// at 0. One IR expression feeds the oracle, the generated JavaScript, WGSL and GLSL.
//
// The expansion reads `x` twice, so an argument that may have an effect (a call of a function
// of the file, an atomic) is passed to a function the front end builds, and it runs once.
//
// Both halves read each source: `compile()` (its emit and the oracle's values) and the
// language service (no diagnostic). `gate:differential` draws generated programs, not these;
// this file holds the values the oracle gives, and the compile gate compiles the emitted text.
//
// Verifies: Rule 2.4 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { compileModule } from '../../core/oracle.js';
import { compileModuleJs } from '../../core/cpu-codegen.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const XS = [-8, -1, 0, 1, 8] as const;
const EXPANDED = '(sign(x) * pow(abs(x), 0.3333333333333333))';

/** Both halves take `source`: no diagnostic from `compile()` or from the editor. */
function bothTake(source: string): ReturnType<typeof compile> {
  const c = compile(source);
  expect(c.diagnostics, 'compile()').toEqual([]);
  const service = createTypeshadeLanguageService();
  service.openDocument('a.ts', source);
  expect(service.getDiagnostics('a.ts'), 'the editor').toEqual([]);
  return c;
}

const count = (text: string, needle: string): number => text.split(needle).length - 1;

describe('cbrt of a negative x is the negative root (#614)', () => {
  const source = `"use typeshade";
export function m(x: f32): f32 { return Math.cbrt(x); }
export function c(x: f32): f32 { return cbrt(x); }
`;

  it('emits sign(x) * pow(abs(x), 1/3) on both targets, for both spellings', () => {
    const r = bothTake(source);
    expect(count(r.wgsl!, EXPANDED)).toBe(2);
    expect(count(r.glsl!.fragment, EXPANDED)).toBe(2);
    expect(r.wgsl).not.toContain('pow(x, ');
  });

  it("gives ECMAScript's Math.cbrt on the oracle and in the generated JavaScript", () => {
    const r = bothTake(source);
    const f64 = compileModule(r.module).fns;
    const f32 = compileModule(r.module, { precision: 'f32' }).fns;
    const js = compileModuleJs(r.module).fns;
    for (const fn of ['m', 'c']) {
      for (const x of XS) {
        const want = Math.cbrt(x);
        expect(r.eval(fn, [x]), `${fn}(${String(x)}) eval`).toBe(want);
        expect(f64[fn]!(x), `${fn}(${String(x)}) oracle`).toBe(want);
        expect(f32[fn]!(x), `${fn}(${String(x)}) oracle f32`).toBe(want);
        expect(js[fn]!(x), `${fn}(${String(x)}) js`).toBe(want);
      }
    }
  });

  it('folds a module constant to the negative root', () => {
    const r = bothTake(`"use typeshade";
const K: f32 = Math.cbrt(-8.);
export function k(): f32 { return K; }
`);
    expect(r.eval('k', [])).toBe(-2);
  });
});

describe('an argument with an effect runs once (#614)', () => {
  const source = `"use typeshade";
declare const buf: storage<array<f32>, "read_write">;
declare const cnt: storage<array<atomic<u32>>, "read_write">;
function bump(): f32 { buf[0] = buf[0] + 1.; return buf[0]; }
export function h(x: f32): f32 { return Math.cbrt(bump()) + cbrt(f32(atomicAdd(cnt[0], u32(1)))) + Math.cbrt(x); }
`;

  it('calls bump and atomicAdd once each, through the built function', () => {
    const r = bothTake(source);
    // A module with a storage binding has no GLSL render program here, so WGSL is the text read.
    expect(count(r.wgsl!, '= bump()')).toBe(1);
    expect(count(r.wgsl!, 'atomicAdd(')).toBe(1);
    // The built function holds the expansion once; a pure argument is still expanded in place.
    expect(r.wgsl).toContain(`fn cbrt(x: f32) -> f32 {\n  return ${EXPANDED};\n}`);
    expect(r.wgsl).toContain(EXPANDED);
  });

  it("keeps clear of the file's own function named cbrt", () => {
    const r = bothTake(`"use typeshade";
declare const buf: storage<array<f32>, "read_write">;
function bump(): f32 { buf[0] = buf[0] + 1.; return buf[0]; }
function cbrt(x: f32): f32 { return x * 2.; }
export function h(x: f32): f32 { return Math.cbrt(bump()) + cbrt(x); }
`);
    expect(count(r.wgsl!, '= bump()')).toBe(1);
    expect(count(r.wgsl!, 'fn cbrt(')).toBe(1);
    expect(r.wgsl).toContain('return (x * 2.0);');
  });
});
