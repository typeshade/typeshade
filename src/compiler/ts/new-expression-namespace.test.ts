import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { compileTsSource } from './source-file.js';
import { TS_CODES } from './codes.js';
import { compileModule } from '../../core/oracle.js';
import { compileModuleJs } from '../../core/cpu-codegen.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';
import { keepHelpers } from '../../core/testing/keep-helpers.js';

const errorsOf = (src: string) =>
  compileTsSource(src)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => `${d.code} ${d.message}`);

const file = (head: string, body: string) => `"use typeshade"
${head}@fragment export function fs(): vec4 {
${body}
}
`;
const agree = (r: ReturnType<typeof compile>, expected: number[]): void => {
  for (const make of [compileModule, compileModuleJs]) {
    expect(make(r.module).fns['fs']!(), make.name).toEqual(expected);
  }
};

describe('a short name inside a namespace is the namespace’s, ahead of a top-level one, for a new and a type alike', () => {
  const TOP = `class P {\n  a: f32 = 7.\n}\n`;
  const values = (src: string, expected: number[]) => {
    const r = compile(src);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toMatch(/N_P_new(_into)?\(/);
    agree(r, expected);
  };

  it(
    'a bare new P(), a const p: P, a parameter p: P and a return type P',
    keepHelpers(() => {
      values(
        file(
          `${TOP}namespace N {\n  export class P {\n    a: f32 = 1.\n  }\n  export function f(): f32 {\n    const p = new P()\n    return p.a\n  }\n}\n`,
          `  return vec4(N.f())`,
        ),
        [1, 1, 1, 1],
      );
      values(
        file(
          `${TOP}namespace N {\n  export class P {\n    a: f32 = 1.\n  }\n  export function f(): f32 {\n    const p: P = new P()\n    return p.a\n  }\n}\n`,
          `  return vec4(N.f())`,
        ),
        [1, 1, 1, 1],
      );
      values(
        file(
          `${TOP}namespace N {\n  export class P {\n    a: f32 = 1.\n  }\n  export function f(p: P): f32 {\n    return p.a\n  }\n  export function g(): f32 {\n    return f(new P())\n  }\n}\n`,
          `  return vec4(N.g())`,
        ),
        [1, 1, 1, 1],
      );
      values(
        file(
          `${TOP}namespace N {\n  export class P {\n    a: f32 = 1.\n  }\n  export function mk(): P {\n    return new P()\n  }\n}\n`,
          `  return vec4(N.mk().a + new P().a)`,
        ),
        [8, 8, 8, 8],
      );
    }),
  );

  it(
    'in another block of the namespace, ahead of a top-level class of the name',
    keepHelpers(() => {
      values(
        file(
          `${TOP}namespace N {\n  export class P {\n    a: f32 = 1.\n  }\n}\nnamespace N {\n  export function mk(): P {\n    return new P()\n  }\n}\n`,
          `  return vec4(N.mk().a)`,
        ),
        [1, 1, 1, 1],
      );
    }),
  );

  it(
    'a parameter P of a namespace function takes N.P, which a top-level P is not',
    keepHelpers(() => {
      const called = file(
        `${TOP}namespace N {\n  export class P {\n    a: f32 = 1.\n  }\n  export function f(p: P): f32 {\n    return p.a\n  }\n}\n`,
        `  return vec4(N.f(new P()))`,
      );
      const sentence =
        `${TS_CODES.TYPE_MISMATCH} Argument 1 of "N.f" is P, and "N.f" takes N.P. A struct is its ` +
        `own type whatever its fields, so pass a value of type N.P.`;
      expect(errorsOf(called)).toEqual([sentence]);
      const service = createTypeshadeLanguageService();
      service.openDocument('t.ts', called);
      expect(service.getDiagnostics('t.ts').map((d) => `${String(d.code)} ${d.message}`)).toEqual([
        sentence,
      ]);
      values(
        file(
          `${TOP}namespace N {\n  export class P {\n    a: f32 = 1.\n  }\n  export function f(p: P): f32 {\n    return p.a\n  }\n}\n`,
          `  return vec4(N.f(new N.P()))`,
        ),
        [1, 1, 1, 1],
      );
    }),
  );

  it(
    'a field initializer that builds a sibling class of the namespace',
    keepHelpers(() => {
      const r = compile(
        file(
          `namespace N {\n  export class A {\n    x: f32 = 1.\n  }\n  export class B {\n    a: A = new A()\n  }\n}\n`,
          `  return vec4(new N.B().a.x)`,
        ),
      );
      expect(r.diagnostics).toEqual([]);
      expect(r.wgsl).toContain('N_A_new_into(&self_.a);');
      agree(r, [1, 1, 1, 1]);
    }),
  );
});
