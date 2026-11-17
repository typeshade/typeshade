import { describe, expect, it } from 'vitest';
import { bothRefuse, bothTake } from '../../core/testing/both-halves.js';
import { compileModule } from '../../core/oracle.js';
import { optimizeAt, type OptLevel } from '../../core/passes/opt/optimize.js';
import { emitModule } from '../../core/backends/wgsl.js';
import { emitGlslModule } from '../../core/backends/glsl.js';

const HELPERS = 'function gg() {\n  return 5 | 0;\n}\nfunction pass(v: u32) {\n  return v;\n}\n';

const program = (result: string, body: string): string =>
  `"use typeshade";\n${HELPERS}export function t(ii: i32, vi: u32): ${result} {\n  ${body}\n}\n`;

const LEVELS: readonly OptLevel[] = ['O0', 'O1', 'O2'];

const valuesAt = (source: string, args: readonly unknown[]): unknown[] => {
  const { result } = bothTake(source);
  return LEVELS.map((level) => {
    const cpu = compileModule(optimizeAt(result.module, level), { precision: 'f32' });
    return (cpu.fns['t'] as (...a: readonly unknown[]) => unknown)(...args);
  });
};

const emitsAt = (source: string): { wgsl: string; glsl: string }[] => {
  const { result } = bothTake(source);
  return LEVELS.map((level) => {
    const m = optimizeAt(result.module, level);
    return { wgsl: emitModule(m), glsl: emitGlslModule(m, 'fragment') };
  });
};

const toUint32 = (x: number): number => Math.trunc(x) >>> 0;
const toInt32 = (x: number): number => Math.trunc(x) | 0;

describe('an integer position reads the integer quotient of integers by inference (issue 1320)', () => {
  it("u32() of a negative quotient over i32 operands is ToUint32 of TypeScript's quotient", () => {
    const source = program(
      'u32',
      'let a = -21 - gg();\n  let b = a;\n  a *= ii;\n  return u32(a / b);',
    );
    expect(valuesAt(source, [-3, 7])).toEqual(LEVELS.map(() => toUint32((-26 * -3) / -26)));
    expect(valuesAt(source, [0, 7])).toEqual(LEVELS.map(() => 0));
    for (const { wgsl, glsl } of emitsAt(source)) {
      expect(wgsl).not.toContain('f32(a)');
      expect(wgsl).toContain('u32(_opt_div0_i32_i32_(a, b))');
      expect(glsl).not.toContain('float(a)');
    }
  });

  it('u32() and i32() of a quotient with no integer value truncate toward zero', () => {
    const u = program('u32', 'let a = (-7|0);\n  return u32(a / 2);');
    expect(valuesAt(u, [0, 0])).toEqual(LEVELS.map(() => toUint32(-7 / 2)));
    const i = program('i32', 'let a = (-7|0);\n  return i32(a / 2);');
    expect(valuesAt(i, [0, 0])).toEqual(LEVELS.map(() => toInt32(-7 / 2)));
    expect(emitsAt(u)[0]!.wgsl).toContain('u32((a / 2))');
    expect(emitsAt(i)[0]!.wgsl).not.toContain('f32(a)');
  });

  it('a quotient over u32 operands converts to i32 by its bits', () => {
    const source = program('i32', 'let a = pass(vi);\n  return i32(a / 3);');
    expect(valuesAt(source, [0, 4294967295])).toEqual(LEVELS.map(() => toInt32(4294967295 / 3)));
    expect(emitsAt(source)[0]!.wgsl).toContain('return i32((a / 3u));');
  });

  it("a divisor of zero at run time gives TypeScript's 0 after the conversion", () => {
    for (const [result, conversion, tsValue] of [
      ['u32', 'u32', toUint32(-Infinity)],
      ['i32', 'i32', toInt32(-Infinity)],
    ] as const) {
      const source = program(
        result,
        `let a = (-7|0);\n  let z = gg() - 5;\n  return ${conversion}(a / z);`,
      );
      expect(valuesAt(source, [0, 0])).toEqual(LEVELS.map(() => tsValue));
      for (const { wgsl, glsl } of emitsAt(source)) {
        expect(wgsl).toContain('_opt_div0_i32_i32_(a, z)');
        expect(glsl).toContain('_opt_div0_i32_i32_(a, z)');
      }
    }
    const nan = program('u32', 'let z = gg() - 5;\n  let a = z;\n  return u32(a / z);');
    expect(valuesAt(nan, [0, 0])).toEqual(LEVELS.map(() => toUint32(NaN)));
  });

  it('a declared integer of the operands type reads 0 for a divisor of zero', () => {
    const source = program(
      'i32',
      'let a = (-7|0);\n  let z = gg() - 5;\n  let j: i32 = a / z;\n  return j;',
    );
    expect(valuesAt(source, [0, 0])).toEqual(LEVELS.map(() => 0));
    const nonzero = program(
      'i32',
      'let a = (-7|0);\n  let z = gg() - 3;\n  let j: i32 = a / z;\n  return j;',
    );
    expect(valuesAt(nonzero, [0, 0])).toEqual(LEVELS.map(() => toInt32(-7 / 2)));
  });

  it('a constant quotient folds to the value the run time computes', () => {
    for (const [result, body, value] of [
      ['u32', 'return u32((-7|0) / 2);', toUint32(-7 / 2)],
      ['u32', 'return u32((-6|0) / 2);', toUint32(-6 / 2)],
      ['i32', 'return i32((-7|0) / 2);', toInt32(-7 / 2)],
      ['u32', 'return u32((-7|0) / 2) + u32(0);', toUint32(-7 / 2)],
    ] as const) {
      const source = program(result, body);
      expect(valuesAt(source, [0, 0])).toEqual(LEVELS.map(() => value));
      expect(emitsAt(source)[0]!.wgsl).toContain(
        result === 'u32' ? `${String(value)}u` : String(value),
      );
    }
  });

  it('a declaration of the other integer type keeps the refusal that names the edit', () => {
    bothRefuse(
      program('u32', 'let a = (-7|0);\n  let j: u32 = a / 2;\n  return j;'),
      'TS8003',
      '"a" is an integer by its bit operator, and no operand of "a / 2" has a declared type, so the "/" does not say which division it is. Write "u32(a) / 2" for the integer division.',
    );
  });
});

const MODULE_G = (body: string): string => `"use typeshade";\nlet g = 1 | 0;\n${body}\n`;

const valuesOf = (source: string, args: readonly unknown[]): unknown[] => {
  const { result } = bothTake(source);
  return LEVELS.map((level) => {
    const cpu = compileModule(optimizeAt(result.module, level), { precision: 'f32' });
    return (cpu.fns['t'] as (...a: readonly unknown[]) => unknown)(...args);
  });
};

describe('the zero test evaluates each operand of the quotient once, in order (issue 1320)', () => {
  it('a dividend that writes runs whatever the divisor is', () => {
    const source = MODULE_G(
      'function bump() {\n  g = g + 10;\n  return -7 | 0;\n}\nfunction passi(v: i32) {\n  return v;\n}\n' +
        'export function t(jj: i32): i32 {\n  let b = passi(jj);\n  let q = u32(bump() / b);\n  return g + i32(q);\n}',
    );
    expect(valuesOf(source, [0])).toEqual(LEVELS.map(() => 11));
  });

  it('a dividend that writes the divisor runs before the divisor is read', () => {
    const source = MODULE_G(
      'function bump() {\n  g = 0;\n  return -7 | 0;\n}\n' +
        'export function t(jj: i32): u32 {\n  g = jj;\n  return u32(bump() / g);\n}',
    );
    expect(valuesOf(source, [3])).toEqual(LEVELS.map(() => toUint32(-7 / 0)));
  });

  it('a divisor that is a call takes the zero test too', () => {
    const passi = 'function passi(v: i32) {\n  return v;\n}\n';
    for (const [result, body] of [
      ['u32', 'let a = (-7|0);\n  return u32(a / passi(jj));'],
      ['i32', 'let a = (-7|0);\n  return i32(a / passi(jj));'],
      ['i32', 'let a = (-7|0);\n  let j: i32 = a / passi(jj);\n  return j;'],
      ['i32', 'let a = passi(-7);\n  let b = passi(jj);\n  return a / b;'],
    ] as const) {
      const source = `"use typeshade";\n${passi}export function t(jj: i32): ${result} {\n  ${body}\n}\n`;
      expect(valuesOf(source, [0])).toEqual(LEVELS.map(() => 0));
      expect(valuesOf(source, [2])).toEqual(
        LEVELS.map(() => (result === 'u32' ? toUint32(-7 / 2) : toInt32(-7 / 2))),
      );
    }
  });
});
