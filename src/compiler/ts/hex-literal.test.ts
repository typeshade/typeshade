// A literal written with a `0x`, `0b` or `0o` prefix is an integer whatever its digits
// (Rule 5.1, #182). The classifier used to look for `e` or `E` in the text, the test for a
// decimal exponent, without excluding the prefix, so `0xE` and every standard hash constant
// (`0x9e3779b9`, `0x85ebca6b`, ...) typed as f32.

import { describe, expect, it } from 'vitest';
import { compile } from '../../index.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const times = (lit: string): string => `"use typeshade"
export function f(x: u32): u32 {
  return x * ${lit}
}
`;

describe('an integer-written literal in any base is an integer (#182)', () => {
  const cases: [string, string][] = [
    ['0x9e3779b9', '2654435769u'],
    ['0x85ebca6b', '2246822507u'],
    ['0xc2b2ae35', '3266489909u'],
    ['0x27d4eb2f', '668265263u'],
    ['0xdeadbeef', '3735928559u'],
    ['0xBEEF', '48879u'],
    ['0xE', '14u'],
    ['0xe', '14u'],
    ['0XE', '14u'],
    ['0xff', '255u'],
    ['0xFF_FF', '65535u'],
    ['0b1011', '11u'],
    ['0B1011', '11u'],
    ['0o17', '15u'],
    ['1_000_000', '1000000u'],
  ];
  for (const [lit, emitted] of cases) {
    it(`${lit} multiplies a u32`, () => {
      const r = compile(times(lit));
      expect(r.diagnostics).toEqual([]);
      expect(r.wgsl).toContain(`return (x * ${emitted});`);
    });
  }

  it('the editor agrees: no diagnostic on a hash constant', () => {
    const service = createTypeshadeLanguageService();
    service.openDocument('a.ts', times('0x9e3779b9'));
    expect(service.getDiagnostics('a.ts')).toEqual([]);
  });

  it('a decimal exponent is still a float', () => {
    const r = compile(times('1e3'));
    expect(r.diagnostics.map((d) => d.code)).toEqual(['TS8003']);
  });

  it('a hex literal types as the decimal it spells, in every position (Rule 5.1)', () => {
    const body = (lit: string): string => `"use typeshade"
export function f(): f32 {
  const k = ${lit}
  let n: i32 = ${lit}
  return k + f32(n)
}
`;
    const hex = compile(body('0xE'));
    const dec = compile(body('14'));
    expect(hex.diagnostics).toEqual([]);
    expect(hex.wgsl).toBe(dec.wgsl);
  });
});

describe('a union of literal types reads the literal as written', () => {
  // `node.text` is normalized by TypeScript (`1.0` reads `1`, `0xE` reads `14`), so the
  // classifier reads the source text.
  it('1.0 | 2.0 is an f32', () => {
    const r = compile(`"use typeshade";
type Level = 1.0 | 2.0;
export function f(l: Level): f32 {
  return l;
}
`);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('fn f(l: f32) -> f32 {');
  });

  it('0xE | 0xF is an i32', () => {
    const r = compile(`"use typeshade";
type Nibble = 0xE | 0xF;
export function f(n: Nibble): i32 {
  return n;
}
`);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('fn f(n: i32) -> i32 {');
  });
});
