import { describe, expect, it } from 'vitest';
import { compile } from '../../compiler/ts/compile.js';
import { compileModule } from '../oracle.js';
import { compileModuleJs } from '../cpu-codegen.js';
import { TypeShadeError } from '../diagnostics/error.js';
import { grad } from './grad.js';
import { emitModule } from '../backends/wgsl.js';
import { emitGlslModule } from '../backends/glsl.js';
import { keepHelpers } from '../testing/keep-helpers.js';
import type { ModuleDecl } from '../ir/nodes.js';

function moduleOf(src: string): ModuleDecl {
  const r = compile(`"use typeshade"\n${src}`);
  expect(r.diagnostics).toEqual([]);
  return r.module;
}

type Fn = (...args: number[]) => number;

describe('grad: invariants of the tangent walk', () => {
  it('reads the old value of a variable in the tangent of an assignment to it', () => {
    const m = moduleOf(`export function f(x: f32, k: f32): f32 {
  let acc: f32 = k
  acc = acc * acc
  acc = acc * x
  return acc
}`);
    const d = grad(m, 'f', 'k');
    for (const make of [compileModule, compileModuleJs]) {
      const df = make(d.module).fns[d.name] as Fn;
      expect(df(3, 2)).toBeCloseTo(12, 6);
      expect(df(0.5, -1.5)).toBeCloseTo(-1.5, 5);
    }
  });

  it('gives a variable that starts at zero a tangent that a later assignment fills', () => {
    const m = moduleOf(`export function f(x: f32, k: f32): f32 {
  let acc: f32 = 0.
  acc = k * k * x
  return acc
}`);
    const d = grad(m, 'f', 'k');
    for (const make of [compileModule, compileModuleJs]) {
      expect((make(d.module).fns[d.name] as Fn)(3, 2)).toBeCloseTo(12, 6);
    }
  });

  it('leaves out every term that has a zero tangent', () => {
    const m = moduleOf(`export function f(x: f32, k: f32): f32 {
  return x * x + sin(x) + 3. * k
}`);
    const d = grad(m, 'f', 'k');
    const body = d.module.funcs.find((f) => f.name === d.name)!.body;
    expect(JSON.stringify(body)).not.toContain('"name":"x"');
    expect(JSON.stringify(body)).not.toContain('"bop":"+"');
  });

  it('refuses a call that writes through an inout argument depending on the parameter', () => {
    const m = moduleOf(`function g(a: f32): f32 {
  return a
}
export function f(x: f32, k: f32): f32 {
  return g(k) + x
}`);
    const patched: ModuleDecl = {
      ...m,
      funcs: m.funcs.map((fn) =>
        fn.name === 'g'
          ? { ...fn, params: fn.params.map((p) => ({ ...p, mode: 'inout' as const })) }
          : fn,
      ),
    };
    let caught: unknown;
    try {
      grad(patched, 'f', 'k');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TypeShadeError);
    expect((caught as TypeShadeError).code).toBe('SD0118');
    expect((caught as TypeShadeError).message).toContain('by reference');
  });

  it('differentiates atan2 with the first argument as y and the second as x', () => {
    const m = moduleOf(`export function f(x: f32, k: f32): f32 {
  return atan2(k, x)
}`);
    const wrtK = grad(m, 'f', 'k');
    const wrtX = grad(m, 'f', 'x');
    for (const make of [compileModule, compileModuleJs]) {
      expect((make(wrtK.module).fns[wrtK.name] as Fn)(3, 2)).toBeCloseTo(3 / 13, 6);
      expect((make(wrtX.module).fns[wrtX.name] as Fn)(3, 2)).toBeCloseTo(-2 / 13, 6);
    }
  });

  it.each([
    [
      'a module variable',
      `let g: f32 = 0.
export function f(x: f32, k: f32): f32 {
  g = k * x
  return x
}`,
      '"f" writes a value that depends on the parameter to "g", which is a module variable or a binding; grad carries a derivative through f32, float-vector and float-matrix locals only',
    ],
    [
      'an array element',
      `export function f(x: f32, k: f32): f32 {
  let a: array<f32, 2> = [0., 0.]
  a[0] = k * x
  return x
}`,
      '"f" writes a value that depends on the parameter to "a", which is a struct, an array or a parameter; grad carries a derivative through f32, float-vector and float-matrix locals only',
    ],
  ])('refuses an assignment of a dependent value to %s', (_name, src, message) => {
    let caught: unknown;
    try {
      grad(moduleOf(src), 'f', 'k');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TypeShadeError);
    expect((caught as TypeShadeError).message).toContain(message);
  });

  it('writes a zero matrix tangent as zero columns that both targets spell', () => {
    const m = moduleOf(`export function f(x: f32, k: f32): vec2 {
  let acc: mat2 = mat2(1., 0., 0., 1.)
  acc = acc * mat2(k, 0., 0., x)
  return acc * vec2(1., 1.)
}`);
    const d = grad(m, 'f', 'k');
    expect(keepHelpers(emitModule)(d.module)).toContain(
      'var d_acc: mat2x2<f32> = mat2x2<f32>(_cse1, _cse1);',
    );
    expect(keepHelpers(emitGlslModule)(d.module, 'fragment')).toContain(
      'mat2 d_acc = mat2(_cse1, _cse1);',
    );
    for (const make of [compileModule, compileModuleJs]) {
      const df = make(d.module).fns[d.name] as (x: number, k: number) => number[];
      expect(df(3, 2)).toEqual([1, 0]);
    }
  });
});
