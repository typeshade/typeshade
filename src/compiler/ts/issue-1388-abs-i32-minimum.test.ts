import { describe, expect, it } from 'vitest';
import { bothRefuse, bothTake } from '../../core/testing/both-halves.js';
import { compileModule } from '../../core/oracle.js';
import { optimizeAt, type OptLevel } from '../../core/passes/opt/optimize.js';

const program = (body: string, result = 'f32'): string =>
  `"use typeshade";\nexport function t(ii: i32, vi: u32, f: f32): ${result} {\n  ${body}\n}\n`;

const H = 'let h = (1 << 30);\n  ';
const LEVELS: readonly OptLevel[] = ['O0', 'O1', 'O2'];

const valuesAt = (source: string, args: readonly unknown[] = [-9, 7, 1.5]): unknown[] => {
  const { result } = bothTake(source);
  return LEVELS.map((level) => {
    const cpu = compileModule(optimizeAt(result.module, level), { precision: 'f32' });
    return (cpu.fns['t'] as (...a: readonly unknown[]) => unknown)(...args);
  });
};

const same = (value: number): number[] => LEVELS.map(() => value);

const NO_EDIT = (subject: string, at = 'abs'): string =>
  `The compiler cannot prove that the u32 bits and the TypeScript value of "${subject}" agree, ` +
  `so the "${at}" does not say which value it means.`;

describe('abs of a proven i32 minimum is refused with no edit (issue 1388, decision (d))', () => {
  it.each([
    ['a conversion', `${H}return f32(abs(i32(h + h)));`, 'i32(h + h)'],
    ['a let binding', `${H}let k = i32(h + h);\n  return f32(abs(k));`, 'k'],
    ['a const binding', `${H}const m = i32(h + h);\n  return f32(abs(m));`, 'm'],
    ['a constant fold', 'return f32(abs(i32(-2147483647 - 1)));', 'i32(-2147483647 - 1)'],
    ['a written minimum', 'return f32(abs(i32(-2147483648)));', 'i32(-2147483648)'],
    ['a nested conversion', `${H}return f32(abs(i32(u32(h + h))));`, 'i32(u32(h + h))'],
    [
      'a binding of a nested conversion',
      `${H}let u = u32(h + h);\n  return f32(abs(i32(u)));`,
      'i32(u)',
    ],
    ['a chain of bindings', `${H}let k = i32(h + h);\n  let j = k;\n  return f32(abs(j));`, 'j'],
    ['a typed binding', `${H}let k: i32 = i32(h + h);\n  return f32(abs(k));`, 'k'],
    [
      'a constant with a conversion',
      'const M = -2147483647 - 1;\n  return f32(abs(i32(M)));',
      'i32(M)',
    ],
    ['an abs inside max', `${H}let k = i32(h + h);\n  return f32(max(abs(k), 1));`, 'k'],
    ['an abs in a sum', `${H}let k = i32(h + h);\n  return f32(abs(k) + 1);`, 'k'],
    ['an abs beside an i32', `${H}let k = i32(h + h);\n  return f32(abs(k) + ii);`, 'k'],
  ] as const)('refuses %s in both halves', (_, body, subject) => {
    bothRefuse(program(body), 'TS8003', NO_EDIT(subject));
  });

  it.each([
    ['a shifted operand', `${H}let k = i32(h << 1);\n  return f32(abs(k));`, 'k'],
    ['a product operand', `${H}let k = i32(h * 2);\n  return f32(abs(k));`, 'k'],
    ['a negated operand', `${H}let k = i32(-h - h);\n  return f32(abs(k));`, 'k'],
    ['a u32 literal', 'return f32(abs(i32(u32(2147483648))));', 'i32(u32(2147483648))'],
    ['a const of a written minimum', 'const m = i32(-2147483648);\n  return f32(abs(m));', 'm'],
    [
      'a typed let of a written minimum',
      'let m: i32 = i32(-2147483648);\n  return f32(abs(m));',
      'm',
    ],
    ['an i32 of a binding', `${H}let k = i32(h + h);\n  return f32(abs(i32(k)));`, 'i32(k)'],
    ['a parenthesised binding', `${H}let k = i32(h + h);\n  return f32(abs((k)));`, 'k'],
    ['a quotient', `${H}let k = i32(h + h);\n  return f32(abs(k) / 2);`, 'k'],
    ['a product', `${H}let k = i32(h + h);\n  return f32(abs(k) * 2);`, 'k'],
    ['a negation', `${H}let k = i32(h + h);\n  return f32(-abs(k));`, 'k'],
    ['a condition', `${H}let k = i32(h + h);\n  return f32(abs(k) > 5 ? 1 : 2);`, 'k'],
    ['a min of two abs', `${H}let k = i32(h + h);\n  return f32(min(abs(k), abs(k)));`, 'k'],
    ['a binding of abs', `${H}let k = i32(h + h);\n  let a = abs(k);\n  return f32(a);`, 'k'],
    ['a u32 conversion of abs', `${H}let k = i32(h + h);\n  return f32(u32(abs(k)));`, 'k'],
    [
      'an abs beside an abs of a run-time i32',
      `${H}let k = i32(h + h);\n  return f32(abs(k)) + f32(abs(ii));`,
      'k',
    ],
    ['an abs beside an f32', `${H}let k = i32(h + h);\n  return f32(abs(k)) + f;`, 'k'],
    [
      'an abs in a branch',
      `${H}let k = i32(h + h);\n  if (ii > 0) {\n    return f32(abs(k));\n  }\n  return 1;`,
      'k',
    ],
    [
      'an abs inside a loop',
      `${H}let k = i32(h + h);\n  let s = 0.0;\n  for (let i = 0; i < 2; i++) {\n    s += f32(abs(k));\n  }\n  return s;`,
      'k',
    ],
    ['a const operand', 'const h = 1 << 30;\n  let k = i32(h + h);\n  return f32(abs(k));', 'k'],
  ] as const)('refuses %s in both halves, where main accepted it', (_, body, subject) => {
    bothRefuse(program(body), 'TS8003', NO_EDIT(subject));
  });

  it('refuses each abs of a proven minimum, one sentence for each', () => {
    bothRefuse(program('const m = i32(-2147483648);\n  return f32(abs(m) - abs(m));'), 'TS8003', [
      NO_EDIT('m'),
      NO_EDIT('m'),
    ]);
    bothRefuse(program(`${H}let k = i32(h + h);\n  return f32(abs(k) - abs(k));`), 'TS8003', [
      NO_EDIT('k'),
      NO_EDIT('k'),
    ]);
  });

  it('reports the refusal of abs where main reported a mixed-type sum', () => {
    bothRefuse(
      program(`${H}let u = u32(h + h);\n  return f32(abs(i32(u)) + abs(u));`),
      'TS8003',
      NO_EDIT('i32(u)'),
    );
  });

  it('refuses an abs with an i32 result', () => {
    bothRefuse(program(`${H}let k = i32(h + h);\n  return abs(k);`, 'i32'), 'TS8003', NO_EDIT('k'));
  });

  it('names no edit for the f32 conversion under abs(i32(...)), where the edit gave the wrong value', () => {
    bothRefuse(
      program(`${H}return f32(abs(i32(f32(h + h))));`),
      'TS8003',
      NO_EDIT('h + h', 'f32()'),
    );
  });

  it.each([
    ['an f32 conversion with an i32 result', `${H}return abs(i32(f32(h + h)));`, 'i32'],
    ['an f32 conversion in a sum', `${H}return f32(abs(i32(f32(h + h))) + 1);`, 'f32'],
    ['a parenthesised f32 conversion', `${H}return f32(abs(i32(f32((h + h)))));`, 'f32'],
  ] as const)('names no edit for %s under abs(i32(...))', (_, body, result) => {
    bothRefuse(program(body, result), 'TS8003', NO_EDIT('h + h', 'f32()'));
  });

  it('keeps the value of a program that is no i32 minimum, at every level', () => {
    const small = 'let h = (1 << 20);\n  ';
    const cases: readonly (readonly [string, string, number])[] = [
      ['a binding', `${small}let k = i32(h + h);\n  return f32(abs(k));`, 2097152],
      ['a nested conversion', `${small}return f32(abs(i32(u32(h + h))));`, 2097152],
      ['an f32 conversion', `${small}return f32(abs(i32(f32(h + h))));`, 2097152],
      ['a fold', 'return f32(abs(i32(-2147483647)));', 2147483648],
      ['a typed const', 'const m: i32 = -2147483648;\n  return f32(abs(m));', -2147483648],
      ['a reassigned binding', `${H}let k = i32(h + h);\n  k = ii;\n  return f32(abs(k));`, 9],
    ];
    for (const [, body, value] of cases) expect(valuesAt(program(body))).toEqual(same(value));
  });

  it("abs of an i32 known only at run time keeps WGSL's rule, at every level", () => {
    const source = program('return f32(abs(ii));');
    expect(valuesAt(source, [-2147483648, 7, 1.5])).toEqual(same(-2147483648));
    expect(valuesAt(source, [-9, 7, 1.5])).toEqual(same(9));
  });
});
