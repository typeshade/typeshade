import { describe, it, expect } from 'vitest';
import type { Expr, Stmt, ModuleDecl, ShaderType } from './ir/index.js';
import { f32T, u32T, boolT, voidT, vec3fT, vec3iT, vec3uT, vec3bT } from './ir/index.js';
import { compileModule, type CpuPrecision } from './oracle.js';
import { bothTake } from './testing/both-halves.js';
import type { ConsoleEvent } from './console.js';
import { compileModuleJs } from './cpu-codegen.js';
import type { CpuValue } from './cpu-runtime.js';

const lit = (v: number | boolean, type: ShaderType = f32T): Expr => ({ op: 'lit', type, value: v });
const param = (name: string, type: ShaderType = f32T): Expr => ({ op: 'param', type, name });
const call = (fn: string, args: Expr[] = [], type: ShaderType = f32T): Expr => ({
  op: 'call',
  type,
  fn,
  args,
});
const member = (base: Expr, field: string, type: ShaderType = f32T): Expr => ({
  op: 'member',
  type,
  base,
  field,
});
const construct = (type: ShaderType, args: Expr[]): Expr => ({ op: 'construct', type, args });
const ret = (expr?: Expr): Stmt => ({ s: 'return', expr });
const cmp = (cop: '>' | '<' | '!=', a: Expr, b: Expr, type: ShaderType = boolT): Expr => ({
  op: 'compare',
  type,
  cop,
  a,
  b,
});
const neg = (a: Expr, type: ShaderType): Expr => ({ op: 'unop', type, a });
const ifS = (cond: Expr, body: Stmt[]): Stmt => ({ s: 'if', arms: [{ cond, body }] });

type P = { name: string; type: ShaderType; mode?: 'inout' };
const func = (name: string, params: P[], retType: ShaderType, body: Stmt[]) => ({
  name,
  params,
  ret: retType,
  body,
});

const emptyModule = (m: Partial<ModuleDecl>): ModuleDecl => ({
  consts: [],
  structs: [],
  bindings: [],
  funcs: [],
  ...m,
});

const PRECISIONS: readonly CpuPrecision[] = ['f64', 'f32'];

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

function everyEngine(
  m: ModuleDecl,
  name: string,
  args: CpuValue[] = [],
  extra: { overrides?: Record<string, CpuValue> } = {},
): CpuValue[] {
  return PRECISIONS.flatMap((precision) =>
    [compileModule(m, { precision, ...extra }), compileModuleJs(m, { precision, ...extra })].map(
      (engine) => engine.fns[name]!(...(clone(args) as never[])),
    ),
  );
}

const all = (value: CpuValue): CpuValue[] => [value, value, value, value];

describe('a matrix product takes the shape of its operands from their static types', () => {
  const product = (a: number[], aRows: number, b: number[], bCols: number): number[] => {
    const aCols = a.length / aRows;
    const out: number[] = [];
    for (let c = 0; c < bCols; c++)
      for (let r = 0; r < aRows; r++) {
        let sum = 0;
        for (let k = 0; k < aCols; k++) sum += a[k * aRows + r]! * b[c * aCols + k]!;
        out.push(sum);
      }
    return out;
  };

  it('multiplies matrices of two different shapes in both orders', () => {
    const { result } = bothTake(`"use typeshade"
export function wide(x: mat3x2, y: mat2x3): mat2x2 { return x * y }
export function tall(x: mat2x3, y: mat3x2): mat3x3 { return x * y }
`);
    const x = [1, 2, 3, 4, 5, 6];
    const y = [7, 8, 9, 10, 11, 12];
    const expected = {
      wide: product(x, 2, y, 2),
      tall: product(x, 3, y, 3),
    };
    for (const precision of PRECISIONS) {
      const interpreter = compileModule(result.module, { precision });
      const generated = compileModuleJs(result.module, { precision });
      for (const name of ['wide', 'tall'] as const) {
        expect(interpreter.fns[name]!(x, y)).toEqual(expected[name]);
        expect(generated.fns[name]!(x, y)).toEqual(expected[name]);
      }
    }
  });
});

describe('a dispatch on the codegen keeps the state of the invocations apart', () => {
  const entry = `"use typeshade";
declare const out: storage<array<f32>, "read_write">;
let acc: workgroup<f32>;
@compute([1, 1, 1]) export function k(gid: builtin<"global_invocation_id">): void {
  acc += 1.;
  out[gid.x] = acc;
  console.log(gid.x);
}
`;

  it('starts the workgroup memory of every workgroup from zero', () => {
    const { result } = bothTake(entry);
    for (const make of [compileModule, compileModuleJs]) {
      const cm = make(result.module, { consoleSink: () => undefined });
      const out = [0, 0, 0];
      cm.setBinding('out', out);
      cm.dispatch('k', 3);
      expect(out).toEqual([1, 1, 1]);
    }
  });

  it('leaves no invocation behind for a call the host makes after the dispatch', () => {
    const { result } = bothTake(entry);
    for (const make of [compileModule, compileModuleJs]) {
      const events: ConsoleEvent[] = [];
      const cm = make(result.module, { consoleSink: (e) => events.push(e) });
      cm.setBinding('out', [0, 0, 0]);
      cm.dispatch('k', 3);
      events.length = 0;
      cm.fns.k!([1, 0, 0]);
      expect(events.map((e) => e.invocation)).toEqual([undefined]);
    }
  });
});

describe('a vector operation on an operand that may be missing', () => {
  const x = param('x', vec3fT);
  const u = param('u', vec3uT);
  const m = emptyModule({
    funcs: [
      func('maybe', [{ name: 'x', type: vec3fT }], vec3fT, [
        ifS(cmp('>', member(x, 'x'), lit(100)), [{ s: 'discard' }]),
        ret(x),
      ]),
      func('maybeU', [{ name: 'u', type: vec3uT }], vec3uT, [
        ifS(cmp('>', member(u, 'x', u32T), lit(100, u32T)), [{ s: 'discard' }]),
        ret(u),
      ]),
      func('toInt', [{ name: 'x', type: vec3fT }], vec3iT, [
        ret(construct(vec3iT, [call('maybe', [x], vec3fT)])),
      ]),
      func('reverse', [{ name: 'x', type: vec3fT }], vec3fT, [
        ret(member(call('maybe', [x], vec3fT), 'zyx', vec3fT)),
      ]),
      func(
        'differs',
        [
          { name: 'x', type: vec3fT },
          { name: 'y', type: vec3fT },
        ],
        vec3bT,
        [ret(cmp('!=', call('maybe', [x], vec3fT), param('y', vec3fT), vec3bT))],
      ),
      func('negate', [{ name: 'u', type: vec3uT }], vec3uT, [
        ret(neg(call('maybeU', [u], vec3uT), vec3uT)),
      ]),
    ],
  });

  it('converts each component to the element kind of the vector it builds', () => {
    expect(everyEngine(m, 'toInt', [[1.5, -2.5, 3.9]])).toEqual(all([1, -2, 3]));
  });

  it('picks every component a swizzle names', () => {
    expect(everyEngine(m, 'reverse', [[1, 2, 3]])).toEqual(all([3, 2, 1]));
  });

  it('compares f32 vectors after rounding both sides to f32', () => {
    expect(
      everyEngine(m, 'differs', [
        [1, 16777217, 2],
        [1, 16777216, 2],
      ]),
    ).toEqual(all([false, false, false]));
  });

  it('wraps the negation of an unsigned vector into the unsigned range', () => {
    expect(everyEngine(m, 'negate', [[1, 2, 3]])).toEqual(
      all([4294967295, 4294967294, 4294967293]),
    );
  });
});

describe('a comparison of f32 operands for inequality', () => {
  it('rounds both to f32 first, as the interpreter does at either precision', () => {
    const m = emptyModule({
      funcs: [
        func(
          'differ',
          [
            { name: 'a', type: f32T },
            { name: 'b', type: f32T },
          ],
          boolT,
          [ret(cmp('!=', param('a'), param('b')))],
        ),
      ],
    });
    expect(everyEngine(m, 'differ', [16777217, 16777216])).toEqual(all(false));
    expect(everyEngine(m, 'differ', [16777218, 16777216])).toEqual(all(true));
  });
});

describe('atomicCompareExchangeWeak on the codegen', () => {
  const { result } = bothTake(`"use typeshade";
declare const lock: storage<atomic<u32>, "read_write">;
declare const o: storage<array<u32>, "read_write">;
@compute([1, 1, 1]) export function cs(gid: builtin<"global_invocation_id">): void {
  const r = atomicCompareExchangeWeak(lock, 0, 7);
  o[0] = r.old_value;
  o[1] = atomicLoad(lock);
}
`);

  it('stores the value it was given when the comparison matches, and nothing otherwise', () => {
    for (const make of [compileModule, compileModuleJs]) {
      for (const [start, expected] of [
        [0, [0, 7]],
        [5, [5, 5]],
      ] as const) {
        const out = [0, 0];
        const cm = make(result.module);
        cm.setBinding('lock', start as unknown as CpuValue);
        cm.setBinding('o', out as unknown as CpuValue);
        cm.fns.cs!([0, 0, 0]);
        expect(out).toEqual([...expected]);
      }
    }
  });
});

describe('a compute entry that declares no workgroup size', () => {
  it('runs a workgroup of 64 invocations, as the interpreter does', () => {
    const m = emptyModule({
      funcs: [{ name: 'k', params: [], ret: voidT, body: [], stage: 'compute' as const }],
    });
    for (const make of [compileModule, compileModuleJs]) {
      expect(make(m).dispatch('k', 1)).toEqual({
        workgroups: 1,
        invocations: 64,
        barrierPhases: 0,
      });
    }
  });
});

describe('an atomic on a workgroup variable', () => {
  const { result } = bothTake(`"use typeshade";
declare const o: storage<array<u32>, "read_write">;
let counter: workgroup<atomic<u32>>;
@compute([4, 1, 1]) export function k(gid: builtin<"global_invocation_id">): void {
  o[gid.x] = atomicAdd(counter, 1);
}
`);

  it('counts the invocations of the workgroup, in order, on both engines', () => {
    for (const make of [compileModule, compileModuleJs]) {
      const out = [9, 9, 9, 9];
      const cm = make(result.module);
      cm.setBinding('o', out as unknown as CpuValue);
      for (let i = 0; i < 4; i++) cm.fns.k!([i, 0, 0]);
      expect(out).toEqual([0, 1, 2, 3]);
    }
  });
});
