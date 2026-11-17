import { describe, expect, it } from 'vitest';
import { bothRefuse, bothTake } from '../../core/testing/both-halves.js';

const program = (body: string, ret: string): string =>
  `"use typeshade";\nexport function t(ii: i32, vi: u32, f: f32): ${ret} {\n  ${body}\n}\n`;
const run = (source: string): unknown => bothTake(source).result.eval('t', [-3, 7, 2.5]);
const unproven = (subject: string, at: string, edit: string): string =>
  `The compiler cannot prove that the u32 bits and the TypeScript value of "${subject}" agree, ` +
  `so the "${at}" does not say which value it means. Write "${edit}" for the ${edit.slice(0, 3)} value.`;

const A = 'let a = (0xF0000000|0);\n  ';

describe('issue 1307: the result of an operation beside a typed u32 keeps two readings (D2)', () => {
  it.each([
    ['f32(a + vi)', 'f32', 'a + vi', 'f32()', 'f32(i32(a + vi))', -268435449],
    ['(a + vi) > vi ? 1.0 : 0.0', 'f32', 'a + vi', '>', 'u32(a + vi) > vi ? 1.0 : 0.0', 1],
    ['(a + vi) / vi', 'u32', 'a + vi', '/', 'u32(a + vi) / vi', 575218835],
    ['(a + vi) % 3', 'u32', 'a + vi', '%', 'u32(a + vi) % 3', 4026531847 % 3],
    ['max(a + vi, vi)', 'u32', 'a + vi', 'max', 'max(u32(a + vi), vi)', 4026531847],
    ['f32(~(a ^ vi))', 'f32', '~(a ^ vi)', 'f32()', 'f32(i32(~(a ^ vi)))', ~(-268435456 ^ 7)],
    ['f32((a | vi) - vi)', 'f32', '(a | vi) - vi', 'f32()', 'f32(i32((a | vi) - vi))', -268435456],
  ] as const)(
    'return %s is refused in both halves, and its edit compiles',
    (returned, ret, subject, at, edited, value) => {
      const source = program(`${A}return ${returned};`, ret);
      const type = at === 'f32()' ? 'i32' : 'u32';
      bothRefuse(source, 'TS8003', unproven(subject, at, `${type}(${subject})`));
      expect(run(program(`${A}return ${edited};`, ret))).toBe(value);
    },
  );

  it.each([
    ['through a let', 'let d = vi * a;\n  return f32(d);', 'd', -268435456 * 7],
    ['through a plain store', 'let s = 0;\n  s = a + vi;\n  return f32(s);', 's', -268435449],
  ])('the two readings reach a later f32() %s', (_, body, name, value) => {
    const source = program(A + body, 'f32');
    bothRefuse(source, 'TS8003', unproven(name, 'f32()', `i32(${name})`));
    expect(run(source.replace(`f32(${name})`, `f32(i32(${name}))`))).toBe(value | 0);
  });

  it.each([
    ['a + vi alone, in a u32 result', 'return a + vi;', 'u32', 4026531847],
    ['an annotation ends the origin', 'let x: u32 = a + vi;\n  return f32(x);', 'f32', 4026531847],
    ['a mask whose readings agree', 'return f32((a & 0xFF) + vi);', 'f32', 7],
    ['a conversion before f32()', 'return f32(i32(a + vi));', 'f32', -268435449],
    ['a typed left operand of a shift', 'return f32(vi << a);', 'f32', 7],
  ] as const)('a neighbour still compiles with its value: %s', (_, body, ret, value) => {
    expect(run(program(A + body, ret))).toBe(value);
  });

  it('an exported function with no written result refuses to return such a value', () => {
    const exported = (ret: string): string =>
      `"use typeshade";\nexport function g(vi: u32) {\n  ${A}return ${ret};\n}\n`;
    bothRefuse(exported('a + vi'), 'TS8003', unproven('a + vi', 'return', 'i32(a + vi)'));
    expect(bothTake(exported('i32(a + vi)')).result.eval('g', [7])).toBe(-268435449);
  });
});
