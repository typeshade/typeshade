// The editor and the compiler read a function with no written result type alike (Rule 12.7).
//
// The language service writes the result type the front end inferred into the text it analyses
// (`: u32` after the parameter list), and marks it as not the author's, so the analysis infers
// it again as `compile()` does on the author's text (change 0134). A generic function's
// instance read that mark from `node.type` alone, so the written-in `: u32` counted as written
// and the instance returned void: the editor said `returns void` where `compile()` accepted the
// program (#1277). Each row reads both halves on the same source.

import { describe, expect, it } from 'vitest';
import { createTypeshadeLanguageService } from './service.js';
import { compile } from '../compiler/ts/compile.js';

const editor = (source: string) => {
  const service = createTypeshadeLanguageService();
  service.openDocument('a.ts', source);
  return service;
};

const errorsOf = (source: string): string[] =>
  compile(source)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => `${d.code}: ${d.message}`);

const program = (sig: string, body: string): string => `"use typeshade";
function g${sig} { return ${body}; }
export function t(vi: u32): i32 {
  return i32(g<u32>(vi)) * 2;
}
`;

describe('a generic function with no written result type (#1277)', () => {
  for (const body of ['u32(1 | 2) / 2', 'u32(1 | 2)', 'u32(3)']) {
    it(`both halves accept \`return ${body}\` and read the result as u32`, () => {
      const source = program('<T>(a: T)', body);
      expect(errorsOf(source)).toEqual([]);
      expect(compile(source).wgsl).toMatch(/fn g_u32\([^)]*\) -> u32/);
      const service = editor(source);
      expect(service.getDiagnostics('a.ts')).toEqual([]);
      const hover = service.getHover('a.ts', { line: 1, character: 9 });
      expect(hover?.contents).toContain('): u32');
    });
  }

  it('the neighbour with a written result type reads the same on both halves', () => {
    const source = program('<T>(a: T): u32', 'u32(1 | 2) / 2');
    expect(errorsOf(source)).toEqual([]);
    const service = editor(source);
    expect(service.getDiagnostics('a.ts')).toEqual([]);
    expect(service.getHover('a.ts', { line: 1, character: 9 })?.contents).toContain('): u32');
  });

  it('a written `: void` still refuses a returned value on both halves', () => {
    const source = program('<T>(a: T): void', 'u32(3)');
    expect(errorsOf(source).length).toBeGreaterThan(0);
    expect(editor(source).getDiagnostics('a.ts').length).toBeGreaterThan(0);
  });
});

// An untyped function's result read by a local whose uses ask two types (#1280). The local
// inference read the callee's `type` node, so the result type the projection wrote (`: i32`)
// counted as written: the editor fixed the local to `i32` and said only `/=` mismatched, where
// `compile()` says the local cannot be inferred. The rows are the two programs the differential
// test of #1272 found (seed 3 and seed 555), a minimal form, and two neighbours.
describe('an untyped function result read by a local of conflicting uses (#1280)', () => {
  const both = (source: string) => {
    const compiler = compile(source)
      .diagnostics.filter((d) => d.category === 'error')
      .map((d) => `${d.code}: ${d.message}`);
    const service = editor(source);
    const editorSide = service
      .getDiagnostics('a.ts')
      .filter((d) => d.severity === 'error')
      .map((d) => `TS${String(d.code).replace(/^TS/, '')}: ${d.message}`);
    return { compiler, editorSide };
  };

  const ROWS: readonly (readonly [string, string, RegExp])[] = [
    [
      'seed 3, a result assigned in a branch',
      `"use typeshade";
function hu(a: u32): u32 {
  return a + 1;
}
function hh(a: i32): i32 {
  return a + 1;
}
export function gg() {
  return (5|0);
}
export function t(ii: i32, vi: u32, f: f32): u32 {
  let a = 4;
  let b = a;
  if (vi > 3) {
    a = gg();
  }
  return a;
}
`,
      /Cannot infer "a"/,
    ],
    [
      'seed 555, a result and a u32 compound assignment',
      `"use typeshade";
const K = (6^3);
let M = (-(5|0));
function gg3() {
  return abs((~(1|2)));
}
export function t(ii: i32, vi: u32, f: f32): i32 {
  M = (M | 0);
  let a = 7;
  a = gg3();
  a /= u32(2);
  return a;
}
`,
      /Cannot infer "a"/,
    ],
    [
      'a minimal form',
      `"use typeshade";
function g() { return abs(~(1|2)); }
export function t(vi: u32): u32 {
  let a = 7;
  a = g();
  a /= vi;
  return u32(a);
}
`,
      /Cannot infer "a"/,
    ],
  ];

  for (const [name, source, expected] of ROWS) {
    it(`${name}: both halves give the same diagnostics`, () => {
      const { compiler, editorSide } = both(source);
      expect(compiler.join('\n')).toMatch(expected);
      expect(editorSide).toEqual(compiler);
    });
  }

  it('the neighbour whose uses agree on one type: both halves accept it', () => {
    const source = `"use typeshade";
function g() { return abs(~(1|2)); }
export function t(ii: i32): i32 {
  let a = 7;
  a = g();
  a /= ii;
  return a;
}
`;
    const { compiler, editorSide } = both(source);
    expect(compiler).toEqual([]);
    expect(editorSide).toEqual([]);
  });

  it('the neighbour with a written result type: both halves read it as written', () => {
    const source = `"use typeshade";
function g(): i32 { return abs(~(1|2)); }
export function t(vi: u32): u32 {
  let a = 7;
  a = g();
  a /= vi;
  return u32(a);
}
`;
    const { compiler, editorSide } = both(source);
    expect(compiler.join('\n')).toMatch(/cannot \/= i32 and u32/);
    expect(editorSide).toEqual(compiler);
  });
});
