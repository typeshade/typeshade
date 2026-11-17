import { describe, expect, it } from 'vitest';
import { compile } from '../../../compiler/ts/compile.js';
import { compileModule } from '../../oracle.js';
import type { Expr, ModuleDecl } from '../../ir/index.js';
import { f32T, u32T } from '../../ir/types.js';
import { splitLocalArrays } from './sroa.js';
import { fixpoint } from './optimize.js';

const PRELUDE = `"use typeshade";
  function side(x: f32): f32 { return x + 1.; }
  function sum3(x: array<f32, 3>): f32 { return x[0] + x[1] + x[2]; }
  function make(x: f32): array<f32, 3> { return [x, x, x]; }`;

const build = (body: string): ModuleDecl => {
  const r = compile(`${PRELUDE}
    export function f(a: f32, b: f32, c: f32, vi: u32): f32 { ${body} }`);
  expect(r.diagnostics).toEqual([]);
  return r.module;
};

const bodyOf = (m: ModuleDecl) => m.funcs.find((f) => f.name === 'f')!.body;
const hasArrayDecl = (m: ModuleDecl): boolean =>
  JSON.stringify(bodyOf(m)).includes('"kind":"array"');
const declNames = (m: ModuleDecl): string[] =>
  bodyOf(m).flatMap((s) => (s.s === 'let' || s.s === 'var' ? [`${s.s} ${s.name}`] : []));
const sameValues = (m: ModuleDecl, out: ModuleDecl): void => {
  const run = (x: ModuleDecl) => compileModule(x).fns.f! as (...a: number[]) => number;
  for (const args of [
    [1, 2, 3, 0],
    [-4.5, 0.25, 9, 1],
    [0, 0, 0, 2],
  ])
    expect(run(out)(...args)).toEqual(run(m)(...args));
};

describe('splitLocalArrays', () => {
  it('splits an array read only by literal indices', () => {
    const m = build('let xs = array<f32, 3>(a, b, c); return xs[0] + xs[2];');
    const out = splitLocalArrays(m);
    expect(hasArrayDecl(out)).toBe(false);
    expect(declNames(out)).toEqual(['let xs_0', 'let xs_1', 'let xs_2']);
    sameValues(m, out);
    expect(splitLocalArrays(out)).toEqual(out);
  });

  it('keeps a written element a var and an unwritten one a let', () => {
    const m = build(
      'let xs = array<f32, 3>(a, b, c); xs[1] = xs[0] + 1.; xs[1] += c; return xs[1] + xs[2];',
    );
    const out = splitLocalArrays(m);
    expect(declNames(out)).toEqual(['let xs_0', 'var xs_1', 'let xs_2']);
    sameValues(m, out);
  });

  it('splits a zero-initialised array into zero-initialised vars', () => {
    const arr = { kind: 'array', elem: f32T, size: 2 } as const;
    const ref = (name: string, k: number): Expr => ({
      op: 'index',
      type: f32T,
      base: { op: 'varref', type: arr, name },
      idx: { op: 'lit', type: u32T, value: k },
    });
    const m: ModuleDecl = {
      consts: [],
      structs: [],
      bindings: [],
      funcs: [
        {
          name: 'f',
          params: [{ name: 'a', type: f32T }],
          ret: f32T,
          body: [
            { s: 'var', name: 'xs', type: arr },
            { s: 'assign', target: ref('xs', 1), expr: { op: 'param', type: f32T, name: 'a' } },
            {
              s: 'return',
              expr: { op: 'binop', type: f32T, bop: '+', a: ref('xs', 0), b: ref('xs', 1) },
            },
          ],
        },
      ],
    };
    const out = splitLocalArrays(m);
    expect(hasArrayDecl(out)).toBe(false);
    expect(declNames(out)).toEqual(['var xs_0', 'var xs_1']);
    expect(compileModule(out).fns.f!(3)).toEqual(compileModule(m).fns.f!(3));
  });

  it('evaluates each initializer argument once, in order', () => {
    const m = build('let xs = array<f32, 2>(side(a), side(b)); return xs[1] - xs[0];');
    const out = splitLocalArrays(m);
    expect(declNames(out)).toEqual(['let xs_0', 'let xs_1']);
    expect(JSON.stringify(bodyOf(out)).match(/"fn":"side"/g)).toHaveLength(2);
    sameValues(m, out);
  });

  it('splits an element whose field is written', () => {
    const m = build(
      'let xs = array<vec2, 2>(vec2(a, b), vec2(c, a)); xs[0].x = c; return xs[0].x + xs[1].y;',
    );
    const out = splitLocalArrays(m);
    expect(hasArrayDecl(out)).toBe(false);
    expect(declNames(out)).toEqual(['var xs_0', 'let xs_1']);
    sameValues(m, out);
  });

  it('splits inside a loop body and an if arm', () => {
    const m = build(
      'let s = 0.; for (let i = 0; i < 3; i++) { let t = array<f32, 2>(s, a); if (b > 0.) { let u = array<f32, 2>(t[1], c); s = u[0] + t[0] + u[1]; } else { s = t[0] + t[1]; } } return s;',
    );
    const out = splitLocalArrays(m);
    expect(hasArrayDecl(out)).toBe(false);
    sameValues(m, out);
  });

  it.each([
    ['a dynamic index', 'let xs = array<f32, 3>(a, b, c); return xs[vi];'],
    ['a dynamic write', 'let xs = array<f32, 3>(a, b, c); xs[vi] = a; return xs[0];'],
    ['a whole copy', 'let xs = array<f32, 3>(a, b, c); let ys = xs; return ys[0] + xs[1];'],
    ['a whole assignment', 'let xs = array<f32, 3>(a, b, c); xs = [c, b, a]; return xs[0];'],
    ['a call argument', 'let xs = array<f32, 3>(a, b, c); return sum3(xs);'],
    ['an initializer that is not a construct', 'let xs = make(a); return xs[0] + xs[1];'],
    ['an index out of range', 'let xs = array<f32, 3>(a, b, c); return xs[0] + xs[3];'],
  ])('leaves an array alone with %s', (_, body) => {
    const r = compile(`${PRELUDE}
      export function f(a: f32, b: f32, c: f32, vi: u32): f32 { ${body} }`);
    if (r.diagnostics.length > 0) return;
    expect(splitLocalArrays(r.module)).toEqual(r.module);
  });

  it('survives the whole pipeline with the same values', () => {
    const m = build(
      'let xs = array<f32, 2>(a, b); let t = xs[0]; xs[0] = xs[1]; xs[1] = t; return xs[0] * 2. + xs[1];',
    );
    const out = fixpoint(m);
    expect(hasArrayDecl(out)).toBe(false);
    sameValues(m, out);
  });
});
