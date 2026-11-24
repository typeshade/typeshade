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

describe('a flow-aware walk pairs only values that occur together (issue 1308, Amendment A9)', () => {
  it("takes the issue's program in both halves, and its value is 0", () => {
    expect(valuesAt(sum('if (vi > 3) { a = 5; c = 5; }'))).toEqual(at(0, 0, 0));
  });

  it('takes the program with the stores in the other order and with a read of c first', () => {
    expect(valuesAt(sum('if (vi > 3) { c = 5; a = 5; }'))).toEqual(at(0, 0, 0));
    expect(valuesAt(sum('if (vi > 3) { a = 5; c = 5; }', 'return f32(c - a);'))).toEqual(
      at(0, 0, 0),
    );
  });

  it('takes an if with an else, a nested if and a store that a branch skips', () => {
    expect(valuesAt(sum('if (vi > 3) { a = 5; c = 5; } else { a = 7; c = 7; }'))).toEqual(
      at(0, 0, 0),
    );
    expect(valuesAt(sum('if (vi > 3) { if (vi > 5) { a = 5; c = 5; } }'))).toEqual(at(0, 0, 0));
    expect(valuesAt(sum('if (vi > 3) { a = 5; if (vi > 5) { c = 5; } }'))).toEqual(at(0, 0, 0));
  });

  it('takes loops with both stores in the body, and a read after an early return', () => {
    expect(valuesAt(sum('for (let i = 0; i < ii; i++) { a = 5; c = 5; }'))).toEqual(at(0, 0, 0));
    expect(valuesAt(sum('for (let i = 0; i < ii; i++) { c = 5; a = 5; }'))).toEqual(at(0, 0, 0));
    expect(valuesAt(sum('let i = 0;\n  while (i < ii) { a = 5; c = 5; i++; }'))).toEqual(
      at(0, 0, 0),
    );
    expect(valuesAt(sum('if (vi > 3) { a = 5; c = 5; return f32(a - c); }'))).toEqual(at(0, 0, 0));
  });

  it('takes a compound store of both, and gives the value of the pair that occurs', () => {
    expect(valuesAt(sum('if (vi > 3) { a = 5; c = 5; a += 1; c += 1; }'))).toEqual(at(0, 0, 0));
    expect(valuesAt(sum('if (vi > 3) { a = 5; c = 5; a += 1; }'))).toEqual(at(1, 0, 1));
  });

  it('takes the program with no store to c, whose two values agree on every path', () => {
    expect(valuesAt(sum('if (vi > 3) { a = 5; }'))).toEqual(at(268435456, 0, 268435456));
  });

  it('takes an operator other than a minus when the pairs that occur agree', () => {
    expect(valuesAt(sum('if (vi > 3) { a = 5; c = 5; }', 'return f32(a ^ c);'))).toEqual(
      at(0, 0, 0),
    );
  });

  it('takes a copy of a variable read before the variable was stored again', () => {
    const body = 'let a = 5;\n  let c = a;\n  a = (0xF0000000|0);\n  return f32(c - 1);';
    expect(valuesAt(program(body))).toEqual(at(4, 4, 4));
    const chain =
      'let a = (0xF0000000|0);\n  let c = a;\n  let e = c;\n  ' +
      'if (vi > 3) { a = 5; c = 5; e = 5; }\n  return f32(a - e);';
    expect(valuesAt(program(chain))).toEqual(at(0, 0, 0));
  });

  it('takes an early return, a store of a alone, a copy inside a loop and a plain block', () => {
    const cases: readonly (readonly [string, string, number[]])[] = [
      ['if (vi > 3) { return 1.0; }\n  a = 5;\n  c = 5;', 'return f32(a - c);', [1, 0, 1]],
      ['for (let i = 0; i < ii; i++) { a = 5; }', 'return f32(a - c);', [0, 268435456, 268435456]],
      ['for (let i = 0; i < ii; i++) { c = a; a = 5; }', 'return f32(a - c);', [0, 0, 0]],
      ['{ a = 5; c = a; }', 'return f32(a - c);', [0, 0, 0]],
      ['{ a = 5; c = 5; }', 'return f32(a - c);', [0, 0, 0]],
    ];
    for (const [body, result, values] of cases) {
      expect(valuesAt(sum(body, result))).toEqual(at(...values));
    }
  });

  it('takes a store of one variable before an if that stores the other', () => {
    expect(valuesAt(sum('a = 5;\n  if (vi > 3) { c = 5; }'))).toEqual(at(0, 268435456, 0));
    expect(valuesAt(sum('c = 5;\n  if (vi > 3) { a = 5; }', 'return f32(c - a);'))).toEqual(
      at(0, 268435456, 0),
    );
  });

  it('takes an else-if chain, with and without the store of c in the last branch', () => {
    const chain = 'if (vi > 8) { a = 5; c = 5; } else if (vi > 3) { a = 6; c = 6; }';
    expect(valuesAt(sum(chain))).toEqual(at(0, 0, 0));
    const alone = 'if (vi > 8) { a = 5; c = 5; } else if (vi > 3) { a = 6; }';
    expect(valuesAt(sum(alone))).toEqual(at(268435456, 0, 0));
  });

  it('takes a store after the loop, a read inside the loop and a return in the else branch', () => {
    const after = 'for (let i = 0; i < ii; i++) { a = 5; c = 5; }\n  a = 9;';
    expect(valuesAt(sum(after))).toEqual(at(268435456, 4, 4));
    const inside =
      'let r = 0.0;\n  for (let i = 0; i < ii; i++) { r += f32(a - c); a = 5; c = 5; }';
    expect(valuesAt(sum(inside, 'return r;'))).toEqual(at(0, 0, 0));
    const early = 'if (vi > 3) { a = 5; c = 5; } else { return 2.0; }';
    expect(valuesAt(sum(early))).toEqual(at(0, 2, 0));
  });

  it('takes the same shapes with u32 variables', () => {
    const u32 = (body: string, result = 'return f32(a - c);'): string =>
      program(`let a = 0xF0000000;\n  let c = a;\n  ${body}\n  ${result}`);
    expect(valuesAt(u32('if (vi > 3) { return 1.0; }\n  a = 5;\n  c = 5;'))).toEqual(at(1, 0, 1));
    expect(valuesAt(u32('for (let i = 0; i < ii; i++) { a = 5; }', 'return f32(c - a);'))).toEqual(
      at(0, 4026531840, 4026531840),
    );
    expect(valuesAt(u32('{ a = 5; c = a; }'))).toEqual(at(0, 0, 0));
    expect(valuesAt(u32('if (vi > 3) { a = 5; c = 5; } else { return 2.0; }'))).toEqual(
      at(0, 2, 0),
    );
    expect(valuesAt(u32('if (vi > 3) { a = 5; c = 5; } else { c = 5; }'))).toEqual(
      at(0, 4026531840, 0),
    );
  });

  it('takes a copy that was read before the variable was stored again, in either order', () => {
    const body = 'let a = 5;\n  let c = a;\n  a = (0xF0000000|0);\n  return f32(c - a);';
    expect(valuesAt(program(body))).toEqual(at(268435456, 268435456, 268435456));
  });

  it('reports the do...while refusal alone, without a second refusal of the read', () => {
    const sentence =
      'do…while is not supported: the IR has one loop shape, a top-tested "for", and a do…while ' +
      'runs its body before the first test. Write "while (c) { … }" with the body\'s first pass ' +
      'unrolled above it, or a counted "for".';
    const body = 'let i = 0;\n  do { a = 5; c = 5; i++; } while (i < ii);';
    bothRefuse(sum(body), 'TS8099', sentence);
  });

  it('refuses a pair that occurs on one path, with the approved sentence', () => {
    const cases: readonly (readonly [string, string, string])[] = [
      ['if (vi > 3) { a = 5; c = 6; }', 'return f32(a - c);', 'a - c'],
      ['if (vi > 3) { a = 5; c = 5; } else { a = 7; c = 8; }', 'return f32(a - c);', 'a - c'],
      ['if (vi > 3) { a = 5; c = 5; } else { c = 5; }', 'return f32(a - c);', 'a - c'],
      ['if (vi > 3) { c = 5; }', 'return f32(a - c);', 'a - c'],
      ['for (let i = 0; i < ii; i++) { a = 5; c = 6; }', 'return f32(a - c);', 'a - c'],
      ['if (vi > 3) { a = 5; c = 5; }', 'return f32(a + c);', 'a + c'],
      ['if (vi > 3) { a = 5; c = 5; }', 'return f32(a * c);', 'a * c'],
      ['if (vi > 3) { a = 5; c = 5; }', 'return f32(a & c);', 'a & c'],
      ['if (vi > 3) { a = 5; c = 5; }', 'return f32(a | c);', 'a | c'],
    ];
    for (const [body, result, expression] of cases) {
      bothRefuse(sum(body, result), 'TS8003', refusal(expression));
    }
  });

  it('refuses a pair the walk cannot follow: a choice that stores, a break', () => {
    const cases: readonly string[] = [
      'a = vi > 3 ? 5 : a;\n  c = vi > 3 ? 5 : c;',
      'a = select(a, 5, vi > 3);\n  c = select(c, 5, vi > 3);',
      'for (let i = 0; i < ii; i++) { a = 5; if (vi > 2) { break; } c = 5; }',
    ];
    for (const body of cases) bothRefuse(sum(body), 'TS8003', refusal('a - c'));
  });

  it('refuses a value of one variable that reaches the read, and its named edit gives the value', () => {
    const lone = 'let a = (0xF0000000|0);\n  if (vi > 3) { a = 5; }\n  return f32(a - 1);';
    bothRefuse(program(lone), 'TS8003', refusal('a - 1'));
    const edited = sum('if (vi > 3) { a = 5; c = 6; }', 'return f32(i32(a - c));');
    expect(valuesAt(edited)).toEqual(at(-1, 0, -1));
  });

  it('refuses a pair that a loop carries to its next pass, in i32 and in u32', () => {
    const i32 =
      'let a = (0xF0000000|0);\n  let c = a;\n  let r = 0.0;\n' +
      '  for (let i = 0; i < ii; i++) { r += f32(a - c); a = c; c = 5; }\n  return r;';
    bothRefuse(program(i32), 'TS8003', refusal('a - c'));
    const u32 =
      'let a = 0xF0000000;\n  let c = a;\n  let r = 0.0;\n' +
      '  for (let i = 0; i < ii; i++) { r += f32(a - c); c = a; a = 5; }\n  return r;';
    bothRefuse(program(u32), 'TS8003', refusal('a - c'));
  });
});
