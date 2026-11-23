import { describe, expect, it } from 'vitest';
import { bothTake } from '../../core/testing/both-halves.js';

const program = (body: string, ret: string, pre = ''): string =>
  `"use typeshade";\n${pre}export function t(ii: i32, vi: u32, f: f32): ${ret} {\n  ${body}\n}\n`;
const run = (source: string): unknown => bothTake(source).result.eval('t', [-3, 7, 2.5]);

const A = '(vi > 3 ? (5|0) : vi)';
const LOOP = (statement: string): string =>
  `let s = 0;\n  for (let k = 0; k < 3; k++) {\n    ${statement}\n  }\n  return f32(s);`;
const X = '(vi > 3 ? (3000000000|0) : q)';
const Q = 'const q: i32 = 3;\n  ';

describe('issue 1309: an arm set beside a typed arm compiles with its value (D2)', () => {
  it.each([
    [
      'a stored arm set plus a tree',
      'let c = vi > 3 ? (5|0) : vi;\n  return f32(c + (1 << 3));',
      13,
    ],
    ['two arm sets', 'return f32((vi > 3 ? (5|0) : vi) + (vi > 2 ? (1 << 3) : vi));', 13],
    ['a loop of s + an arm set', LOOP(`s = s + ${A};`), 15],
    ['a loop of s += an arm set', LOOP(`s += ${A};`), 15],
    ['a loop of an arm set of 1 << 3', LOOP('s = s + (vi > 3 ? (1<<3) : vi);'), 24],
    ['a loop of s ^ an arm set of 6 ^ 3', LOOP('s = s ^ (vi > 3 ? (6^3) : vi);'), 5],
    ['two plain statements', `let s = 0;\n  s = s + ${A};\n  s = s + ${A};\n  return f32(s);`, 10],
    ['inside an if', `let s = 0;\n  if (vi > 2) {\n    s = s + ${A};\n  }\n  return f32(s);`, 5],
  ] as const)('review of #1358 (B-1): %s', (_, body, value) => {
    expect(run(program(body, 'f32'))).toBe(value);
  });

  it.each([
    [`min(${X}, ii)`, -1294967296],
    [`max(${X}, ii)`, -3],
    [`max(ii, ${X})`, -3],
    [`min(ii, ${X})`, -1294967296],
    [`clamp(${X}, ${X}, ii)`, -1294967296],
    [`clamp(ii, ${X}, ${X})`, -1294967296],
  ] as const)(
    'review of c352e278: an arm set beside a typed i32 in a builtin: %s',
    (call, value) => {
      expect(run(program(`${Q}return ${call};`, 'i32'))).toBe(value);
    },
  );
});
