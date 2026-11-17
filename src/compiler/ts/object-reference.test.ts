// Verifies: Rule 6.10, Rule 8.8, Rule 8.25, Rule 12.7 (docs/language-design.md; traced in reqs/).
//
// An object has the identity a JavaScript object has (change 0142, stage 1): a struct, an instance
// of a class and an array are passed, named and iterated as JavaScript passes, names and iterates
// them. Each row of the proposal's Table 1 that stage 1 implements is read here by both halves
// (`compile()` and the language service) on one source, and run on the CPU oracle, whose result
// is the number JavaScript gives for the same program. A row of a later stage is read as its
// "not supported yet" refusal, in both halves.

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const P = `class P { x: f32 = 0; bump(): void { this.x += 1.; } }
function nudge(p: P): void { p.x += 1.; }
`;

/** The errors of each half on `body`, and what `f()` gives on the CPU oracle. */
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

describe('an object is passed, named and iterated as JavaScript does (change 0142, stage 1)', () => {
  const runs: readonly (readonly [string, string, number])[] = [
    [
      "a function that writes a field of its parameter changes the caller's object",
      `${P}export function f(): f32 { let a = new P(); nudge(a); return a.x; }`,
      1,
    ],
    [
      "a function that hands its parameter on changes the caller's object",
      `${P}function outer(q: P): void { nudge(q); nudge(q); }
export function f(): f32 { let a = new P(); outer(a); return a.x; }`,
      2,
    ],
    [
      'a method that writes its object, called on a parameter',
      `${P}function g(q: P): void { q.bump(); }
export function f(): f32 { let a = new P(); g(a); return a.x; }`,
      1,
    ],
    [
      'an array with a size is an object',
      `function h(a: array<f32, 2>): void { a[0] = 1.; }
export function f(): f32 { let a: array<f32, 2> = [0., 0.]; h(a); return a[0]; }`,
      1,
    ],
    [
      'an element of an array is the place',
      `${P}export function f(): f32 { let ps: array<P, 2> = [new P(), new P()]; nudge(ps[1]); return ps[1].x; }`,
      1,
    ],
    [
      'a const that holds an object is written through',
      `${P}export function f(): f32 { const a = new P(); nudge(a); a.x += 1.; return a.x; }`,
      2,
    ],
    [
      'a value nothing holds is held for the call',
      `${P}function made(p: P): f32 { p.x = 4.; return p.x; }
export function f(): f32 { return made(new P()); }`,
      4,
    ],
    [
      'a parameter assigned whole names a local from then on',
      `${P}function fresh(p: P): f32 { p = new P(); p.x += 1.; return p.x; }
export function f(): f32 { let a = new P(); a.x = 7.; return fresh(a) + a.x; }`,
      8,
    ],
    [
      'a const second name writes the object it names',
      `${P}export function f(): f32 { let a = new P(); const q = a; q.x = 1.; return a.x; }`,
      1,
    ],
    [
      'a let second name writes the object it names',
      `${P}export function f(): f32 { let a = new P(); let q = a; q.x = 1.; return a.x; }`,
      1,
    ],
    [
      'a second name sees a write through the first',
      `${P}export function f(): f32 { let a = new P(); const q = a; a.x = 7.; return q.x; }`,
      7,
    ],
    [
      "a second name of a parameter makes the parameter the caller's object",
      `${P}function h(p: P): void { const q = p; q.x = 3.; }
export function f(): f32 { let a = new P(); h(a); return a.x; }`,
      3,
    ],
    [
      'a name that nothing writes through is a copy with the same result',
      `${P}export function f(): f32 { let a = new P(); a.x = 5.; const q = a; return q.x; }`,
      5,
    ],
    [
      'for…of names each element, written by an assignment',
      `${P}export function f(): f32 { let ps: array<P, 2> = [new P(), new P()]; for (const p of ps) { p.x = 3.; } return ps[0].x + ps[1].x; }`,
      6,
    ],
    [
      'for…of names each element, written by a method and by a function',
      `${P}export function f(): f32 { let ps: array<P, 2> = [new P(), new P()]; for (const p of ps) { p.bump(); nudge(p); } return ps[0].x + ps[1].x; }`,
      4,
    ],
    [
      "for…of over a parameter makes the parameter the caller's array",
      `${P}function all(ps: array<P, 2>): void { for (const p of ps) { p.x = 5.; } }
export function f(): f32 { let ps: array<P, 2> = [new P(), new P()]; all(ps); return ps[0].x + ps[1].x; }`,
      10,
    ],
    [
      'for…of over numbers gives values: a write to the name stays in the loop',
      `export function f(): f32 { let xs: array<f32, 2> = [1., 2.]; for (let x of xs) { x = x + 1.; } return xs[0]; }`,
      1,
    ],
    [
      'slice() is a new array of values',
      `export function f(): f32 { let s: array<f32, 3> = [1., 2., 3.]; let r = s.slice(); r[0] = 9.; return s[0] + r[0]; }`,
      10,
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

  it('passes the place: a pointer on WGSL', () => {
    const r = compile(
      `"use typeshade";
${P}declare const dst: storage<array<f32>, "read_write">;
@compute([1]) export function main(): void { let a = new P(); nudge(a); dst[0] = a.x; }
`,
      { fileName: 'm.shade.ts' },
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('fn nudge(p: ptr<function, P>)');
    expect(r.wgsl).toContain('nudge(&a);');
  });
});

describe('a function gives back two values through a list (change 0142, decision 8)', () => {
  const runs: readonly (readonly [string, string, number])[] = [
    [
      "two names take the two elements of a function's result",
      `function order(lo: f32, hi: f32): [f32, f32] { return lo > hi ? [hi, lo] : [lo, hi]; }
export function f(): f32 { let a: f32 = 5.; let b: f32 = 2.; [a, b] = order(a, b); return a * 10. + b; }`,
      25,
    ],
    [
      'the list is read before a name is written: a swap',
      `export function f(): f32 { let p: f32 = 1.; let q: f32 = 3.; [p, q] = [q, p]; return p * 10. + q; }`,
      31,
    ],
    [
      'a field is a target',
      `class Q { x: f32 = 0; y: f32 = 0; }
function two(): [f32, f32] { return [4., 6.]; }
export function f(): f32 { let p = new Q(); [p.x, p.y] = two(); return p.x * 10. + p.y; }`,
      46,
    ],
    [
      'a list assignment is a first assignment of its names',
      `function two(): [f32, f32] { return [4., 6.]; }
export function f(): f32 { let a: f32; let b: f32; [a, b] = two(); return a + b; }`,
      10,
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

  it('refuses a const among the names, in both halves', () => {
    const r = read(`function two(): [f32, f32] { return [4., 6.]; }
export function f(): f32 { const a: f32 = 1.; let b: f32 = 0.; [a, b] = two(); return a + b; }`);
    expect(r.compiler).toEqual(['TS8005 Cannot assign to "a" — it is declared with const.']);
    expect(r.editor).toEqual(r.compiler);
  });

  it('refuses a list that is too short, in both halves', () => {
    const r = read(`function one(): [f32] { return [4.]; }
export function f(): f32 { let a: f32 = 0.; let b: f32 = 0.; [a, b] = one(); return a + b; }`);
    expect(r.compiler).toHaveLength(1);
    expect(r.compiler[0]).toMatch(/^TS\d+ /);
    expect(r.editor.length).toBeGreaterThan(0);
  });
});

describe('one object under two names (change 0142, Table 1)', () => {
  const ID = `${P}function id(p: P): P { return p; }
function touched(p: P): P { p.x = 1.; return p; }
`;
  const runs: readonly (readonly [string, string, number])[] = [
    [
      'the result of a function that returns its parameter is the argument',
      `${ID}export function f(): f32 { let a = new P(); let b = id(a); b.x = 5.; return a.x; }`,
      5,
    ],
    [
      'the call still runs for what it writes',
      `${ID}export function f(): f32 { let a = new P(); const b = touched(a); b.x += 4.; return a.x; }`,
      5,
    ],
    [
      'a result nothing writes is read as a copy, with the same result',
      `${ID}export function f(): f32 { let a = new P(); a.x = 2.; let b = id(a); return a.x + b.x; }`,
      4,
    ],
    [
      'an object written before it is stored is stored as it is',
      `${P}export function f(): f32 {
  let xs: array<P, 2> = [new P(), new P()];
  for (let i = 0; i < 2; i++) { let p = new P(); p.x = f32(i) + 1.; xs[i] = p; }
  return xs[0].x * 10. + xs[1].x;
}`,
      12,
    ],
    [
      'an assignment to the place itself puts another object there',
      `${P}export function f(): f32 {
  let xs: array<P, 2> = [new P(), new P()];
  xs[0].x = 3.;
  const q = xs[0];
  xs[0] = new P();
  return q.x * 10. + xs[0].x;
}`,
      30,
    ],
    [
      'a write to another field leaves the object named as it was',
      `class B { c: P = new P(); k: f32 = 0; }
${P}export function f(): f32 { let b = new B(); const q = b.c; b.k = 3.; return q.x + b.k; }`,
      3,
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

  it('reads a number from a uniform as a value: a field that takes it holds no object', () => {
    const source = `"use typeshade";
${P}declare const k: uniform<f32>;
export function f(): f32 { let a = new P(); a.x = k; nudge(a); return a.x + k; }
`;
    expect(compile(source).diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    const service = createTypeshadeLanguageService();
    service.openDocument('m.shade.ts', source);
    expect(service.getDiagnostics('m.shade.ts').filter((d) => d.severity === 'error')).toEqual([]);
  });

  const refused: readonly (readonly [string, string, RegExp])[] = [
    [
      'a name assigned another name, then written',
      `${P}export function f(): f32 { let a = new P(); let q = new P(); q = a; q.x = 5.; return a.x; }`,
      /^TS8099 "q" would name the object "a" names, and "q" is written after that\. One object under two names is not supported yet \(change 0142, stage 2\): a copy here would not show the write through "a"\./,
    ],
    [
      'an element that holds a name, then the name written',
      `${P}export function f(): f32 {
  let a = new P(); let xs: array<P, 2> = [new P(), new P()]; xs[0] = a; a.x = 5.; return xs[0].x;
}`,
      /^TS8099 "xs" would hold the object "a" names, and "a" is written after that\. One object under two names is not supported yet \(change 0142, stage 3\)/,
    ],
    [
      'a list that holds a name twice, then written',
      `${P}export function f(): f32 {
  let a = new P(); let xs: array<P, 2> = [a, a]; xs[0].x = 5.; return a.x + xs[1].x;
}`,
      /^TS8099 "xs" would hold the object "a" names, and "xs" is written after that\./,
    ],
    [
      'an object built around a name, then the name written',
      `class B { c: P; constructor(c: P) { this.c = c; } }
${P}export function f(): f32 { let a = new P(); let b = new B(a); a.x = 5.; return b.c.x; }`,
      /^TS8099 "b" would hold the object "a" names, and "a" is written after that\./,
    ],
    [
      'an element named, then written through the array',
      `${P}export function f(): f32 {
  let xs: array<P, 2> = [new P(), new P()]; const q = xs[0]; xs[0].x = 5.; return q.x;
}`,
      /^TS8099 "q" would name the object "xs" names, and "xs" is written after that\./,
    ],
    [
      'a variable stored at each turn of a loop and written at each',
      `${P}export function f(): f32 {
  let xs: array<P, 2> = [new P(), new P()];
  let p = new P();
  for (let i = 0; i < 2; i++) { p.x = f32(i) + 1.; xs[i] = p; }
  return xs[0].x;
}`,
      /^TS8099 "xs" would hold the object "p" names, and "p" is written after that\./,
    ],
    [
      'the result of a function that returns its parameter, passed on to be written',
      `${ID}export function f(): f32 { let a = new P(); nudge(id(a)); return a.x; }`,
      /^TS8073 "nudge" writes its parameter "p", and "id\(a\)" may be the object "a" names\. Passing it on from an expression is not supported yet \(change 0142, stage 2\): name it first, const r = id\(a\), and pass r\.$/,
    ],
  ];
  for (const [name, body, text] of refused) {
    it(`refuses ${name}, in both halves`, () => {
      const r = read(body);
      expect(r.compiler).toHaveLength(1);
      expect(r.compiler[0]).toMatch(text);
      expect(r.editor).toEqual(r.compiler);
    });
  }
});

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

// Each program here compiled to a result JavaScript does not give, with no diagnostic, at
// 497efc30. A review that ran each program as JavaScript too found them. Both halves read each
// one, and the oracle's number is the one JavaScript gives.
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

  const refused: readonly (readonly [string, string, RegExp])[] = [
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
      /^TS8099 "d" would hold the object "a" names, and "d" is written after that\./,
    ],
    [
      'an element that holds a name, written through a loop name',
      `${Q}export function f(): f32 {
  let a = new P(); let ps: array<P, 2> = [new P(), new P()]; ps[0] = a;
  for (const p of ps) { p.x += 1.; }
  return a.x;
}`,
      /^TS8099 "ps" would hold the object "a" names, and "ps" is written after that\./,
    ],
    [
      'a stored object written by a function declared before the store',
      `${Q}export function f(): f32 {
  let a = new P(); let b = new B(); const g = (): void => { a.x = 1.; }; b.c = a; g(); return b.c.x;
}`,
      /^TS8099 "b" would hold the object "a" names, and "a" is written after that\./,
    ],
    [
      'a second name that a local function writes',
      `${Q}export function f(): f32 {
  let a = new P(); let q = a; const g = (): void => { q.x = 1.; }; g(); return a.x;
}`,
      /^TS8099 "q" is a second name of the object "a" names, and a function inside this one uses "q"\. A second name that a local function captures is not supported yet \(change 0142, stage 2\)\. Use "a" in that function\.$/,
    ],
    [
      'a list that gives one object to two names',
      `${Q}export function f(): f32 {
  let a = new P(); let b = new P(); a.x = 1.; [a, b] = [a, a]; b.x += 5.; return a.x;
}`,
      /^TS8099 "b" would name the object "a" names, and "b" is written after that\./,
    ],
  ];
  for (const [name, body, text] of refused) {
    it(`refuses ${name}, in both halves`, () => {
      const r = read(body);
      expect(r.compiler).toHaveLength(1);
      expect(r.compiler[0]).toMatch(text);
      expect(r.editor).toEqual(r.compiler);
    });
  }
});

// The programs of a second review, at 1967abb3: each gave a result JavaScript does not give.
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

  const refused: readonly (readonly [string, string, RegExp])[] = [
    [
      'one object handed twice to a function that writes one and reads the other',
      `${Q}function w(p: P, q: P): f32 { p.x = 5.; return q.x; }
export function f(): f32 { const a = new P(); return w(a, a); }`,
      /^TS8074 This call hands "a" to "w" twice, and "w" writes one of the two: one object under two names inside "w", which is not supported yet \(change 0142, stage 2\)\./,
    ],
    [
      'a const that holds a name in a field, written through the field',
      `${Q}export function f(): f32 { const p = new P(); const h = new H(p); h.c.x = 5.; return p.x; }`,
      /^TS8099 "h" would hold the object "p" names, and "h" is written after that\./,
    ],
    [
      'a name a pattern takes from a field, then written',
      `${Q}export function f(): f32 { const b = new B(); let { c } = b; c.x = 5.; return b.c.x; }`,
      /^TS8099 "c" would name the object "b" names, and "c" is written after that\./,
    ],
    [
      'two names a pattern takes from one object',
      `${Q}export function f(): f32 { const a = new P(); let [p, q] = [a, a]; p.x = 5.; return q.x; }`,
      /^TS8099 "p" would name the object "a" names, and "p" is written after that\./,
    ],
    [
      'an object whose name another block declares first as a number',
      `${Q}export function f(): f32 {
  { const a = 1.; }
  { const a = new P(); let xs: array<P, 1> = [new P()]; xs[0] = a; a.x = 5.; return xs[0].x; }
  return 0.;
}`,
      /^TS8099 "xs" would hold the object "a" names, and "a" is written after that\./,
    ],
    [
      'a second name of this, read after a write through this',
      `class S { x: f32 = 0; m(): f32 { const s = this; this.x = 5.; return s.x; } }
export function f(): f32 { const a = new S(); return a.m(); }`,
      /^TS8099 "s" would name the object "this" names, and "this" is written after that\./,
    ],
    [
      'a name of an element, read at the field a later write changes',
      `class E { pos: f32 = 1; tag: f32 = 2; }
export function f(): f32 {
  let es: array<E, 2> = [new E(), new E()]; const p = es[0]; es[0].pos = 9.; return p.pos;
}`,
      /^TS8099 "p" would name the object "es" names, and "es" is written after that\./,
    ],
  ];
  for (const [name, body, text] of refused) {
    it(`refuses ${name}, in both halves`, () => {
      const r = read(body);
      expect(r.compiler).toHaveLength(1);
      expect(r.compiler[0]).toMatch(text);
      expect(r.editor).toEqual(r.compiler);
    });
  }
});

describe('a value stays a value (change 0142, decision 1)', () => {
  it('refuses a write through a vector parameter, in both halves', () => {
    const r = read(`function h(v: vec3f): f32 { v.x = 1.; return v.x; }
export function f(): f32 { return h(vec3f(0.)); }`);
    expect(r.compiler).toHaveLength(1);
    expect(r.compiler[0]).toMatch(/^TS8018 Cannot write through parameter "v"/);
    expect(r.editor).toEqual(r.compiler);
  });
});

describe('a form of a later stage is refused as not supported yet (change 0142, OD-9)', () => {
  it('a second name that is assigned again, in both halves', () => {
    const r = read(
      `${P}export function f(): f32 { let a = new P(); let q = a; q = new P(); q.x = 1.; return a.x; }`,
    );
    expect(r.compiler).toEqual([
      'TS8099 "q" is a second name of the object "a" names, and "q" is assigned again later. ' +
        'Following which object each name then refers to is not supported yet (change 0142, ' +
        'stage 2). Give "q" its own variable for the second object.',
    ]);
    expect(r.editor).toEqual(r.compiler);
  });

  it('slice() of an array of objects, in both halves', () => {
    const r = read(
      `${P}export function f(): f32 { let ps: array<P, 2> = [new P(), new P()]; let qs = ps.slice(); return qs[0].x; }`,
    );
    expect(r.compiler).toHaveLength(1);
    expect(r.compiler[0]).toMatch(
      /^TS8099 "ps\.slice\(\)" gives a new array of the same objects, .* not supported yet \(change 0142, stage 3\)/,
    );
    expect(r.editor).toEqual(r.compiler);
  });
});

describe('@inout and @out are removed (change 0142, decision 8)', () => {
  const OBJECT = (q: string): string =>
    `"@${q}" was removed (change 0142): an object parameter is the caller's object with no mark. Delete "@${q}".`;
  const VALUE = (q: string): string =>
    `"@${q}" was removed (change 0142): a number, a bool, a vector and a matrix are values. ` +
    `Return the value, and write [a, b] = f(a, b) for more than one.`;

  const refused: readonly (readonly [string, string, string])[] = [
    [
      '@inout on an array',
      `function h(@inout a: array<f32, 2>): void { a[0] = 1.; }
export function f(): f32 { let a: array<f32, 2> = [0., 0.]; h(a); return a[0]; }`,
      OBJECT('inout'),
    ],
    [
      '@out on a struct',
      `${P}function h(@out p: P): void { p.x = 1.; }
export function f(): f32 { let a = new P(); h(a); return a.x; }`,
      OBJECT('out'),
    ],
    [
      '@inout on a number',
      `function h(@inout v: f32): void { v += 1.; }
export function f(): f32 { let a = 0.; h(a); return a; }`,
      VALUE('inout'),
    ],
    [
      '@out on a vector',
      `function h(@out v: vec3): void { v = vec3(1., 2., 3.); }
export function f(): f32 { let a = vec3(0., 0., 0.); h(a); return a.x; }`,
      VALUE('out'),
    ],
  ];
  for (const [name, body, text] of refused) {
    it(`refuses ${name} with one TS8073 at the decorator, in both halves`, () => {
      const { compiler, editor } = read(body);
      expect(compiler).toEqual([`TS8073 ${text}`]);
      expect(editor).toEqual([`TS8073 ${text}`]);
    });
  }

  it('refuses the type form with the removal sentence, in both halves', () => {
    const body = `function h(a: inout<array<f32, 2>>): void { a[0] = 1.; }
export function f(): f32 { let a: array<f32, 2> = [0., 0.]; h(a); return a[0]; }`;
    const { compiler, editor } = read(body);
    expect(compiler).toHaveLength(1);
    expect(compiler[0]).toMatch(/^TS8028 "inout<array<f32, 2>>" was removed \(change 0142\)/);
    expect(editor).toEqual(compiler);
  });

  it('lowers a refused object parameter as one with no qualifier, which the function writes', () => {
    const r = compile(
      `"use typeshade";\nfunction h(@inout a: array<f32, 2>): void { a[0] = 1.; }\nexport function f(): f32 { let a: array<f32, 2> = [0., 0.]; h(a); return a[0]; }\n`,
      { fileName: 'm.shade.ts' },
    );
    expect(r.diagnostics.filter((d) => d.category === 'error').map((d) => d.code)).toEqual([
      'TS8073',
    ]);
  });
});
