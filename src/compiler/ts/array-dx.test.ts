import { describe, expect, it } from 'vitest';
import { compileTsSource } from './source-file.js';

describe('array DX', () => {
  it('constructs array<f32, 2>(a, b)', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(a: f32, b: f32): i32 {
        const xs = array<f32, 2>(a, b);
        return xs.length;
      }
    `);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    const letS = r.funcs[0]!.body.find((s) => s.s === 'let');
    if (letS && letS.s === 'let') expect(letS.expr.op).toBe('construct');
  });

  it('folds xs.length to i32 N', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(xs: array<f32, 4>): i32 {
        return xs.length;
      }
    `);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    const ret = r.funcs[0]!.body[0];
    if (ret!.s === 'return' && ret.expr?.op === 'lit') expect(ret.expr.value).toBe(4);
  });

  it('rejects Array<f32> and f32[]', () => {
    const js = compileTsSource(`
      "use typeshade";
      export function f(xs: Array<f32>): f32 { return 0.; }
    `);
    expect(js.diagnostics.some((d) => /JS Array/.test(d.message))).toBe(true);

    const bracket = compileTsSource(`
      "use typeshade";
      export function f(xs: f32[]): f32 { return 0.; }
    `);
    expect(bracket.diagnostics.some((d) => /T\[\]/.test(d.message))).toBe(true);
  });

  it('rejects xs.filter, which is not one of the five methods an array has (surface §63)', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(xs: array<f32, 4>): f32 {
        return xs.filter((x) => x > 0.)[0];
      }
    `);
    expect(r.diagnostics.map((d) => `${d.code} ${d.message}`)).toEqual([
      `TS8099 ".filter" is not one of an array's methods here, which are map, forEach, some, ` +
        `every and reduce. An array's length is fixed, so a search, a copy or a change of ` +
        `length is a loop: "for (const x of xs) { … }".`,
    ]);
  });

  it('rejects construct arity mismatch', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(a: f32): f32 {
        const xs = array<f32, 2>(a);
        return a;
      }
    `);
    expect(r.diagnostics.some((d) => /expects 2/.test(d.message))).toBe(true);
  });
});
