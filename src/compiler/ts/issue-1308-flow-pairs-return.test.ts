import { describe, expect, it } from 'vitest';
import { bothRefuse, bothTake } from '../../core/testing/both-halves.js';
import { compileModule } from '../../core/oracle.js';
import { optimizeAt, type OptLevel } from '../../core/passes/opt/optimize.js';

const program = (body: string): string =>
  `"use typeshade";\nexport function t(ii: i32, vi: u32, f: f32): f32 {\n  ${body}\n}\n`;

const LEVELS: readonly OptLevel[] = ['O0', 'O1', 'O2'];
const ARGS: readonly (readonly unknown[])[] = [
  [-3, 7, 1.5],
  [3, 2, 1.5],
  [3, 9, 1.5],
];

const valuesAt = (source: string): unknown[][] => {
  const { result } = bothTake(source);
  return LEVELS.map((level) => {
    const cpu = compileModule(optimizeAt(result.module, level), { precision: 'f32' });
    return ARGS.map((args) => (cpu.fns['t'] as (...a: readonly unknown[]) => unknown)(...args));
  });
};

const at = (...values: number[]): number[][] => LEVELS.map(() => values);

const H = 'let a = (0xF0000000|0);\n  let c = a;\n  ';
const sum = (body: string, result = 'return f32(a - c);'): string =>
  program(`${H}${body}\n  ${result}`);

const refusal = (expression: string): string =>
  `The compiler cannot prove that the u32 bits and the TypeScript value of "${expression}" agree, ` +
  `so the "f32()" does not say which value it means. Write "i32(${expression})" for the i32 value.`;

describe('a store followed by a return, and the refusals that stay (issue 1308, Amendment A9)', () => {
  it('takes a read after a store that is followed by a return, in an arm, an else arm and a loop', () => {
    const cases: readonly (readonly [string, string, number[]])[] = [
      ['if (vi > 3) { c = 5; return 1.0; }', 'return f32(a - c);', [1, 0, 1]],
      ['if (vi > 3) { a = 5; return 1.0; }', 'return f32(a - c);', [1, 0, 1]],
      ['if (vi > 3) { }\n  else { a = 5; return 1.0; }', 'return f32(a - c);', [0, 1, 0]],
      ['if (vi > 3) { c = 5; return 1.0; }', 'return f32(c - a);', [1, 0, 1]],
      ['if (vi > 3) { c = 5; return 1.0; }', 'let r = a - c;\n  return f32(r);', [1, 0, 1]],
      [
        'for (let i = 0; i < ii; i++) { a = 5; if (vi > 3) { return 1.0; } }',
        'return f32(a - c);',
        [0, 268435456, 1],
      ],
      [
        'if (vi > 3) { c = 5; return 1.0; } else { a = 7; c = 7; }',
        'return f32(a - c);',
        [1, 0, 1],
      ],
    ];
    for (const [body, result, values] of cases) {
      expect(valuesAt(sum(body, result))).toEqual(at(...values));
      const u32 = program(`let a = 0xF0000000;\n  let c = a;\n  ${body}\n  ${result}`);
      if (!result.includes('^') && !body.includes('for')) {
        expect(valuesAt(u32)).toEqual(at(...values));
      }
    }
  });

  it('keeps the refusal of a pair that a loop with a conditional return carries on', () => {
    const body = 'for (let i = 0; i < ii; i++) { a = 5; if (vi > 3) { return 1.0; } }';
    const u32 = program(`let a = 0xF0000000;\n  let c = a;\n  ${body}\n  return f32(a - c);`);
    bothRefuse(u32, 'TS8003', refusal('a - c'));
  });

  it('refuses the value that has to fit alone, in a u32 xor after a store and a return', () => {
    const fit =
      'The value has to fit: 4026531840 is outside i32, which holds -2147483648 to 2147483647 (§13).';
    const u32 = program(
      'let a = 0xF0000000;\n  let c = a;\n  if (vi > 3) { a = 5; return 1.0; }\n  return f32(a ^ c);',
    );
    bothRefuse(u32, 'TS8003', fit);
  });

  it('drops the refusal of a read that is now accepted in a program that stays refused', () => {
    const list =
      'A list takes its type from the position it is written in: declare one, as "const xs: array<T, 2> = [...]" or a return type, or call array<T, 2>(...) here.';
    const text =
      'A string has no GPU representation: there is nothing for it to be at run time, and no instruction takes one. Text that picks between cases is a key type, a union of string literals the GPU holds as ids, or an enum; text a human reads belongs on the host.';
    const statement = (s: string): string => `Unsupported expression statement "${s}".`;
    const cases: readonly (readonly [string, string])[] = [
      ['if (vi > 3) { (a = 5); c = 5; }', statement('(a = 5);')],
      ['for (const q of [1, 2]) { a = 5; c = 5; }', list],
      ['if (vi > 3) { a = 5; c = 5; }\n  void 0;', statement('void 0;')],
      ['if (vi > 3) { a = 5; c = 5; }\n  ;', 'Unsupported statement ";".'],
      ['a = 5;\n  c = 5;\n  const s = "x";', text],
    ];
    for (const [body, sentence] of cases) {
      bothRefuse(sum(body), 'TS8099', sentence);
      bothRefuse(sum(body, 'return f32(c - a);'), 'TS8099', sentence);
    }
  });
});
