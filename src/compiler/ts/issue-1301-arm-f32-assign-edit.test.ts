import { describe, it } from 'vitest';
import { bothRefuse } from '../../core/testing/both-halves.js';

const program = (body: string): string =>
  `"use typeshade";\nexport function t(f: f32, i: i32, u: u32, g: f32): f32 {\n  ${body}\n}\n`;

const tree = (text: string): string =>
  `"${text}" is an integer by its bit operator, and this position takes an f32.`;
const shift = (literal: string, gives: string): string =>
  `Bitwise ">>" over ${literal}, which only a u32 holds, gives ${gives} in TypeScript, so it does not say which it means.`;
const prove = (edit: string): string =>
  `The compiler cannot prove that the u32 bits and the TypeScript value of "x" agree, so the "f32()" does not say which value it means. ${edit}`;

const TWO_READINGS = 'Write u32(…) or i32(…) around "x" to choose its value.';
const ONE_READING = 'Write "i32(x)" for the i32 value.';

describe('an arm that holds a u32 by its bits, stored in an i32 variable (issue 1301, Rule 5.1)', () => {
  const ROWS: readonly { body: string; sentences: readonly string[] }[] = [
    {
      body: 'let x = 0; x = f > 1.0 ? 0xFFFFFFFF | 0 : f; return f32(x);',
      sentences: [tree('0xFFFFFFFF | 0'), prove(TWO_READINGS)],
    },
    {
      body: 'let x = 0; x += f > 1.0 ? 0x80000000 | 0 : f; return f32(x);',
      sentences: [tree('0x80000000 | 0'), prove(TWO_READINGS)],
    },
    {
      body: 'let x = 0; x = f > 1.0 ? 0x80000000 >> 1 : 1.5; return f32(x);',
      sentences: [
        tree('0x80000000 >> 1'),
        shift('0x80000000', '1073741824 on its u32 bits and -1073741824'),
        prove(TWO_READINGS),
      ],
    },
    {
      body: 'let x = 0; x += select(1.5, 0xFFFFFFFF >> 1, f > 1.0); return f32(x);',
      sentences: [
        tree('0xFFFFFFFF >> 1'),
        shift('0xFFFFFFFF', '2147483647 on its u32 bits and -1'),
        prove(TWO_READINGS),
      ],
    },
    {
      body: 'let x = 0; x = f > 1.0 ? 1 | 2 : 1.5; return f32(x);',
      sentences: [`${tree('1 | 2')} Write "f32(1 | 2)" for the float value.`, prove(ONE_READING)],
    },
  ];

  for (const row of ROWS) {
    it(`${row.body} names the stored value by its readings`, () => {
      bothRefuse(program(row.body), 'TS8003', row.sentences);
    });
  }
});
