// #321 types#19: the array min/max overload takes numeric elements, even at length one.
// Actual Tint (Chromium 156.0.8078.4 / SwiftShader, 2026-11-07) refused the old emit with
// "no matching call to 'min(S, S)'" and "no matching call to 'max(bool, bool)'". Numeric
// scalar/vector neighbours passed, and the broken-shader instrument was refused.
// Verifies: Rule 9.2, Rule 12.1, Rule 12.4, Rule 12.6, Rule 12.7 (docs/language-design.md; traced in reqs/).
import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { compileModule, type CpuValue } from '../../core/oracle.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const URI = '/array-minmax.shade.ts';

function check(source: string) {
  const result = compile(source, { fileName: URI });
  const service = createTypeshadeLanguageService();
  service.openDocument(URI, source);
  const compiler = result.diagnostics.filter((d) => d.category === 'error');
  const editor = service.getDiagnostics(URI).filter((d) => d.severity === 'error');
  expect(editor.map(({ code, message }) => ({ code, message }))).toEqual(
    compiler.map(({ code, message }) => ({ code, message })),
  );
  service.closeDocument(URI);
  return { result, compiler, editor };
}

function sourceOf(op: string, elem: string, size: number | undefined, declaration = '') {
  return `"use typeshade";
${declaration}
export function f(xs: array<${elem}${size === undefined ? '' : `, ${size}`}>): ${elem} {
  return ${op}(xs);
}`;
}

describe.each(['min', 'max'])('%s over a fixed array', (op) => {
  it.each([
    ['bool', 2, '', 'bool'],
    ['bool', 1, '', 'bool'],
    ['vec2b', 2, '', 'vec2b'],
    ['mat2', 2, '', 'mat2x2'],
    ['array<f32, 2>', 2, '', 'array<f32, 2>'],
    ['S', 2, 'class S { value!: f32; }', 'S'],
    ['S', 1, 'class S { value!: f32; }', 'S'],
  ] as const)('refuses %s elements at length %s once in both halves', (elem, size, decl, shown) => {
    const source = sourceOf(op, elem, size, decl);
    const { result, compiler, editor } = check(source);
    expect(compiler.map(({ code, message }) => ({ code, message }))).toEqual([
      {
        code: 'TS8003',
        message: `${op}(xs) cannot compare ${shown} elements. Pass an array of numeric scalars or vectors.`,
      },
    ]);
    expect(compiler[0]).toMatchObject({
      fileName: URI,
      start: source.indexOf(`${op}(xs)`),
      length: `${op}(xs)`.length,
    });
    expect(editor[0]?.range).toEqual({
      start: { line: 3, character: 9 },
      end: { line: 3, character: 9 + `${op}(xs)`.length },
    });
    expect(result.wgsl).toBeUndefined();
  });

  it.each([
    ['f32', [-2, 3], -2, 3],
    ['i32', [-5, 7], -5, 7],
    ['u32', [3, 7], 3, 7],
    ['f64', [Math.PI, -Math.E], -Math.E, Math.PI],
    [
      'vec2',
      [
        [1, 4],
        [3, 2],
      ],
      [1, 2],
      [3, 4],
    ],
    [
      'vec3i',
      [
        [-1, 9, 2],
        [2, -2, 5],
      ],
      [-1, -2, 2],
      [2, 9, 5],
    ],
    [
      'vec4u',
      [
        [1, 8, 3, 4],
        [5, 2, 7, 0],
      ],
      [1, 2, 3, 0],
      [5, 8, 7, 4],
    ],
  ] as const)(
    'keeps %s elements accepted and computes the expected value',
    (elem, values, min, max) => {
      const { result, compiler } = check(sourceOf(op, elem, 2));
      expect(compiler).toEqual([]);
      expect(result.wgsl).toBeDefined();
      expect(compileModule(result.module).fns.f!(values as unknown as CpuValue)).toEqual(
        op === 'min' ? min : max,
      );
    },
  );

  it('keeps a one-element numeric array accepted', () => {
    const { result, compiler } = check(sourceOf(op, 'f32', 1));
    expect(compiler).toEqual([]);
    expect(compileModule(result.module).fns.f!([7])).toBe(7);
  });

  it('preserves the existing fixed-size refusal', () => {
    const { compiler } = check(sourceOf(op, 'f32', undefined));
    expect(compiler.map(({ code, message }) => ({ code, message }))).toEqual([
      { code: 'TS8003', message: `${op}(xs) needs a fixed-size array.` },
    ]);
  });
});
