import { describe, expect, it } from 'vitest';
import { bothRefuse, bothTake } from '../../core/testing/both-halves.js';
import { compileModule } from '../../core/oracle.js';
import { optimizeAt, type OptLevel } from '../../core/passes/opt/optimize.js';
import { emitModule } from '../../core/backends/wgsl.js';

const HELPERS = 'function pass(v: u32) {\n  return v;\n}\n';

const program = (result: string, body: string): string =>
  `"use typeshade";\n${HELPERS}export function t(ii: i32, vi: u32): ${result} {\n  ${body}\n}\n`;

const LEVELS: readonly OptLevel[] = ['O0', 'O1', 'O2'];

const valuesAt = (source: string, args: readonly unknown[] = [0, 7]): unknown[] => {
  const { result } = bothTake(source);
  return LEVELS.map((level) => {
    const cpu = compileModule(optimizeAt(result.module, level), { precision: 'f32' });
    return (cpu.fns['t'] as (...a: readonly unknown[]) => unknown)(...args);
  });
};

const at = (value: number): number[] => LEVELS.map(() => value);
const toUint32 = (x: number): number => Math.trunc(x) >>> 0;
const toInt32 = (x: number): number => Math.trunc(x) | 0;

const C = 'let c = (3000000000|0);\n  let d = c;\n  ';
const TS_C = 3000000000 | 0;

const numbers = (name: string, u32: number, ts: number, edit: string): string =>
  `"${name}" is ${String(u32)} on its u32 bits and ${String(ts)} in TypeScript, so the "/" does ` +
  `not say which value it means. Write "${edit}" for the ${edit.slice(0, 3)} value.`;

const unproven = (name: string): string =>
  `The compiler cannot prove that the u32 bits and the TypeScript value of "${name}" agree, so ` +
  `the "/" does not say which value it means. Write "u32(${name})" for the u32 value.`;

describe('a u32 quotient of a binding that holds a u32 tree is refused (issue 1363, D2)', () => {
  it("refuses the issue's program in both halves, and its edit gives TypeScript's value", () => {
    bothRefuse(
      program('u32', `${C}return d / 7;`),
      'TS8003',
      numbers('d', 3000000000, TS_C, 'u32(d)'),
    );
    expect(valuesAt(program('u32', `${C}return u32(d) / 7;`))).toEqual(
      at(toUint32(toUint32(TS_C) / 7)),
    );
  });

  it('accepts the written type, which reads the u32 bits', () => {
    const source = program('u32', 'let c = (3000000000|0);\n  let d: u32 = c;\n  return d / 7;');
    expect(valuesAt(source)).toEqual(at(Math.trunc(3000000000 / 7)));
    expect(emitModule(bothTake(source).result.module)).toContain('/ 7u');
  });

  it("keeps D-b's refusal inside f32(), and its edit gives TypeScript's value", () => {
    bothRefuse(
      program('f32', `${C}return f32(d / 7);`),
      'TS8003',
      '"d" is an integer by its bit operator, and no operand of "d / 7" has a declared type, so ' +
        'the "/" does not say which division it is. Write "f32(i32(d)) / 7" for the float division.',
    );
    expect(valuesAt(program('f32', `${C}return f32(f32(i32(d)) / 7);`))).toEqual(
      at(Math.fround(TS_C / 7)),
    );
  });

  it("refuses every u32 reading of the quotient, and each named edit gives TypeScript's value", () => {
    const R = 'let c = (3000000000|0);\n  ';
    const cases: readonly (readonly [string, string, string, string, string, number])[] = [
      ['u32', `${R}return c / 7;`, 'c', 'u32(c)', `${R}return u32(c) / 7;`, 428571428],
      ['u32', `${C}return 7 / d;`, 'd', 'u32(d)', `${C}return 7 / u32(d);`, toUint32(7 / 3e9)],
      [
        'u32',
        `${C}return u32(d / 7);`,
        'd',
        'i32(d)',
        `${C}return u32(i32(d) / 7);`,
        toUint32(TS_C / 7),
      ],
      [
        'i32',
        `${C}return i32(d / 7);`,
        'd',
        'i32(d)',
        `${C}return i32(i32(d) / 7);`,
        toInt32(TS_C / 7),
      ],
      [
        'u32',
        `${C}let e: u32 = d / 7;\n  return e;`,
        'd',
        'u32(d)',
        `${C}let e: u32 = u32(d) / 7;\n  return e;`,
        428571428,
      ],
    ];
    for (const [result, body, name, edit, edited, value] of cases) {
      bothRefuse(program(result, body), 'TS8003', numbers(name, 3000000000, TS_C, edit));
      expect(valuesAt(program(result, edited))).toEqual(at(value));
    }
    const f = 'let c = (0xF0000000|0);\n  let d = c;\n  ';
    bothRefuse(
      program('u32', `${f}return u32(d / 16);`),
      'TS8003',
      numbers('d', 0xf0000000, 0xf0000000 | 0, 'i32(d)'),
    );
    expect(valuesAt(program('u32', `${f}return u32(i32(d) / 16);`))).toEqual(
      at(toUint32((0xf0000000 | 0) / 16)),
    );
  });

  it('states no numbers where a reassigned variable or a second value reaches the operand', () => {
    for (const body of [
      `${C}d = d + 1;\n  return d / 7;`,
      `${C}if (vi > 3) {\n    d = (4000000000|0);\n  }\n  return d / 7;`,
      'let c = (3000000000|0);\n  let d = vi > 3 ? c : (4000000000|0);\n  return d / 7;',
    ]) {
      bothRefuse(program('u32', body), 'TS8003', unproven('d'));
    }
    bothRefuse(
      program(
        'u32',
        'let c = (3000000000|0);\n  for (let i = 0; i < 3; i++) {\n    c += (1|0);\n  }\n  return c / 7;',
      ),
      'TS8003',
      unproven('c'),
    );
    expect(valuesAt(program('u32', `${C}d = d + 1;\n  return u32(d) / 7;`))).toEqual(
      at(toUint32(toUint32(TS_C + 1) / 7)),
    );
  });

  it('keeps the refusals that D-b gave before', () => {
    bothRefuse(
      program('i32', `${C}return d / 7;`),
      'TS8003',
      '"d" is an integer by its bit operator, and no operand of "d / 7" has a declared type, so ' +
        'the "/" does not say which division it is. Write "i32(d) / 7" for the integer division.',
    );
    bothRefuse(
      program('u32', `${C}return d / 7 + vi;`),
      'TS8003',
      '"d" is an integer by its bit operator, and no operand of "d / 7" has a declared type, so ' +
        'the "/" does not say which division it is. Write "u32(d) / 7" for the integer division.',
    );
  });

  it('leaves typed u32 division as it was', () => {
    for (const body of [
      'return vi / 7;',
      'let b: u32 = vi;\n  return b / 7;',
      'let b = pass(vi);\n  return b / 7;',
    ]) {
      expect(valuesAt(program('u32', body), [0, 7])).toEqual(at(1));
      expect(valuesAt(program('u32', body), [0, 4294967295])).toEqual(at(613566756));
    }
  });
});
