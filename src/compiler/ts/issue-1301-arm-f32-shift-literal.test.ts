import { describe, it } from 'vitest';
import { bothRefuse } from '../../core/testing/both-halves.js';

const program = (body: string): string =>
  `"use typeshade";\nexport function t(f: f32, i: i32, u: u32, g: f32): f32 {\n  ${body}\n}\n`;

const tree = (text: string): string =>
  `"${text}" is an integer by its bit operator, and this position takes an f32.`;
const shift = (literal: string, gives: string): string =>
  `Bitwise ">>" over ${literal}, which only a u32 holds, gives ${gives} in TypeScript, so it does not say which it means.`;

describe('an arm that is a shift over a written u32 literal (issue 1301, Rule 5.1)', () => {
  const ROWS: readonly { body: string; sentences: readonly string[] }[] = [
    {
      body: 'return f > 1.0 ? 0x80000000 >> 1 : f;',
      sentences: [
        tree('0x80000000 >> 1'),
        shift('0x80000000', '1073741824 on its u32 bits and -1073741824'),
      ],
    },
    {
      body: 'return f > 1.0 ? 0xFFFFFFFF >> 1 : f;',
      sentences: [
        tree('0xFFFFFFFF >> 1'),
        shift('0xFFFFFFFF', '2147483647 on its u32 bits and -1'),
      ],
    },
    {
      body: 'return select(f, 0x80000000 >> 1, f > 1.0);',
      sentences: [
        tree('0x80000000 >> 1'),
        shift('0x80000000', '1073741824 on its u32 bits and -1073741824'),
      ],
    },
    {
      body: 'return f + (0x80000000 >> 1);',
      sentences: [
        tree('0x80000000 >> 1'),
        shift('0x80000000', '1073741824 on its u32 bits and -1073741824'),
      ],
    },
    {
      body: 'return f > 1.0 ? (0x80000000 >> 1) | 0 : f;',
      sentences: [
        `${tree('(0x80000000 >> 1) | 0')} Write "f32((0x80000000 >> 1) | 0)" for the float value.`,
      ],
    },
  ];

  for (const row of ROWS) {
    it(`${row.body} names the tree and drops the u32 shift edit`, () => {
      bothRefuse(program(row.body), 'TS8003', row.sentences);
    });
  }
});
