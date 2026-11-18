import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { compileTsSource } from './source-file.js';
import { TS_CODES } from './codes.js';
import { compileModule } from '../../core/oracle.js';
import { compileModuleJs } from '../../core/cpu-codegen.js';

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

describe('a value built at module scope is refused once, by its own declaration', () => {
  const head = `function g(): f32 {\n  return 1.\n}\nclass P {\n  a: f32\n  constructor(a: f32) {\n    this.a = a\n  }\n}\n`;
  const constant = (name: string, call: string, what: string) =>
    `${TS_CODES.TYPE_MISMATCH} Module const "${name}" must be constant, and "${call}" ${what} this file declares. A module constant is folded before any function exists, so build the value inside the function that reads it.`;

  it('a module const that calls a function or builds a class', () => {
    expect(errorsOf(file(`${head}const K: f32 = g()\n`, `  return vec4(K)`))).toEqual([
      constant('K', 'g()', 'calls a function'),
    ]);
    expect(errorsOf(file(`${head}const K = new P(2.)\n`, `  return vec4(K.a)`))).toEqual([
      constant('K', 'new P(2.)', 'builds a class'),
    ]);
    expect(
      errorsOf(file(`${head}const K: f32 = g()\nconst J: f32 = K * 2.\n`, `  return vec4(J)`)),
    ).toEqual([constant('K', 'g()', 'calls a function')]);
  });

  it('a static field, a module let and an enum member each say it in their own words', () => {
    expect(
      errorsOf(file(`${head}class S {\n  static K: f32 = g()\n}\n`, `  return vec4(S.K)`)),
    ).toEqual([
      `${TS_CODES.TYPE_MISMATCH} Static field "S.K" must be constant, and "g()" calls a function this file declares. A static field no code writes is a module constant, folded before any function exists, so build the value inside the function that reads it.`,
    ]);
    expect(errorsOf(file(`${head}let K = new P(2.)\n`, `  return vec4(K.a)`))).toEqual([
      `${TS_CODES.MODULE_VAR} "K" needs a constant initializer (a literal, a module const, arithmetic or a math builtin over those); "new P(2.)" is not one. Assign it inside the entry.`,
    ]);
    expect(
      errorsOf(
        file(
          `function h(): i32 {\n  return 1\n}\nenum E {\n  A = h(),\n}\n`,
          `  return vec4(f32(E.A))`,
        ),
      ),
    ).toEqual([
      `${TS_CODES.TYPE_MISMATCH} Enum member "E.A" needs a value this can compute: a whole number, or arithmetic over numbers and members declared before it.`,
    ]);
  });

  it('built inside the function, the same value compiles', () => {
    const r = compile(file(head, `  const K = new P(g() * 2.)\n  return vec4(K.a)`));
    expect(r.diagnostics).toEqual([]);
    agree(r, [2, 2, 2, 2]);
  });
});
