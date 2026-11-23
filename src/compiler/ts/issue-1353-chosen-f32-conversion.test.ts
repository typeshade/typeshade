import { describe, expect, it } from 'vitest';
import { bothTake } from '../../core/testing/both-halves.js';
import { compileModule } from '../../core/oracle.js';
import { optimizeAt, type OptLevel } from '../../core/passes/opt/optimize.js';
import { emitModule } from '../../core/backends/wgsl.js';
import { emitGlslModule } from '../../core/backends/glsl.js';

const LEVELS: readonly OptLevel[] = ['O0', 'O1', 'O2'];

const program = (result: string, body: string): string =>
  `"use typeshade";\nexport function t(f: f32, ii: i32): ${result} {\n  ${body}\n}\n`;

const valuesAt = (source: string, f = 1.5): unknown[] => {
  const { result } = bothTake(source);
  return LEVELS.map((level) => {
    const cpu = compileModule(optimizeAt(result.module, level), { precision: 'f32' });
    return (cpu.fns['t'] as (...a: readonly unknown[]) => unknown)(f, -3);
  });
};

const emitsAt = (source: string): { wgsl: string; glsl: string }[] => {
  const { result } = bothTake(source);
  return LEVELS.map((level) => {
    const m = optimizeAt(result.module, level);
    return { wgsl: emitModule(m), glsl: emitGlslModule(m, 'fragment') };
  });
};

const same = (value: unknown): unknown[] => LEVELS.map(() => value);

describe('u32() and i32() of a compiler-chosen f32 wrap as TypeScript does (issue 1353)', () => {
  it('u32() of a negative value is ToUint32 of it', () => {
    const source = program('u32', 'let k = 5;\n  k -= 8;\n  return u32(k);');
    expect(valuesAt(source)).toEqual(same(4294967293));
  });

  it('i32() of a negative value in range is the value', () => {
    const source = program('i32', 'let k = 5;\n  k -= 8;\n  return i32(k);');
    expect(valuesAt(source)).toEqual(same(-3));
  });

  it('a value in range keeps its value', () => {
    const source = program('u32', 'let k = 5;\n  k += 3;\n  return u32(k);');
    expect(valuesAt(source)).toEqual(same(8));
  });

  it('a value past the range wraps modulo 2^32 on the f32 the program computes', () => {
    const big = 'let k = 5;\n  k *= 1000000000;\n  k *= 5;\n  ';
    expect(valuesAt(program('i32', `${big}return i32(k);`))).toEqual(same(-769804288));
    expect(valuesAt(program('u32', `${big}return u32(k);`))).toEqual(same(3525163008));
    const low = 'let k = 5;\n  k -= 3000000000;\n  k -= 3000000000;\n  ';
    expect(valuesAt(program('i32', `${low}return i32(k);`))).toEqual(same(-1705032704));
    expect(valuesAt(program('u32', `${low}return u32(k);`))).toEqual(same(2589934592));
  });

  it('the edges of the range', () => {
    const edge = (conversion: string, init: string): string =>
      program(conversion, `let k = ${init};\n  k += 0;\n  return ${conversion}(k);`);
    expect(valuesAt(edge('u32', '2147483648'))).toEqual(same(2147483648));
    expect(valuesAt(edge('i32', '2147483648'))).toEqual(same(-2147483648));
    expect(valuesAt(edge('i32', '-2147483648'))).toEqual(same(-2147483648));
    expect(valuesAt(edge('u32', '-2147483648'))).toEqual(same(2147483648));
    expect(valuesAt(edge('u32', '4294967296'))).toEqual(same(0));
    expect(valuesAt(edge('i32', '4294967296'))).toEqual(same(0));
  });

  it('a fraction truncates toward zero before it wraps', () => {
    const source = program('u32', 'let k = 5;\n  k /= 2;\n  k -= 10;\n  return u32(k);');
    expect(valuesAt(source)).toEqual(same(4294967289));
  });

  it('arithmetic over the chosen value is read the same way', () => {
    const source = program('u32', 'let k = 5;\n  k -= 8;\n  return u32(k * 2);');
    expect(valuesAt(source)).toEqual(same(4294967290));
  });

  it('both targets emit the helper where the value is chosen', () => {
    const source = program('u32', 'let k = 5;\n  k -= 8;\n  return u32(k);');
    for (const { wgsl, glsl } of emitsAt(source)) {
      expect(wgsl).toContain('_opt_wrap_u32_f32_(k)');
      expect(glsl).toContain('_opt_wrap_u32_f32_(k)');
    }
  });

  it('a float the author typed keeps the saturating conversion', () => {
    expect(valuesAt(program('u32', 'return u32(f - 10.0);'))).toEqual(same(0));
    expect(valuesAt(program('i32', 'return i32(f * 1.0e10);'))).toEqual(same(2147483520));
    expect(valuesAt(program('u32', 'let k: f32 = 5;\n  k -= 8;\n  return u32(k);'))).toEqual(
      same(0),
    );
    expect(valuesAt(program('u32', 'let k = 5.0;\n  k -= 8;\n  return u32(k);'))).toEqual(same(0));
    const mixed = program('u32', 'let k = 5;\n  k -= 8;\n  return u32(k + f);');
    expect(valuesAt(mixed)).toEqual(same(0));
    for (const { wgsl } of emitsAt(program('u32', 'return u32(f - 10.0);'))) {
      expect(wgsl).toContain('u32((f - 10.0))');
      expect(wgsl).not.toContain('_opt_wrap');
    }
  });

  it('a value that an integer use decides keeps its integer type', () => {
    const source = program('u32', 'let k = 5;\n  k -= u32(8);\n  return u32(k);');
    expect(valuesAt(source)).toEqual(same(4294967293));
  });
});
