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
const toUint32 = (x: number): number => Math.trunc(x) >>> 0;
const toInt32 = (x: number): number => Math.trunc(x) | 0;

const A = 'let a = 1 << 30;\n  let b = a + a;\n  ';
const TS_B = 2 ** 30 + 2 ** 30;
const I32_B = toInt32(TS_B);

const unproven = (name: string, operator = '/'): string =>
  `The compiler cannot prove that the u32 bits and the TypeScript value of "${name}" agree, so ` +
  `the "${operator}" does not say which value it means. Write "i32(${name})" for the i32 value.`;

const db = (name: string, quotient: string, edit: string, kind: string): string =>
  `"${name}" is an integer by its bit operator, and no operand of "${quotient}" has a declared ` +
  `type, so the "/" does not say which division it is. Write "${edit}" for the ${kind} division.`;

describe('an integer quotient of a signed i32 tree past i32 is refused (issue 1412, D2)', () => {
  it("refuses the issue's program in both halves, and its edit gives TypeScript's value", () => {
    bothRefuse(program('i32', `${A}return i32(b / 7);`), 'TS8003', unproven('b'));
    expect(valuesAt(program('i32', `${A}return i32(i32(b) / 7);`))).toEqual(at(toInt32(I32_B / 7)));
  });

  it("refuses the quotient in an i32 annotation and an i32 result, and each edit's value", () => {
    const cases: readonly (readonly [string, string, string, number])[] = [
      [
        'i32',
        `${A}let r: i32 = b / 7;\n  return r;`,
        `${A}let r: i32 = i32(b) / 7;\n  return r;`,
        toInt32(I32_B / 7),
      ],
      ['i32', `${A}return b / 7;`, `${A}return i32(b) / 7;`, toInt32(I32_B / 7)],
      ['i32', `${A}return i32(7 / b);`, `${A}return i32(7 / i32(b));`, toInt32(7 / I32_B)],
      ['i32', `${A}return (b / 7) | 0;`, `${A}return (i32(b) / 7) | 0;`, toInt32(I32_B / 7)],
      ['u32', `${A}return u32(b / 7);`, `${A}return u32(i32(b) / 7);`, toUint32(I32_B / 7)],
    ];
    for (const [result, body, edited, value] of cases) {
      bothRefuse(program(result, body), 'TS8003', unproven('b'));
      expect(valuesAt(program(result, edited))).toEqual(at(value));
    }
  });

  it('refuses a reassigned signed tree, and a sum whose trip count is known only at run time', () => {
    const reassigned = `${A}b = b + 1;\n  `;
    bothRefuse(program('i32', `${reassigned}return b / 7;`), 'TS8003', unproven('b'));
    expect(valuesAt(program('i32', `${reassigned}return i32(b) / 7;`))).toEqual(
      at(toInt32(toInt32(TS_B + 1) / 7)),
    );
    const loop =
      'let a = 1 << 20;\n  let b = a;\n  for (let i = 0; i < ii; i++) {\n    b = b + a;\n  }\n  ';
    bothRefuse(program('i32', `${loop}return b / 7;`), 'TS8003', unproven('b'));
    expect(valuesAt(program('i32', `${loop}return i32(b) / 7;`), [3, 7, 1.5])).toEqual(
      at(toInt32((4 * 2 ** 20) / 7)),
    );
  });

  it('accepts a signed tree whose two readings agree, as before', () => {
    const G = 'let a = 1 << 20;\n  let b = a + a;\n  ';
    const value = toInt32((2 ** 20 + 2 ** 20) / 7);
    for (const body of [
      `${G}return i32(b / 7);`,
      `${G}let r: i32 = b / 7;\n  return r;`,
      `${G}return b / 7;`,
      `${G}b = b + 1;\n  return b / 7;`,
    ]) {
      expect(valuesAt(program('i32', body))).toEqual(at(body.includes('b + 1') ? 299593 : value));
    }
    const counted =
      'let a = 1 << 20;\n  let b = a;\n  for (let i = 0; i < 3; i++) {\n    b = b + a;\n  }\n  ';
    expect(valuesAt(program('i32', `${counted}return b / 7;`))).toEqual(
      at(toInt32((4 * 2 ** 20) / 7)),
    );
  });

  it('leaves typed i32 division as it was', () => {
    for (const body of ['return ii / 7;', 'let x: i32 = ii;\n  return x / 7;']) {
      expect(valuesAt(program('i32', body))).toEqual(at(-1));
      expect(valuesAt(program('i32', body), [2147483647, 7, 1.5])).toEqual(
        at(toInt32(2147483647 / 7)),
      );
    }
  });

  it("keeps D-b's refusal in the f32 positions, and its edit gives TypeScript's value", () => {
    for (const body of [`${A}return f32(b / 7);`, `${A}return b / 7;`]) {
      bothRefuse(program('f32', body), 'TS8003', db('b', 'b / 7', 'f32(i32(b)) / 7', 'float'));
    }
    expect(valuesAt(program('f32', `${A}return f32(f32(i32(b)) / 7);`))).toEqual(
      at(Math.fround(I32_B / 7)),
    );
    bothRefuse(
      program('f32', 'let a = 1 << 20;\n  let b = a + a;\n  return f32(b / 7);'),
      'TS8003',
      db('b', 'b / 7', 'f32(b) / 7', 'float'),
    );
  });
});
