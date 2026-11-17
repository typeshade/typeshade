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

const AGAIN = (name: string): RegExp =>
  new RegExp(
    `^TS8099 "${esc(name)}" is a second name of an object that already has a name, and "${esc(name)}" is assigned again later\\. Following which object each name then refers to is not supported yet \\(change 0142, stage 2\\)\\. Give "${esc(name)}" its own variable for the second object\\.$`,
  );

function refusedAs(r: ReturnType<typeof read>, want: readonly RegExp[]): void {
  expect(r.compiler).toHaveLength(want.length);
  want.forEach((w, i) => expect(r.compiler[i]).toMatch(w));
  expect(r.editor).toEqual(r.compiler);
}

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
    refusedAs(r, [AGAIN('q')]);
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
