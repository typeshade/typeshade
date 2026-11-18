import { describe, expect, it } from 'vitest';
import { compile } from '../../../compiler/ts/compile.js';
import type { ModuleDecl, Stmt } from '../../ir/index.js';
import { compileModule } from '../../oracle.js';
import { varToLet } from './var-to-let.js';

function build(body: string, prelude = '', params = 'x: f32'): ModuleDecl {
  const r = compile(`"use typeshade";
    ${prelude}
    export function f(${params}): f32 {
      ${body}
    }`);
  expect(r.diagnostics).toEqual([]);
  return r.module;
}

const top = (m: ModuleDecl): readonly Stmt[] => m.funcs.find((f) => f.name === 'f')!.body;
const declOf = (m: ModuleDecl, name: string): Stmt | undefined =>
  top(m).find((s) => (s.s === 'var' || s.s === 'let') && s.name === name);
const writesTo = (m: ModuleDecl, name: string): number =>
  top(m).filter(
    (s) =>
      (s.s === 'assign' || s.s === 'assignOp') &&
      s.target.op === 'varref' &&
      s.target.name === name,
  ).length;

const sameValues = (before: ModuleDecl, after: ModuleDecl, args: number[][]): void => {
  for (const a of args)
    expect(compileModule(after).fns.f!(...a)).toEqual(compileModule(before).fns.f!(...a));
};

describe('varToLet: a dead initializer', () => {
  it('moves the first whole write into the declaration', () => {
    const m = build('let a = x + 1.; a = x * 2.; return a * 3.;');
    const out = varToLet(m);
    expect(declOf(out, 'a')).toMatchObject({ s: 'let', expr: { op: 'binop', bop: '*' } });
    expect(writesTo(out, 'a')).toBe(0);
    sameValues(m, out, [[-1.5], [0], [4]]);
  });

  it('moves the declaration past statements that do not touch the variable', () => {
    const m = build('let a = 0.; let b = 0.; a = x + 1.; b = x + 2.; return a * b;');
    const out = varToLet(m);
    expect(writesTo(out, 'a') + writesTo(out, 'b')).toBe(0);
    expect(declOf(out, 'a')?.s).toBe('let');
    expect(declOf(out, 'b')?.s).toBe('let');
    sameValues(m, out, [[-1.5], [0], [4]]);
  });

  it('keeps a variable written again, as a variable with the new initializer', () => {
    const m = build('let a = 0.; a = x + 1.; a = a * 2.; return a;');
    const out = varToLet(m);
    expect(declOf(out, 'a')).toMatchObject({ s: 'var', init: { op: 'binop', bop: '+' } });
    expect(writesTo(out, 'a')).toBe(1);
    sameValues(m, out, [[-1.5], [3]]);
  });

  it.each([
    ['the first touch reads the variable', 'let a = x; let b = a; a = x + 1.; return a + b;'],
    ['the first touch is a compound assignment', 'let a = x; a += 1.; a = x * 2.; return a;'],
    ['the new value reads the variable', 'let a = x; a = a + 1.; return a;'],
    ['the first touch is a branch', 'let a = x; if (x > 0.) { a = 1.; } return a;'],
    [
      'the first touch is a loop',
      'let a = x; for (let i = 0; i < 3; i++) { a = a + 1.; } return a;',
    ],
  ])('keeps the initializer when %s', (_why, body) => {
    const m = build(body);
    const out = varToLet(m);
    expect(declOf(out, 'a')).toMatchObject({ s: 'var' });
    expect((declOf(out, 'a') as { init?: unknown }).init).toMatchObject({ op: 'param' });
    sameValues(m, out, [[-1.5], [0], [4]]);
  });

  it('keeps an initializer that has an effect', () => {
    const m = build(
      'let a = bump(x); a = x * 2.; return a;',
      'let sink: f32 = 0; function bump(v: f32): f32 { sink = v; return v; }',
    );
    const out = varToLet(m);
    expect((declOf(out, 'a') as { init?: unknown }).init).toMatchObject({ op: 'call' });
    expect(writesTo(out, 'a')).toBe(1);
  });
});

describe('varToLet: a variable written once becomes a let', () => {
  it('turns a variable that is never written again into a let', () => {
    const m = build('let a = x * 2.; return a + a;');
    expect(declOf(m, 'a')?.s).toBe('var');
    const out = varToLet(m);
    expect(declOf(out, 'a')?.s).toBe('let');
    sameValues(m, out, [[-1.5], [0], [4]]);
  });

  it('turns a struct that is only read into a let', () => {
    const m = build(
      'let p = new P(x, 2.); return p.a + p.b;',
      'class P { a: f32; b: f32; constructor(a: f32, b: f32) { this.a = a; this.b = b; } }',
    );
    const out = varToLet(m);
    const decl = declOf(out, 'p') ?? top(out).find((s) => s.s === 'let' || s.s === 'var');
    expect(decl?.s).toBe('let');
    sameValues(m, out, [[-1.5], [4]]);
  });

  it.each([
    ['written twice', 'let a = x; a = x + 1.; let b = a; a = x + 2.; return a + b;'],
    ['written in a branch', 'let a = x; if (x > 0.) { a = 1.; } return a;'],
    ['written in a loop', 'let a = x; for (let i = 0; i < 3; i++) { a = a + 1.; } return a;'],
    ['compound assignment', 'let a = x; a += 1.; return a;'],
    ['incremented', 'let a = x; a++; return a;'],
    ['lane write', 'let v = vec3(x, 1., 2.); v.y = x; return v.y + v.z;'],
    ['element write', 'let v = [x, 1., 2.]; v[1] = x; return v[1] + v[2];'],
  ])('stays a var: %s', (_why, body) => {
    const m = build(body);
    const out = varToLet(m);
    expect(top(out).some((s) => s.s === 'var' && (s.name === 'a' || s.name === 'v'))).toBe(true);
    sameValues(m, out, [[-1.5], [0], [4]]);
  });

  it('stays a var: a field is written', () => {
    const m = build(
      'let p = new P(x, 2.); p.a = 5.; return p.a + p.b;',
      'class P { a: f32; b: f32; constructor(a: f32, b: f32) { this.a = a; this.b = b; } }',
    );
    const out = varToLet(m);
    expect(top(out).some((s) => s.s === 'var' && s.type.kind === 'struct')).toBe(true);
    sameValues(m, out, [[-1.5], [4]]);
  });

  it('stays a var: a callee writes it through an inout parameter', () => {
    const m = build(
      'let v = [x, 1., 2.]; change(v); return v[0];',
      'function change(a: array<f32, 3>): void { a[0] = 99.; }',
    );
    const out = varToLet(m);
    expect(top(out).some((s) => s.s === 'var' && s.type.kind === 'array')).toBe(true);
    sameValues(m, out, [[-1.5], [4]]);
  });

  it('stays a var: a callee writes it through a second callee', () => {
    const m = build(
      'let v = [x, 1., 2.]; outer(v); return v[0];',
      'function change(a: array<f32, 3>): void { a[0] = 99.; }\n' +
        'function outer(a: array<f32, 3>): void { change(a); }',
    );
    const out = varToLet(m);
    expect(top(out).some((s) => s.s === 'var' && s.type.kind === 'array')).toBe(true);
    sameValues(m, out, [[-1.5], [4]]);
  });

  it('stays a var: a method changes its object', () => {
    const m = build(
      'let p = new P(x); p.bump(); return p.a;',
      'class P { a: f32; constructor(a: f32) { this.a = a; } bump(): void { this.a += 1.; } }',
    );
    const out = varToLet(m);
    expect(top(out).some((s) => s.s === 'var' && s.type.kind === 'struct')).toBe(true);
    sameValues(m, out, [[-1.5], [4]]);
  });
});

it('drops a pure initializer that a later whole write replaces, one write after another', () => {
  const m = build('let a = x; a = x + 1.; a = x + 2.; return a;');
  const out = varToLet(m);
  expect(declOf(out, 'a')).toMatchObject({ s: 'let' });
  expect(writesTo(out, 'a')).toBe(0);
  sameValues(m, out, [[-1.5], [4]]);
});

describe('varToLet: shape of the result', () => {
  it('is idempotent', () => {
    const m = build('let a = 0.; let b = x; a = x + 1.; let c = a * b; return c + b;');
    const once = varToLet(m);
    expect(varToLet(once)).toEqual(once);
    sameValues(m, once, [[-1.5], [0], [4]]);
  });

  it('leaves a module with nothing to do unchanged in value', () => {
    const m = build('return x * 2.;');
    expect(top(varToLet(m))).toEqual(top(m));
  });
});
