// A conversion that starts a `for` counter declares the counter's type (Rule 7.5).
//
// Rule 7.5 gives a header name with no annotation `i32` (or `u32` beside a `u32` bound) only
// when its value is written as an integer; any other value gives the name the value's type, as a
// `let` does. `u32(x)` with an `f32` `x` already counted in `u32`. `u32(3)` and `f32(3)` did
// not: the fold makes the conversion of a written number a literal of its type (#1217), and the
// header read that literal as a written integer and made the counter an `i32`. So
// `for (let j = u32(3); j < 8; j++) h(j)` was refused, and `for (let j = u32(0); j < ii; j++)`
// with an `i32` `ii` compiled as an `i32` loop. The counter now takes the conversion's type.
//
// Each case reads both halves on one source (Rule 12.7): `compile()` (its diagnostics, the WGSL,
// the CPU oracle) and the language service.
//
// Verifies: Rule 7.5 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { compileModule } from '../../core/oracle.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const editor = (source: string): string[] => {
  const service = createTypeshadeLanguageService();
  service.openDocument('a.shade.ts', source);
  return service.getDiagnostics('a.shade.ts').map((d) => `${String(d.code)}: ${d.message}`);
};

const fn = (body: string): string => `"use typeshade";
function h(a: u32): u32 { return a; }
function hi(a: i32): i32 { return a; }
function hf(a: f32): f32 { return a; }
export function t(vi: u32, ii: i32, x: f32): f32 {
  let a = 0.;
  ${body}
  return a;
}`;
const ARGS = [3, 5, 2] as const;

describe('a conversion that starts a counter declares its type', () => {
  it('u32(3) counts in u32, as u32(x) does', () => {
    for (const [start, value] of [
      ['u32(3)', 3 + 4 + 5 + 6 + 7],
      ['u32(x)', 2 + 3 + 4 + 5 + 6 + 7],
    ] as const) {
      const source = fn(`for (let j = ${start}; j < 8; j++) { a += f32(h(j)); }`);
      const result = compile(source);
      expect(result.diagnostics).toEqual([]);
      expect(editor(source)).toEqual([]);
      expect(result.wgsl).toMatch(/var j(_\d+)?: u32|h\(\d+u\)/);
      expect(result.eval('t', ARGS)).toBe(value);
    }
    // `i32(3)` counted in `i32` before and still does.
    const signed = fn('for (let j = i32(3); j < 8; j++) { a += f32(hi(j)); }');
    expect(compile(signed).diagnostics).toEqual([]);
    expect(editor(signed)).toEqual([]);
    expect(compile(signed).eval('t', ARGS)).toBe(25);
  });

  it('f32(3) counts in f32, as f32(vi) does', () => {
    for (const [body, value] of [
      ['for (let j = f32(3); j < 8.; j += 1.) { a += hf(j); }', 3 + 4 + 5 + 6 + 7],
      ['for (let j = f32(3); j < 8; j++) { a += hf(j); }', 3 + 4 + 5 + 6 + 7],
      // Value that changes: `j / 2` is a float division now; it was an integer one (11).
      ['for (let j = f32(3); j < 8; j++) { a += f32(j / 2); }', 12.5],
    ] as const) {
      const source = fn(body);
      const result = compile(source);
      expect(result.diagnostics).toEqual([]);
      expect(editor(source)).toEqual([]);
      expect(result.eval('t', ARGS)).toBe(value);
    }
  });

  it('unsigned arithmetic below zero wraps in a u32 counter', () => {
    // Value that changes: `j - 3` was an `i32` (-1 + 0 + 1 + 2 = 2) and is a `u32` that wraps.
    const source = fn('for (let j = u32(2); j < 6; j++) { a += f32(j - 3); }');
    const result = compile(source);
    expect(result.diagnostics).toEqual([]);
    expect(editor(source)).toEqual([]);
    const cpu = compileModule(result.module, { precision: 'f32' });
    expect((cpu.fns['t'] as (...a: readonly unknown[]) => unknown)(...ARGS)).toBe(4294967296);
  });

  it('a u32 or f32 counter used as an i32 is refused, as u32(x) is', () => {
    // Each compiled before as an `i32` loop.
    for (const [body, sentence] of [
      ['for (let j = u32(3); j < 8; j++) { a += f32(-j); }', 'Unary "-" is not defined on u32'],
      ['for (let j = u32(3); j < 8; j++) { let q: i32 = j; a += f32(q); }', 'Type mismatch'],
      [
        'for (let j = f32(0); j < ii; j++) { a += 1.; }',
        'Type mismatch: cannot compare f32 and i32',
      ],
      [
        'for (let j = f32(3); j < 8; j++) { a += f32(hi(j)); }',
        'Argument 1 of "hi" type mismatch.',
      ],
      [
        'for (let j = u32(0); j < ii; j++) { a += 1.; }',
        'Type mismatch: cannot compare u32 and i32',
      ],
      [
        'for (let j = u32(0); j < 8; j++) { a += f32(hi(j)); }',
        'Argument 1 of "hi" type mismatch.',
      ],
    ] as const) {
      const source = fn(body);
      const lines = compile(source).diagnostics.map((d) => `${d.code}: ${d.message}`);
      expect(lines).toEqual([expect.stringContaining(sentence)]);
      expect(editor(source)).toEqual(lines);
    }
  });

  it('a u32 counter that counts down to zero leaves its type (TS8006)', () => {
    const source = fn('for (let j = u32(3); j >= 0; j--) { a += 1.; if (a > 9.) { break; } }');
    const lines = compile(source).diagnostics.map((d) => `${d.code}: ${d.message}`);
    expect(lines).toEqual([expect.stringMatching(/^TS8006: /)]);
    expect(editor(source)).toEqual(lines);
  });
});
