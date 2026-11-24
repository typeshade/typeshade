import { describe, expect, it } from 'vitest';
import { bothRefuse, bothTake } from '../../core/testing/both-halves.js';
import { compileModule } from '../../core/oracle.js';
import { optimizeAt, type OptLevel } from '../../core/passes/opt/optimize.js';

const LEVELS: readonly OptLevel[] = ['O0', 'O1', 'O2'];

const program = (body: string): string =>
  `"use typeshade";\nconst K = 1 | 2;\nexport function t(f: f32, i: i32, u: u32, g: f32): f32 {\n  ${body}\n}\n`;

const valuesAt = (source: string, [f, i]: readonly [number, number]): unknown[] => {
  const args = [f, i, 4, 0.25];
  const { result } = bothTake(source);
  return LEVELS.map((level) => {
    const cpu = compileModule(optimizeAt(result.module, level), { precision: 'f32' });
    return (cpu.fns['t'] as (...a: readonly unknown[]) => unknown)(...args);
  });
};

const named = (text: string): string =>
  `"${text}" is an integer by its bit operator, and this position takes an f32. Write "f32(${text})" for the float value.`;
const bare = (text: string): string =>
  `"${text}" is an integer by its bit operator, and this position takes an f32.`;

const CASES: readonly { body: string; tree: string; edited: string }[] = [
  {
    body: 'return f > 1.0 ? K : f;',
    tree: 'K',
    edited: 'return f > 1.0 ? f32(K) : f;',
  },
  {
    body: 'return f > 1.0 ? f : K;',
    tree: 'K',
    edited: 'return f > 1.0 ? f : f32(K);',
  },
  {
    body: 'return select(f, K, f > 1.0);',
    tree: 'K',
    edited: 'return select(f, f32(K), f > 1.0);',
  },
  {
    body: 'return select(K, f, f > 1.0);',
    tree: 'K',
    edited: 'return select(f32(K), f, f > 1.0);',
  },
  {
    body: 'return f > 1.0 ? (1 | 2) : f;',
    tree: '1 | 2',
    edited: 'return f > 1.0 ? (f32(1 | 2)) : f;',
  },
  {
    body: 'return select(f, 1 << 3, f > 1.0);',
    tree: '1 << 3',
    edited: 'return select(f, f32(1 << 3), f > 1.0);',
  },
  {
    body: 'return select(f, ~K, f > 1.0);',
    tree: '~K',
    edited: 'return select(f, f32(~K), f > 1.0);',
  },
  {
    body: 'let k = 1 | 2;\n  return f > 1.0 ? k : f;',
    tree: 'k',
    edited: 'let k = 1 | 2;\n  return f > 1.0 ? f32(k) : f;',
  },
  {
    body: 'let k = 1 | 2;\n  return select(f, k, f > 1.0);',
    tree: 'k',
    edited: 'let k = 1 | 2;\n  return select(f, f32(k), f > 1.0);',
  },
  {
    body: 'return f > 1.0 ? K : 0.5;',
    tree: 'K',
    edited: 'return f > 1.0 ? f32(K) : 0.5;',
  },
  {
    body: 'let x = f > 1.0 ? K : f;\n  return x;',
    tree: 'K',
    edited: 'let x = f > 1.0 ? f32(K) : f;\n  return x;',
  },
  {
    body: 'return f + (f > 1.0 ? K : f);',
    tree: 'K',
    edited: 'return f + (f > 1.0 ? f32(K) : f);',
  },
  {
    body: 'return f > 1.0 ? abs(K) : f;',
    tree: 'abs(K)',
    edited: 'return f > 1.0 ? f32(abs(K)) : f;',
  },
  {
    body: 'return f > 1.0 ? 0xFFFFFFFF & 7 : f;',
    tree: '0xFFFFFFFF & 7',
    edited: 'return f > 1.0 ? f32(0xFFFFFFFF & 7) : f;',
  },
  {
    body: 'return f > 1.0 ? ~~5 : f;',
    tree: '~~5',
    edited: 'return f > 1.0 ? f32(~~5) : f;',
  },
  {
    body: 'return f > 1.0 ? (1 << 31) : f;',
    tree: '1 << 31',
    edited: 'return f > 1.0 ? (f32(1 << 31)) : f;',
  },
  {
    body: 'return f > 1.0 ? (K | 1) : 1.5;',
    tree: 'K | 1',
    edited: 'return f > 1.0 ? (f32(K | 1)) : 1.5;',
  },
  {
    body: 'return f > 1.0 ? ((K | 4)) : f;',
    tree: 'K | 4',
    edited: 'return f > 1.0 ? ((f32(K | 4))) : f;',
  },
  {
    body: 'return f > 1.0 ? K : f + 0;',
    tree: 'K',
    edited: 'return f > 1.0 ? f32(K) : f + 0;',
  },
  {
    body: 'return f > 1.0 ? (K) : f;',
    tree: 'K',
    edited: 'return f > 1.0 ? (f32(K)) : f;',
  },
  {
    body: 'return f * (f > 1.0 ? K : f);',
    tree: 'K',
    edited: 'return f * (f > 1.0 ? f32(K) : f);',
  },
  {
    body: 'return f > 1.0 ? K : sqrt(f);',
    tree: 'K',
    edited: 'return f > 1.0 ? f32(K) : sqrt(f);',
  },
  {
    body: 'return f > 1.0 ? K : (f as number);',
    tree: 'K',
    edited: 'return f > 1.0 ? f32(K) : (f as number);',
  },
  {
    body: 'return f > 1.0 ? K : f32(1 | 2);',
    tree: 'K',
    edited: 'return f > 1.0 ? f32(K) : f32(1 | 2);',
  },
  {
    body: 'return f32(f > 1.0 ? 1|2 : f);',
    tree: '1|2',
    edited: 'return f32(f > 1.0 ? f32(1|2) : f);',
  },
  {
    body: 'return f > 1.0 ? f : (f > 2.0 ? K : 3);',
    tree: 'f > 2.0 ? K : 3',
    edited: 'return f > 1.0 ? f : (f32(f > 2.0 ? K : 3));',
  },
];

describe('an arm of ?: and of select names the tree and its edit (issue 1301, Rule 5.1)', () => {
  for (const c of CASES) {
    it(`${c.body.replace(/\s+/g, ' ')} names f32(${c.tree})`, () => {
      bothRefuse(program(c.body), 'TS8003', named(c.tree));
      const edited = program(c.edited);
      const taken = valuesAt(edited, [2, 0]);
      const kept = valuesAt(edited, [0.5, 0]);
      expect(taken.every((v) => v === taken[0])).toBe(true);
      expect(kept.every((v) => v === kept[0])).toBe(true);
    });
  }

  it("the edit gives TypeScript's value of the edited program", () => {
    const ternary = program('return f > 1.0 ? f32(K) : f;');
    expect(valuesAt(ternary, [2, 0])).toEqual(LEVELS.map(() => 3));
    expect(valuesAt(ternary, [0.5, 0])).toEqual(LEVELS.map(() => 0.5));
    const pick = program('return select(f, f32(~K), f > 1.0);');
    expect(valuesAt(pick, [2, 0])).toEqual(LEVELS.map(() => -4));
    expect(valuesAt(pick, [0.5, 0])).toEqual(LEVELS.map(() => 0.5));
  });

  it('a tree of a value with two readings names no edit', () => {
    bothRefuse(program('return f > 1.0 ? (0x80000000 | 0) : f;'), 'TS8003', bare('0x80000000 | 0'));
    bothRefuse(program('return f > 1.0 ? 0xFFFFFFFF | 0 : f;'), 'TS8003', bare('0xFFFFFFFF | 0'));
    bothRefuse(
      program('return select(f, 0xFFFFFFFF | 0, f > 1.0);'),
      'TS8003',
      bare('0xFFFFFFFF | 0'),
    );
  });

  it("a shifted tree gives TypeScript's 32-bit value", () => {
    const shifted = program('return f > 1.0 ? f32(1 << 31) : f;');
    expect(valuesAt(shifted, [2, 0])).toEqual(LEVELS.map(() => -2147483648));
    expect(valuesAt(shifted, [0.5, 0])).toEqual(LEVELS.map(() => 0.5));
  });

  it('an arm that is no tree keeps the plain mismatch', () => {
    bothRefuse(
      program('return f > 1.0 ? i : f;'),
      'TS8003',
      'Ternary arm type mismatch: i32 vs f32.',
    );
    bothRefuse(
      program('return select(f, i, f > 1.0);'),
      'TS8003',
      'select arm type mismatch: f32 vs i32.',
    );
  });
});
