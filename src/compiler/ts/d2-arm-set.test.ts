import { describe, expect, it } from 'vitest';
import { bothRefuse, bothTake } from '../../core/testing/both-halves.js';

const program = (body: string, ret: string, pre = ''): string =>
  `"use typeshade";\n${pre}export function t(ii: i32, vi: u32, f: f32): ${ret} {\n  ${body}\n}\n`;
const run = (source: string): unknown => bothTake(source).result.eval('t', [-3, 7, 2.5]);
const unproven = (subject: string, at: string, edit: string): string =>
  `The compiler cannot prove that the u32 bits and the TypeScript value of "${subject}" agree, ` +
  `so the "${at}" does not say which value it means. Write "${edit}" for the ${edit.slice(0, 3)} value.`;
const NO_EDIT = (subject: string): string =>
  `The compiler cannot prove that the u32 bits and the TypeScript value of "${subject}" agree, so the "abs" does not say which value it means.`;
const TREE_A = 'let a = (0xF0000000|0);\n  ';

describe('issue 1309: a value with more than one possible value states no numbers (D2)', () => {
  it.each([
    ['a ?: of two trees', 'vi > 3 ? a + 0x90000000 : a', -2147483648],
    ['a select of two trees', 'select(a, (0x80000000|0), vi > 3)', -2147483648],
    ['a ?: of a tree and a number', 'vi > 3 ? a : 5', -268435456],
  ] as const)(
    'owner decision of 2026-11-18: more than one possible value states no numbers: %s',
    (_, x, value) => {
      const source = program(`${TREE_A}return f32(${x});`, 'f32');
      bothRefuse(source, 'TS8003', unproven(x, 'f32()', `i32(${x})`));
      expect(run(source.replace(`f32(${x})`, `f32(i32(${x}))`))).toBe(value);
    },
  );

  it("abs over the owner's example states no numbers and names no edit", () => {
    const x = 'vi > 3 ? a + 0x90000000 : a';
    bothRefuse(program(`${TREE_A}return f32(abs(${x}));`, 'f32'), 'TS8003', NO_EDIT(x));
  });

  it.each([
    [
      'a stored arm set plus a tree',
      'let c = vi > 3 ? (5|0) : vi;\n  return f32(c + (1 << 3));',
      13,
    ],
    ['two arm sets', 'return f32((vi > 3 ? (5|0) : vi) + (vi > 2 ? (1 << 3) : vi));', 13],
    [
      'a loop of s + an arm set',
      'let s = 0;\n  for (let k = 0; k < 3; k++) {\n    s = s + (vi > 3 ? (5|0) : vi);\n  }\n  return f32(s);',
      15,
    ],
    [
      'a loop of s += an arm set',
      'let s = 0;\n  for (let k = 0; k < 3; k++) {\n    s += (vi > 3 ? (5|0) : vi);\n  }\n  return f32(s);',
      15,
    ],
    [
      'a loop of s + an arm set of 1 << 3',
      'let s = 0;\n  for (let k = 0; k < 3; k++) {\n    s = s + (vi > 3 ? (1<<3) : vi);\n  }\n  return f32(s);',
      24,
    ],
    [
      'a loop of s ^ an arm set of 6 ^ 3',
      'let s = 0;\n  for (let k = 0; k < 3; k++) {\n    s = s ^ (vi > 3 ? (6^3) : vi);\n  }\n  return f32(s);',
      5,
    ],
    [
      'two plain statements',
      'let s = 0;\n  s = s + (vi > 3 ? (5|0) : vi);\n  s = s + (vi > 3 ? (5|0) : vi);\n  return f32(s);',
      10,
    ],
    [
      'inside an if',
      'let s = 0;\n  if (vi > 2) {\n    s = s + (vi > 3 ? (5|0) : vi);\n  }\n  return f32(s);',
      5,
    ],
  ] as const)(
    'review of #1358 (B-1): an arm set beside a typed arm still compiles: %s',
    (_, body, value) => {
      expect(run(program(body, 'f32'))).toBe(value);
    },
  );
});
