// The editor and the compiler read a call cycle alike (Rule 12.7, #1298).
//
// WGSL has no call stack, so `compile()` refuses a function, a method or a getter that takes
// part in a call cycle (TS8031). With no written result type, TypeScript also says the result
// is implicitly `any` (TS7023). The projection writes a result type in only where the value
// applies an operator, so a cycle of plain calls reached the editor with TS7023 on every member
// besides the compiler's refusal. Each row reads both halves on the same source.

import { describe, expect, it } from 'vitest';
import { createTypeshadeLanguageService } from './service.js';
import { compile } from '../compiler/ts/compile.js';

const compilerSide = (source: string): string[] =>
  compile(source)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => `TS${String(d.code).replace(/^TS/, '')}: ${d.message}`);

const editorSide = (source: string): string[] => {
  const service = createTypeshadeLanguageService();
  service.openDocument('a.ts', source);
  return service
    .getDiagnostics('a.ts')
    .filter((d) => d.severity === 'error')
    .map((d) => `TS${String(d.code).replace(/^TS/, '')}: ${d.message}`);
};

const cycle = (names: string): RegExp =>
  new RegExp(`^TS8031: Recursive call: ${names}\\. WGSL has no call stack`);

for (const arg of ['n', 'n - 1']) {
  const cases: readonly (readonly [string, string, RegExp])[] = [
    [
      'a single recursive function',
      `"use typeshade";
function f(n: u32) { if (n > 0) { return 1; } return f(${arg}); }
export function t(n: u32): u32 { return u32(f(n)); }
`,
      cycle('"f" -> "f"'),
    ],
    [
      'two mutually recursive functions',
      `"use typeshade";
function a(n: u32) { if (n > 0) { return 1; } return b(${arg}); }
function b(n: u32) { if (n > 0) { return 2; } return a(${arg}); }
export function t(n: u32): u32 { return u32(a(n)); }
`,
      cycle('"a" -> "b" -> "a"'),
    ],
    [
      'two mutually recursive functions, one writes its result type',
      `"use typeshade";
function a(n: u32) { if (n > 0) { return 1; } return b(${arg}); }
function b(n: u32): u32 { if (n > 0) { return 2; } return a(${arg}); }
export function t(n: u32): u32 { return u32(a(n)); }
`,
      cycle('"a" -> "b" -> "a"'),
    ],
    [
      'two mutually recursive namespaced functions',
      `"use typeshade";
namespace A { export function f(n: u32) { if (n > 0) { return 1; } return B.g(${arg}); } }
namespace B { export function g(n: u32) { if (n > 0) { return 2; } return A.f(${arg}); } }
export function t(n: u32): u32 { return u32(A.f(n)); }
`,
      cycle('"A_f" -> "B_g" -> "A_f"'),
    ],
    [
      'a namespaced function that calls itself',
      `"use typeshade";
namespace A { export function f(n: u32) { if (n > 0) { return 1; } return f(${arg}); } }
export function t(n: u32): u32 { return u32(A.f(n)); }
`,
      cycle('"A_f" -> "A_f"'),
    ],
    [
      'a cycle of three functions',
      `"use typeshade";
function a(n: u32) { if (n > 0) { return 1; } return b(${arg}); }
function b(n: u32) { if (n > 0) { return 2; } return c(${arg}); }
function c(n: u32) { if (n > 0) { return 3; } return a(${arg}); }
export function t(n: u32): u32 { return u32(a(n)); }
`,
      cycle('"a" -> "b" -> "c" -> "a"'),
    ],
    [
      'two mutually recursive nested functions',
      `"use typeshade";
function outer(n: u32): u32 {
  function a(m: u32) { if (m > 0) { return 1; } return b(${arg.replace('n', 'm')}); }
  function b(m: u32) { if (m > 0) { return 2; } return a(${arg.replace('n', 'm')}); }
  return u32(a(n));
}
export function t(n: u32): u32 { return outer(n); }
`,
      cycle('"outer_a" -> "outer_b" -> "outer_a"'),
    ],
    [
      'two mutually recursive methods',
      `"use typeshade";
class C {
  a(n: u32) { if (n > 0) { return 1; } return this.b(${arg}); }
  b(n: u32) { if (n > 0) { return 2; } return this.a(${arg}); }
}
export function t(n: u32): u32 { const c = new C(); return u32(c.a(n)); }
`,
      cycle('"C.a" -> "C.b" -> "C.a"'),
    ],
    [
      'two mutually recursive methods, one writes its result type',
      `"use typeshade";
class C {
  a(n: u32) { if (n > 0) { return 1; } return this.b(${arg}); }
  b(n: u32): u32 { if (n > 0) { return 2; } return this.a(${arg}); }
}
export function t(n: u32): u32 { const c = new C(); return u32(c.a(n)); }
`,
      cycle('"C.a" -> "C.b" -> "C.a"'),
    ],
  ];
  for (const [label, source, expected] of cases) {
    describe(`${label} (call argument \`${arg}\`)`, () => {
      it('both halves refuse the cycle with the same single error', () => {
        const compiler = compilerSide(source);
        expect(compiler).toHaveLength(1);
        expect(compiler[0]).toMatch(expected);
        expect(editorSide(source)).toEqual(compiler);
      });
    });
  }
}

const getters = (written: boolean): string => `"use typeshade";
class C {
  x: u32 = 1;
  get a() { if (this.x > 0) { return 1; } return this.b; }
  get b()${written ? ': u32' : ''} { if (this.x > 0) { return 2; } return this.a; }
}
export function t(n: u32): u32 { const c = new C(); return u32(c.a); }
`;

describe('mutually recursive getters (#1298)', () => {
  for (const written of [false, true]) {
    it(`both halves refuse the cycle with the same single error${written ? ', one writes its result type' : ''}`, () => {
      const compiler = compilerSide(getters(written));
      expect(compiler).toHaveLength(1);
      expect(compiler[0]).toMatch(cycle('"C.a" -> "C.b" -> "C.a"'));
      expect(editorSide(getters(written))).toEqual(compiler);
    });
  }

  it('a getter that reads itself is refused alike', () => {
    const source = `"use typeshade";
class C { x: u32 = 1; get a() { if (this.x > 0) { return 1; } return this.a; } }
export function t(n: u32): u32 { const c = new C(); return u32(c.a); }
`;
    const compiler = compilerSide(source);
    expect(compiler).toHaveLength(1);
    expect(compiler[0]).toMatch(cycle('"C.a" -> "C.a"'));
    expect(editorSide(source)).toEqual(compiler);
  });
});

describe('a cycle beside a method of another class with the same name (#1298)', () => {
  it('both halves report the one cycle of class A alike', () => {
    const source = `"use typeshade";
class A { a(n: u32) { if (n > 0) { return 1; } return this.b(n); } b(n: u32) { return this.a(n); } }
class B { a(n: u32) { return n; } }
export function t(n: u32): u32 { return u32(new B().a(n)); }
`;
    const compiler = compilerSide(source);
    expect(compiler).toHaveLength(1);
    expect(compiler[0]).toMatch(cycle('"A.a" -> "A.b" -> "A.a"'));
    expect(editorSide(source)).toEqual(compiler);
  });
});
