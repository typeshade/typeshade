import { describe, it } from 'vitest';
import { bothRefuse } from '../../core/testing/both-halves.js';

const program = (result: string, body: string): string =>
  `"use typeshade";\nexport function t(ii: i32, vi: u32, f: f32): ${result} {\n  ${body}\n}\n`;

const C = 'let c = (3000000000|0);\n  let d = c;\n  ';
const X = 'let c = (3000000000 ^ 0);\n  let d = c * 7;\n  ';

const division = (subject: string, text: string, remedy: string): string =>
  `"${subject}" is an integer by its bit operator, and no operand of "${text}" has a declared ` +
  `type, so the "/" does not say which division it is. ${remedy}`;

const NO_WRAP = "Declare the type of the division's operands to choose it.";

describe('the operators a u32 reading of a held quotient passes through (issue 1447)', () => {
  it.each([
    ['u32(d / 7 + 1)'],
    ['u32(d / 7 - 1)'],
    ['u32(d / 7 * 2)'],
    ['u32(d / 7 % 5)'],
    ['u32(-(d / 7 / 1))'],
  ])('names no edit for %s, which reads a negative value', (call) => {
    bothRefuse(program('u32', `${C}return ${call};`), 'TS8003', division('d', 'd / 7', NO_WRAP));
  });
});

describe('a parenthesized quotient in u32() (issue 1447)', () => {
  it('names the i32 edit of the held operand', () => {
    bothRefuse(
      program('u32', `${C}return u32((d / 7));`),
      'TS8003',
      '"d" is 3000000000 on its u32 bits and -1294967296 in TypeScript, so the "/" does not say which value it means. Write "i32(d)" for the i32 value.',
    );
  });
});

describe('a u32 tree past i32 beside a u32 peer (issue 1447)', () => {
  it('names the edit that keeps the u32 value of the tree', () => {
    bothRefuse(
      program('u32', `${X}return d / 7 + vi;`),
      'TS8003',
      division('d', 'd / 7', 'Write "u32(d) / 7" for the integer division.'),
    );
  });
});
