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

const LOOP = (n: number, add: string): string =>
  `let s = 0;\n  for (let i = 0; i < ${String(n)}; i++) {\n    s += ${add};\n  }\n  `;
const ISSUE = LOOP(3, 'max(((3000000000|0) ^ (-7|0)), (6^3))');
const FOUR = 'const c = 2000000000 + 2000000000;\n  ';

describe('issue 1309: a tree-origin integer keeps its two readings (D2)', () => {
  it.each([
    ['the accumulator of the issue', `${ISSUE}return f32(s);`, 'f32', 's', 'f32()', -410065429],
    ['1 << 31', 'let a = 1 << 31;\n  return f32(a + a);', 'f32', 'a + a', 'f32()', 0],
    [
      '(0x7FFFFFFF + 1) | 0',
      'let a = (0x7FFFFFFF + 1) | 0;\n  return f32(a + a);',
      'f32',
      'a + a',
      'f32()',
      0,
    ],
    [
      'a |= 1073741824 (seed 7070, #1884)',
      'let a = (5|0);\n  a |= 1073741824;\n  let d = a + a + a;\n  return d % 7;',
      'i32',
      'd',
      '%',
      0,
    ],
    [
      'forty additions, past what the walk follows',
      `${LOOP(40, '(1|2)')}return f32(s);`,
      'f32',
      's',
      'f32()',
      120,
    ],
  ] as const)(
    '%s is refused in both halves, and its edit compiles',
    (_, body, ret, subject, at, value) => {
      const source = program(body, ret);
      bothRefuse(source, 'TS8003', unproven(subject, at, `i32(${subject})`));
      const fixed =
        at === 'f32()'
          ? source.replace(`f32(${subject})`, `f32(i32(${subject}))`)
          : source.replace(`return ${subject} %`, `return i32(${subject}) %`);
      expect(fixed).not.toEqual(source);
      expect(run(fixed)).toBe(value);
    },
  );

  it.each([
    [
      'b = b * 2',
      'let b = 1500000000;\n  b = b * 2;\n  let c = b | 0;\n  ',
      'c + c',
      1705032704,
      -2589934592,
      '',
    ],
    ['a constant past i32', `${FOUR}let d = c | 0;\n  `, 'd + d', 3705032704, -589934592, ''],
    [
      'a module constant',
      'let d = K | 0;\n  ',
      'd + d',
      3705032704,
      -589934592,
      'const K = 2000000000 + 2000000000;\n',
    ],
    [
      'a product',
      'const k = 1500000000 * 2;\n  let d = k | 0;\n  ',
      'd + d',
      1705032704,
      -2589934592,
      '',
    ],
    ['the root itself', FOUR, 'c | 0', 4000000000, -294967296, ''],
  ] as const)(
    'a computed number past i32 starts a tree through a variable: %s',
    (_, body, subject, u, t, pre) => {
      const source = program(`${body}return f32(${subject});`, 'f32', pre);
      bothRefuse(source, 'TS8003', proven(subject, u, t, 'f32()', `i32(${subject})`));
      expect(run(source.replace(`f32(${subject})`, `f32(i32(${subject}))`))).toBe(t | 0);
    },
  );

  it.each([
    ['a tree that stays in range', 'let a = 5 | 0;\n  return f32(a - 10);', -5],
    ['a constant trip count', `${LOOP(4, '(1|2)')}return f32(s);`, 12],
    [
      'bit operators alone',
      'let h = 1 | 0;\n  for (let i = 0; i < 100; i++) {\n    h = h ^ (h << 13);\n  }\n  return f32(h);',
      1,
    ],
    [
      'an integer typed by a typed peer only (Rule 1.3, out of scope)',
      'let s = 0;\n  s += ii;\n  return f32(s);',
      -3,
    ],
    ['a conversion', 'let a = 1 << 31;\n  return f32(i32(a + a));', 0],
  ] as const)('a neighbour still compiles with its value: %s', (_, body, value) => {
    expect(run(program(body, 'f32'))).toBe(value);
  });
});
