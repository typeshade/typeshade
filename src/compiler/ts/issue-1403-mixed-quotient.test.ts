import { describe, expect, it } from 'vitest';
import { bothRefuse, bothTake } from '../../core/testing/both-halves.js';
import { compileModule } from '../../core/oracle.js';
import { optimizeAt, type OptLevel } from '../../core/passes/opt/optimize.js';

const LEVELS: readonly OptLevel[] = ['O0', 'O1', 'O2'];

const program = (result: string, body: string): string =>
  `"use typeshade";\nfunction pass(v: u32) { return v; }\n` +
  `export function t(ii: i32, vi: u32, f: f32): ${result} {\n  let a = (-7 | 0);\n  let b = pass(vi);\n  ${body}\n}\n`;

const valuesAt = (source: string, args: readonly unknown[]): unknown[] => {
  const { result } = bothTake(source);
  return LEVELS.map((level) => {
    const cpu = compileModule(optimizeAt(result.module, level), { precision: 'f32' });
    return (cpu.fns['t'] as (...a: readonly unknown[]) => unknown)(...args);
  });
};

const at = (value: number): number[] => LEVELS.map(() => value);
const toUint32 = (x: number): number => Math.trunc(x) >>> 0;

const refusal = (quotient: string, subject: string, edit: string, kind: string): string =>
  `"${subject}" is an integer by its bit operator, and no operand of "${quotient}" has a ` +
  `declared type, so the "/" does not say which division it is. Write "${edit}" for the ${kind} division.`;

const noEdit = (quotient: string, subject: string): string =>
  `"${subject}" is an integer by its bit operator, and no operand of "${quotient}" has a ` +
  `declared type, so the "/" does not say which division it is. ` +
  `Declare the type of the division's operands to choose it.`;

describe('a quotient of an inferred i32 and an inferred u32 operand is refused (issue 1403)', () => {
  it("refuses the issue's program in both halves, and names no edit for u32()", () => {
    const sentence = noEdit('a / b', 'a');
    bothRefuse(program('f32', 'return f32(u32(a / b));'), 'TS8003', sentence);
    bothRefuse(program('u32', 'return u32(a / b);'), 'TS8003', sentence);
  });

  it('refuses the operands swapped, and names no edit for u32()', () => {
    const sentence = noEdit('b / a', 'b');
    bothRefuse(program('f32', 'return f32(u32(b / a));'), 'TS8003', sentence);
    bothRefuse(program('u32', 'return u32(b / a);'), 'TS8003', sentence);
  });

  it('does not name the i32 edit, which is wrong for a u32 operand past 2^31', () => {
    const edited = program('u32', 'return u32(i32(a) / i32(b));');
    expect(valuesAt(edited, [-9, 3, 1.5])).toEqual(at(toUint32(-7 / 3)));
    expect(valuesAt(edited, [-9, 4294967295, 1.5])).not.toEqual(at(toUint32(-7 / 4294967295)));
    expect(noEdit('a / b', 'a')).not.toContain('i32(a) / i32(b)');
  });

  it('refuses i32() of the quotient with the float edit, which gives TypeScript value', () => {
    const forward = refusal('a / b', 'a', 'f32(a) / f32(b)', 'float');
    bothRefuse(program('f32', 'return f32(i32(a / b));'), 'TS8003', forward);
    bothRefuse(program('i32', 'return i32(a / b);'), 'TS8003', forward);
    const swapped = refusal('b / a', 'b', 'f32(b) / f32(a)', 'float');
    bothRefuse(program('i32', 'return i32(b / a);'), 'TS8003', swapped);
    expect(valuesAt(program('i32', 'return i32(f32(a) / f32(b));'), [-9, 3, 1.5])).toEqual(
      at(Math.trunc(-7 / 3)),
    );
    expect(valuesAt(program('i32', 'return i32(f32(b) / f32(a));'), [-9, 30, 1.5])).toEqual(
      at(Math.trunc(30 / -7)),
    );
    for (const vi of [3, 2147483648, 4294967295]) {
      expect(valuesAt(program('i32', 'return i32(f32(a) / f32(b));'), [-9, vi, 1.5])).toEqual(
        at(Math.trunc(-7 / vi)),
      );
    }
  });

  it('still takes a quotient whose operands share one integer type', () => {
    const same = 'let c = (-7 | 0);\n  return u32(c / 2);';
    expect(valuesAt(program('u32', same), [-9, 3, 1.5])).toEqual(at(toUint32(-7 / 2)));
    const typed = 'return u32(ii / 2);';
    expect(valuesAt(program('u32', typed), [-9, 3, 1.5])).toEqual(at(toUint32(-9 / 2)));
  });
});
