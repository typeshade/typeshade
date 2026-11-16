// Verifies: Rule 8.23 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 8.25 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 7.6 (docs/language-design.md; traced in reqs/).
//
// A parameter of an array with no qualifier is a value (change 0138, Amendment A15, decision 1):
// a write to it that a path carries to a `return` that does not return it, or to the end of the
// function, is refused with `TS8080`. Read twice, as every program an author writes is
// (CLAUDE.md): each program in `compile()` and in the language service, with the same code and the
// same text. An `@out` array is filled with zeros by the call, so `TS8075` refuses no read of its
// elements and no path that leaves it unwritten (decision 2).

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { lostWriteText } from './value-array-write.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const module = (body: string): string => `"use typeshade";\n${body}\n`;

const compiled = (body: string): string[] =>
  compile(module(body), { fileName: 'm.shade.ts' }).diagnostics.map(
    (d) => `${d.category} ${String(d.code)} ${d.message}`,
  );

const edited = (body: string): string[] => {
  const service = createTypeshadeLanguageService();
  service.openDocument('m.shade.ts', module(body));
  return service
    .getDiagnostics('m.shade.ts')
    .map((d) => `${d.severity} ${String(d.code)} ${d.message}`);
};

const outPushed = (fn: string, p: string): string =>
  `error TS8080 ${fn}(): parameter "${p}" is @out; a push to it needs @inout. Write @inout ${p}.`;
/** Each program of `TS8080`: `[name, source, the diagnostics both halves say]`. */
const CASES: readonly (readonly [string, string, readonly string[]])[] = [
  [
    "an element write in a kernel function: the write reaches the caller's array",
    `export function scale(xs: array<f32>, k: f32) {
  for (let i: u32 = 0; i < xs.length; i++) {
    xs[i] = xs[i] * k;
  }
}`,
    [],
  ],
  [
    "a compound write: the write reaches the caller's array",
    `export function bump(xs: array<f32>) {
  for (let i: u32 = 0; i < xs.length; i++) {
    xs[i] += 1.;
  }
}`,
    [],
  ],
  [
    "an increment: the write reaches the caller's array",
    `export function count(xs: array<u32>) {
  for (let i: u32 = 0; i < xs.length; i++) {
    xs[i]++;
  }
}`,
    [],
  ],
  [
    "fill: the write reaches the caller's array",
    `export function zero(xs: array<f32>) {
  xs.fill(0.);
}`,
    [],
  ],
  [
    'a local rewrite of a fixed-size array parameter that no return carries is no TS8080 (Rule 8.8, change 0031)',
    `function reset(a: array<f32, 2>, c: bool): f32 {
  if (c) {
    a = [0., 0.];
    return 1.;
  }
  return 2.;
}`,
    [],
  ],
  [
    "a push: the write reaches the caller's array",
    `export function add(xs: array<f32>, v: f32) {
  for (let i: u32 = 0; i < xs.length; i++) {
    xs.push(v);
  }
}`,
    [],
  ],
  [
    'a push to a fixed-size array parameter is no TS8080: it is no array method (TS8099)',
    `function add(xs: array<f32, 2>, v: f32): array<f32, 2> {
  xs.push(v);
  return xs;
}`,
    [
      // TS8080 reads an array with no size only (Amendment A16, decision 2). A push belongs to a kernel function's array in a loop (Rule 8.22); on a fixed-size array
      // it is also no array method, which the same compile says.
      `error TS8099 ".push" is not one of an array's methods here, which are map, forEach, some, every, reduce, fill, findIndex, findLastIndex, indexOf, lastIndexOf, includes and slice() with no argument, which copies it. An array's length is fixed, so a change of length is a loop: "for (const x of xs) { … }".`,
    ],
  ],
  [
    'a write on one path and a return of the parameter on the other',
    `function pick(a: array<f32, 2>, c: bool): array<f32, 2> {
  if (c) {
    a = [1., 2.];
  }
  return a;
}`,
    [],
  ],
  [
    'a fixed-size array: a write, then a return that does not return the parameter, is no TS8080',
    `function pick(a: array<f32, 2>, c: bool): array<f32, 2> {
  if (c) {
    a = [1., 2.];
    return [3., 4.];
  }
  return a;
}`,
    [],
  ],
  [
    'a fixed-size array: a write after a loop reaches the end of the function, no TS8080',
    `function run(a: array<f32, 2>, n: u32): f32 {
  for (let i: u32 = 0; i < n; i++) {
    a = [1., 2.];
  }
  return 0.;
}`,
    [],
  ],
  [
    'a parameter the body only reads',
    `export function total(xs: array<f32>): f32 {
  let s = 0.;
  for (let i: u32 = 0; i < xs.length; i++) {
    s += xs[i];
  }
  return s;
}`,
    [],
  ],
  [
    'an @inout parameter',
    `export function scale(@inout xs: array<f32>, k: f32) {
  for (let i: u32 = 0; i < xs.length; i++) {
    xs[i] = xs[i] * k;
  }
}`,
    [],
  ],
  [
    'a push onto a declared @out array needs @inout',
    `export function grow(@out list: array<f32>, v: f32) {
  for (let i: u32 = 0; i < 4; i++) {
    list.push(v);
  }
}`,
    [outPushed('grow', 'list')],
  ],
  [
    'an element write to a declared @out array is no TS8080',
    `export function seta(@out list: array<f32>) {
  for (let i: u32 = 0; i < list.length; i++) {
    list[i] = 1.;
  }
}`,
    [],
  ],
  [
    "an array with no size written through an alias is the caller's array too",
    `type Xs = array<f32>;
export function scale(xs: Xs) {
  for (let i: u32 = 0; i < xs.length; i++) {
    xs[i] = 2.;
  }
}`,
    [],
  ],
  [
    'an @inout parameter that is pushed onto',
    `export function add(@inout xs: array<f32>, v: f32) {
  for (let i: u32 = 0; i < xs.length; i++) {
    xs.push(v);
  }
}`,
    [],
  ],
  [
    'a written neighbour: the parameter that is written is named, not the one that is read',
    `export function copy(xs: array<f32>, @inout ys: array<f32>) {
  for (let i: u32 = 0; i < xs.length; i++) {
    ys[i] = xs[i];
  }
}`,
    [],
  ],
  [
    "two array parameters, one written: the write reaches the caller's array",
    `export function copy(xs: array<f32>, ys: array<f32>) {
  for (let i: u32 = 0; i < xs.length; i++) {
    ys[i] = xs[i];
  }
}`,
    [],
  ],
  [
    'a local array of the same name is a local',
    `export function sum(xs: array<f32>): f32 {
  let s = 0.;
  for (let i: u32 = 0; i < xs.length; i++) {
    s += xs[i];
  }
  return s;
}
function scratch(): f32 {
  let a: array<f32, 2> = [0., 0.];
  a[0] = 1.;
  return a[0];
}`,
    [],
  ],
  [
    'an @out array written through its elements, read back, and never written on a path',
    `export function fill(@out xs: array<f32>, k: f32) {
  for (let i: u32 = 0; i < xs.length; i++) {
    xs[i] = xs[i] + k;
  }
}`,
    [],
  ],
  [
    'an @out array that the body never writes',
    `export function nothing(@out xs: array<f32>, k: f32) {
  let s = k;
  s += 1.;
}`,
    [],
  ],
];

describe('a write to a value array parameter (TS8080, change 0138, Amendment A15)', () => {
  for (const [name, source, expected] of CASES) {
    it(`${name}: the compiler and the editor say the same`, () => {
      expect(compiled(source)).toEqual([...expected]);
      expect(edited(source)).toEqual([...expected]);
    });
  }

  it('reports no lost write on an element write through an array parameter (change 0142)', () => {
    const source = module(`export function scale(xs: array<f32>) {
  for (let i: u32 = 0; i < xs.length; i++) {
    xs[i] = 2.;
  }
}`);
    // Change 0142: the parameter is the caller's array, so the write is no lost write. Both halves.
    const r = compile(source, { fileName: 'm.shade.ts' });
    expect(r.diagnostics.filter((x) => x.category === 'error')).toEqual([]);
    expect(r.diagnostics.some((x) => x.code === 'TS8080')).toBe(false);
    const service = createTypeshadeLanguageService();
    service.openDocument('m.shade.ts', source);
    expect(service.getDiagnostics('m.shade.ts').filter((x) => x.severity === 'error')).toEqual([]);
  });
});

describe('the text of TS8080 (Amendment A16, decision 3)', () => {
  it('a write to an array parameter is no TS8080 in a kernel function or in a helper (change 0142)', () => {
    const sources = [
      `export function scale(xs: array<f32>) {\n  xs[0] = 1.;\n}`,
      `function scale(xs: array<f32, 4>) {\n  xs[0] = 1.;\n}`,
    ];
    for (const src of sources) {
      expect(compiled(src)).toEqual([]);
      expect(edited(src)).toEqual([]);
    }
    // The helper's parameter is a pointer, so the write reaches the caller's array.
    const r = compile(module(sources[1]!), { fileName: 'm.shade.ts' });
    expect(r.wgsl).toContain('xs: ptr<function, array<f32, 4>>');
  });

  it('keeps "or return xs" behind the condition slice 3 enables', () => {
    expect(lostWriteText('scale', 'xs', 'write', true)).toBe(
      `scale(): parameter "xs" is a value; its writes are lost. Write @inout xs to update the caller's array, or return xs.`,
    );
    expect(lostWriteText('scale', 'xs', 'write')).toBe(
      `scale(): parameter "xs" is a value; its writes are lost. Write @inout xs to update the caller's array.`,
    );
  });
});

describe('an @out array (change 0138, Amendment A15, decision 2): no TS8075 on a read or an unwritten path', () => {
  it('still refuses an @out value that is no array: it is written whole before it is read', () => {
    const source = `export function f(@out c: f32): void { c = c + 1.; }`;
    const expected = [
      'error TS8075 "c" is an @out parameter, and is read here before f writes it: it holds no value until the function writes it. Write "c" first, or declare it @inout (Rule 8.25).',
    ];
    expect(compiled(source)).toEqual(expected);
    expect(edited(source)).toEqual(expected);
  });
});
