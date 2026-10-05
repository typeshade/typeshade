// Verifies: Rule 9.4 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { compileTsSource } from './source-file.js';
import { EXPAND_ARITY, expandMath, type ExpandId } from './math-expand.js';
import { MATH_EXPAND_ALIAS, resolveMathExpand, isCanonicalMathFn } from './math-alias.js';
import type { Expr } from '../../core/ir/nodes.js';
import { f32T } from '../../core/ir/types.js';
import { stripSpans } from '../../core/testing/strip-spans.js';

describe('missing Math + shader free math', () => {
  it('classifies expansions and free names', () => {
    expect(resolveMathExpand('log10')).toBe('log10');
    expect(resolveMathExpand('hypot')).toBe('hypot');
    expect(isCanonicalMathFn('clamp')).toBe(true);
    expect(isCanonicalMathFn('length')).toBe(true);
    expect(isCanonicalMathFn('inverseSqrt')).toBe(true);
  });

  it('log10(x) expands to log(x) * LOG10E', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(x: f32): f32 { return log10(x); }
    `);
    expect(r.diagnostics).toEqual([]);
    const ret = r.funcs[0]!.body[0];
    expect(ret!.s).toBe('return');
    if (ret!.s === 'return' && ret.expr && ret.expr.op === 'binop') {
      expect(ret.expr.bop).toBe('*');
      if (ret.expr.a.op === 'call') expect(ret.expr.a.fn).toBe('log');
    }
  });

  it('Math.log10 === log10', () => {
    const a = compileTsSource(
      `"use typeshade"; export function f(x: f32): f32 { return log10(x); }`,
    );
    const b = compileTsSource(
      `"use typeshade"; export function f(x: f32): f32 { return Math.log10(x); }`,
    );
    expect(a.diagnostics).toEqual([]);
    expect(b.diagnostics).toEqual([]);
    expect(stripSpans(a.funcs[0]!.body)).toEqual(stripSpans(b.funcs[0]!.body));
  });

  it('cbrt(x) expands to pow(x, 1/3)', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(x: f32): f32 { return Math.cbrt(x); }
    `);
    expect(r.diagnostics).toEqual([]);
    const ret = r.funcs[0]!.body[0];
    if (ret!.s === 'return' && ret.expr && ret.expr.op === 'call') expect(ret.expr.fn).toBe('pow');
  });

  it('hypot(a,b) expands to length(vec2)', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(a: f32, b: f32): f32 { return hypot(a, b); }
    `);
    expect(r.diagnostics).toEqual([]);
    const ret = r.funcs[0]!.body[0];
    if (ret!.s === 'return' && ret.expr && ret.expr.op === 'call')
      expect(ret.expr.fn).toBe('length');
  });

  it('clamp / mix / length are free functions', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(x: f32, uv: vec2): f32 {
        const a = clamp(x, 0, 1);
        const b = mix(a, 1, 0.5);
        return length(uv) + b;
      }
    `);
    expect(r.diagnostics).toEqual([]);
  });

  it('log1p / expm1 expand', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(x: f32): f32 { return log1p(x) + expm1(x); }
    `);
    expect(r.diagnostics).toEqual([]);
  });
});

// The compiler's half of the `Math` members it expands, which the editor declares from the tables
// this file reads (`ambient.ts`, Rule 12.7, #186). `ambient-parity.test.ts` reads the other half
// of each program below, and holds the declaration to the count of arguments `EXPAND_ARITY`
// gives. The values are pinned as they are so that a change to one is an edit of this file: how
// closely each answers like ECMAScript's is a separate question (#186), and none of it moves here.
describe('the Math members WGSL has no builtin for: the member is its free spelling (Rule 9.4)', () => {
  const programOf = (expression: string): string =>
    `"use typeshade"\nexport function f(x: f32, y: f32, z: f32): f32 {\n  return ${expression}\n}\n`;

  /** `[the name, the arguments written, the return the WGSL has]` */
  const ROWS: readonly (readonly [string, string, string])[] = [
    ['log10', 'x', 'return (log(x) * 0.4342944819032518);'],
    ['log1p', 'x', 'return log((x + 1.0));'],
    ['expm1', 'x', 'return (exp(x) - 1.0);'],
    ['cbrt', 'x', 'return pow(x, 0.3333333333333333);'],
    ['hypot', 'x, y', 'return length(vec2<f32>(x, y));'],
    ['hypot', 'x, y, z', 'return length(vec3<f32>(x, y, z));'],
  ];

  for (const [name, args, wgslReturn] of ROWS) {
    it(`Math.${name}(${args}) and ${name}(${args}) are one call, ${wgslReturn}`, () => {
      const member = programOf(`Math.${name}(${args})`);
      const free = programOf(`${name}(${args})`);
      const a = compileTsSource(member);
      const b = compileTsSource(free);
      expect(a.diagnostics).toEqual([]);
      expect(b.diagnostics).toEqual([]);
      expect(stripSpans(a.funcs[0]!.body)).toEqual(stripSpans(b.funcs[0]!.body));
      const compiled = compile(member);
      expect(compiled.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
      expect(compiled.wgsl).toContain(wgslReturn);
      expect(compiled.wgsl).toBe(compile(free).wgsl);
    });
  }

  it('an expansion is refused, member or free, when an argument is not an f32', () => {
    const refused = (expression: string): string[] =>
      compileTsSource(
        `"use typeshade"\nexport function f(i: i32, x: f32): f32 {\n  return ${expression}\n}\n`,
      ).diagnostics.map((d) => `${d.code} ${d.message}`);
    expect(refused('Math.cbrt(i)')).toEqual(['TS8003 cbrt expects f32, got i32.']);
    expect(refused('cbrt(i)')).toEqual(['TS8003 cbrt expects f32, got i32.']);
    expect(refused('Math.hypot(x, i)')).toEqual(['TS8003 hypot arguments must be f32, got i32.']);
    expect(refused('hypot(i, x)')).toEqual(['TS8003 hypot arguments must be f32, got i32.']);
  });
});

describe('EXPAND_ARITY is the count of arguments expandMath takes (#186)', () => {
  const argument = (): Expr => ({ op: 'lit', type: f32T, value: 1 });
  /** The sentence each expansion answers a wrong count with, code apart: text is contract. */
  const SENTENCE: Readonly<Record<ExpandId, string>> = {
    log10: 'log10 expects 1 argument.',
    log1p: 'log1p expects 1 argument.',
    expm1: 'expm1 expects 1 argument.',
    cbrt: 'cbrt expects 1 argument.',
    hypot: 'hypot expects 2 or 3 arguments.',
  };

  it('has a row for every member the compiler expands, and no other', () => {
    expect(Object.keys(EXPAND_ARITY).sort()).toEqual(Object.keys(MATH_EXPAND_ALIAS).sort());
    expect(EXPAND_ARITY.hypot).toEqual([2, 3]);
  });

  for (const id of Object.keys(EXPAND_ARITY) as ExpandId[]) {
    const [fewest, most] = EXPAND_ARITY[id];
    it(`${id} takes ${fewest} to ${most} arguments, and says so at every count beside them`, () => {
      for (let count = 0; count <= 4; count++) {
        const out = expandMath(id, Array.from({ length: count }, argument));
        if (count >= fewest && count <= most) expect(typeof out, `${count}`).toBe('object');
        else expect(out, `${count}`).toBe(SENTENCE[id]);
      }
    });
  }
});
