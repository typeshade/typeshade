// Verifies: Rule 7.2 (docs/language-design.md; traced in reqs/).
//
// A conditional on a struct or an array is an `if` (surface §31, #113), and so is a scalar or
// vector conditional whose arm is costly (change 0097): a call of a function of the module, a
// texture read, or 8 or more operations. A cheap arm keeps `select` and the ternary, and so does
// an arm that holds a derivative, a barrier or a call that reaches one, since the uniformity
// analysis ran on the `select`. The CPU oracle reads the IR and gives the same value either way.
import { describe, expect, it } from 'vitest';
import { compile } from '../../compiler/ts/compile.js';
import { compileModule } from '../oracle.js';
import { armCost, COSTLY_ARM, collectiveFunctions } from './select-composite.js';

/** A program whose fragment entry reads `call`, so the GLSL ES 3.00 fragment, which carries only
 *  what its entry reaches, holds the function under test. */
const program = (body: string, call = 'w'): string => `"use typeshade";
function heavy(x: f32): f32 { return sin(x) * cos(x * 3.) + sqrt(abs(x)) * exp(-x * x); }
${body}
@fragment
export function fs(@location(0) uv: vec2, @location(1) w: f32): vec4 {
  return vec4(uv, ${call}, 1.);
}
`;

const compiled = (body: string, call?: string) => {
  const r = compile(program(body, call));
  expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return r;
};

describe('a scalar conditional with a costly arm is an if, and a cheap one keeps select (change 0097)', () => {
  it('a call of a function of the module in an arm is hoisted into a slot and an if, on both targets', () => {
    const r = compiled(
      `export function pick(x: f32): f32 { return x > 0.5 ? heavy(x) : 0.; }`,
      'pick(w)',
    );
    expect(r.wgsl).toContain(
      'var _sel0: f32;\n  if ((x > 0.5)) {\n    _sel0 = heavy(x);\n  } else {\n    _sel0 = 0.0;\n  }\n  return _sel0;',
    );
    expect(r.wgsl).not.toContain('select(0.0, heavy(x)');
    expect(r.glsl?.fragment).toContain(
      'float _sel0;\n  if ((x > 0.5)) {\n    _sel0 = heavy(x);\n  } else {\n    _sel0 = 0.0;\n  }',
    );
    const run = compileModule(r.module).fns;
    expect(run['pick']!(0.25)).toBe(0);
    expect(run['pick']!(0.75)).toBeCloseTo(
      Math.sin(0.75) * Math.cos(2.25) + Math.sqrt(0.75) * Math.exp(-0.5625),
      5,
    );
  });

  it('cheap arms keep select and the ternary', () => {
    const r = compiled(
      `export function cheap(x: f32): f32 { return x > 0.5 ? x * 2. : x * 3.; }`,
      'cheap(w)',
    );
    expect(r.wgsl).toContain('return select((x * 3.0), (x * 2.0), (x > 0.5));');
    expect(r.glsl?.fragment).toContain('return ((x > 0.5) ? (x * 2.0) : (x * 3.0));');
  });

  it('eight operations in an arm reach the threshold; seven do not', () => {
    const eight = compiled(
      `export function f(x: f32): f32 { return x > 0.5 ? x * 2. + x * 3. + x * 4. + x * 5. + 1. : 0.; }`,
    );
    expect(eight.wgsl).toContain('var _sel0: f32;');
    const seven = compiled(
      `export function f(x: f32): f32 { return x > 0.5 ? x * 2. + x * 3. + x * 4. + 1. : 0.; }`,
    );
    expect(seven.wgsl).toContain('select(0.0, ');
  });

  it('a conditional inside a loop body hoists inside the body, and a nested one hoists deepest first', () => {
    const r = compiled(
      `export function inLoop(x: f32, k: array<f32, 4>): f32 { let s = 0.; for (let i = 0; i < 4; i++) { s += x > k[i] ? heavy(k[i]) : 1.; } return s; }
export function nested(x: f32): f32 { return x > 0.5 ? (x > 0.7 ? heavy(x) : 0.) : heavy(-x); }`,
    );
    const wgsl = r.wgsl!;
    const loop = wgsl.indexOf('for (var i: i32 = 0;');
    expect(loop).toBeGreaterThan(0);
    expect(wgsl.indexOf('var _sel0: f32;')).toBeGreaterThan(loop);
    expect(wgsl).toContain('_sel0 = heavy(k[i]);');
    // The inner conditional's slot is assigned before the outer reads it.
    expect(wgsl.indexOf('_sel1 = heavy(x);')).toBeLessThan(wgsl.indexOf('_sel2 = _sel1;'));
  });

  it('an arm that holds a derivative, or a call of a function that reaches one, keeps select', () => {
    const r = compiled(
      `function slope(x: f32): f32 { return dpdx(x) * 2. + sin(x) * cos(x) * sqrt(x) * 4.; }
export function direct(x: f32, w: f32): f32 { return w > 0.5 ? dpdx(x) * 2. + sin(x) * cos(x) * sqrt(x) * 4. : 0.; }
export function reached(x: f32, w: f32): f32 { return w > 0.5 ? slope(x) : 0.; }`,
    );
    expect(r.wgsl).toContain('select(0.0, ((dpdx(x) * 2.0)');
    expect(r.wgsl).toContain('select(0.0, slope(x), (w > 0.5))');
  });

  it('a componentwise select keeps the operator', () => {
    const r = compiled(
      `export function mask(a: vec2, b: vec2, m: vec2b): vec2 { return select(vec2(heavy(a.x), heavy(a.y)), b, m); }`,
    );
    expect(r.wgsl).toContain('return select(');
    expect(r.wgsl).not.toContain('_sel0');
  });

  it('measures an arm as the proposal weighs it', () => {
    const r = compiled(
      `export function pick(x: f32): f32 { return x > 0.5 ? heavy(x) : sqrt(x) * 2.; }`,
    );
    const declared = new Set(r.module.funcs.map((f) => f.name));
    const pick = r.module.funcs.find((f) => f.name === 'pick')!;
    const ret = pick.body.find((s) => s.s === 'return')!;
    const sel = (ret as unknown as { expr: { op: string; ifTrue: never; ifFalse: never } }).expr;
    expect(sel.op).toBe('select');
    expect(armCost(sel.ifTrue, declared)).toBe(16);
    expect(armCost(sel.ifFalse, declared)).toBe(3);
    expect(COSTLY_ARM).toBe(8);
    expect([...collectiveFunctions(r.module)]).toEqual([]);
  });
});
