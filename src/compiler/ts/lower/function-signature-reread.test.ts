import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { markProjectedAnnotations } from '../abstract-const.js';
import type { TsCompilerDiagnostic } from '../source-file.js';
import { parseSignature } from './function-signature.js';

function sentencesAfterReading(body: string, times: number): number[] {
  const sourceFile = ts.createSourceFile('a.shade.ts', body, ts.ScriptTarget.ESNext, true);
  const node = sourceFile.statements.find(ts.isFunctionDeclaration)!;
  const diagnostics: TsCompilerDiagnostic[] = [];
  const counts: number[] = [];
  for (let i = 0; i < times; i++) {
    parseSignature(node, sourceFile, diagnostics);
    counts.push(diagnostics.length);
  }
  return counts;
}

describe('a signature that is read again says each refusal once', () => {
  it.each([
    ['a second stage attribute', '@vertex @fragment export function f(): vec4 { return vec4(0.) }'],
    ['an argument on a stage attribute', '@vertex() export function f(): vec4 { return vec4(0.) }'],
    [
      'a type argument on a stage attribute',
      '@fragment<f32>() export function f(): vec4 { return vec4(0.) }',
    ],
    [
      'a bad workgroup_size of a kernel function',
      '@workgroup_size([0]) export function k(a: array<f32>) { }',
    ],
    [
      'a workgroup_size of a function that is not a kernel function',
      '@workgroup_size([8]) export function k(a: f32) { }',
    ],
    [
      'a second workgroup_size',
      '@workgroup_size([8]) @workgroup_size([9]) export function k(a: array<f32>) { }',
    ],
  ])('%s', (_name, body) => {
    const [first, second, third] = sentencesAfterReading(body, 3);
    expect(first).toBeGreaterThan(0);
    expect([second, third]).toEqual([first, first]);
  });
});

describe('a result type that the editor projection wrote', () => {
  const text = 'function f(a: f32): f32 { return a }';
  const resultOf = (projected: boolean): string => {
    const sourceFile = ts.createSourceFile('a.shade.ts', text, ts.ScriptTarget.ESNext, true);
    if (projected) markProjectedAnnotations(sourceFile, [text.indexOf(': f32 {')]);
    const node = sourceFile.statements.find(ts.isFunctionDeclaration)!;
    return parseSignature(node, sourceFile, [])!.ret.kind;
  };

  it('is left for the function to infer, and the author written one is kept', () => {
    expect(resultOf(false)).toBe('scalar');
    expect(resultOf(true)).toBe('void');
  });
});
