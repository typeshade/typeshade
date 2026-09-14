// Every spelling §9 of docs/use-typeshade-surface.md documents must resolve in the ambient
// lib (#8 A6). The compiler accepts all of them; a name the editor cannot see red-squiggles
// valid source, which is the false POSITIVE the design doc's §6 forbids — the opposite of the
// false negatives it deliberately tolerates.
//
// The generated tables in ambient.ts derive a signature from an arity alone, so four of these
// have to be written by hand: `select`'s third argument is a bool, `atan` has two arities,
// `bool` takes a bool as well as a number, and `discard` is a statement rather than a call.

import { describe, expect, it } from 'vitest'
import { createTypeshadeLanguageService } from './service.js'

/** The TypeScript diagnostics the service reports for one program — TypeShade's own are not
 *  the subject here, only whether the editor's type layer can see the vocabulary. */
function tsDiagnostics(body: string): string[] {
  const service = createTypeshadeLanguageService()
  service.openDocument('a.ts', `"use typeshade";\n${body}`)
  return service
    .getDiagnostics('a.ts')
    .filter((d) => d.source !== 'typeshade')
    .map((d) => `${d.code ?? ''} ${d.message}`)
}

describe('the ambient lib sees every #8 A6 spelling', () => {
  it.each([
    ['exp2', 'export function f(x: f32): f32 {\n  return exp2(x);\n}'],
    ['saturate', 'export function f(x: f32): f32 {\n  return saturate(x);\n}'],
    ['fwidth', 'export function f(x: f32): f32 {\n  return fwidth(x);\n}'],
    ['dpdx', 'export function f(x: f32): f32 {\n  return dpdx(x);\n}'],
    ['dpdy', 'export function f(x: f32): f32 {\n  return dpdy(x);\n}'],
    ['fma', 'export function f(x: f32): f32 {\n  return fma(x, x, x);\n}'],
    ['atan, one argument', 'export function f(x: f32): f32 {\n  return atan(x);\n}'],
    ['atan, two arguments', 'export function f(y: f32, x: f32): f32 {\n  return atan(y, x);\n}'],
    ['select', 'export function f(a: f32, b: f32, c: bool): f32 {\n  return select(a, b, c);\n}'],
    ['bool of a number', 'export function f(i: i32): bool {\n  return bool(i);\n}'],
    ['bool of a bool', 'export function f(c: bool): bool {\n  return bool(c);\n}'],
    ['f64', 'export function f(x: f32): f64 {\n  return f64(x);\n}'],
    ['**', 'export function f(x: f32): f32 {\n  return x ** x;\n}'],
    [
      'discard',
      'export function f(x: f32): f32 {\n  if (x < 0.) {\n    discard;\n  }\n  return x;\n}',
    ],
  ])('resolves %s', (_label, body) => {
    expect(tsDiagnostics(body)).toEqual([])
  })
})
