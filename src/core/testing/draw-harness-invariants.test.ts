import { describe, expect, it } from 'vitest';
import type { CpuValue } from '../cpu-runtime.js';
import type { Expr, FuncDecl, ModuleDecl, ShaderType, Stmt } from '../ir/index.js';
import { boolT, f32T, i32T, u32T } from '../ir/index.js';
import { compileModule } from '../oracle.js';
import {
  DRAW_TABLE,
  drawnFunction,
  pixelValue,
  tableValue,
  tableWords,
  taintGlslUndefined,
  taintedName,
} from './draw-harness.js';

const vec2f: ShaderType = { kind: 'vec', n: 2, elem: 'f32' };
const vec3f: ShaderType = { kind: 'vec', n: 3, elem: 'f32' };
const vec2u: ShaderType = { kind: 'vec', n: 2, elem: 'u32' };

const param = (name: string, type: ShaderType): Expr => ({ op: 'param', type, name });
const fn = (
  name: string,
  params: readonly [string, ShaderType][],
  ret: ShaderType,
  body: Stmt[],
  extra: Partial<FuncDecl> = {},
): FuncDecl => ({
  name,
  params: params.map(([n, type]) => ({ name: n, type })),
  ret,
  attrs: [],
  body,
  ...extra,
});
const identity = (name: string, t: ShaderType): FuncDecl =>
  fn(name, [['a', t]], t, [{ s: 'return', expr: param('a', t) }]);
const moduleOf = (funcs: FuncDecl[]): ModuleDecl => ({
  consts: [],
  structs: [],
  bindings: [],
  funcs,
});

const F32_ONE = 0x3f800000;
const F32_TWO = 0x40000000;
const F32_HALF = 0x3f000000;

const drawOnce = (m: ModuleDecl, name: string, args: CpuValue[][]): number[] => {
  const d = drawnFunction(m, name, args.length, 1);
  const run = compileModule(d.module, { precision: 'f32' });
  run.setBinding(DRAW_TABLE, tableValue(tableWords(d, args)));
  return run.fns[d.entry]!([0.5, 0.5, 0, 1]) as number[];
};

describe('draw harness: the entry, the table and the pixel', () => {
  it('writes the lanes the result fills and zero in the lanes it does not', () => {
    const m = moduleOf([
      identity('s', f32T),
      identity('v2', vec2f),
      identity('v3', vec3f),
      identity('u', u32T),
    ]);
    expect(drawOnce(m, 's', [[1]])).toEqual([F32_ONE, 0, 0, 0]);
    expect(drawOnce(m, 'v2', [[[1, 2]]]).slice(0, 4)).toEqual([F32_ONE, F32_TWO, 0, 0]);
    expect(drawOnce(m, 'v3', [[[1, 2, 0.5]]]).slice(0, 4)).toEqual([F32_ONE, F32_TWO, F32_HALF, 0]);
    expect(drawOnce(m, 'u', [[4294967295]])).toEqual([4294967295, 0, 0, 0]);
  });

  it('writes a signed result as its two-complement bits and reads them back signed', () => {
    const m = moduleOf([identity('i', i32T)]);
    const words = drawOnce(m, 'i', [[-7]]);
    expect(words[0]).toBe(0xfffffff9);
    expect(pixelValue(i32T, words)).toBe(-7);
  });

  it('reads each result type back as the value the function returned', () => {
    expect(pixelValue(u32T, [4294967295, 0, 0, 0])).toBe(4294967295);
    expect(pixelValue(f32T, [F32_HALF, 0, 0, 0])).toBe(0.5);
    expect(pixelValue(vec3f, [F32_ONE, F32_TWO, F32_HALF, 0])).toEqual([1, 2, 0.5]);
    expect(pixelValue(vec2f, [F32_ONE, F32_TWO, F32_HALF, F32_HALF])).toEqual([1, 2]);
  });

  it('takes pixel x of the row as argument list x and a row per parameter', () => {
    const m = moduleOf([
      fn(
        'two',
        [
          ['a', i32T],
          ['b', f32T],
        ],
        i32T,
        [{ s: 'return', expr: param('a', i32T) }],
      ),
    ]);
    const d = drawnFunction(m, 'two', 3, 2);
    const words = tableWords(d, [
      [1, 0.5],
      [-1, 1],
      [2, 2],
      [3, 0],
      [4, 0],
      [5, 0],
    ]);
    expect(words).toHaveLength(3 * 2 * 2 * 4);
    expect(words.slice(0, 8)).toEqual([1, 0, 0, 0, F32_HALF, 0, 0, 0]);
    expect(words.slice(8, 12)).toEqual([0xffffffff, 0, 0, 0]);
    const run = compileModule(d.module, { precision: 'f32' });
    run.setBinding(DRAW_TABLE, tableValue(words));
    const at = (x: number, y: number): number =>
      (run.fns[d.entry]!([x + 0.5, y + 0.5, 0, 1]) as number[])[0]! | 0;
    expect([at(0, 0), at(1, 0), at(2, 0)]).toEqual([1, -1, 2]);
    expect([at(0, 1), at(1, 1), at(2, 1)]).toEqual([3, 4, 5]);
  });

  it('packs a vector argument into one row of lanes, zero past the last', () => {
    const m = moduleOf([identity('v2', vec2f)]);
    const d = drawnFunction(m, 'v2', 1, 1);
    expect(tableWords(d, [[[1, 2]]])).toEqual([F32_ONE, F32_TWO, 0, 0]);
  });

  it('adds the table binding after the existing bindings, and the entry last', () => {
    const base = moduleOf([identity('s', f32T)]);
    const withBinding: ModuleDecl = {
      ...base,
      bindings: [{ group: 0, binding: 0, name: 'other', space: 'uniform', type: f32T }],
    };
    const d = drawnFunction(withBinding, 's', 2, 2);
    expect(d.module.bindings.map((b) => [b.name, b.binding])).toEqual([
      ['other', 0],
      [DRAW_TABLE, 1],
    ]);
    expect(d.module.funcs.at(-1)!.name).toBe(d.entry);
    expect(d.module.funcs.at(-1)!.stage).toBe('fragment');
    expect(d.module.structs).toHaveLength(1);
    expect([d.width, d.height]).toEqual([2, 2]);
    expect(d.fn.name).toBe('s');
    expect(withBinding.funcs).toHaveLength(1);
  });

  it('refuses a function the module lacks and an argument table of the wrong size', () => {
    const m = moduleOf([identity('s', f32T)]);
    expect(() => drawnFunction(m, 'missing', 1, 1)).toThrow('draw-harness: no function "missing"');
    const d = drawnFunction(m, 's', 2, 2);
    expect(() => tableWords(d, [[1], [1], [1]])).toThrow(
      'draw-harness: 3 argument lists for 4 pixels',
    );
  });

  it('refuses a signature type the table and the target cannot carry', () => {
    expect(() => drawnFunction(moduleOf([identity('b', boolT)]), 'b', 1, 1)).toThrow(
      'draw-harness: no {"kind":"scalar","scalar":"bool"} in a generated function\'s signature',
    );
    expect(() => drawnFunction(moduleOf([identity('u2', vec2u)]), 'u2', 1, 1)).toThrow(
      'draw-harness: no {"kind":"vec","n":2,"elem":"u32"} in a generated function\'s signature',
    );
  });
});

describe('draw harness: the taint', () => {
  const bin = (bop: '/' | '%', t: ShaderType): FuncDecl =>
    fn(
      'op',
      [
        ['a', t],
        ['b', t],
      ],
      t,
      [{ s: 'return', expr: { op: 'binop', type: t, bop, a: param('a', t), b: param('b', t) } }],
    );
  const to = (name: string, t: ShaderType): FuncDecl =>
    fn(name, [['x', f32T]], t, [
      {
        s: 'return',
        expr: { op: 'call', type: t, fn: t === i32T ? 'i32' : 'u32', args: [param('x', f32T)] },
      },
    ]);
  const flagOf = (m: ModuleDecl, name: string, args: number[]): number =>
    compileModule(taintGlslUndefined(m), { precision: 'f32' }).fns[taintedName(name)]!(
      ...args,
    ) as number;

  it('leaves a flag unset for the greatest operands a conversion and a division hold', () => {
    expect(flagOf(moduleOf([to('toU', u32T)]), 'toU', [4294967040])).toBe(0);
    expect(flagOf(moduleOf([to('toI', i32T)]), 'toI', [2147483520])).toBe(0);
    expect(flagOf(moduleOf([bin('/', i32T)]), 'op', [-2147483648, 1])).toBe(0);
    expect(flagOf(moduleOf([bin('%', u32T)]), 'op', [7, 1])).toBe(0);
  });

  it('sets the flag for a float that no integer of the target holds', () => {
    expect(flagOf(moduleOf([to('toI', i32T)]), 'toI', [-3e9])).toBe(1);
    expect(flagOf(moduleOf([to('toU', u32T)]), 'toU', [NaN])).toBe(1);
    expect(flagOf(moduleOf([to('toU', u32T)]), 'toU', [5e9])).toBe(1);
  });

  it('sets the flag for a remainder with a negative divisor and for a division of u32 by zero', () => {
    expect(flagOf(moduleOf([bin('%', i32T)]), 'op', [-7, 3])).toBe(1);
    expect(flagOf(moduleOf([bin('/', u32T)]), 'op', [7, 0])).toBe(1);
  });

  it('adds a flag function for a value function only, not for an entry or a void function', () => {
    const entry = fn(
      'ent',
      [],
      f32T,
      [{ s: 'return', expr: { op: 'lit', type: f32T, value: 1 } }],
      {
        attrs: ['@fragment'],
        stage: 'fragment',
      },
    );
    const procedure = fn('proc', [], { kind: 'void' } as ShaderType, []);
    const tainted = taintGlslUndefined(moduleOf([identity('val', f32T), entry, procedure]));
    const names = tainted.funcs.map((f) => f.name);
    expect(names).toContain(taintedName('val'));
    expect(names).not.toContain(taintedName('ent'));
    expect(names).not.toContain(taintedName('proc'));
    expect(tainted.vars!.some((v) => v.space === 'private' && v.init !== undefined)).toBe(true);
  });

  it('refuses an integer vector division and an integer vector conversion', () => {
    const divide = moduleOf([bin('/', vec2u)]);
    expect(() => taintGlslUndefined(divide)).toThrow('an integer vector / is not tainted');
    const convert = moduleOf([
      fn('c', [['v', vec2f]], vec2u, [
        {
          s: 'return',
          expr: { op: 'construct', type: vec2u, args: [param('v', vec2f)] },
        },
      ]),
    ]);
    expect(() => taintGlslUndefined(convert)).toThrow(
      'an integer vector conversion is not tainted',
    );
  });
});
