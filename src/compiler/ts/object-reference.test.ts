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
