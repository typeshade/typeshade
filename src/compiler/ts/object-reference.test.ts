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

const MOVED = (name: string, place: string): RegExp =>
  new RegExp(
    `^TS8099 "${esc(name)}" names "${esc(place)}", and this statement puts another object there while "${esc(name)}" is still used\\. That is not supported yet \\(change 0142, stage 2\\)\\. Read what you need from "${esc(name)}" before this statement\\.$`,
  );

function refusedAs(r: ReturnType<typeof read>, want: readonly RegExp[]): void {
  expect(r.compiler).toHaveLength(want.length);
  want.forEach((w, i) => expect(r.compiler[i]).toMatch(w));
  expect(r.editor).toEqual(r.compiler);
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
      'a name of an element sees a write through the array',
      `${P}export function f(): f32 {
  let xs: array<P, 2> = [new P(), new P()]; const q = xs[0]; xs[0].x = 5.; return q.x;
}`,
      5,
    ],
    [
      'a name of an element writes the element',
      `${P}export function f(): f32 {
  const ps: array<P, 2> = [new P(), new P()]; let i = 1; const p = ps[i]; p.x = 9.; i = 0; return ps[1].x + ps[0].x;
}`,
      9,
    ],
    [
      'a let name of an element writes the element',
      `${P}export function f(): f32 {
  const ps: array<P, 2> = [new P(), new P()]; let p = ps[1]; p.x = 9.; return ps[1].x;
}`,
      9,
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

  const refused: readonly (readonly [string, string, RegExp | readonly RegExp[]])[] = [
    [
      'an assignment to the place itself puts another object there, while the name is read',
      `${P}export function f(): f32 {
  let xs: array<P, 2> = [new P(), new P()];
  xs[0].x = 3.;
  const q = xs[0];
  xs[0] = new P();
  return q.x * 10. + xs[0].x;
}`,
      MOVED('q', 'xs[0]'),
    ],
    [
      'a name assigned another name, then written',
      `${P}export function f(): f32 { let a = new P(); let q = new P(); q = a; q.x = 5.; return a.x; }`,
      STORED('a'),
    ],
    [
      'an element that holds a name, then the name written',
      `${P}export function f(): f32 {
  let a = new P(); let xs: array<P, 2> = [new P(), new P()]; xs[0] = a; a.x = 5.; return xs[0].x;
}`,
      STORED('a'),
    ],
    [
      'a list that holds a name twice, then written',
      `${P}export function f(): f32 {
  let a = new P(); let xs: array<P, 2> = [a, a]; xs[0].x = 5.; return a.x + xs[1].x;
}`,
      [STORED('a'), STORED('a')],
    ],
    [
      'an object built around a name, then the name written',
      `class B { c: P; constructor(c: P) { this.c = c; } }
${P}export function f(): f32 { let a = new P(); let b = new B(a); a.x = 5.; return b.c.x; }`,
      STORED('a'),
    ],
    [
      'a variable stored at each turn of a loop and written at each',
      `${P}export function f(): f32 {
  let xs: array<P, 2> = [new P(), new P()];
  let p = new P();
  for (let i = 0; i < 2; i++) { p.x = f32(i) + 1.; xs[i] = p; }
  return xs[0].x;
}`,
      STORED('p'),
    ],
    [
      'the result of a function that returns its parameter, passed on to be written',
      `${ID}export function f(): f32 { let a = new P(); nudge(id(a)); return a.x; }`,
      /^TS8073 "nudge" writes its parameter "p", and "id\(a\)" may be an object that already has a name\. Passing it on from an expression is not supported yet \(change 0142, stage 2\): name it first, const r = id\(a\), and pass r\.$/,
    ],
  ];
  for (const [name, body, text] of refused) {
    it(`refuses ${name}, in both halves`, () => {
      refusedAs(read(body), Array.isArray(text) ? text : [text as RegExp]);
    });
  }
});
