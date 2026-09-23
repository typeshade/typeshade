// Diagnostics surface: intentional errors must not throw; locations + messages

import { describe, expect, it } from 'vitest';
import { compileTsSource } from './source-file.js';
import { compile } from './compile.js';
import { TS_CODES } from './codes.js';

function diag(source: string) {
  const r = compileTsSource(source);
  return r;
}

describe('diagnostics (use typeshade)', () => {
  it('does not throw on any intentional error sample', () => {
    const samples = [
      `"use typeshade";\nexport function bad(a: string): f32 { return 1; }`,
      `"use typeshade";\nexport function f(): f32 { return missing; }`,
      `"use typeshade";\nexport function f(a: f32): f32 { if (a) return 1; return 0; }`,
      `"use typeshade";\nexport function f(a: f32, b: f32): bool { return a == b; }`,
      `"use typeshade";\nexport function f(): f32 { const x = 1.; x = 2.; return x; }`,
      `"use typeshade";\nexport function f(a?: f32): f32 { return 0; }`,
    ];
    for (const s of samples) {
      expect(() => compileTsSource(s)).not.toThrow();
      const r = compileTsSource(s);
      expect(r.hasDirective).toBe(true);
      expect(r.diagnostics.length).toBeGreaterThan(0);
      for (const d of r.diagnostics) {
        expect(d.line).toBeGreaterThanOrEqual(1);
        expect(d.character).toBeGreaterThanOrEqual(1);
        expect(['error', 'warning', 'message']).toContain(d.category);
        expect(d.message.length).toBeGreaterThan(0);
      }
    }
  });

  it('string param type yields diagnostic and skips or soft-fails function', () => {
    const r = diag(`"use typeshade";\nexport function bad(a: string): f32 { return 1; }`);
    expect(r.diagnostics.some((d) => /string|TypeShade type/i.test(d.message))).toBe(true);
  });

  it('requireDirective emits error when directive missing', () => {
    const r = compileTsSource('export function f(): void {}', { requireDirective: true });
    expect(r.hasDirective).toBe(false);
    expect(r.diagnostics.some((d) => d.category === 'error')).toBe(true);
  });

  it('gives a type-mismatch diagnostic a span over the offending expression', () => {
    const r = diag(`"use typeshade";\nexport function f(a: f32, b: i32): f32 { return a + b; }`);
    const d = r.diagnostics.find((d) => d.code === TS_CODES.TYPE_MISMATCH);
    expect(d).toBeDefined();
    expect(r.sourceFile.text.slice(d!.start, d!.start + d!.length)).toBe('a + b');
  });

  it("keeps a diagnostic's endLine/endCharacter consistent with start + length", () => {
    const r = diag(`"use typeshade";\nexport function f(a: f32, b: i32): f32 { return a + b; }`);
    const d = r.diagnostics.find((d) => d.code === TS_CODES.TYPE_MISMATCH)!;
    const end = r.sourceFile.getLineAndCharacterOfPosition(d.start + d.length);
    expect(d.endLine).toBe(end.line + 1);
    expect(d.endCharacter).toBe(end.character + 1);
    // The span is non-empty and starts strictly before it ends, one-based line/character.
    expect(d.line).toBeLessThanOrEqual(d.endLine);
    expect(d.length).toBeGreaterThan(0);
  });

  it('gives a missing-directive diagnostic (no offending node) a zero start', () => {
    const r = compileTsSource('export function f(): void {}', { requireDirective: true });
    const d = r.diagnostics[0]!;
    expect(d.start).toBe(0);
    expect(d.length).toBeGreaterThanOrEqual(0);
    expect(d.endLine).toBeGreaterThanOrEqual(d.line);
  });

  it('valid transform has zero error diagnostics', () => {
    const r = diag(`
      "use typeshade";
      export function transform(a: f32, b: f32): f32 {
        const x = a + b;
        return x * 2;
      }
    `);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(r.funcs).toHaveLength(1);
  });
});

// A file TypeScript could not parse is not lowered. Before this, `vec4(3.14` (no closing
// parenthesis) compiled to WGSL without a word: the parser's recovered tree looked enough like
// a program for the front end to lower it. The parse errors are now the whole answer.
describe('syntax errors', () => {
  const unclosedCall = `"use typeshade";\nexport function f(): vec4 { return vec4(3.14; }`;

  it('reports an unclosed call as a SYNTAX diagnostic and lowers nothing', () => {
    const r = diag(unclosedCall);
    expect(r.hasDirective).toBe(true);
    expect(r.diagnostics.length).toBeGreaterThan(0);
    for (const d of r.diagnostics) {
      expect(d.code).toBe(TS_CODES.SYNTAX);
      expect(d.category).toBe('error');
    }
    expect(r.diagnostics[0]!.message).toMatch(/'\)' expected/);
    expect(r.diagnostics[0]!.line).toBe(2);
    expect(r.funcs).toEqual([]);
    expect(r.wgsl).toBeUndefined();
  });

  it("gives a syntax diagnostic the parser's own span, inside the file", () => {
    const r = diag(unclosedCall);
    const d = r.diagnostics[0]!;
    expect(d.start).toBeGreaterThan(0);
    expect(d.start + d.length).toBeLessThanOrEqual(r.sourceFile.text.length);
    expect(r.sourceFile.text.slice(d.start, d.start + d.length)).toBe(';');
    const end = r.sourceFile.getLineAndCharacterOfPosition(d.start + d.length);
    expect(d.endLine).toBe(end.line + 1);
    expect(d.endCharacter).toBe(end.character + 1);
  });

  it('reports a missing closing brace without cascading into TypeShade diagnostics', () => {
    const r = diag(`"use typeshade";\nexport function f(): f32 {\n  return 1.;\n`);
    expect(r.diagnostics.length).toBeGreaterThan(0);
    expect(r.diagnostics.every((d) => d.code === TS_CODES.SYNTAX)).toBe(true);
    expect(r.funcs).toEqual([]);
    expect(r.wgsl).toBeUndefined();
  });

  it('reports only the missing directive, not the parse error, for a file with no directive', () => {
    const broken = 'export function f(): number { return (1; }';
    expect(compileTsSource(broken, { requireDirective: false }).diagnostics).toEqual([]);
    const r = compileTsSource(broken);
    expect(r.diagnostics.map((d) => d.code)).toEqual([TS_CODES.MISSING_DIRECTIVE]);
  });

  it('compile() carries the SYNTAX diagnostic and emits no function for the file', () => {
    const c = compile(unclosedCall);
    expect(c.diagnostics.some((d) => d.code === TS_CODES.SYNTAX)).toBe(true);
    expect(c.module.funcs).toEqual([]);
    expect(c.wgsl ?? '').not.toMatch(/fn f/);
    expect(c.glsl?.vertex ?? '').not.toMatch(/\bf\(/);
  });
});
