import { describe, expect, it } from 'vitest';
import { bothHalves, bothRefuse, bothTake } from '../../core/testing/both-halves.js';

const program = (...lines: string[]): string => `"use typeshade"\n${lines.join('\n')}`;

const ONE = 'export function f(): f32 { return 1.; }';

const declaredCall = (shown: string, call: string, what = 'calls a function'): string =>
  `${shown} must be constant, and "${call}" ${what} this file declares. ` +
  'A module constant is folded before any function exists, so build the value inside the ' +
  'function that reads it.';

describe('a module constant that calls what the file declares', () => {
  it('names a function reached through a class', () => {
    bothRefuse(
      program('class C { static f(): f32 { return 1.; } }', 'const K = C.f();', ONE),
      'TS8003',
      declaredCall('Module const "K"', 'C.f()'),
    );
  });

  it('names a function reached through a namespace', () => {
    bothRefuse(
      program('namespace N { export function g(): f32 { return 1.; } }', 'const K = N.g();', ONE),
      'TS8003',
      declaredCall('Module const "K"', 'N.g()'),
    );
  });

  it('names the constant as written, with its namespaces, and not as emitted', () => {
    bothRefuse(
      program(
        'function g(): f32 { return 1.; }',
        'namespace A { export namespace B { export const K = g(); } }',
        ONE,
      ),
      'TS8003',
      declaredCall('Module const "A.B.K"', 'g()'),
    );
  });

  it('says nothing more at a read of the refused constant', () => {
    bothRefuse(
      program(
        'function g(): f32 { return 1.; }',
        'const K = g();',
        'export function f(): f32 { return K + K; }',
      ),
      'TS8003',
      declaredCall('Module const "K"', 'g()'),
    );
  });

  it('does not walk the body of a function written in the initializer', () => {
    bothRefuse(
      program(
        'function g(x: f32): f32 { return x; }',
        'const K = vec3(((x: f32): f32 => g(x))(1.), 2., 3.);',
        ONE,
      ),
      'TS8004',
      'Unknown function "((x: f32): f32 => g(x))". Declare it in this file, or import it from another shader module.',
    );
  });
});

describe('a module constant of a vector is refused for a divisor it can prove is zero', () => {
  const zero = (shown: string): string =>
    `Division by zero: "${shown}" is 0 on every invocation. WGSL refuses it and GLSL ES 3.00 leaves it undefined.`;

  it('refuses a remainder by a vector with a zero component', () => {
    bothRefuse(
      program('const Y = vec3(1., 2., 3.) % vec3(1., 0., 1.);', ONE),
      'TS8003',
      zero('vec3(1., 0., 1.)'),
    );
  });

  it('refuses a remainder by an earlier constant with a zero component', () => {
    bothRefuse(
      program('const Z = vec3(1., 0., 1.);', 'const Y = vec3(1., 2., 3.) % Z;', ONE),
      'TS8003',
      zero('Z'),
    );
  });

  it('takes a divisor with no zero component', () => {
    const halves = bothTake(program('const Y = vec3(1., 2., 3.) / vec3(1., 2., 1.);', ONE));
    expect(halves.result.wgsl).toContain('const Y');
  });
});

describe('a static field that shares its emitted name with another', () => {
  it('is declared once, and the second is the one the sentence names', () => {
    const halves = bothHalves(
      program(
        'class S { static K: f32 = 1.; static #K: f32 = 2.; static get(): f32 { return S.K; } }',
        'export function f(): f32 { return S.get(); }',
      ),
    );
    const refusals = [
      'typeshade TS8035: "S.K" and "S.#K" would both be the module constant "S_K": a private name is emitted without its "#". Rename one of them.',
      'typeshade TS8022: "S" has no static field "K".',
    ];
    expect(halves.compiler).toEqual(refusals);
    expect(halves.editor).toEqual(refusals);
  });
});

describe('a static field that holds a function', () => {
  it('is refused once, as a static method, and is no module constant', () => {
    bothRefuse(
      program(
        'class S { static twice = (x: f32): f32 => x * 2.; }',
        'export function f(): f32 { return S.twice(1.); }',
      ),
      'TS8035',
      'A static field holding a function is a static method: write "static twice(...) { ... }".',
    );
  });
});

describe('a module constant refused once leaves its uses silent', () => {
  it('a list that spreads a list', () => {
    bothRefuse(
      program(
        'const A: array<f32, 2> = [1., 2.];',
        'const B: array<f32, 4> = [...A, 3., 4.];',
        'export function f(): f32 { return B[0] + B[1]; }',
      ),
      'TS8013',
      '"...A" spreads a list into a list, which a shader array does not do: write its elements, A[0], A[1].',
    );
  });

  it('an annotation of a type nothing declares', () => {
    bothRefuse(
      program('const K: Foo = 1.;', 'export function f(): f32 { return K + K; }'),
      'TS8002',
      'Unknown type "Foo". Declare it in this file, or import it from another shader module.',
    );
  });

  it('an annotation that is no scalar type, beside a scalar value', () => {
    bothRefuse(
      program('const K: vec3 = 1.;', ONE),
      'TS8003',
      'Module const "K" must be f32, i32, u32, or bool for now.',
    );
  });
});

describe('a module constant of a struct type', () => {
  it('reads its annotation to find the struct its object literal builds', () => {
    const halves = bothTake(
      program(
        'interface P { x: f32; y: f32; }',
        'const O: P = { x: 0., y: 1. };',
        'export function f(): f32 { return O.y; }',
      ),
    );
    expect(halves.result.wgsl).toContain('const O: P');
  });
});
