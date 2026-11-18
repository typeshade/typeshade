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

  const LOOP_H = 'let h = 1 | 0;\n  for (let i = 0; i < 3; i++) {\n    ';
  it.each([
    ['-(5 | 0) * 1e9', 'let a = -(5 | 0);\n  ', 'a * 1000000000', -705032704],
    ['-(1 << 30) three times', 'let a = -(1 << 30);\n  ', 'a + a + a', 1073741824],
    ['-((1<<30)|0) * 4', 'let a = -((1<<30)|0);\n  ', 'a * 4', 0],
    ['s++', 'let s = 2147483647 | 0;\n  s++;\n  ', 's', -2147483648],
    ['s--', 'let s = (-2147483647 - 1) | 0;\n  s--;\n  ', 's', 2147483647],
    ['h = h + i * 1e9', `${LOOP_H}h = h + i * 1000000000;\n  }\n  `, 'h', -1294967295],
    ['h += i * 1e9', `${LOOP_H}h += i * 1000000000;\n  }\n  `, 'h', -1294967295],
    [
      'a while loop',
      'let h = 7 | 0;\n  let k = 0;\n  while (k < 3) {\n    k = k + 1;\n    h = h + k * 1000000000;\n  }\n  ',
      'h',
      1705032711,
    ],
    [
      'n++ then a sum',
      'let n = 0;\n  n++;\n  let h = (1|0) + n * 2000000000;\n  ',
      'h + h',
      -294967294,
    ],
    [
      'extractBits',
      'let a = (1<<30)|0;\n  let b = extractBits(a, 0, 31);\n  ',
      'b + b',
      -2147483648,
    ],
    ['reverseBits', 'let a = (1<<30)|0;\n  ', 'reverseBits(reverseBits(a)) * 2', -2147483648],
    ['countOneBits', 'let a = (1<<30)|0;\n  ', 'countOneBits(a) + a + a', -2147483647],
  ] as const)(
    'review of #1358: %s is refused in both halves, and its edit compiles',
    (_, body, subject, value) => {
      const source = program(`${body}return f32(${subject});`, 'f32');
      bothRefuse(source, 'TS8003', unproven(subject, 'f32()', `i32(${subject})`));
      expect(run(source.replace(`f32(${subject})`, `f32(i32(${subject}))`))).toBe(value);
    },
  );

  it('review of #1358: a comparison of -(1 << 30) * 3 is refused, and its edit compiles', () => {
    const source = program('let a = -(1 << 30);\n  return a * 3 > 0 ? 1.0 : 0.0;', 'f32');
    bothRefuse(source, 'TS8003', unproven('a * 3', '>', 'i32(a * 3)'));
    expect(run(source.replace('a * 3 >', 'i32(a * 3) >'))).toBe(1);
  });

  it.each([
    [
      'twenty-one additions up to 2.1e9',
      `let s = 0|0;\n  for (let i = 0; i < 21; i++) {\n    s += 100000000;\n  }\n  return f32(s);`,
      2100000000,
    ],
    ['twenty-three additions', `${LOOP(23, '(1|2)')}return f32(s);`, 69],
    ['a minus over a tree that stays in range', 'let a = -(5 | 0);\n  return f32(a - 1);', -6],
  ] as const)('review of #1358: a bounded neighbour compiles: %s', (_, body, value) => {
    expect(run(program(body, 'f32'))).toBe(value);
  });

  it('review of #1358: -(1 << 31) is a u32 tree, and twice it is refused with its numbers', () => {
    const source = program('let a = -(1 << 31);\n  return f32(a + a);', 'f32');
    bothRefuse(source, 'TS8003', proven('a + a', 0, 4294967296, 'f32()', 'i32(a + a)'));
    expect(run(source.replace('f32(a + a)', 'f32(i32(a + a))'))).toBe(0);
  });

  const PULLED = (loop: string, use: string, read: string): string =>
    `let t = (3000000000|0);\n  ${loop}\n  let x = ${use};\n  return f32(${read});`;
  it('a loop variable a u32 tree pulls, past the rounds the walk follows, is refused', () => {
    const body = PULLED(
      'let acc = 0;\n  for (let k = 0; k < 30; k++) {\n    acc = acc + 3;\n  }',
      'acc + t',
      'acc',
    );
    const source = program(body, 'f32');
    bothRefuse(source, 'TS8003', unproven('acc', 'f32()', 'i32(acc)'));
    expect(run(source.replace('f32(acc)', 'f32(i32(acc))'))).toBe(90);
  });

  it.each([
    [
      'the hash of the re-review',
      'let h = 5;\n  for (let k = 0; k < 4; k++) {\n    h = (h ^ (h << 3)) + 1;\n  }',
      'h ^ t',
      'h & 255',
      233,
    ],
    [
      'a product masked to its low bits',
      'let c = 1;\n  for (let k = 0; k < 3; k++) {\n    c = c * 100000;\n  }',
      'c + t',
      'c & 7',
      0,
    ],
  ] as const)(
    'a loop variable a u32 tree pulls, followed to its end, compiles: %s',
    (_, loop, use, read, value) => {
      expect(run(program(PULLED(loop, use, read), 'f32'))).toBe(value);
    },
  );

  const H = 'let h = (1 << 30);\n  ';
  const [h, ii, vi] = [2 ** 30, -3, 7];
  it.each([
    ['h + h + ii', H, 'h + h + ii', (h + h + ii) | 0, ''],
    ['h * 3 + ii', H, 'h * 3 + ii', (h * 3 + ii) | 0, ''],
    ['(h + h) * ii', H, '(h + h) * ii', ((h + h) * ii) | 0, ''],
    [
      'an accumulator',
      'let s = 0 | 0;\n  for (let i = 0; i < 3; i++) {\n    s += 1000000000;\n  }\n  ',
      's + ii',
      (3e9 + ii) | 0,
      '',
    ],
    ['s++', 'let s = 2147483647 | 0;\n  s++;\n  ', 's + ii', (2147483648 + ii) | 0, ''],
    ['a minus', 'let a = -(5 | 0);\n  ', 'a * 1000000000 + ii', (-5e9 + ii) | 0, ''],
    ['a typed variable', `${H}let k: i32 = 0;\n  `, 'h + h + k', (h + h) | 0, ''],
    ['a conversion', H, 'h + h + i32(vi)', (h + h + vi) | 0, ''],
    [
      'a helper',
      '',
      'g(ii)',
      (h + h + ii) | 0,
      'function g(x: i32) {\n  let h = (1 << 30);\n  return h + h + x;\n}\n',
    ],
  ] as const)(
    'review of #1358 (decision a): a differing tree beside a typed i32 is refused: %s',
    (_, body, subject, value, pre) => {
      const source = program(`${body}return f32(${subject});`, 'f32', pre);
      bothRefuse(source, 'TS8003', unproven(subject, 'f32()', `i32(${subject})`));
      expect(run(source.replace(`f32(${subject})`, `f32(i32(${subject}))`))).toBe(value);
    },
  );

  it('review of #1358 (decision a): the comparison of such a sum is refused', () => {
    const source = program(`${H}let d = h + h;\n  return d + ii > 0 ? 1.0 : 0.0;`, 'f32');
    bothRefuse(source, 'TS8003', unproven('d + ii', '>', 'i32(d + ii)'));
    expect(run(source.replace('d + ii >', 'i32(d + ii) >'))).toBe(((h + h + ii) | 0) > 0 ? 1 : 0);
  });

  it.each([
    ['max', `return f32(max(h + h, ii));`, 'h + h', 'max', Math.max((h + h) | 0, ii)],
    ['min', `return f32(min(h + h, ii));`, 'h + h', 'min', Math.min((h + h) | 0, ii)],
    [
      'clamp',
      `return f32(clamp(h + h, ii, 10));`,
      'h + h',
      'clamp',
      Math.min(Math.max((h + h) | 0, ii), 10),
    ],
    [
      'max under a comparison',
      `return max(h + h, ii) > 0 ? 1.0 : 0.0;`,
      'h + h',
      'max',
      Math.max((h + h) | 0, ii) > 0 ? 1 : 0,
    ],
    [
      'max of a binding',
      `let d = h + h;\n  let e = max(d, ii);\n  return f32(e);`,
      'd',
      'max',
      Math.max((h + h) | 0, ii),
    ],
  ] as const)(
    'review of #1358: a builtin beside a typed i32 refuses the operand, and its edit gives the value: %s',
    (_, body, subject, at, value) => {
      const source = program(H + body, 'f32');
      bothRefuse(source, 'TS8003', unproven(subject, at, `i32(${subject})`));
      expect(run(source.replace(`${at}(${subject},`, `${at}(i32(${subject}),`))).toBe(value);
    },
  );

  it.each([
    ['abs(i32(h))', 'return f32(abs(i32(h)));', 5],
    ['max(i32(h), 2)', 'return f32(max(i32(h), 2));', 5],
  ] as const)(
    'review of #1358 (decision b): a conversion inside a builtin compiles: %s',
    (_, body, value) => {
      expect(run(program(`let h = 5 | 0;\n  ${body}`, 'f32'))).toBe(value);
    },
  );

  it("owner decision of 2026-11-18: abs of a differing tree names no edit, since abs(i32(…)) is WGSL's", () => {
    const source = program(`${H}return f32(abs(h + h));`, 'f32');
    bothRefuse(
      source,
      'TS8003',
      'The compiler cannot prove that the u32 bits and the TypeScript value of "h + h" agree, so the "abs" does not say which value it means.',
    );
  });

  it('abs of a u32 tree whose i32 value is no i32 minimum names the verified edit', () => {
    const source = program('let a = (0xF0000000|0);\n  return f32(abs(a));', 'f32');
    bothRefuse(source, 'TS8003', proven('a', 4026531840, -268435456, 'abs', 'i32(a)'));
    expect(run(source.replace('abs(a)', 'abs(i32(a))'))).toBe(268435456);
  });
});
