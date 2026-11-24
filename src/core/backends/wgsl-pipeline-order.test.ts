import { describe, it, expect } from 'vitest';
import { emitFuncs, emitModule } from './wgsl.js';
import { bothTake } from '../testing/both-halves.js';
import type { Expr, FuncDecl, ModuleDecl } from '../ir/index.js';
import { f32T } from '../ir/index.js';

const lit = (value: number): Expr => ({ op: 'lit', type: f32T, value });
const add = (a: Expr, b: Expr): Expr => ({ op: 'binop', type: f32T, bop: '+', a, b });
const ret = (expr: Expr) => ({ s: 'return' as const, expr });

const helper = (name: string, extra: Partial<FuncDecl> = {}): FuncDecl => ({
  name,
  params: [],
  ret: f32T,
  body: [ret(add(lit(1), lit(2)))],
  ...extra,
});

describe('a list of functions goes through the passes of a module', () => {
  it('leaves a kernel function out of the text', () => {
    const text = emitFuncs([helper('host_side', { kernel: true }), helper('shader_side')]);
    expect(text).not.toContain('host_side');
    expect(text).toContain('fn shader_side()');
  });

  it('writes nothing for a list of kernel functions only', () => {
    expect(emitFuncs([helper('host_side', { kernel: true })])).toBe('');
  });

  it('folds a constant, as the module emit does', () => {
    expect(emitFuncs([helper('f')])).toBe('fn f() -> f32 {\n  return 3.0;\n}');
  });

  it('joins the functions with one blank line', () => {
    const text = emitFuncs([helper('a'), helper('b')]);
    expect(text).toBe('fn a() -> f32 {\n  return 3.0;\n}\n\nfn b() -> f32 {\n  return 3.0;\n}');
  });
});

describe('a function that carries a raw statement is written as authored', () => {
  const withRaw = (): FuncDecl => ({
    name: 'composed',
    params: [],
    ret: f32T,
    body: [{ s: 'raw', wgsl: 'let seed = 1.0;' }, ret(add(lit(1), lit(2)))],
  });

  it('keeps a foldable expression unfolded when the function holds a raw statement', () => {
    const text = emitFuncs([withRaw()]);
    expect(text).toContain('let seed = 1.0;');
    expect(text).toContain('return (1.0 + 2.0);');
  });

  it('keeps the same expression unfolded through the module emit', () => {
    const m: ModuleDecl = { consts: [], structs: [], bindings: [], funcs: [withRaw()] };
    expect(emitModule(m)).toContain('return (1.0 + 2.0);');
  });
});

describe('the passes run in an order that the emitted text shows', () => {
  const COMPUTE_CALLS = (guard: string) => `"use typeshade";
declare const ps: storage<array<P>, "read_write">;
class P {
  v: f32;
  bump(d: f32): void {
    this.v = this.v + d;
  }
}
@compute([1, 1, 1]) export function k(gid: builtin<"global_invocation_id">): void {
  ${guard}
  let local = new P();
  local.bump(1.);
  ps[gid.x].v = ps[gid.x].v + local.v;
}
`;

  it('makes no copy for an address space whose only call the optimizer folded away', () => {
    const wgsl = bothTake(COMPUTE_CALLS('if (1 > 2) { ps[gid.x].bump(0.25); }')).result.wgsl!;
    expect(wgsl).toContain('fn P_bump(self_: ptr<function, P>, d: f32) {');
    expect(wgsl).not.toContain('P_bump_storage');
    expect(wgsl).not.toContain('P_bump_function');
  });

  it('makes one copy for each address space that a surviving call uses', () => {
    const wgsl = bothTake(COMPUTE_CALLS('ps[gid.x].bump(0.25);')).result.wgsl!;
    expect(wgsl).toContain('fn P_bump_storage(self_: ptr<storage, P, read_write>, d: f32) {');
    expect(wgsl).toContain('fn P_bump_function(self_: ptr<function, P>, d: f32) {');
  });

  const WEIGHTS_IN_LOOP = `"use typeshade";
interface U { weights: array<f32, 4>; n: u32 }
declare const U_: uniform<U>;
@fragment export function fs(): vec4 {
  let s = 0;
  for (let i = 0; i < U_.n; i++) {
    let w = U_.weights;
    s += w[i % 4] * w[(i + 1) % 4];
  }
  return vec4(s);
}`;

  it('pads a uniform array before the optimizer runs, so a loop reads the padded field in place', () => {
    const wgsl = bothTake(WEIGHTS_IN_LOOP).result.wgsl!;
    expect(wgsl).toContain('@align(16) weights: array<_Pad16_f32, 4>,');
    expect(wgsl).toContain('s += (U_.weights[(i % 4u)].v * U_.weights[((i + 1u) % 4u)].v);');
    expect(wgsl).not.toContain('array<f32, 4>(U_.weights[0].v');
  });
});
