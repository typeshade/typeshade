// Verifies: Rule 6.10, Rule 8.8, Rule 8.25, Rule 12.7 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const P = `class P { x: f32 = 0; bump(): void { this.x += 1.; } }
function nudge(p: P): void { p.x += 1.; }
`;

function read(body: string): { compiler: string[]; editor: string[]; value: unknown } {
  const source = `"use typeshade";\n${body}\n`;
  const r = compile(source, { fileName: 'm.shade.ts' });
  const compiler = r.diagnostics
    .filter((d) => d.category === 'error')
    .map((d) => `${d.code} ${d.message}`);
  const service = createTypeshadeLanguageService();
  service.openDocument('m.shade.ts', source);
  const editor = service
    .getDiagnostics('m.shade.ts')
    .filter((d) => d.severity === 'error')
    .map((d) => `${String(d.code)} ${d.message}`);
  const value = compiler.length === 0 ? r.eval?.('f', []) : undefined;
  return { compiler, editor, value };
}

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const STORED = (name: string): RegExp =>
  new RegExp(
    `^TS8099 "${esc(name)}" is stored in a second place here, and it is used after that\\. One object under two names is not supported yet \\(change 0142, stage 3\\)\\. Store it where it is last used, or build a new object for the second place\\.$`,
  );

const NAMED = (text: string): RegExp =>
  new RegExp(
    `^TS8099 "${esc(text)}" already has a name, and this statement gives it a second place\\. One object under two names is not supported yet \\(change 0142, stage 3\\)\\. Build a new object for the second place\\.$`,
  );

const CALLED = (name: string, call: string): RegExp =>
  new RegExp(
    `^TS8099 "${esc(name)}" would name an object that "${esc(call)}" gives back, which may already have a name, and the function writes an object after that\\. One object under two names is not supported yet \\(change 0142, stage 2\\)\\. Read what you need from the call first, or write through the name that holds the object\\.$`,
  );

function refusedAs(r: ReturnType<typeof read>, want: readonly RegExp[]): void {
  expect(r.compiler).toHaveLength(want.length);
  want.forEach((w, i) => expect(r.compiler[i]).toMatch(w));
  expect(r.editor).toEqual(r.compiler);
}

describe('a copy is written with a name JavaScript has (change 0142, Table 3)', () => {
  const S = `interface S { x: f32; y: f32 }
`;
  const runs: readonly (readonly [string, string, number])[] = [
    [
      'structuredClone of a struct that is no class is its own object',
      `${S}export function f(): f32 { let a: S = { x: 1., y: 2. }; let b = structuredClone(a); b.x = 9.; return a.x * 10. + b.x; }`,
      19,
    ],
    [
      'structuredClone of an array of numbers is its own array',
      `export function f(): f32 { let a: array<f32, 2> = [1., 2.]; let b = structuredClone(a); b[0] = 9.; return a[0] * 10. + b[0]; }`,
      19,
    ],
    [
      'an object spread of a struct with no object field is its own object',
      `${S}export function f(): f32 { let a: S = { x: 1., y: 2. }; let b: S = { ...a }; b.x = 9.; return a.x * 10. + b.x; }`,
      19,
    ],
  ];
  for (const [name, body, expected] of runs) {
    it(`${name}: both halves, and the oracle`, () => {
      const r = read(body);
      expect(r.compiler).toEqual([]);
      expect(r.editor).toEqual([]);
      expect(r.value).toBe(expected);
    });
  }

  it('refuses structuredClone of an instance of a class as not supported yet, in both halves', () => {
    const r = read(
      `${P}export function f(): f32 { let a = new P(); let b = structuredClone(a); b.x = 9.; return a.x; }`,
    );
    expect(r.compiler).toEqual([
      'TS8099 structuredClone gives back a plain object with no methods for an instance of the class "P", which is not supported yet (change 0142, stage 3). To copy an instance, build one: new P(...), or a method of the class that returns a new one.',
    ]);
    expect(r.editor).toEqual(r.compiler);
  });

  it('refuses a lone spread of an array and names slice(), in both halves', () => {
    const r = read(
      `export function f(): f32 { const a: array<f32, 3> = [1., 2., 3.]; let b = [...a]; b[0] = 9.; return a[0] + b[0]; }`,
    );
    expect(r.compiler).toEqual([
      'TS8013 "...a" spreads a list into a list, which a shader array does not do: write its elements, a[0], a[1], a[2], or a.slice() for a copy of the whole array.',
    ]);
    expect(r.editor).toEqual(r.compiler);
  });
});

describe('programs a review found with a result JavaScript does not give (change 0142)', () => {
  const Q = `class P { x: f32 = 0; y: f32 = 0; }
class B { c: P = new P(); }
function wp(p: P): void { p.x = 7.; }
function id(p: P): P { return p; }
`;
  const runs: readonly (readonly [string, string, number])[] = [
    [
      'a second name of a second name, written through the first name',
      `${Q}export function f(): f32 { let a = new P(); let q = a; let r = q; a.x = 1.; return r.x; }`,
      1,
    ],
    [
      'a second name through two calls that return their parameter',
      `${Q}export function f(): f32 { let a = new P(); let q = id(a); let r = id(q); wp(r); return a.x; }`,
      7,
    ],
    [
      'a list assignment to two fields is a write that a second name sees',
      `${Q}export function f(): f32 { let a = new P(); let q = a; [a.x, a.y] = [1., 2.]; return q.x + q.y * 10.; }`,
      21,
    ],
    [
      "a list assignment to two fields of a parameter writes the caller's object",
      `${Q}function w(p: P): void { [p.x, p.y] = [1., 2.]; }
export function f(): f32 { let a = new P(); w(a); return a.x + a.y * 10.; }`,
      21,
    ],
    [
      "a block that declares the parameter's name again does not hide the write outside it",
      `${Q}function g(p: P): void { p.x = 3.; { let p = new P(); p.x = 9.; } }
export function f(): f32 { let a = new P(); g(a); return a.x; }`,
      3,
    ],
    [
      'a second name of a parameter through a call that returns it',
      `${Q}function g(p: P): void { const q = id(p); q.x = 1.; }
export function f(): f32 { let a = new P(); g(a); return a.x; }`,
      1,
    ],
    [
      'a parameter assigned whole before any write is a local, and the caller sees nothing',
      `${Q}function g(p: P): void { p = new P(); p.x = 9.; }
export function f(): f32 { let a = new P(); g(a); return a.x; }`,
      0,
    ],
    [
      'two objects that change places stay two objects',
      `${Q}export function f(): f32 {
  let a = new P(); let b = new P(); a.x = 1.; [a, b] = [b, a]; b.x += 5.; return a.x * 10. + b.x;
}`,
      6,
    ],
  ];
  for (const [name, body, expected] of runs) {
    it(`${name}: both halves, and the oracle`, () => {
      const r = read(body);
      expect(r.compiler).toEqual([]);
      expect(r.editor).toEqual([]);
      expect(r.value).toBe(expected);
    });
  }

  const refused: readonly (readonly [string, string, RegExp | readonly RegExp[]])[] = [
    [
      "a parameter assigned whole after a write to the caller's object",
      `${Q}function g(p: P): void { p.x = 3.; p = new P(); p.x = 9.; }
export function f(): f32 { let a = new P(); g(a); return a.x; }`,
      /^TS8099 "p" is assigned another object here, after a write to the object it named until now\. A name that stops naming the caller's object part of the way through is not supported yet \(change 0142, stage 2\)\. Declare a local for the other object\.$/,
    ],
    [
      'a loop name assigned whole after a write to the element',
      `${Q}export function f(): f32 {
  let ps: array<P, 2> = [new P(), new P()];
  for (let p of ps) { p.x = 2.; p = new P(); p.x = 7.; }
  return ps[0].x + ps[1].x;
}`,
      /^TS8099 "p" is assigned another object here/,
    ],
    [
      'a field that takes an object from a field that holds a name',
      `${Q}export function f(): f32 {
  let a = new P(); let b = new B(); b.c = a; let d = new B(); d.c = b.c; d.c.x = 4.; return a.x;
}`,
      [STORED('a'), NAMED('b.c')],
    ],
    [
      'an element that holds a name, written through a loop name',
      `${Q}export function f(): f32 {
  let a = new P(); let ps: array<P, 2> = [new P(), new P()]; ps[0] = a;
  for (const p of ps) { p.x += 1.; }
  return a.x;
}`,
      STORED('a'),
    ],
    [
      'a stored object written by a function declared before the store',
      `${Q}export function f(): f32 {
  let a = new P(); let b = new B(); const g = (): void => { a.x = 1.; }; b.c = a; g(); return b.c.x;
}`,
      STORED('a'),
    ],
    [
      'a second name that a local function writes',
      `${Q}export function f(): f32 {
  let a = new P(); let q = a; const g = (): void => { q.x = 1.; }; g(); return a.x;
}`,
      /^TS8099 "q" is a second name of an object that already has a name, and a function inside this one uses "q"\. A second name that a local function captures is not supported yet \(change 0142, stage 2\)\. Use the first name in that function\.$/,
    ],
    [
      'a list that gives one object to two names',
      `${Q}export function f(): f32 {
  let a = new P(); let b = new P(); a.x = 1.; [a, b] = [a, a]; b.x += 5.; return a.x;
}`,
      [STORED('a'), STORED('a')],
    ],
  ];
  for (const [name, body, text] of refused) {
    it(`refuses ${name}, in both halves`, () => {
      refusedAs(read(body), Array.isArray(text) ? text : [text as RegExp]);
    });
  }
});

describe('more programs a review found (change 0142)', () => {
  const Q = `class P { x: f32 = 0; y: f32 = 0; }
class B { c: P = new P(); }
class H { c: P; constructor(p: P) { this.c = p; } }
`;
  const runs: readonly (readonly [string, string, number])[] = [
    [
      'one object handed twice to a function that only reads',
      `${Q}function w(p: P, q: P): f32 { return p.x + q.x; }
export function f(): f32 { const a = new P(); a.x = 2.; return w(a, a); }`,
      4,
    ],
    [
      'a list of numbers taken apart into names is no object',
      `function two(): [f32, f32] { return [4., 6.]; }
export function f(): f32 { let p = vec2(0., 0.); const [a, b] = two(); p.x = a; p.y = b; return p.x + p.y + a; }`,
      14,
    ],
    [
      'a name of an element, read at the field a later write changes',
      `class E { pos: f32 = 1; tag: f32 = 2; }
export function f(): f32 {
  let es: array<E, 2> = [new E(), new E()]; const p = es[0]; es[0].pos = 9.; return p.pos;
}`,
      9,
    ],
    [
      'a second name of this, read after a write through this',
      `class S { x: f32 = 0; m(): f32 { const s = this; this.x = 5.; return s.x; } }
export function f(): f32 { const a = new S(); return a.m(); }`,
      5,
    ],
    [
      'a name of an element, read at a field that a later write to the element leaves alone',
      `class E { pos: f32 = 1; tag: f32 = 2; }
export function f(): f32 {
  let es: array<E, 2> = [new E(), new E()];
  const p = es[0];
  es[0].pos = p.pos * 2. + 1.;
  es[0].tag = p.tag + 3.;
  return es[0].pos * 10. + es[0].tag;
}`,
      35,
    ],
  ];
  for (const [name, body, expected] of runs) {
    it(`${name}: both halves, and the oracle`, () => {
      const r = read(body);
      expect(r.compiler).toEqual([]);
      expect(r.editor).toEqual([]);
      expect(r.value).toBe(expected);
    });
  }

  const refused: readonly (readonly [string, string, RegExp | readonly RegExp[]])[] = [
    [
      'one object handed twice to a function that writes one and reads the other',
      `${Q}function w(p: P, q: P): f32 { p.x = 5.; return q.x; }
export function f(): f32 { const a = new P(); return w(a, a); }`,
      /^TS8074 This call hands "a" to "w" twice, and "w" writes one of the two: one object under two names inside "w", which is not supported yet \(change 0142, stage 2\)\./,
    ],
    [
      'a const that holds a name in a field, written through the field',
      `${Q}export function f(): f32 { const p = new P(); const h = new H(p); h.c.x = 5.; return p.x; }`,
      STORED('p'),
    ],
    [
      'a name a pattern takes from a field, then written',
      `${Q}export function f(): f32 { const b = new B(); let { c } = b; c.x = 5.; return b.c.x; }`,
      CALLED('c', 'b'),
    ],
    [
      'two names a pattern takes from one object',
      `${Q}export function f(): f32 { const a = new P(); let [p, q] = [a, a]; p.x = 5.; return q.x; }`,
      [CALLED('p', '[a, a]'), CALLED('q', '[a, a]'), STORED('a'), STORED('a')],
    ],
    [
      'an object whose name another block declares first as a number',
      `${Q}export function f(): f32 {
  { const a = 1.; }
  { const a = new P(); let xs: array<P, 1> = [new P()]; xs[0] = a; a.x = 5.; return xs[0].x; }
  return 0.;
}`,
      STORED('a'),
    ],
  ];
  for (const [name, body, text] of refused) {
    it(`refuses ${name}, in both halves`, () => {
      refusedAs(read(body), Array.isArray(text) ? text : [text as RegExp]);
    });
  }
});
