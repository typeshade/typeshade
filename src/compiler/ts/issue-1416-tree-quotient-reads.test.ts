import { describe, expect, it } from 'vitest';
import { bothRefuse, bothTake } from '../../core/testing/both-halves.js';
import { compileModule } from '../../core/oracle.js';
import { optimizeAt, type OptLevel } from '../../core/passes/opt/optimize.js';

const program = (result: string, body: string): string =>
  `"use typeshade";\nexport function t(ii: i32, vi: u32, f: f32): ${result} {\n  ${body}\n}\n`;

const LEVELS: readonly OptLevel[] = ['O0', 'O1', 'O2'];

const valuesAt = (source: string, args: readonly unknown[] = [-9, 7, 1.5]): unknown[] => {
  const { result } = bothTake(source);
  return LEVELS.map((level) => {
    const cpu = compileModule(optimizeAt(result.module, level), { precision: 'f32' });
    return (cpu.fns['t'] as (...a: readonly unknown[]) => unknown)(...args);
  });
};

const at = (value: number): number[] => LEVELS.map(() => value);
const toInt32 = (x: number): number => Math.trunc(x) | 0;
const toUint32 = (x: number): number => Math.trunc(x) >>> 0;

const C = 'let c = (3000000000|0);\n  let d = c;\n  ';
const A = 'let a = 1 << 30;\n  let b = a + a;\n  ';
const TS_D = 3000000000 | 0;
const TS_B = 2 ** 30 + 2 ** 30;

const numbers = (name: string, edit?: string): string =>
  `"${name}" is 3000000000 on its u32 bits and ${String(TS_D)} in TypeScript, so the "/" does ` +
  `not say which value it means.${edit === undefined ? '' : ` Write "${edit}" for the i32 value.`}`;

const unproven = (name: string, edit = true): string =>
  `The compiler cannot prove that the u32 bits and the TypeScript value of "${name}" agree, so ` +
  `the "/" does not say which value it means.${edit ? ` Write "i32(${name})" for the i32 value.` : ''}`;

const division = (subject: string, text: string, remedy: string): string =>
  `"${subject}" is an integer by its bit operator, and no operand of "${text}" has a declared ` +
  `type, so the "/" does not say which division it is. ${remedy}`;

const NO_WRAP = "Declare the type of the division's operands to choose it.";

describe('a D-b quotient of a tree whose two readings differ (issue 1416, D2)', () => {
  it("refuses a comparison of a u32 tree's quotient, and the edit gives TypeScript's value", () => {
    expect(TS_D / 7 > 5).toBe(false);
    for (const result of ['i32', 'u32']) {
      bothRefuse(
        program(result, `${C}return d / 7 > 5 ? 1 : 0;`),
        'TS8003',
        numbers('d', 'i32(d)'),
      );
      expect(valuesAt(program(result, `${C}return i32(d) / 7 > 5 ? 1 : 0;`))).toEqual(at(0));
    }
    bothRefuse(
      program('i32', 'let c = (3000000000|0);\n  return c / 7 > 5 ? 1 : 0;'),
      'TS8003',
      numbers('c', 'i32(c)'),
    );
    bothRefuse(program('i32', `${C}return d / 7 === 5 ? 1 : 0;`), 'TS8003', numbers('d', 'i32(d)'));
    bothRefuse(program('i32', `${C}return 7 / d < f ? 1 : 0;`), 'TS8003', numbers('d'));
    bothRefuse(
      program('i32', `${C}d = d + 1;\n  return d / 7 > 5 ? 1 : 0;`),
      'TS8003',
      unproven('d'),
    );
    expect(valuesAt(program('i32', `${C}d = d + 1;\n  return i32(d) / 7 > 5 ? 1 : 0;`))).toEqual(
      at(0),
    );
  });

  it("refuses a comparison of a signed tree's quotient past i32 beside no typed peer", () => {
    expect(TS_B / 7 > 5).toBe(true);
    bothRefuse(program('i32', `${A}return b / 7 > 5 ? 1 : 0;`), 'TS8003', unproven('b'));
    expect(toInt32(TS_B) / 7 > 5).toBe(false);
    expect(valuesAt(program('i32', `${A}return i32(b) / 7 > 5 ? 1 : 0;`))).toEqual(at(0));
    bothRefuse(program('i32', `${A}return b / 7 > f ? 1 : 0;`), 'TS8003', unproven('b', false));
    bothRefuse(
      program('i32', `${A}return b / 7 > ii ? 1 : 0;`),
      'TS8003',
      division('b', 'b / 7', 'Write "i32(b) / 7" for the integer division.'),
    );
  });

  it('names no edit where the quotient reaches u32() or an index, which read a negative value', () => {
    expect(toUint32(TS_D / 7 / 1)).toBe(4109971968);
    bothRefuse(
      program('u32', `${C}return u32(d / 7 / 1);`),
      'TS8003',
      division('d', 'd / 7', NO_WRAP),
    );
    expect(valuesAt(program('u32', `${C}return u32(f32(i32(d)) / 7 / 1);`))).toEqual(at(0));
    bothRefuse(
      program('i32', `${C}let xs = array<i32, 5>(1, 2, 3, 4, 5);\n  return xs[d / 1000000000];`),
      'TS8003',
      division('d', 'd / 1000000000', NO_WRAP),
    );
  });

  it("names an edit beside a u32 peer that keeps TypeScript's value of the tree", () => {
    const value = toUint32(TS_D / 7 + 7);
    expect(value).toBe(4109971975);
    bothRefuse(
      program('u32', `${C}return d / 7 + vi;`),
      'TS8003',
      division('d', 'd / 7', 'Write "u32(i32(d) / 7)" for the integer division.'),
    );
    expect(valuesAt(program('u32', `${C}return u32(i32(d) / 7) + vi;`))).toEqual(at(value));
  });

  it('keeps the integer quotient of a tree that is no u32 refused once in a stated position', () => {
    const S = 'let d = (1|0);\n  d += (2999999999|0);\n  ';
    const fit =
      'The value has to fit: 2999999999 is outside i32, which holds -2147483648 to 2147483647 (§13).';
    bothRefuse(program('i32', `${S}return i32(d / 7);`), 'TS8003', fit);
    bothRefuse(program('u32', `${S}return u32(d / 7);`), 'TS8003', fit);
    bothRefuse(program('u32', `${S}return d / 7;`), 'TS8003', [
      fit,
      division('d', 'd / 7', 'Write u32(…) around "d" to choose the division.'),
    ]);
  });

  it('leaves agreeing trees, typed division and the other D-b refusals as they were', () => {
    const G = 'let a = 1 << 20;\n  let b = a + a;\n  ';
    expect(valuesAt(program('i32', `${G}return b / 7 > 5 ? 1 : 0;`))).toEqual(at(1));
    expect(valuesAt(program('i32', 'let a = (5|0);\n  return a / 2 > 2 ? 1 : 0;'))).toEqual(at(1));
    expect(valuesAt(program('i32', 'return ii / 7 > 5 ? 1 : 0;'), [100, 7, 1.5])).toEqual(at(1));
    expect(valuesAt(program('i32', 'return ii / 7;'))).toEqual(at(-1));
    expect(valuesAt(program('u32', 'return vi / 7;'))).toEqual(at(1));
    expect(valuesAt(program('i32', 'let x: u32 = vi;\n  return x / 7 > vi ? 1 : 0;'))).toEqual(
      at(0),
    );
    bothRefuse(
      program('f32', `${C}return f32(d / 7);`),
      'TS8003',
      division('d', 'd / 7', 'Write "f32(i32(d)) / 7" for the float division.'),
    );
    bothRefuse(
      program('u32', 'let a = (5|0);\n  return u32(a / 2 / 1);'),
      'TS8003',
      division('a', 'a / 2', 'Write "f32(a) / 2" for the float division.'),
    );
    bothRefuse(
      program('u32', `${A}return b / 7 + vi;`),
      'TS8003',
      division('b', 'b / 7', 'Write "u32(b) / 7" for the integer division.'),
    );
  });
});
