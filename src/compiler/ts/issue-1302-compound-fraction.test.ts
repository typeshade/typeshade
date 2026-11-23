import { describe, it } from 'vitest';
import { bothRefuse, bothTake } from '../../core/testing/both-halves.js';

const program = (body: string): string =>
  `"use typeshade";\nexport function t(ii: i32, vi: u32): i32 {\n  ${body}\n}\n`;

const mismatch = (op: string, kind: string): string =>
  `Type mismatch: cannot ${op} ${kind} and f32 — no implicit int/float conversion. ` +
  `Cast explicitly: f32(intVal) or i32(floatVal) / u32(floatVal).`;

describe('a compound assignment of a fraction over an integer variable (issue 1302)', () => {
  it('refuses each program in both halves as a type mismatch', () => {
    const cases: readonly (readonly [string, string, string])[] = [
      ['let a = ii;\n  a *= 0.5;\n  return a;', '*=', 'i32'],
      ['let a = 1 | 2;\n  a += 0.5;\n  return a;', '+=', 'i32'],
      ['const K = 1 | 2;\n  let a = K;\n  a *= 0.5;\n  return a;', '*=', 'i32'],
      ['let a = vi;\n  a *= 0.5;\n  return i32(a);', '*=', 'u32'],
    ];
    for (const [body, op, kind] of cases) {
      bothRefuse(program(body), 'TS8003', mismatch(op, kind));
    }
  });

  it('refuses the expanded form with the same code', () => {
    bothRefuse(program('let a = ii;\n  a = a * 0.5;\n  return a;'), 'TS8003', mismatch('*', 'i32'));
  });

  it('takes an integer operand and a float target', () => {
    bothTake(program('let a = ii;\n  a *= 2;\n  return a;'));
    bothTake(program('let f = 1.5;\n  f *= 0.5;\n  return i32(f);'));
  });
});
