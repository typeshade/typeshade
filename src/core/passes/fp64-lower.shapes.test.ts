import { describe, it, expect } from 'vitest';
import {
  fn,
  module,
  f64T,
  f32T,
  vec2fT,
  vec3fT,
  vec3f64T,
  vec2f64T,
  mat2f64T,
  toF32,
  type Expr,
  type FuncDecl,
  type ModuleDecl,
  type ShaderType,
} from '../ir/index.js';
import { eachExpr, eachStmtExpr } from '../ir/visit.js';
import { FP64_GUARD_NAME, FP64_GUARD_TYPE } from '../fp64/df64-lib.js';
import { emitGlslModule } from '../backends/glsl.js';
import { emitModule } from '../backends/wgsl.js';
import { fp64Lower } from './fp64-lower.js';

const param = (name: string, type: ShaderType): Expr => ({ op: 'param', type, name });
const lit = (type: ShaderType, value: number): Expr => ({ op: 'lit', type, value });

const single = (
  params: readonly [string, ShaderType][],
  expr: Expr,
  extra: Partial<ModuleDecl> = {},
): ModuleDecl => ({
  ...module({
    funcs: [
      {
        name: 'k',
        params: params.map(([name, type]) => ({ name, type })),
        ret: expr.type,
        body: [{ s: 'return', expr }],
      },
    ],
  }),
  ...extra,
});

const returned = (m: ModuleDecl): Expr => {
  const k = fp64Lower(m).funcs.find((f) => f.name === 'k')!;
  const last = k.body.at(-1)!;
  if (last.s !== 'return' || last.expr === undefined) throw new Error('k does not return');
  return last.expr;
};

const countCalls = (f: FuncDecl, name: string): number => {
  let n = 0;
  for (const s of f.body)
    eachStmtExpr(s, (e) =>
      eachExpr(e, (x) => {
        if (x.op === 'call' && x.fn === name) n++;
      }),
    );
  return n;
};

describe('what the lowering injects into a module', () => {
  it('marks every injected helper opaque and no function of the module', () => {
    const k = fn('k', { a: f64T, b: f64T }, (p) => toF32(p.a.add(p.b))).decl;
    const out = fp64Lower(module({ funcs: [k] }));
    const helpers = out.funcs.filter((f) => f.name.startsWith('df64_'));
    expect(helpers.length).toBeGreaterThan(2);
    for (const h of helpers) expect(h.opaque, h.name).toBe(true);
    expect(out.funcs.find((f) => f.name === 'k')!.opaque).toBeUndefined();
  });

  it('keeps the signature of a module function, and reads the guard in its body', () => {
    const k = fn('k', { a: f64T, b: f64T }, (p) => toF32(p.a.add(p.b))).decl;
    const lowered = fp64Lower(module({ funcs: [k] })).funcs.find((f) => f.name === 'k')!;
    expect(lowered.params.map((p) => p.name)).toEqual(['a', 'b']);
    expect(countCalls(lowered, 'f64Guard')).toBeGreaterThan(0);
  });

  it('reads a hand-declared guard at highp, in the binding and on GLSL', () => {
    const k = fn('k', { a: f64T, b: f64T }, (p) => toF32(p.a.add(p.b)));
    const declared = {
      group: 0,
      binding: 2,
      name: FP64_GUARD_NAME,
      space: 'uniform' as const,
      type: FP64_GUARD_TYPE,
    };
    const m = { ...module({ funcs: [k] }), bindings: [declared] };
    const guard = fp64Lower(m).bindings.find((b) => b.name === FP64_GUARD_NAME)!;
    expect([guard.binding, guard.precision]).toEqual([2, 'highp']);
    expect(emitGlslModule(m, 'fragment')).toMatch(/highp sampler2D _fp64/);
  });

  it('places the injected guard after the group-0 bindings only', () => {
    const k = fn('k', { a: f64T, b: f64T }, (p) => toF32(p.a.add(p.b)));
    const at = (group: number, binding: number) => ({
      group,
      binding,
      name: `u${group}_${binding}`,
      space: 'uniform' as const,
      type: f32T,
    });
    const slot = (bindings: ReturnType<typeof at>[]): number[] => {
      const out = fp64Lower({ ...module({ funcs: [k] }), bindings });
      const g = out.bindings.find((b) => b.name === FP64_GUARD_NAME)!;
      return [g.group, g.binding];
    };
    expect(slot([at(1, 9), at(0, 3)])).toEqual([0, 4]);
    expect(slot([at(1, 9)])).toEqual([0, 0]);
  });

  it('threads the guard into a constant whose initializer calls a helper', () => {
    const sum: Expr = { op: 'binop', type: f64T, bop: '+', a: lit(f64T, 1), b: lit(f64T, 2) };
    const m = {
      ...module({ funcs: [fn('k', { a: f64T }, (p) => p.a).decl] }),
      consts: [{ name: 'C', type: f64T, wgslValue: 0, cpuValue: 3, valueExpr: sum }],
    };
    const c = fp64Lower(m).consts[0]!;
    expect(c.valueExpr).toMatchObject({ op: 'call', fn: 'df64_add' });
    const args = c.valueExpr!.op === 'call' ? c.valueExpr!.args : [];
    expect(args.at(-1)).toMatchObject({ op: 'call', fn: 'f64Guard' });
  });

  it('spells the renorm zero as a bit-cast round trip on both targets', () => {
    const k = fn('k', { a: f64T, b: f64T }, (p) => toF32(p.a.sub(p.b)));
    expect(emitModule(module({ funcs: [k] }))).toContain('bitcast<f32>(bitcast<u32>(0.0))');
    expect(emitGlslModule(module({ funcs: [k] }), 'fragment')).toContain(
      'uintBitsToFloat(floatBitsToUint(0.0))',
    );
  });
});

describe('what the lowering leaves alone or evaluates once', () => {
  it('passes a host global and an override of a non-f64 type through untouched', () => {
    const ext: Expr = { op: 'externref', type: f32T, name: 'hostScale' };
    const ovr: Expr = { op: 'overrideref', type: f32T, name: 'tuning' };
    const sum: Expr = { op: 'binop', type: f32T, bop: '+', a: ext, b: ovr };
    const m = {
      ...single([['a', f64T]], { op: 'call', type: f32T, fn: 'f32', args: [param('a', f64T)] }),
      externs: [{ name: 'hostScale', type: f32T }],
      overrides: [{ name: 'tuning', type: f32T, default: 1 }],
    };
    const withUse: ModuleDecl = {
      ...m,
      funcs: [
        {
          ...m.funcs[0]!,
          ret: f32T,
          body: [{ s: 'return', expr: { ...sum, a: { ...ext }, b: { ...ovr } } }],
        },
      ],
    };
    const body = fp64Lower(withUse).funcs[0]!.body[0]!;
    expect(body).toMatchObject({ s: 'return', expr: { op: 'binop', a: ext, b: ovr } });
  });

  it('evaluates the operand of a componentwise vec64 builtin once', () => {
    const source: Expr = { op: 'call', type: vec3f64T, fn: 'source', args: [] };
    const abs: Expr = { op: 'call', type: vec3f64T, fn: 'abs', args: [source] };
    const lowered = fp64Lower(single([], abs)).funcs[0]!;
    expect(countCalls(lowered, 'source')).toBe(1);
    expect(countCalls(lowered, 'df64_v3_abs')).toBe(1);
  });
});

describe('constructors', () => {
  it('builds a vec64 of one argument from one lane of each plane, to be splatted', () => {
    const e = returned(
      single([['a', f64T]], { op: 'construct', type: vec3f64T, args: [param('a', f64T)] }),
    );
    expect(e).toMatchObject({
      op: 'construct',
      type: { kind: 'struct', name: 'DF64Vec3' },
      args: [
        { op: 'construct', type: vec3fT, args: [{ op: 'member', field: 'x' }] },
        { op: 'construct', type: vec3fT, args: [{ op: 'member', field: 'y' }] },
      ],
    });
  });

  it('lowers the arguments and the type of an array of f64', () => {
    const type: ShaderType = { kind: 'array', elem: f64T, size: 2 };
    const e = returned(
      single([], { op: 'construct', type, args: [lit(f64T, 1.5), lit(f64T, 2.5)] }),
    );
    expect(e).toMatchObject({
      op: 'construct',
      type: { kind: 'array', elem: vec2fT, size: 2 },
      args: [
        { op: 'construct', type: vec2fT },
        { op: 'construct', type: vec2fT },
      ],
    });
  });

  it('lowers every part of a match over an f64 value', () => {
    const match: Expr = {
      op: 'matchExpr',
      type: f64T,
      scrutinee: { op: 'lit', type: { kind: 'scalar', scalar: 'u32' }, value: 0 },
      cases: [[0, lit(f64T, 1)]],
      default: lit(f64T, 2),
    };
    expect(returned(single([], match))).toMatchObject({
      op: 'matchExpr',
      type: vec2fT,
      cases: [[0, { op: 'construct', type: vec2fT }]],
      default: { op: 'construct', type: vec2fT },
    });
  });

  it('lowers the condition and both arms of a select over an f64 value', () => {
    const select: Expr = {
      op: 'select',
      type: f64T,
      cond: { op: 'lit', type: { kind: 'scalar', scalar: 'bool' }, value: 1 },
      ifTrue: lit(f64T, 1),
      ifFalse: lit(f64T, 2),
    };
    expect(returned(single([], select))).toMatchObject({
      op: 'select',
      type: vec2fT,
      ifTrue: { op: 'construct' },
      ifFalse: { op: 'construct' },
    });
  });
});

describe('vector and matrix shapes', () => {
  it('declares the vector struct a matrix expression nests, before the matrix struct', () => {
    const source: Expr = { op: 'call', type: mat2f64T, fn: 'source', args: [] };
    const m = module({
      funcs: [
        {
          name: 'k',
          params: [],
          ret: f32T,
          body: [
            { s: 'let', name: 'm', expr: source },
            { s: 'return', expr: lit(f32T, 0) },
          ],
        },
      ],
    });
    expect(fp64Lower(m).structs.map((x) => x.name)).toEqual(['DF64Vec2', 'DF64Mat2']);
  });

  it('gathers the vec64 columns of a matrix constructor into a DF64Mat', () => {
    const col = param('c', vec2f64T);
    const e = returned(
      single([['c', vec2f64T]], { op: 'construct', type: mat2f64T, args: [col, col] }),
    );
    expect(e).toMatchObject({
      op: 'construct',
      type: { kind: 'struct', name: 'DF64Mat2' },
      args: [{ op: 'param' }, { op: 'param' }],
    });
  });

  it('negates a vec64 plane by plane', () => {
    const e = returned(
      single([['v', vec3f64T]], { op: 'unop', type: vec3f64T, a: param('v', vec3f64T) }),
    );
    expect(e).toMatchObject({
      op: 'construct',
      type: { kind: 'struct', name: 'DF64Vec3' },
      args: [
        { op: 'unop', type: vec3fT, a: { op: 'member', field: 'hi' } },
        { op: 'unop', type: vec3fT, a: { op: 'member', field: 'lo' } },
      ],
    });
  });

  it('gives a call of a module function the lowered type of its result', () => {
    const inner: FuncDecl = {
      name: 'inner',
      params: [{ name: 'x', type: f64T }],
      ret: f64T,
      body: [{ s: 'return', expr: param('x', f64T) }],
    };
    const call: Expr = { op: 'call', type: f64T, fn: 'inner', args: [param('a', f64T)] };
    const m = single([['a', f64T]], call);
    const lowered = returned({ ...m, funcs: [...m.funcs, inner] });
    expect(lowered).toMatchObject({ op: 'call', fn: 'inner', type: vec2fT });
  });
});
