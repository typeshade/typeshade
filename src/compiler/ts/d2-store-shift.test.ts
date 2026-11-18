import { describe, expect, it } from 'vitest';
import { bothRefuse, bothTake } from '../../core/testing/both-halves.js';

const program = (body: string, ret: string, pre = ''): string =>
  `"use typeshade";\n${pre}export function t(ii: i32, vi: u32, f: f32): ${ret} {\n  ${body}\n}\n`;
const run = (source: string): unknown => bothTake(source).result.eval('t', [-3, 7, 2.5]);
const unproven = (subject: string, at: string, edit: string): string =>
  `The compiler cannot prove that the u32 bits and the TypeScript value of "${subject}" agree, ` +
  `so the "${at}" does not say which value it means. Write "${edit}" for the ${edit.slice(0, 3)} value.`;
const proven = (subject: string, u: number, t: number, at: string, edit: string): string =>
  `"${subject}" is ${String(u)} on its u32 bits and ${String(t)} in TypeScript, so the "${at}" ` +
  `does not say which value it means. Write "${edit}" for the ${edit.slice(0, 3)} value.`;

const TREE = 'let c = (3000000000|0);\n  ';
const ISSUE = (amount: string): string =>
  `let a: i32 = ${amount};\n  ${TREE}c = 9;\n  return f32(((c << a) < vi) ? 1 : 0);`;

describe('issue 1331: a u32 tree variable keeps two readings through a store and a shift (D2)', () => {
  it.each([['31'], ['-1'], ['((-7|0)/(6^3))']])(
    'the program of the issue with a: i32 = %s is refused in both halves',
    (amount) => {
      const source = program(ISSUE(amount), 'f32');
      bothRefuse(source, 'TS8003', unproven('c << a', '<', 'u32(c << a)'));
      expect(run(source.replace('(c << a) <', 'u32(c << a) <'))).toBe(0);
    },
  );

  it('a typed shift amount alone leaves the shift unproven', () => {
    const source = program(`let a: i32 = 2;\n  ${TREE}return f32(((c << a) < vi) ? 1 : 0);`, 'f32');
    bothRefuse(source, 'TS8003', unproven('c << a', '<', 'u32(c << a)'));
    expect(run(source.replace('(c << a) <', 'u32(c << a) <'))).toBe(0);
  });

  it.each([
    ['f32(c << 31)', 'c = 9;\n  return f32(c << 31);', 'f32', 'f32()', 'i32', -2147483648],
    ['(c << 31) / 2', 'c = 9;\n  return (c << 31) / 2;', 'u32', '/', 'u32', 1073741824],
    ['(c << 31) < vi', 'c = 9;\n  return ((c << 31) < vi) ? 1.0 : 0.0;', 'f32', '<', 'u32', 0],
  ] as const)(
    'a written number stored in the variable is read on its u32 bits: %s',
    (_, body, ret, at, type, value) => {
      const source = program(TREE + body, ret);
      bothRefuse(
        source,
        'TS8003',
        proven('c << 31', 2147483648, -2147483648, at, `${type}(c << 31)`),
      );
      const wrapped = at === 'f32()' ? 'f32(i32(c << 31))' : `${type}(c << 31)`;
      const from = at === 'f32()' ? 'f32(c << 31)' : '(c << 31)';
      expect(run(source.replace(from, wrapped))).toBe(value);
    },
  );

  it('a store the walk cannot read beside the tree is unproven: c = vi', () => {
    const source = program(`${TREE}c = vi;\n  return f32(c << 31);`, 'f32');
    bothRefuse(source, 'TS8003', unproven('c << 31', 'f32()', 'i32(c << 31)'));
    expect(run(source.replace('f32(c << 31)', 'f32(i32(c << 31))'))).toBe(-2147483648);
  });

  it.each([
    [
      'no store, a written amount whose readings agree',
      `${TREE}return f32(((c << 31) < vi) ? 1 : 0);`,
      'f32',
      1,
    ],
    ['a store and a typed peer of +', `${TREE}c = 9;\n  return c + vi;`, 'u32', 16],
    [
      'a conversion before the shift',
      `${TREE}c = 9;\n  return f32(i32(c) << 31);`,
      'f32',
      -2147483648,
    ],
    ['a typed left operand', 'let a: i32 = 31;\n  return vi << a;', 'u32', 2147483648],
  ] as const)('a neighbour whose readings agree still compiles: %s', (_, body, ret, value) => {
    expect(run(program(body, ret))).toBe(value);
  });

  it('an exported function with no written result refuses to return such a shift', () => {
    const exported = (ret: string): string =>
      `"use typeshade";\nexport function g(vi: u32) {\n  ${TREE}c = 9;\n  return ${ret};\n}\n`;
    bothRefuse(exported('c << vi'), 'TS8003', unproven('c << vi', 'return', 'i32(c << vi)'));
    expect(bothTake(exported('i32(c << vi)')).result.eval('g', [31])).toBe(-2147483648);
  });

  const AMOUNT = 'c = 1073741824;\n  let a: i32 = 1;\n  ';
  const SHIFT = 'c << (vi > 3 ? a : 31)';
  it.each([
    [
      'f32()',
      `${AMOUNT}return f32(${SHIFT});`,
      'f32',
      `f32(${SHIFT})`,
      `f32(i32(${SHIFT}))`,
      'i32',
      -2147483648,
    ],
    [
      '<',
      `${AMOUNT}return ((${SHIFT}) < vi) ? 1.0 : 0.0;`,
      'f32',
      `(${SHIFT}) <`,
      `u32(${SHIFT}) <`,
      'u32',
      0,
    ],
    [
      '/',
      `${AMOUNT.replace('i32', 'u32')}return (${SHIFT}) / 2;`,
      'u32',
      `(${SHIFT}) /`,
      `u32(${SHIFT}) /`,
      'u32',
      1073741824,
    ],
  ] as const)(
    'review of #1354: a shift amount with a typed arm is unproven, at %s',
    (at, body, ret, from, to, type, value) => {
      const source = program(TREE + body, ret);
      bothRefuse(source, 'TS8003', unproven(SHIFT, at, `${type}(${SHIFT})`));
      expect(run(source.replace(from, to))).toBe(value);
    },
  );

  it.each([
    ['[c, d] = [d, c]', 'let d = 9;\n  [c, d] = [d, c];\n  '],
    ['[c] = [9]', '[c] = [9];\n  '],
  ])('review of #1354: a store through a destructuring pattern is unproven: %s', (_, store) => {
    const source = program(`${TREE}${store}return f32(c << 31);`, 'f32');
    bothRefuse(source, 'TS8003', unproven('c << 31', 'f32()', 'i32(c << 31)'));
    expect(run(source.replace('f32(c << 31)', 'f32(i32(c << 31))'))).toBe(-2147483648);
  });

  const G = 'function g(b: bool) {\n  if (b) {\n    return (3000000000|0);\n  }\n  return 9;\n}\n';
  it.each([
    ['select', '', 'select(9, (3000000000|0), vi < 3) << 31', ''],
    ['a function of mixed returns', G, 'g(vi < 3) << 31', ''],
    [
      'a variable a tree peer types',
      '',
      'c << 31',
      'let c = 9;\n  let t = (3000000000|0);\n  let x = c + t;\n  ',
    ],
  ])('review of #1354: a number beside a u32 tree takes its bits: %s', (_, pre, subject, body) => {
    const source = program(`${body}return f32(${subject});`, 'f32', pre);
    bothRefuse(
      source,
      'TS8003',
      proven(subject, 2147483648, -2147483648, 'f32()', `i32(${subject})`),
    );
    expect(run(source.replace(`f32(${subject})`, `f32(i32(${subject}))`))).toBe(-2147483648);
  });

  it('re-review of #1354: a constant trip count bounds the values, so the loop compiles to 243', () => {
    const body =
      'let t = (3000000000|0);\n  let acc = 1;\n  for (let k = 0; k < 5; k++) {\n    acc = acc * 3;\n  }\n  let x = acc ^ t;\n  return f32(acc);';
    const source = program(body, 'f32');
    expect(run(source)).toBe(243);
    expect(run(source.replace('f32(acc)', 'f32(i32(acc))'))).toBe(243);
  });
});
