// A function that returns nothing cannot return a value (#212).
//
// A helper declared `: void` and an entry declared `: void` used to compile a `return` with a
// value, with no diagnostic, into `fn g(x: f32) { return x; }`, which WGSL refuses (Rule 1.1).
// The editor showed TypeScript's TS2322 while `compile()` reported nothing (Rule 12.7). The front
// end now refuses it on the `return`, where TS2322 sits, under TS8003, the code the editor reads
// TS2322 as, so the editor shows one diagnostic (Rule 12.4).
//
// Measured on Tint (Chromium's WebGPU on SwiftShader, the compile gate's instrument, with a
// broken shader reported first) on 2026-09-24 (Rule 13.3):
//   `fn g(x: f32) { return x; }`               "return statement type must match its function
//                                               return type, returned 'f32', expected 'void'"
//   `@fragment fn fs() { return vec4<f32>(1.0); }`  the same, "returned 'vec4<f32>'"
//   `fn g(x: f32) { if (x > 0.0) { return; } }`     accepted
//   `@fragment fn fs() { }`                         accepted
// and on WebGL2: `void h(float x) { return x; }` is "'return' : void function cannot return a
// value".

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const compilerErrors = (src: string): string[] =>
  compile(src)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => `${d.code} ${d.message}`);

const editorDiagnostics = (src: string): string[] => {
  const service = createTypeshadeLanguageService();
  service.openDocument('a.ts', src);
  return service.getDiagnostics('a.ts').map((d) => `${d.source} ${String(d.code)} ${d.message}`);
};

const HELPER = `"use typeshade";
function g(x: f32): void {
  return x;
}
@fragment
export function fs(): vec4 {
  g(1.);
  return vec4(1.);
}
`;

const ENTRY = `"use typeshade";
@fragment
export function fs(): void {
  return vec4(1.);
}
`;

describe('a `: void` function that returns a value is refused (#212)', () => {
  it('a helper: TS8003 on the return, and nothing emitted', () => {
    const message =
      'Function "g" returns void but returns a value of type f32: write ": f32" as its return ' +
      'type, or return nothing.';
    const r = compile(HELPER);
    expect(compilerErrors(HELPER)).toEqual([`TS8003 ${message}`]);
    expect(r.diagnostics[0]!.start).toBe(HELPER.indexOf('return x'));
    expect(r.wgsl).toBeUndefined();
    expect(r.glsl).toBeUndefined();
    expect(editorDiagnostics(HELPER)).toEqual([`typeshade TS8003 ${message}`]);
  });

  it('an entry: the annotation it names is spelled as an author writes it', () => {
    const message =
      'Function "fs" returns void but returns a value of type vec4<f32>: write ": vec4" as its ' +
      'return type, or return nothing.';
    const r = compile(ENTRY);
    expect(compilerErrors(ENTRY)).toEqual([`TS8003 ${message}`]);
    expect(r.wgsl).toBeUndefined();
    expect(editorDiagnostics(ENTRY)).toEqual([`typeshade TS8003 ${message}`]);
  });

  it('each valued return is reported where it is', () => {
    const src = `"use typeshade";
function g(x: f32): void {
  if (x > 0.) {
    return x;
  }
  return 2. * x;
}
@fragment
export function fs(): vec4 {
  g(1.);
  return vec4(1.);
}
`;
    const starts = compile(src)
      .diagnostics.filter((d) => d.category === 'error')
      .map((d) => d.start);
    expect(starts).toEqual([src.indexOf('return x'), src.indexOf('return 2.')]);
  });

  it('the remedy compiles clean in both halves', () => {
    const fixed = HELPER.replace('): void {', '): f32 {');
    expect(compilerErrors(fixed)).toEqual([]);
    expect(editorDiagnostics(fixed)).toEqual([]);
  });
});

describe('what Tint accepts still compiles', () => {
  it('a `: void` helper with a bare return', () => {
    const src = `"use typeshade";
function g(x: f32): void {
  if (x > 0.) {
    return;
  }
}
@fragment
export function fs(): vec4 {
  g(1.);
  return vec4(1.);
}
`;
    expect(compilerErrors(src)).toEqual([]);
    expect(compile(src).wgsl).toContain('fn g(x: f32) {');
    expect(editorDiagnostics(src)).toEqual([]);
  });

  it('a `: void` entry with no return', () => {
    const src = `"use typeshade";
@compute
export function main(): void {
}
`;
    expect(compilerErrors(src)).toEqual([]);
    expect(compile(src).wgsl).toContain('fn main() {');
    expect(editorDiagnostics(src)).toEqual([]);
  });
});
