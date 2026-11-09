// #794: report the cause once, and offer a remedy that compiles in both halves.
import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

function check(body: string): ReturnType<typeof compile> {
  const source = `"use typeshade";\n${body}`;
  const result = compile(source);
  const service = createTypeshadeLanguageService();
  service.openDocument('diagnostic-cascades.ts', source);
  expect(
    service
      .getDiagnostics('diagnostic-cascades.ts')
      .filter((d) => d.severity === 'error')
      .map((d) => `${d.code} ${d.message}`),
  ).toEqual(
    result.diagnostics.filter((d) => d.category === 'error').map((d) => `${d.code} ${d.message}`),
  );
  return result;
}

const square = 'function sq(x: f32): f32 { return x * x; }';
const valueError =
  '"sq" is a function, and a shader has no function values: nothing at run time can hold one, return one or choose between two. Call it where its value is needed, "sq(...)", or hand it to a parameter that takes a function (Rule 8.18).';
const lengthError =
  '"trace" uses "N" as an array length, but generic parameters name types, not lengths (Rule 8.9). Write a helper for each fixed length, or export a kernel taking an unsized array and a separate size argument.';
const trace = `function trace<N extends number>(a: array<f64, N>, n: u32): f64 {
  let s: f64 = f64(0);
  for (let i: u32 = 0; i < n; i++) s += a[i * n + i];
  return s;
}`;

describe('diagnostic causes and usable remedies', () => {
  it.each(['return g(x);', 'const h = g; return h(x);'])(
    'keeps only the function-value refusal through a failed alias: %s',
    (use) => {
      const r = check(`${square}\nexport function pick(x: f32): f32 { const g = sq; ${use} }`);
      expect(r.diagnostics).toMatchObject([{ code: 'TS8099', message: valueError }]);
      expect(r.diagnostics).toHaveLength(1);
    },
  );

  it('still reports an independent error in the refused call argument', () => {
    const r = check(
      `${square}\nexport function pick(x: f32): f32 { const g = sq; return g(missing); }`,
    );
    expect(r.diagnostics.map((d) => d.code)).toEqual(['TS8099', 'TS8022']);
    expect(r.diagnostics[1]!.message).toBe('Unknown identifier "missing".');
  });

  it('does not suppress an unknown callee in a sibling scope', () => {
    const r = check(`${square}\nexport function pick(x: f32): f32 {
      if (x > 0.) { const g = sq; }
      return g(x);
    }`);
    expect(r.diagnostics.map((d) => d.code)).toEqual(['TS8099', 'TS8004']);
  });

  it.each([
    '',
    'export function both(a: array<f64, 9>, b: array<f64, 36>): f64 { return trace(a, 3) + trace(b, 6); }',
    'export function explicit(a: array<f64, 9>): f64 { return trace<9>(a, 3); }',
  ])('refuses a length parameter once at its declaration, regardless of calls: %s', (calls) => {
    const r = check(`${trace}\n${calls}`);
    expect(r.diagnostics).toMatchObject([{ code: 'TS8002', message: lengthError, line: 2 }]);
    expect(r.diagnostics).toHaveLength(1);
  });

  it('keeps the declaration refusal when the call names its namespace', () => {
    const r = check(`namespace Matrix { export ${trace} }
      export function run(a: array<f64, 9>): f64 { return Matrix.trace(a, 3); }`);
    expect(r.diagnostics).toMatchObject([{ code: 'TS8002', message: lengthError }]);
    expect(r.diagnostics).toHaveLength(1);
  });

  it('keeps valid type inference, fixed lengths and an unsized array with a size argument', () => {
    const r = check(`function identity<T>(a: array<T, 9>): array<T, 9> { return a; }
      export ${trace.replace('<N extends number>', '').replace('array<f64, N>', 'array<f64>')}
      export function fixed(a: array<f64, 9>): array<f64, 9> { return identity(a); }`);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(r.eval('trace', [[1, 2, 3, 4, 5, 6, 7, 8, 9], 3])).toBe(15);
  });

  it.each(['isFinite', 'isNaN', 'Number.isFinite', 'Number.isNaN'])(
    'gives the f32 bit-test remedy for %s, without suggesting the enclosing helper',
    (name) => {
      const r = check(`export function finite(x: f32): bool { return ${name}(x); }`);
      const test = name.endsWith('isFinite')
        ? '(bitcast<u32>(x) & u32(0x7f800000)) != u32(0x7f800000)'
        : '(bitcast<u32>(x) & u32(0x7fffffff)) > u32(0x7f800000)';
      expect(r.diagnostics).toHaveLength(1);
      expect(r.diagnostics[0]).toMatchObject({
        code: name.startsWith('Number.') ? 'TS8022' : 'TS8004',
        message: `"${name}" is an ECMAScript number predicate, not a shader function. For an f32 value x, test its bits with "${test}". This inspects the stored value; it does not make GPU arithmetic preserve NaNs or infinities.`,
      });
      const fixed = check(`export function finite(x: f32): bool { return ${test}; }`);
      expect(fixed.diagnostics).toEqual([]);
      expect(fixed.eval('finite', [2])).toBe(name.endsWith('isFinite'));
      expect(fixed.eval('finite', [Infinity])).toBe(false);
      expect(fixed.eval('finite', [NaN])).toBe(name.endsWith('isNaN'));
    },
  );

  it('allows the author to declare a function with the same spelling', () => {
    const r = check(`function isFinite(x: f32): bool { return x == x; }
      namespace Number { export function isNaN(x: f32): bool { return x != x; } }
      export function finite(x: f32): bool { return isFinite(x) && !Number.isNaN(x); }`);
    expect(r.diagnostics).toEqual([]);
    expect(r.eval('finite', [2])).toBe(true);
  });
});
