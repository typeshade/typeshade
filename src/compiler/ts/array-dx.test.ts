import { describe, expect, it } from 'vitest';
import { compileTsSource } from './source-file.js';
import { bothHalves } from '../../core/testing/both-halves.js';

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

  it('takes Array<f32> and f32[] as the array with no size (change 0114, S1)', () => {
    const funcsOf = (t: string): string =>
      JSON.stringify(
        compileTsSource(`
      "use typeshade";
      export function f(xs: ${t}): f32 { return xs[0]; }
    `).funcs,
        (key, value: unknown) => (key === 'span' || key === 'nameSpan' ? undefined : value),
      );
    expect(funcsOf('Array<f32>')).toBe(funcsOf('array<f32>'));
    expect(funcsOf('f32[]')).toBe(funcsOf('array<f32>'));
  });

  it('rejects xs.filter, which is not one of the methods an array has (surface §63)', () => {
    const halves = bothHalves(`
      "use typeshade";
      export function f(xs: array<f32, 4>): f32 {
        return xs.filter((x) => x > 0.)[0];
      }
    `);
    const sentence =
      `typeshade TS8099: ".filter" is not one of an array's methods here, which are map, forEach, ` +
      `some, every, reduce, fill, findIndex, findLastIndex, indexOf, lastIndexOf, includes and ` +
      `slice() with no argument, which copies it. An array's length is fixed, so a change of ` +
      `length is a loop: "for (const x of xs) { … }".`;
    expect(halves.compiler).toEqual([sentence]);
    // The editor shows TypeScript's 2339 and 7006 beside the sentence.
    expect(halves.editor).toContain(sentence);
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
