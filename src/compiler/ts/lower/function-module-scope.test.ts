import { describe, expect, it } from 'vitest';
import { bothHalves } from '../../../core/testing/both-halves.js';
import { uninlined } from '../../../core/testing/keep-helpers.js';

const read = (source: string) => uninlined(() => bothHalves(source));

const wgslOf = (source: string): string => {
  const h = read(source);
  expect(h.compiler).toEqual([]);
  expect(h.editor).toEqual([]);
  return h.result.wgsl ?? '';
};

const program = (head: string, value: string): string =>
  `"use typeshade"\n${head}\n@fragment export function fs(): vec4 { return vec4(${value}, 0., 0., 1.); }\n`;

describe('the scope a body is lowered in', () => {
  it('divides by a vector const without taking its placeholder value for zero', () => {
    const wgsl = wgslOf(
      `"use typeshade";
const Z = vec3(1., 2., 4.);
function f(v: vec3, k: f32): vec3 { return v / Z * k; }
@fragment export function fs(): vec4 { return vec4(f(vec3(1.), 2.), 1.); }
`,
    );
    expect(wgsl).toContain('((v / Z) * k)');
  });

  it('reads an override as a name, which no pass folds', () => {
    const wgsl = wgslOf(
      program(
        `const K: override<f32> = 2.
function f(v: f32): f32 { return v * K }`,
        'f(1.)',
      ),
    );
    expect(wgsl).toContain('override K: f32 = 2.0;');
    expect(wgsl).toContain('return (v * K);');
  });

  it('reads and writes a module variable under its own name', () => {
    const wgsl = wgslOf(
      program(
        `let counter = 0.
function f(v: f32): f32 { counter += v; return counter }`,
        'f(1.)',
      ),
    );
    expect(wgsl).toContain('var<private> counter: f32 = 0.0;');
    expect(wgsl).toContain('counter += v;');
  });

  it('says one diagnostic for a const beside an override of one name, in both halves', () => {
    const sentence =
      'typeshade TS8023: "K" is declared as a module const and as an override; one module-scope name means one thing.';
    const h = read(
      program(
        `const K: override<f32> = 2.
const K: f32 = 3.
function f(): f32 { return K }`,
        'f()',
      ),
    );
    expect(h.compiler).toEqual([sentence]);
    expect(h.editor).toContain(sentence);
    expect(h.editor.filter((l) => l.startsWith('typeshade'))).toEqual([sentence]);
  });

  it('reads a mistyped enum member as one', () => {
    const sentence = 'typeshade TS8022: "Mode" has no member "C".';
    const h = read(
      program(
        `enum Mode { A, B }
function f(): f32 { return Mode.C }`,
        'f()',
      ),
    );
    expect(h.compiler).toEqual([sentence]);
    expect(h.editor).toEqual([sentence]);
  });

  it('types a returned literal from the signature, and a returned object from its struct', () => {
    const wgsl = wgslOf(
      program(
        `function f(): i32 { return 0 }
function g(): u32 { return 7 }
class Q { a: f32 = 1. }
function h(): Q { return { a: 2. } }`,
        'f32(f()) + f32(g()) + h().a',
      ),
    );
    expect(wgsl).toContain('fn f() -> i32 {\n  return 0;');
    expect(wgsl).toContain('fn g() -> u32 {\n  return 7u;');
    expect(wgsl).toContain('fn h() -> Q {\n  return Q(2.0);');
  });
});
