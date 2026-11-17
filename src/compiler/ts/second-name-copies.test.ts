// Verifies: Rule 6.10, Rule 8.8, Rule 12.7 (docs/language-design.md; traced in reqs/).

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

function runs(body: string, expected: number): void {
  const r = read(`${P}${body}`);
  expect(r.compiler).toEqual([]);
  expect(r.editor).toEqual([]);
  expect(r.value).toBe(expected);
}

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
  const compiles = (body: string, expected: number): void => {
    const r = read(body);
    expect(r.compiler).toEqual([]);
    expect(r.editor).toEqual([]);
    expect(r.value).toBe(expected);
  };
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

describe('what runs where it is not written: accessors, functions declared inside, constructors', () => {
  it('reads a local whose name starts like the built object as another variable', () => {
    refuses(
      `class D { a: P = new P(); b: P = new P(); constructor() { const self_a = new P(); this.a = self_a; this.b = self_a; self_a.x = 2.; } }
export function f(): f32 { const d = new D(); return d.a.x + d.b.x * 10.; }`,
      'TS8099 "self_a"',
      'TS8099 "self_a"',
    );
  });

  it('counts a getter that writes its object as a write after a name of a call result', () => {
    refuses(
      `class G { x: f32 = 0.; get nx(): f32 { this.x += 1.; return this.x; } }
function choose(a: G, b: G): G { return a.x > 5. ? a : b; }
export function f(): f32 { const a = new G(); const b = new G(); const q = choose(a, b); const t = b.nx; return q.x * 10. + t; }`,
      'TS8099 "q" would name an object',
    );
  });

  it('counts a method that reads a getter that writes as a method that writes its object', () => {
    refuses(
      `class G { x: f32 = 0.; get nx(): f32 { this.x += 1.; return this.x; } peek(): f32 { return this.nx; } }
function choose(a: G, b: G): G { return a.x > 5. ? a : b; }
export function f(): f32 { const a = new G(); const b = new G(); const q = choose(a, b); const t = b.peek(); return q.x * 10. + t; }`,
      'TS8099 "q" would name an object',
    );
  });

  it('refuses a call of a function declared earlier that puts another object at the place', () => {
    refuses(
      `export function f(): f32 { const h = new B(); h.c.x = 1.; const g = (): void => { h.c = new P(); }; const q = h.c; g(); q.x += 5.; return h.c.x * 10. + q.x; }`,
      'TS8099 "q" names "h.c", and this statement puts another object there while "q" is still used.',
    );
  });

  it('refuses a setter that puts another object at the place', () => {
    refuses(
      `class S { c: P = new P(); set r(v: f32) { this.c = new P(); } }
export function f(): f32 { const h = new S(); h.c.x = 1.; const q = h.c; h.r = 0.; q.x += 5.; return h.c.x * 10. + q.x; }`,
      'TS8099 "q" names "h.c", and this statement puts another object there while "q" is still used.',
    );
  });

  it('refuses a loop whose body replaces its array through a function declared earlier', () => {
    refuses(
      `class L { ps: array<P, 2> = [new P(), new P()]; }
export function f(): f32 { const h = new L(); h.ps[1].x = 2.; const g = (): void => { h.ps[1] = new P(); }; let s = 0.; for (const e of h.ps) { g(); e.x += 10.; s += e.x; } return s + h.ps[1].x * 100.; }`,
      'TS8099 This statement may put another object in "h.ps"',
    );
  });

  it('refuses a loop whose body replaces its array through a setter', () => {
    refuses(
      `class L { ps: array<P, 2> = [new P(), new P()]; set z(v: f32) { this.ps = [new P(), new P()]; } }
export function f(): f32 { const h = new L(); h.ps[1].x = 2.; let s = 0.; for (const e of h.ps) { h.z = 1.; e.x += 10.; s += e.x; } return s + h.ps[1].x * 100.; }`,
      'TS8099 This statement may put another object in "h.ps"',
    );
  });

  it('runs a function declared earlier that only writes fields of the element', () => {
    runs(
      `class L { ps: array<P, 2> = [new P(), new P()]; }
export function f(): f32 { const h = new L(); const g = (): void => { h.ps[0].x += 1.; }; let s = 0.; for (const e of h.ps) { g(); s += e.x; } return s; }`,
      1,
    );
  });
});
