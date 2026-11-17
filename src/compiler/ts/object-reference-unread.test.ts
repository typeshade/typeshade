// Verifies: Rule 6.10, Rule 8.8, Rule 8.25, Rule 12.7 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

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

const AGAIN = (name: string): RegExp =>
  new RegExp(
    `^TS8099 "${esc(name)}" is a second name of an object that already has a name, and "${esc(name)}" is assigned again later\\. Following which object each name then refers to is not supported yet \\(change 0142, stage 2\\)\\. Give "${esc(name)}" its own variable for the second object\\.$`,
  );

function refusedAs(r: ReturnType<typeof read>, want: readonly RegExp[]): void {
  expect(r.compiler).toHaveLength(want.length);
  want.forEach((w, i) => expect(r.compiler[i]).toMatch(w));
  expect(r.editor).toEqual(r.compiler);
}

describe('what the analysis cannot read is read as shared (change 0142)', () => {
  const Q = `class P { x: f32 = 0; y: f32 = 0; getx(): f32 { return this.x; } }
class H { c: P = new P(); get cc(): P { return this.c; } }
class K { p: P = new P(); q: P = new P(); }
function id(p: P): P { return p; }
function bump(p: P): f32 { p.x += 1.; return p.x; }
function w(p: P, q: P): f32 { p.x = 5.; return q.x; }
`;
  const runs: readonly (readonly [string, string, number])[] = [
    [
      'a list of numbers a method of an array gives is no object',
      `${Q}export function f(): f32 {
  let xs: array<P, 2> = [new P(), new P()];
  const ys = xs.map((e: P): f32 => e.x + 1.);
  xs[0].x = 5.;
  return ys[0];
}`,
      1,
    ],
    [
      'a name of an element read through a method after a write to the element',
      `${Q}export function f(): f32 {
  let xs: array<P, 2> = [new P(), new P()]; const p = xs[1]; xs[1].x = 5.; return p.getx();
}`,
      5,
    ],
    [
      'two fields of one object are two objects for a function that writes one',
      `${Q}export function f(): f32 { const k = new K(); return w(k.p, k.q); }`,
      0,
    ],
    [
      'two numbered elements are two objects for a function that writes one',
      `${Q}export function f(): f32 { let xs: array<P, 2> = [new P(), new P()]; return w(xs[0], xs[1]); }`,
      0,
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
      'a name of what a getter gives, after a write to the field the getter reads',
      `${Q}export function f(): f32 { const h = new H(); const q = h.cc; h.c.x = 5.; return q.x; }`,
      CALLED('q', 'h.cc'),
    ],
    [
      'the result of a function declared inside the function',
      `${Q}export function f(): f32 {
  const idl = (q: P): P => q; const a = new P(); const b = idl(a); a.x = 5.; return b.x;
}`,
      CALLED('b', 'idl(a)'),
    ],
    [
      'a list that holds one object twice, written through one element',
      `${Q}export function f(): f32 {
  const a = new P(); let xs: array<P, 2> = [a, a]; xs[0].x = 5.; return xs[1].x;
}`,
      [STORED('a'), STORED('a')],
    ],
    [
      'the elements a method of an array gives back',
      `${Q}export function f(): f32 {
  let xs: array<P, 2> = [new P(), new P()];
  const ys = xs.map((e: P): P => e);
  xs[0].x = 5.;
  return ys[0].x;
}`,
      CALLED('ys', 'xs.map((e: P): P => e)'),
    ],
    [
      'a function that gives back its parameter out of a list it built',
      `${Q}function g(p: P): P { let xs: array<P, 1> = [p]; return xs[0]; }
export function f(): f32 { const a = new P(); let r = new P(); r = g(a); r.x = 5.; return a.x; }`,
      [NAMED('p'), NAMED('g(a)')],
    ],
    [
      'an object written inside the statement that stores it',
      `${Q}class C { p: P; v: f32; constructor(p: P, v: f32) { this.p = p; this.v = v; } }
export function f(): f32 { const a = new P(); const b = new C(a, bump(a)); return b.p.x; }`,
      STORED('a'),
    ],
    [
      'another object put in the array inside the loop that names its elements',
      `${Q}export function f(): f32 {
  let xs: array<P, 2> = [new P(), new P()];
  let k = 0;
  for (const e of xs) { if (k == 0) { xs[0] = new P(); } e.x = 5.; k++; }
  return xs[0].x;
}`,
      /^TS8099 This statement may put another object in "xs" inside the loop that names its elements "e"\. A loop that must keep the array and the objects it found is not supported yet \(change 0142, stage 2\)\. Loop over the indexes, for \(let i = 0; i < xs\.length; i\+\+\), and read xs\[i\]\.$/,
    ],
    [
      'one object handed as a name and as the result of a call',
      `${Q}export function f(): f32 { const a = new P(); return w(a, id(a)); }`,
      /^TS8074 This call hands the object "a" names to "w" twice, and "w" writes one of the two: one object under two names, which is not supported yet \(change 0142, stage 2\)\. Pass two objects, or give the function one parameter for it\.$/,
    ],
  ];
  for (const [name, body, text] of refused) {
    it(`refuses ${name}, in both halves`, () => {
      refusedAs(read(body), Array.isArray(text) ? text : [text as RegExp]);
    });
  }
});

describe('a loop name, an object that may be absent, and a call on a new object (change 0142)', () => {
  const Q = `class P { x: f32 = 0; }
class H { c: P; constructor(p: P) { this.c = p; } get1(): P { return this.c; } }
`;
  const runs: readonly (readonly [string, string, number])[] = [
    [
      'a loop name reads the element as a write through the array left it',
      `${Q}export function f(): f32 {
  const xs: array<P, 2> = [new P(), new P()];
  let s = 0.;
  for (const p of xs) { xs[0].x += 1.; s += p.x; }
  return s;
}`,
      1,
    ],
    [
      'a loop name reads what an inner loop over the same array wrote',
      `${Q}export function f(): f32 {
  const xs: array<P, 2> = [new P(), new P()];
  let s = 0.;
  for (const p of xs) { for (const q of xs) { q.x += 1.; } s += p.x; }
  return s;
}`,
      3,
    ],
    [
      'a second name of a loop name reads the element too',
      `${Q}export function f(): f32 {
  const xs: array<P, 2> = [new P(), new P()];
  let s = 0.;
  for (const p of xs) { const q = p; xs[0].x = 2.; s += q.x; }
  return s;
}`,
      2,
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
      'a let second name that is assigned another object, after a write before it',
      `${Q}export function f(): f32 {
  const a = new P(); a.x = 1.; let b = a; b = new P(); return a.x + b.x;
}`,
      AGAIN('b'),
    ],
    [
      'a loop name that a function inside the loop writes',
      `${Q}export function f(): f32 {
  const xs: array<P, 2> = [new P(), new P()];
  for (const p of xs) { const g = (): void => { p.x += 1.; }; g(); }
  return xs[0].x + xs[1].x * 10.;
}`,
      /^TS8099 "p" names an element of the array, and a function inside the loop uses "p"\. A loop name that a local function captures is not supported yet \(change 0142, stage 2\)\./,
    ],
    [
      'a name declared as an object that may be absent, then written',
      `${Q}export function f(): f32 { const a = new P(); let q: P | undefined = a; q.x = 3.; return a.x; }`,
      CALLED('q', 'a'),
    ],
    [
      'one object handed as itself and as a parameter that may be absent',
      `${Q}function g(p: P | undefined, r: P): f32 { r.x = 3.; if (p !== undefined) { return p.x; } return 0.; }
export function f(): f32 { const a = new P(); return g(a, a); }`,
      /^TS8074 This call hands the object "a" names to "g" twice/,
    ],
    [
      'the result of a method called on a new object that was built around a name',
      `${Q}export function f(): f32 { const a = new P(); const q = new H(a).get1(); q.x = 3.; return a.x; }`,
      [CALLED('q', 'new H(a).get1()'), STORED('a')],
    ],
  ];
  for (const [name, body, text] of refused) {
    it(`refuses ${name}, in both halves`, () => {
      refusedAs(read(body), Array.isArray(text) ? text : [text as RegExp]);
    });
  }
});

describe('a loop reads its array once, and a name is read in its own block (change 0142)', () => {
  const Q = `class P { x: f32 = 0; y: f32 = 0; }
class H { ps: array<P, 2> = [new P(), new P()]; }
function mk(v: f32): P { const p = new P(); p.x = v; return p; }
`;
  const runs: readonly (readonly [string, string, number])[] = [
    [
      'two blocks that each declare the same two names',
      `${Q}export function f(): f32 {
  let s = 0.;
  { const a = new P(); const b = a; b.y = 1.; s += a.y; }
  { const a = new P(); let b = a; a.y += 2.; s += b.y; }
  return s;
}`,
      3,
    ],
    [
      'a loop over an array reached through an index that the body changes',
      `${Q}export function f(): f32 {
  let hs: array<H, 2> = [new H(), new H()];
  hs[0].ps[0].x = 1.; hs[0].ps[1].x = 2.; hs[1].ps[0].x = 10.; hs[1].ps[1].x = 20.;
  let k = 0;
  let s = 0.;
  for (const p of hs[k].ps) { k = 1; s += p.x; }
  return s;
}`,
      3,
    ],
    [
      'a const that takes what a function built is written like any new object',
      `${Q}export function f(): f32 { const p = mk(3.); p.y = 2.; return p.x + p.y; }`,
      5,
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

  it('reads an element that may be absent through a loop name', () => {
    const r = read(`class P { x: f32 = 0; }
function two(): array<P | undefined, 2> {
  const p = new P(); p.x = 3.; const a: array<P | undefined, 2> = [p, undefined]; return a;
}
export function f(): f32 { const xs = two(); let s = 0.; for (const q of xs) { s += q?.x ?? 7.; } return s; }`);
    expect(r.compiler).toEqual([]);
    expect(r.editor).toEqual([]);
    expect(r.value).toBe(10);
  });

  it('refuses a loop whose body assigns the holder of its array, in both halves', () => {
    const r = read(`${Q}export function f(): f32 {
  const h = new H();
  const o: array<P, 2> = [new P(), new P()];
  o[0].x = 100.;
  let s = 0.;
  for (const p of h.ps) { h.ps = o; s += p.x; }
  return s;
}`);
    refusedAs(r, [
      /^TS8099 This statement may put another object in "h\.ps" inside the loop that names its elements "p"\./,
      STORED('o'),
    ]);
  });
});
