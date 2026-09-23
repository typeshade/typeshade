import { describe, it, expect } from 'vitest';
import { fn, Var, f32, f32T, u32T, boolT } from './index.js';
import { compileTsSource } from '../../compiler/ts/source-file.js';
import type { FuncDecl, Stmt, Expr } from './nodes.js';
import { typeKey } from './types.js';

// ═══ #8 S1 / S2 / B7 — the two authoring surfaces meet in ONE IR ═══
//
// `src/compiler/ts/ir-equality.test.ts` states the claim this file extends: the `fn()` surface
// is the IR equivalence oracle for the `"use typeshade"` compiler. The report behind #8 found
// the claim broken at three statements a shader cannot avoid — the compound assignment, the
// scalar cast, and logical negation — because the B surface had no spelling that made the same
// node. Each of those now has one, and these are the assertions that say so.
//
// The file reads the compiler and changes nothing in it.

const norm = (e: Expr): unknown => {
  const t = typeKey(e.type);
  switch (e.op) {
    case 'lit':
      return { op: 'lit', t, value: e.value };
    case 'varref':
    case 'param':
      return { op: e.op, t, name: e.name };
    case 'binop':
      return { op: 'binop', t, bop: e.bop, a: norm(e.a), b: norm(e.b) };
    case 'compare':
      return { op: 'compare', t, cop: e.cop, a: norm(e.a), b: norm(e.b) };
    case 'call':
      return { op: 'call', t, fn: e.fn, args: e.args.map(norm) };
    default:
      return { op: e.op, t };
  }
};

const normStmt = (s: Stmt): unknown => {
  switch (s.s) {
    case 'var':
      return { s: 'var', name: s.name, t: typeKey(s.type), init: s.init && norm(s.init) };
    case 'assign':
      return { s: 'assign', target: norm(s.target), expr: norm(s.expr) };
    case 'assignOp':
      return { s: 'assignOp', target: norm(s.target), bop: s.bop, expr: norm(s.expr) };
    case 'return':
      return { s: 'return', expr: s.expr && norm(s.expr) };
    default:
      return { s: s.s };
  }
};

const bodyOf = (f: FuncDecl): unknown => f.body.map(normStmt);

// Compile one `"use typeshade"` source and hand back the named function's decl.
const surfaceA = (src: string, name: string): FuncDecl => {
  const out = compileTsSource(`"use typeshade";\n${src}`);
  expect(out.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  const f = out.funcs.find((x) => x.name === name);
  expect(f, `fn ${name} in the compiled module`).toBeDefined();
  return f!;
};

describe('#8 — the seam: one statement, one IR', () => {
  it('S2 — `acc += x` and `acc.addAssign(x)` are the same statement', () => {
    const a = surfaceA(
      `export function f(x: f32): f32 {
         let acc = 0.
         acc += x
         return acc
       }`,
      'f',
    );
    const b = fn('f', { x: f32T }, f32T, ({ x }) => {
      const acc = Var('acc', f32(0));
      acc.addAssign(x);
      return acc;
    });
    expect(bodyOf(b.decl)).toEqual(bodyOf(a));
  });

  it('S2 — and the long spelling is a DIFFERENT statement, which is why S2 was needed', () => {
    const a = surfaceA(
      `export function f(x: f32): f32 {
         let acc = 0.
         acc += x
         return acc
       }`,
      'f',
    );
    const long = fn('f', { x: f32T }, f32T, ({ x }) => {
      const acc = Var('acc', f32(0));
      acc.assign(acc.add(x));
      return acc;
    });
    expect(bodyOf(long.decl)).not.toEqual(bodyOf(a));
  });

  it('S1 — `f32(n)` is the same cast on both surfaces', () => {
    const a = surfaceA(
      `export function f(n: u32): f32 {
         return f32(n)
       }`,
      'f',
    );
    const b = fn('f', { n: u32T }, f32T, ({ n }) => f32(n));
    expect(bodyOf(b.decl)).toEqual(bodyOf(a));
  });

  it('S1 — the method spelling makes that same cast', () => {
    const a = surfaceA(
      `export function f(n: u32): f32 {
         return f32(n)
       }`,
      'f',
    );
    const b = fn('f', { n: u32T }, f32T, ({ n }) => n.f32());
    expect(bodyOf(b.decl)).toEqual(bodyOf(a));
  });

  it('B7 — `!b` and `b.not()` are the same node', () => {
    const a = surfaceA(
      `export function f(b: bool): bool {
         return !b
       }`,
      'f',
    );
    const b = fn('f', { b: boolT }, boolT, ({ b }) => b.not());
    expect(bodyOf(b.decl)).toEqual(bodyOf(a));
  });
});
