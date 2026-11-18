// Verifies: Rule 4.5, Rule 4.6, Rule 7.8, Rule 12.1, Rule 12.4, Rule 12.5, Rule 12.6 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { compileTsSource } from './source-file.js';
import { uninlined } from '../../core/testing/uninlined.js';

const errorsOf = (src: string) =>
  compileTsSource(src)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => d.message);

const FS = `@fragment export function fs(): vec4 {
  return vec4(1.)
}
`;

describe('a tuple is a list of a length the type fixes, which is array<T, N>', () => {
  it('returns one, from both backends', () => {
    const r = uninlined(() =>
      compile(`"use typeshade";
function two(): [f32, f32] {
  return [1., 2.];
}
@fragment export function fs(): vec4 {
  const t = two();
  return vec4(t[0], t[1], 0., 1.);
}
`),
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('fn two_into(_dst: ptr<function, array<f32, 2>>) {');
    expect(r.wgsl).toContain('(*_dst) = array<f32, 2>(1.0, 2.0);');
    expect(r.wgsl).toContain('two_into(&t);');
    expect(r.glsl?.fragment).toContain('float[2] two() {');
  });

  it('takes one as a parameter, and a list written at the call site', () => {
    const r = uninlined(() =>
      compile(`"use typeshade";
function plus(p: [f32, f32]): f32 {
  return p[0] + p[1];
}
@fragment export function fs(): vec4 {
  return vec4(plus([1., 2.]), 0., 0., 1.);
}
`),
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('fn plus(p: array<f32, 2>) -> f32 {');
  });

  it('takes a list in a struct field that declares an array', () => {
    const r = compile(`"use typeshade";
class Box {
  xs: array<f32, 2>;
  k: f32;
}
function rgba(b: Box): vec4 { return vec4(b.xs[0], b.xs[1], b.k, 1.); }
@fragment export function fs(): vec4 {
  const b: Box = { xs: [1., 2.], k: 3. };
  return rgba(b);
}
`);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('vec4<f32>(1.0, 2.0, 3.0, 1.0)');
  });

  it('names its elements, the way TypeScript lets a tuple do', () => {
    const r = uninlined(() =>
      compile(`"use typeshade";
function span(): [lo: f32, hi: f32] {
  return [0., 1.];
}
@fragment export function fs(): vec4 {
  return vec4(span()[1], 0., 0., 1.);
}
`),
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('fn span() -> array<f32, 2> {');
  });

  it('says a tuple of several types is a struct', () => {
    expect(
      errorsOf(`"use typeshade"
function f(p: [f32, vec3]): f32 {
  return 1.
}
${FS}`)[0],
    ).toBe(
      '"[f32, vec3]" holds a f32 and a vec3. A list of one type is array<T, N>; a list of ' +
        'several is a struct, so declare one with a field per element and return that.',
    );
  });

  it('says a tuple that does not fix its length has no array to be', () => {
    expect(
      errorsOf(`"use typeshade"
function f(p: [f32, ...f32[]]): f32 {
  return 1.
}
${FS}`)[0],
    ).toBe(
      '"[f32, ...f32[]]" does not fix its length, and every array on the GPU outside storage ' +
        'has a length known at compile time. Write the elements out, or declare array<T, N>.',
    );
  });

  it('reports an element that names no type on the element, not on the tuple', () => {
    expect(
      errorsOf(`"use typeshade"
function f(p: [f32, string]): f32 {
  return 1.
}
${FS}`),
    ).toEqual([
      'A string has no GPU representation: there is nothing for it to be at run ' +
        'time. Text that picks between cases is a key type, a union of string literals such ' +
        'as "a" | "b", whose values the GPU holds as ids.',
    ]);
  });
});
