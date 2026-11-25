import { describe, expect, it } from 'vitest';
import type { FuncDecl, ModuleDecl, ShaderType } from '../ir/index.js';
import { f32T, i32T, u32T } from '../ir/index.js';
import { compileModule } from '../oracle.js';
import { taintGlslUndefined, taintedName } from './draw-harness.js';

const moduleOf = (funcs: FuncDecl[]): ModuleDecl => ({
  consts: [],
  structs: [],
  bindings: [],
  funcs,
});

const conversion = (name: string, to: ShaderType): FuncDecl => ({
  name,
  params: [{ name: 'x', type: f32T }],
  ret: to,
  attrs: [],
  body: [
    {
      s: 'return',
      expr: {
        op: 'call',
        type: to,
        fn: to === i32T ? 'i32' : 'u32',
        args: [{ op: 'param', type: f32T, name: 'x' }],
      },
    },
  ],
});

const flagsOf = (m: ModuleDecl, name: string, runs: number[]): number[] => {
  const run = compileModule(taintGlslUndefined(m), { precision: 'f32' });
  return runs.map((x) => run.fns[taintedName(name)]!(x) as number);
};

describe('draw harness: the flag of a tainted run', () => {
  it('starts at zero on every call from the host, so a clean run after a tainted one is clean', () => {
    const m = moduleOf([conversion('toI', i32T)]);
    expect(flagsOf(m, 'toI', [-3e9, 1, NaN, 2])).toEqual([1, 0, 1, 0]);
  });

  it('starts at zero on every call for a u32 conversion as well', () => {
    const m = moduleOf([conversion('toU', u32T)]);
    expect(flagsOf(m, 'toU', [5e9, 1, -1, 0])).toEqual([1, 0, 1, 0]);
  });

  it('is not set by a negative zero converted to u32, which is zero and not negative', () => {
    const m = moduleOf([conversion('toU', u32T)]);
    expect(flagsOf(m, 'toU', [-0, 0])).toEqual([0, 0]);
  });

  it('is set by a NaN converted to i32', () => {
    const m = moduleOf([conversion('toI', i32T)]);
    expect(flagsOf(m, 'toI', [NaN])).toEqual([1]);
    expect(flagsOf(m, 'toI', [0])).toEqual([0]);
  });
});
