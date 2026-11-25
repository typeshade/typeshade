import { describe, expect, it } from 'vitest';
import { bothHalves } from '../../../core/testing/both-halves.js';
import { uninlined } from '../../../core/testing/keep-helpers.js';

const entry = (head: string, value: string): string =>
  `"use typeshade"\n${head}\n@fragment export function fs(): vec4 { return vec4(${value}, 0., 0., 1.); }\n`;

const read = (source: string) => uninlined(() => bothHalves(source));

const wgslOf = (source: string): string => {
  const h = read(source);
  expect(h.compiler).toEqual([]);
  expect(h.editor).toEqual([]);
  return h.result.wgsl ?? '';
};

const bothSay = (source: string, sentence: string): void => {
  const h = read(source);
  expect(h.compiler.filter((l) => l.includes(sentence))).toHaveLength(1);
  expect(h.editor.filter((l) => l.includes(sentence))).toHaveLength(1);
};

describe('which functions the file collects', () => {
  it('flattens a namespace function and keeps a top-level one of the same name apart', () => {
    const wgsl = wgslOf(
      entry(
        `namespace Palette {
  export const K = 3.
  export function warm(x: f32): f32 { return x * 2. }
  export function cool(x: f32): f32 { return warm(x) + K }
}
function warm(x: f32): f32 { return x }`,
        'Palette.cool(1.) + warm(1.)',
      ),
    );
    expect(wgsl).toContain('fn Palette_warm(x: f32) -> f32 {');
    expect(wgsl).toContain('fn Palette_cool(x: f32) -> f32 {');
    expect(wgsl).toContain('(warm(x) + Palette_K)');
    expect(wgsl).toContain('fn warm(x: f32) -> f32 {\n  return x;');
  });

  it('skips an overload signature and lowers the implementation', () => {
    const wgsl = wgslOf(
      entry(
        `function f(x: f32): f32
function f(x: f32, y?: f32): f32 { return x }`,
        'f(1.)',
      ),
    );
    expect(wgsl).toContain('fn f(x: f32, y: _opt_f32_) -> f32 {');
    expect(wgsl.match(/fn f\(/g)).toHaveLength(1);
  });

  it('refuses a signature with no implementation and an ambient declaration', () => {
    bothSay(
      entry('function f(x: f32): f32', 'f(1.)'),
      'Function "f" needs a body (no ambient declarations).',
    );
    bothSay(
      entry('declare function f(x: f32): f32', 'f(1.)'),
      'Function "f" needs a body (no ambient declarations).',
    );
  });

  it('refuses an async function once and says nothing more at its call', () => {
    const source = entry('async function h(a: f32): f32 { return a }', 'h(1.)');
    const h = read(source);
    expect(h.compiler).toHaveLength(1);
    expect(h.compiler[0]).toContain('"h" is async');
    expect(h.editor).toHaveLength(1);
    const inNamespace = read(
      entry('namespace N { export async function h(a: f32): f32 { return a } }', 'N.h(1.)'),
    );
    expect(inNamespace.compiler).toHaveLength(1);
    expect(inNamespace.editor).toHaveLength(1);
  });

  it('emits no function for a mixin', () => {
    const wgsl = wgslOf(
      entry(
        `class S2 { pos: vec3 }
function A<TB extends AnyClass>(Base: TB) {
  return class extends Base { tag: f32 = 1. }
}
class E extends A(S2) {}`,
        'new E().tag',
      ),
    );
    expect(wgsl).not.toMatch(/fn A\(/);
    expect(wgsl).toContain('struct E {');
  });

  it('reads a stage call as the function it wraps, so its refusal is the one diagnostic', () => {
    const refusal =
      'typeshade TS8028: a stage is an attribute on the function declaration: write "@vertex function vs(…)", or run "tshc migrate" (change 0130)';
    const h = read(`"use typeshade";
const vs = vertex(function vs(p: vec3): vec4 { return vec4(p, 1.); });
@fragment export function fs(): vec4 { return vec4(0.); }
`);
    expect(h.compiler).toEqual([refusal]);
    expect(h.editor).toEqual([refusal]);
  });

  it('keeps a call to a stage-call entry the refusal of an entry that cannot be called', () => {
    const h = read(`"use typeshade";
const vs = vertex(function vs(p: vec3): vec4 { return vec4(p, 1.); });
function use(): vec4 { return vs(vec3(1.)); }
@fragment export function fs(): vec4 { return use(); }
`);
    expect(h.compiler).toHaveLength(2);
    expect(h.compiler[1]).toContain('"vs" is a vertex entry point and cannot be called');
    expect(
      h.editor.some((l) => l.includes('"vs" is a vertex entry point and cannot be called')),
    ).toBe(true);
  });

  it('says a duplicate function once and keeps the first', () => {
    const h = read(
      entry(
        `function one(x: f32): f32 { return x }
function one(x: f32): f32 { return x + 1. }`,
        'one(1.)',
      ),
    );
    expect(h.compiler).toEqual(['typeshade TS8023: Duplicate function "one".']);
    expect(h.editor).toContain('typeshade TS8023: Duplicate function "one".');
  });

  it('says a clash between a top-level function and a static name on both', () => {
    const h = read(
      entry(
        `class A { static g(): f32 { return 1. } }
function A_g(): f32 { return 2. }`,
        'A.g() + A_g()',
      ),
    );
    const clash =
      'typeshade TS8023: "A_g" is both the function "A_g" and the emitted name of "A.g"; rename one of them.';
    expect(h.compiler).toContain(clash);
    expect(h.editor).toContain(clash);
  });
});

describe('a generic function and a function that takes a function', () => {
  it('is compiled once for each set of argument types, and not as itself', () => {
    const wgsl = wgslOf(
      entry(
        `function pick<T>(a: T, b: T): T { return a }
function inc(x: f32): f32 { return x + 1. }`,
        'pick(1., 2.) + pick<f32>(inc(1.), 2.) + pick(vec3(1., 2., 3.), vec3(0.)).x',
      ),
    );
    expect(wgsl).toContain('fn pick_f32(a: f32, b: f32) -> f32 {');
    expect(wgsl).toContain('fn pick_vec3(a: vec3<f32>, b: vec3<f32>) -> vec3<f32> {');
    expect(wgsl).not.toMatch(/fn pick\(/);
    expect(wgsl.match(/fn pick_f32\(/g)).toHaveLength(1);
    expect(wgsl.indexOf('fn pick_f32')).toBeLessThan(wgsl.indexOf('fn fs'));
  });

  it('is named under its namespace in a namespace', () => {
    const wgsl = wgslOf(
      entry(
        'namespace N { export function pick<T>(a: T, b: T): T { return a } }',
        'N.pick(1., 2.)',
      ),
    );
    expect(wgsl).toContain('fn N_pick_f32(a: f32, b: f32) -> f32 {');
  });

  it('refuses a generic entry, once', () => {
    const h = read(
      `"use typeshade"\n@fragment export function fs<T>(): vec4 { return vec4(0., 0., 0., 1.) }\n`,
    );
    const sentence = 'a generic entry has no instance to compile';
    expect(h.compiler.filter((l) => l.includes(sentence))).toHaveLength(1);
    expect(h.editor.filter((l) => l.includes(sentence))).toHaveLength(1);
  });

  it('refuses an entry parameter of function type', () => {
    bothSay(
      `"use typeshade"\n@fragment export function fs(f: (x: f32) => f32): vec4 { return vec4(0., 0., 0., 1.) }\n`,
      "An entry's parameters come from the pipeline, and a function is nothing the pipeline can supply",
    );
  });

  it('makes one copy for each set of functions a call hands it', () => {
    const wgsl = wgslOf(
      entry(
        `function apply(f: (x: f32) => f32, v: f32): f32 { return f(v) }
function sq(x: f32): f32 { return x * x }
function cube(x: f32): f32 { return x * x * x }`,
        'apply(sq, 2.) + apply(cube, 2.) + apply(sq, 3.) + apply((x: f32) => x + 1., 1.)',
      ),
    );
    expect(wgsl).toContain('fn apply_sq(v: f32) -> f32 {');
    expect(wgsl).toContain('fn apply_cube(v: f32) -> f32 {');
    expect(wgsl).toContain('fn apply_fs_f(v: f32) -> f32 {');
    expect(wgsl.match(/fn apply_sq\(/g)).toHaveLength(1);
    expect(wgsl).not.toMatch(/fn apply\(/);
  });

  it('keeps two sets of names that join to one string apart', () => {
    const wgsl = wgslOf(
      entry(
        `function both(f: (x: f32) => f32, g: (x: f32) => f32, v: f32): f32 { return f(g(v)) }
function a_b(x: f32): f32 { return x }
function a(x: f32): f32 { return x }
function b(x: f32): f32 { return x }
function c(x: f32): f32 { return x }
function b_c(x: f32): f32 { return x }`,
        'both(a_b, c, 1.) + both(a, b_c, 1.)',
      ),
    );
    expect(wgsl).toContain('fn both_a_b_c(v: f32) -> f32 {\n  return a_b(c(v));');
    expect(wgsl).toContain('fn both_a_b_c_1(v: f32) -> f32 {\n  return a(b_c(v));');
  });

  it('refuses a generic function that calls itself at the same types', () => {
    const h = read(entry('function pick<T>(a: T, b: T): T { return pick(a, b) }', 'pick(1., 2.)'));
    expect(h.compiler).toEqual([
      'typeshade TS8031: Recursive call: "pick" -> "pick". WGSL has no call stack, so a function must not take part in a call cycle.',
    ]);
    expect(h.editor).toEqual(h.compiler);
  });

  it('names the template, not the instance, in a message about an instance', () => {
    const h = read(`"use typeshade";
function g<T>(a: T): void { return a; }
@fragment export function fs(): vec4 { g(1.); return vec4(0.); }
`);
    const sentence =
      'typeshade TS8003: Function "g" returns void but returns a value of type f32: write ": f32" as its return type, or return nothing.';
    expect(h.compiler).toEqual([sentence]);
    expect(h.editor).toEqual([sentence]);
  });
});
