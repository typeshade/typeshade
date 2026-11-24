import { describe, expect, it } from 'vitest';
import { bothRefuse, bothTake } from '../../core/testing/both-halves.js';
import { compileModule } from '../../core/oracle.js';
import { optimizeAt, type OptLevel } from '../../core/passes/opt/optimize.js';

const LEVELS: readonly OptLevel[] = ['O0', 'O1', 'O2'];

const program = (result: string, body: string): string =>
  '"use typeshade";\nfunction gg() {\n  return 5 | 0;\n}\nfunction pass(v: u32) {\n  return v;\n}\n' +
  `export function t(ii: i32, vi: u32, xs: i32[]): ${result} {\n  ${body}\n}\n`;

const sentence = (
  subject: string,
  by: string,
  written: string,
  operator: string,
  remedy: string,
): string =>
  `"${subject}" is an integer ${by}, and no operand of "${written}" has a declared type, ` +
  `so the "${operator}" does not say which division it is. ${remedy}`;

const INFERENCE = 'by inference';
const BIT = 'by its bit operator';

const valuesAt = (source: string, args: readonly unknown[]): unknown[] => {
  const { result } = bothTake(source);
  return LEVELS.map((level) => {
    const cpu = compileModule(optimizeAt(result.module, level), { precision: 'f32' });
    return (cpu.fns['t'] as (...a: readonly unknown[]) => unknown)(...args);
  });
};

describe('a refused / names what makes the operand an integer (issue 1300)', () => {
  it.each([
    ['i32', 'let a = ii;\n  a = a / 2;\n  return a;', 'a', 'a / 2', '/', 'i32(a) / 2'],
    ['i32', 'let a = ii;\n  a = 2 / a;\n  return a;', 'a', '2 / a', '/', '2 / i32(a)'],
    ['u32', 'let n = xs.length;\n  n = n / 2;\n  return n;', 'n', 'n / 2', '/', 'u32(n) / 2'],
    ['u32', 'let a = vi;\n  a = a / 2;\n  return a;', 'a', 'a / 2', '/', 'u32(a) / 2'],
    ['u32', 'let a = pass(vi);\n  a = a / 2;\n  return a;', 'a', 'a / 2', '/', 'u32(a) / 2'],
    ['i32', 'let a = ii | 0;\n  a = a / 2;\n  return a;', 'a', 'a / 2', '/', 'i32(a) / 2'],
    ['i32', 'let a = ii + (1 | 0);\n  a = a / 2;\n  return a;', 'a', 'a / 2', '/', 'i32(a) / 2'],
  ] as const)('an integer by inference: %s %s', (ret, body, subject, written, operator, edit) => {
    const said = sentence(
      subject,
      INFERENCE,
      written,
      operator,
      `Write "${edit}" for the integer division.`,
    );
    bothRefuse(program(ret, body), 'TS8003', said);
  });

  it.each([
    ['i32', 'let a = ii;\n  a /= 2;\n  return a;', 'a', 'let a: i32 = ii'],
    ['u32', 'let n = xs.length;\n  n /= 2;\n  return n;', 'n', 'let n: u32 = xs.length'],
  ] as const)('a /= over an integer by inference: %s', (ret, body, subject, edit) => {
    const said = sentence(
      subject,
      INFERENCE,
      `${subject} /= 2`,
      '/=',
      `Write "${edit}" for the integer division.`,
    );
    bothRefuse(program(ret, body), 'TS8003', said);
  });

  it.each([
    ['i32', 'let a = (-7 | 0);\n  a = a / 2;\n  return a;', 'a / 2', '/', 'i32(a) / 2'],
    ['i32', 'let a = gg();\n  a = a / 2;\n  return a;', 'a / 2', '/', 'i32(a) / 2'],
    ['i32', 'let a = (-7 | 0);\n  a /= 2;\n  return a;', 'a /= 2', '/=', 'let a: i32 = (-7 | 0)'],
  ] as const)(
    'an integer by a bit operator keeps its wording: %s',
    (ret, body, written, op, edit) => {
      const said = sentence('a', BIT, written, op, `Write "${edit}" for the integer division.`);
      bothRefuse(program(ret, body), 'TS8003', said);
    },
  );

  it.each([
    ['let a = ii;\n  a = (a | 0) / 2;\n  return a;', 'a | 0', '(a | 0) / 2', 'i32(a | 0) / 2'],
    ['let a = ii;\n  a = (a & 3) / 2;\n  return a;', 'a & 3', '(a & 3) / 2', 'i32(a & 3) / 2'],
    [
      'let a = ii;\n  a = (a | 0) / (a | 1);\n  return a;',
      'a | 0',
      '(a | 0) / (a | 1)',
      'i32(a | 0) / i32(a | 1)',
    ],
    ['let a = ii;\n  let b = a | 0;\n  a = b / 2;\n  return a;', 'b', 'b / 2', 'i32(b) / 2'],
    [
      'let a = ii;\n  a = ((a | 0) + 1) / 2;\n  return a;',
      '(a | 0) + 1',
      '((a | 0) + 1) / 2',
      'i32((a | 0) + 1) / 2',
    ],
    ['let a = ii;\n  a = a / (1|2);\n  return a;', 'a', 'a / (1|2)', 'i32(a) / i32(1|2)'],
    [
      'let a = ii;\n  a = a / (1|2) / (3|0);\n  return a;',
      'a / (1|2)',
      'a / (1|2) / (3|0)',
      'i32(a / (1|2)) / i32(3|0)',
    ],
    [
      'let a = ii;\n  let b = (1 | 0);\n  a = (a / b) / 2;\n  return a;',
      'a',
      'a / b',
      'i32(a) / i32(b)',
    ],
    ['let a = (3|0) * ii;\n  a = a / 2;\n  return a;', 'a', 'a / 2', 'i32(a) / 2'],
    ['let a = -ii;\n  a = a / 2;\n  return a;', 'a', 'a / 2', 'i32(a) / 2'],
    ['let a = ii << 1;\n  a = a / 2;\n  return a;', 'a', 'a / 2', 'i32(a) / 2'],
  ] as const)(
    'a bit expression over a typed operand is an integer by inference: %s',
    (body, subject, written, edit) => {
      const said = sentence(
        subject,
        INFERENCE,
        written,
        '/',
        `Write "${edit}" for the integer division.`,
      );
      bothRefuse(program('i32', body), 'TS8003', said);
    },
  );

  it('the operand that is an integer by inference is the subject beside a bit operand', () => {
    const body = 'let a = ii;\n  let b = (-7 | 0);\n  a = a / b;\n  return a;';
    const said = sentence(
      'a',
      INFERENCE,
      'a / b',
      '/',
      'Write "i32(a) / i32(b)" for the integer division.',
    );
    bothRefuse(program('i32', body), 'TS8003', said);
  });

  it('each named edit gives the integer division of TypeScript value', () => {
    const edited = program('i32', 'let a = ii;\n  a = i32(a) / 2;\n  return a;');
    expect(valuesAt(edited, [7, 0, [1, 2]])).toEqual(LEVELS.map(() => Math.trunc(7 / 2)));
    expect(valuesAt(edited, [-7, 0, [1, 2]])).toEqual(LEVELS.map(() => Math.trunc(-7 / 2)));
    const length = program('u32', 'let n = xs.length;\n  n = u32(n) / 2;\n  return n;');
    expect(valuesAt(length, [0, 0, [1, 2, 3, 4, 5]])).toEqual(LEVELS.map(() => 2));
    const compound = program('i32', 'let a: i32 = ii;\n  a /= 2;\n  return a;');
    expect(valuesAt(compound, [9, 0, [1]])).toEqual(LEVELS.map(() => 4));
  });
});
