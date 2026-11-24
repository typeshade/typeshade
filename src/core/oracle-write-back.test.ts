import { describe, expect, it } from 'vitest';
import { bothTake } from './testing/both-halves.js';
import { compileModule } from './oracle.js';
import { externRef, f32T, fn, module } from './ir/index.js';
import type { Expr, ModuleDecl, ShaderType, Stmt } from './ir/index.js';

const moduleOf = (body: string): ModuleDecl =>
  bothTake(`"use typeshade";\n${body}\n`).result.module;

describe('oracle: an inout argument that is an element is written back to the place it named', () => {
  it('the element named before the call receives the value, though the callee moves the index', () => {
    const cpu = compileModule(
      moduleOf(`class P { v: f32; }
let at: u32 = 0;
function setAndMove(p: P): void { at = 1; p.v = 5.; }
export function first(): f32 {
  let ps = array<P, 2>(new P(), new P());
  setAndMove(ps[at]);
  return ps[0].v;
}
export function second(): f32 {
  let ps = array<P, 2>(new P(), new P());
  setAndMove(ps[at]);
  return ps[1].v;
}`),
    );
    expect(cpu.fns['first']!()).toBe(5);
    expect(cpu.fns['second']!()).toBe(0);
  });

  it('a field of a struct is written back through the call', () => {
    const cpu = compileModule(
      moduleOf(`class Inner { v: f32; }
class Outer { a: Inner; }
function setV(p: Inner): void { p.v = 7.; }
export function run(): f32 {
  let o = new Outer();
  setV(o.a);
  return o.a.v;
}`),
    );
    expect(cpu.fns['run']!()).toBe(7);
  });
});

const vec2T: ShaderType = { kind: 'vec', n: 2, elem: 'f32' };
const lit = (value: number): Expr => ({ op: 'lit', type: f32T, value });
const ref = (name: string, type: ShaderType): Expr => ({ op: 'varref', type, name });

const scalarInoutModule = (argument: Expr): ModuleDecl => ({
  consts: [],
  structs: [],
  bindings: [],
  funcs: [
    {
      name: 'bump',
      params: [{ name: 'p', type: f32T, mode: 'inout' }],
      ret: { kind: 'void' },
      body: [
        {
          s: 'assign',
          target: { op: 'param', type: f32T, name: 'p' },
          expr: {
            op: 'binop',
            type: f32T,
            bop: '+',
            a: { op: 'param', type: f32T, name: 'p' },
            b: lit(5),
          },
        },
      ],
    },
    {
      name: 'run',
      params: [],
      ret: vec2T,
      body: [
        {
          s: 'var',
          name: 'v',
          type: vec2T,
          init: { op: 'construct', type: vec2T, args: [lit(1), lit(2)] },
        },
        { s: 'call', expr: { op: 'call', type: { kind: 'void' }, fn: 'bump', args: [argument] } },
        { s: 'return', expr: ref('v', vec2T) },
      ] as Stmt[],
    },
  ],
});

describe('oracle: a scalar inout argument that is a component is stored back after the call', () => {
  it('a component of a local vector holds what the callee left in its parameter', () => {
    const member: Expr = { op: 'member', type: f32T, base: ref('v', vec2T), field: 'y' };
    const cpu = compileModule(scalarInoutModule(member));
    expect(cpu.fns['run']!()).toEqual([1, 7]);
  });
});

describe('oracle: a host-provided global has no CPU value', () => {
  it('reading it throws and names the global', () => {
    const cpu = compileModule(
      module({ funcs: [fn('run', {}, f32T, () => externRef('hostScale', f32T).add(1.0))] }),
    );
    expect(() => cpu.fns['run']!()).toThrow(
      "typeshade/cpu: host-provided global 'hostScale' has no CPU value",
    );
  });
});

describe('oracle: atomicCompareExchangeWeak stores its third argument', () => {
  const run = (lock: number, compare: number) => {
    const cpu = compileModule(
      moduleOf(`declare const lock: storage<atomic<u32>, "read_write">;
export function exchange(compare: u32): vec3u {
  const r = atomicCompareExchangeWeak(lock, compare, 7);
  return vec3u(r.old_value, r.exchanged ? 1 : 0, atomicLoad(lock));
}`),
    );
    cpu.setBinding('lock', lock);
    return cpu.fns['exchange']!(compare);
  };

  it('a matching exchange leaves the stored value in the location', () => {
    expect(run(3, 3)).toEqual([3, 1, 7]);
  });

  it('a mismatching exchange leaves the location unchanged', () => {
    expect(run(3, 4)).toEqual([3, 0, 3]);
  });
});
