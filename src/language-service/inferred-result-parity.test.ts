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
