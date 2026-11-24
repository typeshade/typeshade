import { describe, expect, it } from 'vitest';
import { bothRefuse, bothTake } from '../../core/testing/both-halves.js';

const HELPER_I32 = 'function h(a: i32): i32 {\n  return a;\n}\n';
const HELPER_F32 = 'function h(a: f32): f32 {\n  return a;\n}\n';

const program = (body: string, before = ''): string =>
  `"use typeshade";\nconst K = 1 | 2;\n${before}export function t(f: f32, i: i32, u: u32, g: f32): f32 {\n  ${body}\n}\n`;

const bare = (text: string): string =>
  `"${text}" is an integer by its bit operator, and this position takes an f32.`;
const named = (text: string): string => `${bare(text)} Write "f32(${text})" for the float value.`;

interface Case {
  readonly body: string;
  readonly before?: string;
  readonly sentence: string;
  readonly edited?: string;
}

const CASES: readonly Case[] = [
  { body: 'let a: i32 = f > 1.0 ? K : f;\n  return f32(a);', sentence: bare('K') },
  { body: 'let a: i32 = i > 1 ? K : f;\n  return f32(a);', sentence: bare('K') },
  { body: 'let a: u32 = f > 1.0 ? K : f;\n  return f32(a);', sentence: bare('K') },
  {
    body: 'let a: f32 = f > 1.0 ? K : f;\n  return a;',
    sentence: named('K'),
    edited: 'let a: f32 = f > 1.0 ? f32(K) : f;\n  return a;',
  },
  {
    body: 'let x = 0.0;\n  x += f > 1.0 ? K : f;\n  return x;',
    sentence: named('K'),
    edited: 'let x = 0.0;\n  x += f > 1.0 ? f32(K) : f;\n  return x;',
  },
  {
    body: 'let x = 0.0;\n  x = f > 1.0 ? K : f;\n  return x;',
    sentence: named('K'),
    edited: 'let x = 0.0;\n  x = f > 1.0 ? f32(K) : f;\n  return x;',
  },
  {
    body: 'let x = 0.0;\n  x = select(f, K, f > 1.0);\n  return x;',
    sentence: named('K'),
    edited: 'let x = 0.0;\n  x = select(f, f32(K), f > 1.0);\n  return x;',
  },
  { body: 'let x = 0.0;\n  x /= f > 1.0 ? K : f;\n  return x;', sentence: bare('K') },
  {
    body: 'return h(f > 1.0 ? K : f);',
    before: HELPER_F32,
    sentence: named('K'),
    edited: 'return h(f > 1.0 ? f32(K) : f);',
  },
  { body: 'return h(f > 1.0 ? K : f);', before: HELPER_I32, sentence: bare('K') },
  { body: 'return f32(h(f > 1.0 ? f : K));', before: HELPER_I32, sentence: bare('K') },
  {
    body: 'const a = [1.0, f > 1.0 ? K : f];\n  return a[0];',
    sentence: named('K'),
    edited: 'const a = [1.0, f > 1.0 ? f32(K) : f];\n  return a[0];',
  },
  {
    body: 'return (f > 1.0 ? K : f) + 0.5;',
    sentence: named('K'),
    edited: 'return (f > 1.0 ? f32(K) : f) + 0.5;',
  },
  {
    body: 'return f > 1.0 ? f : K + 1;',
    sentence: named('K + 1'),
    edited: 'return f > 1.0 ? f : f32(K + 1);',
  },
];

describe('an arm of ?: next to an f32 in a destination, an assignment, an argument and a list (#1301)', () => {
  for (const c of CASES) {
    it(`both halves refuse: ${c.body}`, () => {
      bothRefuse(program(c.body, c.before), 'TS8003', c.sentence);
    });
    if (c.edited !== undefined) {
      it(`both halves take the edit: ${c.edited}`, () => {
        expect(() => bothTake(program(c.edited as string, c.before))).not.toThrow();
      });
    }
  }
});
