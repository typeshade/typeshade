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

const A = 'let a = 1 << 30;\n  let b = a + a;\n  ';
const Q = 'let p = 1 << 20;\n  let q = p + p;\n  ';
const TS_B = 2 ** 30 + 2 ** 30;
const I32_B = toInt32(TS_B);
const Q_VALUE = 2 ** 20 + 2 ** 20;

const unproven = (name: string, operator = '/'): string =>
  `The compiler cannot prove that the u32 bits and the TypeScript value of "${name}" agree, so ` +
  `the "${operator}" does not say which value it means. Write "i32(${name})" for the i32 value.`;

describe('a signed tree past i32 beside a typed i32 operand is refused (issue 1424, D2)', () => {
  it("refuses the issue's program and its neighbours in both halves, with each edit's value", () => {
    expect(toInt32(TS_B / -9)).toBe(-238609294);
    const cases: readonly (readonly [string, string, number])[] = [
      [`${A}return i32(b / ii);`, `${A}return i32(i32(b) / ii);`, toInt32(I32_B / -9)],
      [`${A}return i32(ii / b);`, `${A}return i32(ii / i32(b));`, toInt32(-9 / I32_B)],
      [
        `${A}let r: i32 = b / ii;\n  return r;`,
        `${A}let r: i32 = i32(b) / ii;\n  return r;`,
        toInt32(I32_B / -9),
      ],
      [`${A}return b / ii;`, `${A}return i32(b) / ii;`, toInt32(I32_B / -9)],
    ];
    for (const [body, edited, value] of cases) {
      bothRefuse(program('i32', body), 'TS8003', unproven('b'));
      expect(valuesAt(program('i32', edited))).toEqual(at(value));
    }
  });

  it('refuses the tree beside an agreeing tree that becomes a typed i32', () => {
    expect(toInt32(TS_B / Q_VALUE)).toBe(1024);
    for (const [body, edited] of [
      [`${A}${Q}return i32(b / q);`, `${A}${Q}return i32(i32(b) / q);`],
      [`${A}${Q}let r: i32 = b / q;\n  return r;`, `${A}${Q}let r: i32 = i32(b) / q;\n  return r;`],
    ] as const) {
      bothRefuse(program('i32', body), 'TS8003', unproven('b'));
      expect(valuesAt(program('i32', edited))).toEqual(at(toInt32(I32_B / Q_VALUE)));
    }
  });

  it("names no D-b edit that leads into the refusal, and D2's edit gives TypeScript's value", () => {
    const C = 'let c = 1 << 4;\n  let d = c + c;\n  ';
    expect(toInt32(TS_B / 8)).toBe(268435456);
    bothRefuse(
      program('i32', `${A}${C}return i32(b / (d / 4));`),
      'TS8003',
      '"d" is an integer by its bit operator, and no operand of "d / 4" has a declared type, so ' +
        'the "/" does not say which division it is. Write i32(…) around "d" to choose the division.',
    );
    bothRefuse(program('i32', `${A}${C}return i32(b / (i32(d) / 4));`), 'TS8003', unproven('b'));
    expect(valuesAt(program('i32', `${A}${C}return i32(i32(b) / (i32(d) / 4));`))).toEqual(
      at(toInt32(I32_B / 8)),
    );
    bothRefuse(
      program('i32', `let a = 1 << 20;\n  let b = a + a;\n  ${C}return i32(b / (d / 4));`),
      'TS8003',
      '"d" is an integer by its bit operator, and no operand of "d / 4" has a declared type, so ' +
        'the "/" does not say which division it is. Write "i32(d) / 4" for the integer division.',
    );
  });

  it("refuses the tree's % and comparisons beside a typed i32, with each edit's value", () => {
    expect([TS_B % -9, TS_B < -9, TS_B === -9]).toEqual([2, false, false]);
    const cases: readonly (readonly [string, string, string, number])[] = [
      ['%', `${A}return i32(b % ii);`, `${A}return i32(i32(b) % ii);`, I32_B % -9],
      ['<', `${A}return b < ii ? 1 : 0;`, `${A}return i32(b) < ii ? 1 : 0;`, 1],
      ['===', `${A}return b === ii ? 1 : 0;`, `${A}return i32(b) === ii ? 1 : 0;`, 0],
    ];
    for (const [operator, body, edited, value] of cases) {
      bothRefuse(program('i32', body), 'TS8003', unproven('b', operator));
      expect(valuesAt(program('i32', edited))).toEqual(at(value));
    }
  });

  it('refuses a sum whose trip count is known only at run time beside a typed i32', () => {
    const loop = (trips: string): string =>
      `let a = 1 << 20;\n  let b = a;\n  for (let i = 0; i < ${trips}; i++) {\n    b = b + a;\n  }\n  `;
    bothRefuse(program('i32', `${loop('ii')}return i32(b / ii);`), 'TS8003', unproven('b'));
    expect(valuesAt(program('i32', `${loop('ii')}return i32(i32(b) / ii);`), [3, 7, 1.5])).toEqual(
      at(toInt32((4 * 2 ** 20) / 3)),
    );
    expect(valuesAt(program('i32', `${loop('3')}return i32(b / ii);`), [3, 7, 1.5])).toEqual(
      at(toInt32((4 * 2 ** 20) / 3)),
    );
  });

  it('leaves agreeing trees beside typed operands, typed i32 division and f32 as they were', () => {
    const G = 'let a = 1 << 20;\n  let b = a + a;\n  ';
    expect(valuesAt(program('i32', `${G}return i32(b / ii);`))).toEqual(at(toInt32(Q_VALUE / -9)));
    expect(valuesAt(program('i32', `${G}let r: i32 = b / ii;\n  return r;`))).toEqual(
      at(toInt32(Q_VALUE / -9)),
    );
    expect(valuesAt(program('i32', `${G}${Q}return i32(b / q);`))).toEqual(at(1));
    expect(valuesAt(program('i32', `${G}b = b + 1;\n  return i32(b / ii);`))).toEqual(
      at(toInt32((Q_VALUE + 1) / -9)),
    );
    expect(valuesAt(program('i32', 'return i32(ii / 7);'))).toEqual(at(-1));
    expect(valuesAt(program('i32', 'let x: i32 = ii;\n  return ii / x;'))).toEqual(at(1));
    expect(valuesAt(program('i32', `${A}return i32(b * ii);`))).toEqual(at(toInt32(TS_B * -9)));
    bothRefuse(program('f32', `${A}return f32(b) / f;`), 'TS8003', unproven('b', 'f32()'));
    bothRefuse(
      program('i32', 'let c = (3000000000|0);\n  let d = c;\n  return i32(d / ii);'),
      'TS8003',
      'Type mismatch: cannot / u32 and i32 — WGSL has no implicit integer conversion. Cast one ' +
        'side: u32(…) or i32(…), e.g. a + u32(b).',
    );
  });
});
