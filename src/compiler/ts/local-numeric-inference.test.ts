// Verifies: Rule 5.1, Rule 5.3, Rule 5.4 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { compileTsSource } from './source-file.js';
import { compile } from './compile.js';
import { typeKey } from '../../core/ir/types.js';
import { TS_CODES } from './codes.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';
import { localNumericInference } from './local-numeric-inference.js';

const single = `"use typeshade";
function poo(x: i32): i32 { return x + 2; }
export function run(): i32 { let objectIndex = -1; return poo(objectIndex); }`;

function localType(source: string, name: string): string | undefined {
  return compileTsSource(source)
    .symbols.filter((s) => s.kind === 'local' && s.name === name)
    .map((s) => typeKey(s.type))[0];
}

describe('integer locals constrained by declared direct calls', () => {
  it('types the reported object index as i32 and evaluates integer arithmetic', () => {
    const result = compile(single);
    expect(result.diagnostics).toEqual([]);
    expect(localType(single, 'objectIndex')).toBe('i32');
    expect(result.wgsl).toContain('objectIndex: i32 = -1');
    expect(result.eval!('run')).toBe(1);
  });
  it('uses an unsigned demand', () => {
    const source = `"use typeshade"; function g(n: u32): u32 {return n;} export function run(): u32 {const n=3; return g(n);}`;
    expect(compileTsSource(source).diagnostics).toEqual([]);
    expect(localType(source, 'n')).toBe('u32');
  });
  it.each([
    ['a(n);', 'b(n);'],
    ['b(n);', 'a(n);'],
  ])('refuses conflicting demands %s %s', (first, second) => {
    const source = `"use typeshade"; function a(n:i32):void {} function b(n:f32):void {} export function run():void {let n=-1; ${first} ${second}}`;
    const result = compileTsSource(source);
    expect(
      result.diagnostics.some(
        (d) =>
          d.code === TS_CODES.TYPE_MISMATCH &&
          d.message.includes('Cannot infer "n"') &&
          d.message.includes('explicit type annotation'),
      ),
    ).toBe(true);
    expect(result.wgsl).toBeUndefined();
  });
  it('keeps unneeded defaults and float-written or nonliteral initializers unchanged', () => {
    const source = `"use typeshade"; function g(n:i32):void {} export function run():void {let plain=1; let decimal=1.; let copied=plain; g(decimal); g(copied);}`;
    expect(localType(source, 'plain')).toBe('f32');
    expect(localType(source, 'decimal')).toBe('f32');
    expect(localType(source, 'copied')).toBe('f32');
    expect(
      compileTsSource(source).diagnostics.filter((d) => d.code === TS_CODES.TYPE_MISMATCH),
    ).toHaveLength(2);
  });
  it.each(['-1', '4294967296'])('refuses values outside the unsigned target: %s', (value) => {
    const result = compileTsSource(
      `"use typeshade"; function g(n:u32):void {} export function run():void {let n=${value}; g(n);}`,
    );
    expect(result.diagnostics.some((d) => d.message.includes('outside u32'))).toBe(true);
    expect(result.wgsl).toBeUndefined();
  });
  it('honors explicit annotations', () => {
    const source = `"use typeshade"; function g(n:i32):void {} export function run():void {let n:f32=-1; g(n);}`;
    expect(localType(source, 'n')).toBe('f32');
    expect(compileTsSource(source).diagnostics.some((d) => d.code === TS_CODES.TYPE_MISMATCH)).toBe(
      true,
    );
  });
  it('honors explicit casts and a cast at the use leaves the default unchanged', () => {
    const source = `"use typeshade"; function g(n:i32):i32 {return n;} export function run():i32 {let n=-1; let cast=i32(-2); return g(i32(n)) + g(cast);}`;
    expect(compileTsSource(source).diagnostics).toEqual([]);
    expect(localType(source, 'n')).toBe('f32');
    expect(localType(source, 'cast')).toBe('i32');
  });
  it('refuses i32 and u32 demands with the same annotation remedy', () => {
    const source = `"use typeshade"; function a(n:i32):void {} function b(n:u32):void {} export function run():void {let n=1; a(n); b(n);}`;
    expect(
      compileTsSource(source).diagnostics.some((d) => d.message.includes('require i32 and u32')),
    ).toBe(true);
  });
  it('does not infer from a generic declaration', () => {
    const source = `"use typeshade"; function g<T>(n:i32):i32 {return n;} export function run():i32 {let n=1; return g<f32>(n);}`;
    expect(localType(source, 'n')).toBe('f32');
  });
  it('does not infer from an unresolved imported callee', () => {
    const source = ts.createSourceFile(
      'import.shade.ts',
      `import {g} from "./missing.shade"; function run():void {let n=1; g(n);}`,
      ts.ScriptTarget.Latest,
      true,
    );
    let inferred: ReturnType<typeof localNumericInference>;
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node)) inferred = localNumericInference(node, source);
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(inferred).toBeUndefined();
  });
  it('does not choose a type from an overload signature', () => {
    const source = `"use typeshade"; function g(n:i32):i32; function g(n:f32):f32; function g(n:f32):f32 {return n;} export function run():f32 {let n=1; return g(n);}`;
    expect(localType(source, 'n')).toBe('f32');
  });
  it('does not mistake a shadowing parameter for a declared function', () => {
    const source = `"use typeshade"; function g(n:i32):i32 {return n;} export function run(g:f32):void {let n=1; g(n);}`;
    expect(localType(source, 'n')).toBe('f32');
  });
  it('refuses an initializer outside the signed target range', () => {
    const result = compileTsSource(
      `"use typeshade"; function g(n:i32):void {} export function run():void {let n=2147483648; g(n);}`,
    );
    expect(result.diagnostics.some((d) => d.message.includes('outside i32'))).toBe(true);
  });
  it('separates shadowed locals and function parameters', () => {
    const source = `"use typeshade"; function g(n:i32):void {} function h(n:f32):void {} export function run():void {let n=1; g(n); {let n=2; h(n);} }`;
    const result = compileTsSource(source);
    expect(result.diagnostics).toEqual([]);
    expect(
      result.symbols
        .filter((s) => s.kind === 'local' && s.name === 'n')
        .map((s) => typeKey(s.type)),
    ).toEqual(['i32', 'f32']);
  });
  it('includes closure calls that resolve the outer declaration', () => {
    const source = `"use typeshade"; function g(n:i32):i32 {return n;} export function run():i32 {let n=-1; function inner():i32 {return g(n);} return inner();}`;
    expect(compileTsSource(source).diagnostics).toEqual([]);
    expect(localType(source, 'n')).toBe('i32');
  });
  it('does not warn about inferred integer locals in the default deprecation window', () => {
    expect(compile(single, { deprecations: true }).diagnostics).toEqual([]);
  });
  it('agrees with language service hover and diagnostics', () => {
    const service = createTypeshadeLanguageService();
    service.openDocument('inference.shade.ts', single);
    expect(service.getDiagnostics('inference.shade.ts')).toEqual([]);
    const at = single.indexOf('objectIndex');
    expect(
      service.getHover('inference.shade.ts', service.positionAt('inference.shade.ts', at))
        ?.contents,
    ).toContain('objectIndex: i32');
  });
});
