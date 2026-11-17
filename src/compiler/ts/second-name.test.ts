// Rules 6.10, 8.8 and 12.7 (docs/language-design.md). The `Verifies:` tag of this file waits for
// the reqs/ sync that follows the rule text of Amendment A3.
//
// Change 0142, Amendment A3: a second name is the same place, and a store is a move. Each of the
// five rules is read here by both halves (`compile()` and the language service) on one source,
// and each program that compiles is run on the CPU oracle, whose number is the number JavaScript
// gives for the same source. A refusal says "not supported yet" and never compiles to a copy that
// JavaScript would not make (OD-9).

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const P = `class P { x: f32 = 0; y: f32 = 0; }
class B { c: P = new P(); k: f32 = 0; }
class H { c: P; constructor(c: P) { this.c = c; } }
function wp(p: P): void { p.x = 7.; }
function id(p: P): P { return p; }
function pick(p: P, q: P): P { return q.x > p.x ? q : p; }
function mk(v: f32): P { const p = new P(); p.x = v; return p; }
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

/** `body` compiles in both halves, and the oracle gives `expected`, which JavaScript gives too. */
function runs(body: string, expected: number): void {
  const r = read(`${P}${body}`);
  expect(r.compiler).toEqual([]);
  expect(r.editor).toEqual([]);
  expect(r.value).toBe(expected);
}

/** `body` is refused in both halves, once for each of `starts`, each beginning as given. */
function refuses(body: string, ...starts: string[]): void {
  const r = read(`${P}${body}`);
  expect(r.compiler).toHaveLength(starts.length);
  starts.forEach((s, i) => expect(r.compiler[i]!.startsWith(s), r.compiler[i]).toBe(true));
  expect(r.editor).toEqual(r.compiler);
}

const STORED = (n: string): string =>
  `TS8099 "${n}" is stored in a second place here, and it is used after that. One object under two names is not supported yet (change 0142, stage 3).`;
const NAMED = (n: string): string =>
  `TS8099 "${n}" already has a name, and this statement gives it a second place. One object under two names is not supported yet (change 0142, stage 3).`;
const CALLED = (n: string, call: string): string =>
  `TS8099 "${n}" would name an object that "${call}" gives back, which may already have a name, and the function writes an object after that. One object under two names is not supported yet (change 0142, stage 2).`;
const MOVED = (n: string, place: string): string =>
  `TS8099 "${n}" names "${place}", and this statement puts another object there while "${n}" is still used. That is not supported yet (change 0142, stage 2).`;

describe('rule 1: a second name is the same place', () => {
  it('const p = xs[i]; p.x = 9. writes the element, and let does too', () => {
    runs(
      'export function f(): f32 { const xs: array<P, 2> = [new P(), new P()]; let i = 1; const p = xs[i]; p.x = 9.; return xs[1].x * 10. + xs[0].x; }',
      90,
    );
    runs(
      'export function f(): f32 { const xs: array<P, 2> = [new P(), new P()]; let p = xs[1]; p.x = 9.; return xs[1].x; }',
      9,
    );
  });

  it('an index that is no literal is read once, where the name is declared', () => {
    runs(
      'export function f(): f32 { const xs: array<P, 2> = [new P(), new P()]; let i = 0; const p = xs[i]; i = 1; p.x = 4.; return xs[0].x * 10. + xs[1].x; }',
      40,
    );
  });

  it('a field is a place: const q = h.c; q.x = 3. writes the field', () => {
    runs(
      'export function f(): f32 { const b = new B(); const q = b.c; q.x = 3.; b.c.y = 1.; return b.c.x + q.y * 10.; }',
      13,
    );
  });

  it('this and a field of this are places in a method', () => {
    runs(
      `class W { c: P = new P(); setIt(): void { const q = this.c; q.x = 7.; const t = this; t.c.y = 2.; } }
export function f(): f32 { const w = new W(); w.setIt(); return w.c.x * 10. + w.c.y; }`,
      72,
    );
  });

  it('a second name of a second name, and a name of a parameter, name the same place', () => {
    runs(
      'export function f(): f32 { const b = new B(); const q = b.c; const r = q; r.x = 5.; return b.c.x; }',
      5,
    );
    runs(
      'function g(b: B): void { const q = b.c; q.x = 3.; }\nexport function f(): f32 { const b = new B(); g(b); return b.c.x; }',
      3,
    );
  });

  it('let b = f(a), where f returns its parameter, names the argument; the call still runs', () => {
    runs(
      'function t(p: P): P { p.y = 1.; return p; }\nexport function f(): f32 { const a = new P(); let b = t(a); b.x = 5.; return a.x * 10. + a.y; }',
      51,
    );
  });

  it('a name declared in a for header is a second name', () => {
    runs(
      'export function f(): f32 { const a = new P(); let n = 0; for (let b = a; n < 3; n++) { b.x += 1.; } return a.x; }',
      3,
    );
  });

  it('a name of a loop name, and the loop name itself, name the element', () => {
    runs(
      'export function f(): f32 { const xs: array<P, 2> = [new P(), new P()]; for (const p of xs) { const q = p; q.x = 2.; } return xs[0].x + xs[1].x; }',
      4,
    );
  });

  it('a let second name that is assigned whole later stays refused', () => {
    refuses(
      'export function f(): f32 { const a = new P(); let q = a; q = new P(); q.x = 1.; return a.x; }',
      'TS8099 "q" is a second name of an object that already has a name, and "q" is assigned again later.',
    );
  });

  it('a second name that a function inside the body uses stays refused', () => {
    refuses(
      'export function f(): f32 { const a = new P(); const q = a; const g = (): void => { q.x = 1.; }; g(); return a.x; }',
      'TS8099 "q" is a second name of an object that already has a name, and a function inside this one uses "q".',
    );
  });
});

describe('rule 2: a store is a move', () => {
  it('a local that is not used after the statement may be stored', () => {
    runs(
      'export function f(): f32 { const a = new P(); a.x = 3.; const xs: array<P, 2> = [new P(), new P()]; xs[1] = a; return xs[1].x; }',
      3,
    );
    runs(
      'export function f(): f32 { const a = new P(); a.x = 3.; const b = new B(); b.c = a; return b.c.x; }',
      3,
    );
    runs(
      'export function f(): f32 { const a = new P(); a.x = 3.; const h = new H(a); return h.c.x; }',
      3,
    );
    runs(
      'export function f(): f32 { const a = new P(); a.x = 3.; const o = { c: a }; return o.c.x; }',
      3,
    );
  });

  it('is refused where the object is used after the statement', () => {
    refuses(
      'export function f(): f32 { const a = new P(); const xs: array<P, 2> = [new P(), new P()]; xs[0] = a; return a.x + xs[0].x; }',
      STORED('a'),
    );
    refuses(
      'export function f(): f32 { const a = new P(); const h = new H(a); a.x = 2.; return h.c.x; }',
      STORED('a'),
    );
    refuses(
      'export function f(): f32 { const a = new P(); const xs: array<P, 2> = [a, new P()]; return a.x + xs[0].x; }',
      STORED('a'),
    );
    refuses(
      'export function f(): f32 { const a = new P(); const b = new B(); b.c = a; a.x = 1.; return b.c.x; }',
      STORED('a'),
    );
  });

  it('is refused where the object is stored in a loop that does not declare it', () => {
    refuses(
      'export function f(): f32 { const xs: array<P, 2> = [new P(), new P()]; const p = new P(); for (let i = 0; i < 2; i++) { xs[i] = p; } return xs[0].x; }',
      STORED('p'),
    );
    runs(
      'export function f(): f32 { const xs: array<P, 2> = [new P(), new P()]; for (let i = 0; i < 2; i++) { const p = new P(); p.x = f32(i) + 1.; xs[i] = p; } return xs[0].x * 10. + xs[1].x; }',
      12,
    );
  });

  it('is refused where the value is no bare local of the function', () => {
    refuses(
      'function s(xs: array<P, 2>, p: P): void { xs[0] = p; }\nexport function f(): f32 { const xs: array<P, 2> = [new P(), new P()]; s(xs, new P()); return xs[0].x; }',
      NAMED('p'),
    );
    refuses(
      'export function f(): f32 { const xs: array<P, 2> = [new P(), new P()]; xs[0] = xs[1]; return xs[0].x; }',
      NAMED('xs[1]'),
    );
    refuses(
      'export function f(): f32 { const b = new B(); const q = b.c; const xs: array<P, 1> = [new P()]; xs[0] = q; return xs[0].x; }',
      NAMED('q'),
    );
    refuses(
      'export function f(): f32 { const xs: array<P, 1> = [new P()]; const h = new B(); h.c = id(xs[0]); return h.c.x; }',
      NAMED('id(xs[0])'),
    );
  });

  it('is refused for a whole assignment to an existing name that still holds a name', () => {
    refuses(
      'export function f(): f32 { const a = new P(); let q = new P(); q = a; q.x = 5.; return a.x; }',
      STORED('a'),
    );
    runs(
      'export function f(): f32 { const a = new P(); a.x = 4.; let q = new P(); q = a; return q.x; }',
      4,
    );
  });

  it('a push and a fill of an object are stores', () => {
    refuses(
      'export function f(): f32 { const a = new P(); const xs: array<P, 1> = [new P()]; xs.fill(a); a.x = 1.; return xs[0].x; }',
      STORED('a'),
    );
    refuses(
      'export function f(): f32 { const xs: array<P, 2> = [new P(), new P()]; xs.fill(new P()); return xs[0].x; }',
      'TS8099 "xs.fill(new P())" puts one object in every element',
    );
  });

  it('a list assignment that only puts the same names in another order is no store', () => {
    runs(
      'export function f(): f32 { let a = new P(); let b = new P(); a.x = 1.; [a, b] = [b, a]; b.x += 5.; return a.x * 10. + b.x; }',
      6,
    );
    refuses(
      'export function f(): f32 { let a = new P(); let b = new P(); a.x = 1.; [a, b] = [a, a]; b.x += 5.; return a.x; }',
      STORED('a'),
      STORED('a'),
    );
  });

  it("a constructor stores its own parameter in this, where the caller's new moved it", () => {
    runs('export function f(): f32 { const h = new H(mk(4.)); return h.c.x; }', 4);
  });
});

describe('rule 3: a new object is one the source shows to be new', () => {
  it('new, a literal, structuredClone, slice of values, and a function that built what it returns', () => {
    runs(
      'export function f(): f32 { const xs: array<P, 2> = [new P(), { x: 2., y: 0. }]; const p = mk(3.); xs[0] = p; return xs[0].x + xs[1].x; }',
      5,
    );
    runs(
      'export function f(): f32 { const a: array<f32, 3> = [1., 2., 3.]; const b = a.slice(); b[0] = 9.; return a[0] * 10. + b[0]; }',
      19,
    );
    runs(
      'interface S { x: f32; y: f32 }\nexport function f(): f32 { const a: S = { x: 1., y: 2. }; const b = structuredClone(a); b.x = 9.; return a.x * 10. + b.x; }',
      19,
    );
  });

  it('the result of a function that may give back a parameter is not new', () => {
    refuses(
      'export function f(): f32 { const a = new P(); const b = new B(); b.c = id(a); return b.c.x; }',
      NAMED('id(a)'),
    );
  });
});

describe('rule 4: the result of any other call that gives an object', () => {
  it('may be read directly', () => {
    runs(
      'export function f(): f32 { const a = new P(); const b = new P(); b.x = 2.; let s = 0.; s += pick(a, b).x; a.x = 1.; return s + pick(a, b).x; }',
      4,
    );
  });

  it('may be named by a const where the function writes no object after it', () => {
    runs(
      'export function f(): f32 { const a = new P(); const b = new P(); b.x = 2.; const c = pick(a, b); return c.x; }',
      2,
    );
  });

  it('is refused for a const where the function writes an object after', () => {
    refuses(
      'export function f(): f32 { const a = new P(); const b = new P(); const c = pick(a, b); c.x = 1.; return a.x; }',
      CALLED('c', 'pick(a, b)'),
    );
    refuses(
      'export function f(): f32 { const a = new P(); const b = new P(); const c = pick(a, b); a.x = 1.; return c.x; }',
      CALLED('c', 'pick(a, b)'),
    );
  });

  it('is refused for a let', () => {
    refuses(
      'export function f(): f32 { const a = new P(); const b = new P(); let c = pick(a, b); return c.x; }',
      CALLED('c', 'pick(a, b)'),
    );
  });

  it('is refused as the argument of a function that writes its parameter', () => {
    refuses(
      'export function f(): f32 { const a = new P(); wp(pick(a, a)); return a.x; }',
      'TS8073 "wp" writes its parameter "p", and "pick(a, a)" may be an object that already has a name.',
    );
  });
});

describe('rule 5: a place that a second name names must stay', () => {
  it('a statement that puts another object there while the name is read is refused', () => {
    refuses(
      'export function f(): f32 { const ps: array<P, 2> = [new P(), new P()]; ps[0].x = 3.; const q = ps[0]; ps[0] = new P(); return q.x; }',
      MOVED('q', 'ps[0]'),
    );
    refuses(
      'export function f(): f32 { const b = new B(); const q = b.c; b.c = new P(); return q.x; }',
      MOVED('q', 'b.c'),
    );
    refuses(
      'function reset(ps: array<P, 2>): void { ps[0] = new P(); }\nexport function f(): f32 { const ps: array<P, 2> = [new P(), new P()]; const q = ps[0]; reset(ps); return q.x; }',
      MOVED('q', 'ps[0]'),
    );
  });

  it('is refused where a loop holds the statement and the name is read in it', () => {
    refuses(
      'export function f(): f32 { const ps: array<P, 2> = [new P(), new P()]; const q = ps[0]; let s = 0.; for (let i = 0; i < 2; i++) { s += q.x; ps[0] = new P(); } return s; }',
      MOVED('q', 'ps[0]'),
    );
  });

  it('the right side is read before the place is assigned: const p = ps[i]; ps[i] = { … p … }', () => {
    runs(
      'export function f(): f32 { const ps: array<P, 2> = [new P(), new P()]; ps[1].x = 3.; ps[1].y = 2.; let i = 1; const p = ps[i]; ps[i] = { x: p.x + p.y, y: p.y }; return ps[1].x * 10. + ps[1].y; }',
      52,
    );
  });
});

describe('the three examples of the amendment', () => {
  it('accepted before and after: read an element, then put a new object in its place', () => {
    runs(
      'export function f(): f32 { const ps: array<P, 2> = [new P(), new P()]; ps[0].x = 2.; ps[0].y = 3.; const i = 0; const p = ps[i]; ps[i] = { x: p.x + p.y * 2., y: p.y }; return ps[0].x * 10. + ps[0].y; }',
      83,
    );
  });

  it('accepted before, refused now: the object is read after it is stored', () => {
    refuses(
      'export function f(): f32 { const a = new P(); const xs: array<P, 1> = [new P()]; xs[0] = a; return a.x + xs[0].x; }',
      STORED('a'),
    );
  });

  it('refused before, accepted now: a name of an element writes the element', () => {
    runs(
      'export function f(): f32 { const ps: array<P, 2> = [new P(), new P()]; const i = 1; const p = ps[i]; p.x = 9.; return ps[i].x; }',
      9,
    );
  });
});

describe('rule 6: an object of a type that is never written is a copy', () => {
  /** `body` compiles in both halves and the oracle gives `expected`. */
  const compiles = (body: string, expected: number): void => {
    const r = read(body);
    expect(r.compiler).toEqual([]);
    expect(r.editor).toEqual([]);
    expect(r.value).toBe(expected);
  };
  /** `body` is refused in both halves, once for each of `starts`. */
  const refused = (body: string, ...starts: string[]): void => {
    const r = read(body);
    expect(r.compiler).toHaveLength(starts.length);
    starts.forEach((t, i) => expect(r.compiler[i]!.startsWith(t), r.compiler[i]).toBe(true));
    expect(r.editor).toEqual(r.compiler);
  };

  const SCENE = (leaf: string): string => `class Leaf { v: f32 = 1.; ${leaf} }
class Holder { a: Leaf; b: Leaf; constructor(a: Leaf, b: Leaf) { this.a = a; this.b = b; } }
class Scene {
  l: Leaf = new Leaf();
  m: Leaf = new Leaf();
  h: Holder;
  constructor() { this.h = new Holder(this.l, this.m); }
}
export function f(): f32 { const s = new Scene(); return s.h.a.v + s.h.b.v * 10. + s.l.v * 100.; }`;

  it('a holder built around two fields of this, of a class nothing writes, compiles', () => {
    compiles(SCENE(''), 111);
  });

  it('is refused where a method writes the shared class somewhere else in the file', () => {
    refused(SCENE('bump(): void { this.v += 1.; }'), NAMED('this.l'), NAMED('this.m'));
  });

  it('a type written only in its own constructor is never written', () => {
    compiles(
      `class T { x: f32; constructor(x: f32) { this.x = x; } }
export function f(): f32 { const a = new T(1.); const xs: array<T, 2> = [a, new T(2.)]; return a.x + xs[0].x; }`,
      2,
    );
  });

  it('a type whose nested field type is written is written', () => {
    const OUT = `class In { n: f32 = 0.; }
class Out { i: In = new In(); }
`;
    compiles(
      `${OUT}export function f(): f32 { const a = new Out(); const xs: array<Out, 2> = [a, new Out()]; return a.i.n + xs[0].i.n; }`,
      0,
    );
    refused(
      `${OUT}export function f(): f32 { const a = new Out(); const xs: array<Out, 2> = [a, new Out()]; const q = new In(); q.n = 5.; return a.i.n + xs[0].i.n; }`,
      STORED('a'),
    );
  });

  it('a conditional of null and a name compiles where no array of that type is written', () => {
    compiles(
      `class P { x: f32 = 0; }
export function f(): f32 {
  const items: array<f32, 2> = [3., 4.];
  const p = new P();
  const c = items[0] > 9.;
  const m: array<f32, 2> | null = c ? null : items;
  p.x = 1.;
  return (m?.[1] ?? 0.) + p.x;
}`,
      5,
    );
  });

  it('is refused where an array of that type is written elsewhere', () => {
    refused(
      `export function f(): f32 {
  const items: array<f32, 2> = [3., 4.];
  const other: array<f32, 2> = [0., 0.];
  const c = items[0] > 9.;
  const m: array<f32, 2> | null = c ? null : items;
  other[0] = 1.;
  return (m?.[1] ?? 0.) + other[0];
}`,
      CALLED('m', 'c ? null : items'),
    );
  });
});
