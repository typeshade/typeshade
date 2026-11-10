// A scalar cast yields a value of its type (Rule 5.3).
//
// `u32(7)` is a `u32`, so `u32(7) / 2` is WGSL's truncating integer division, `3`, and
// `u32(7) - 8` wraps to `4294967295`. The front end folded such an expression with
// ECMAScript doubles: it emitted `3.5` for `f32(u32(7) / 2)`, `-1.0` for `f32(u32(7) - 8)`, and
// for `xs[u32(7) / 2]` a `u32` literal `3.5` that the writer refused (`TS8015`, `SD0017`). The
// fold of an integer-typed node now follows `foldIntLit`, the rule the optimizer's constant
// folder already uses. A written number is not typed by a cast and keeps its ECMAScript value:
// `7 / 2` is `3.5`.
//
// Each case reads both halves on one source (Rule 12.7): `compile()` (its diagnostics, the WGSL
// and GLSL ES 3.00 text, the CPU oracle in both precisions) and the language service.
//
// Verifies: Rule 5.3 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { compileModule } from '../../core/oracle.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const editor = (source: string): string[] => {
  const service = createTypeshadeLanguageService();
  service.openDocument('a.shade.ts', source);
  return service.getDiagnostics('a.shade.ts').map((d) => `${String(d.code)}: ${d.message}`);
};

const fn = (body: string): string => `"use typeshade";
export function t(vi: u32, xs: array<f32, 8>): f32 {
  return ${body};
}`;
const ARGS = [1, [1, 2, 3, 4, 5, 6, 7, 8]] as const;

/** Both halves accept `body`; the WGSL returns `emitted`; both oracle precisions give `value`
 *  (`f32Value` in 'f32' precision, where it differs by the f32 rounding of the result). */
const typed = (body: string, emitted: string, value: number, f32Value = value): void => {
  const source = fn(body);
  const result = compile(source);
  expect(result.diagnostics).toEqual([]);
  expect(editor(source)).toEqual([]);
  expect(result.wgsl).toContain(`return ${emitted};`);
  expect(result.eval('t', ARGS)).toBe(value);
  const cpu = compileModule(result.module, { precision: 'f32' });
  expect((cpu.fns['t'] as (...a: readonly unknown[]) => unknown)(...ARGS)).toBe(f32Value);
};

describe('a scalar cast of a written number is a value of its type', () => {
  it('u32(7) / 2 is the integer division 3 (3.5 before)', () => {
    typed('f32(u32(7) / 2)', '3.0', 3);
  });

  it('i32(-7) / 2 truncates toward zero: -3 (-3.5 before)', () => {
    typed('f32(i32(-7) / 2)', '-3.0', -3);
  });

  it('u32(7) - 8 wraps as a u32 does: 4294967295 (-1 before)', () => {
    // 'f32' precision rounds the result to the nearest f32, 4294967296.
    typed('f32(u32(7) - 8)', '4294967295.0', 4294967295, 4294967296);
  });

  it('i32(2147483647) + 1 wraps as an i32 does (2147483648 before)', () => {
    typed('f32(i32(2147483647) + 1)', '-2147483648.0', -2147483648);
  });

  it('u32(7) * u32(1000000000) wraps as a u32 does (7000000000 before)', () => {
    typed('f32(u32(7) * u32(1000000000))', '2705032704.0', 2705032704);
  });

  it('-i32(-2147483648) wraps as an i32 negation does (2147483648 before)', () => {
    typed('f32(-i32(-2147483648))', '-2147483648.0', -2147483648);
  });

  it('xs[u32(7) / 2] indexes element 3 (a backend failure before)', () => {
    typed('xs[u32(7) / 2]', 'xs[3]', 4);
  });

  it('vi + u32(7) / 2 adds 3u (a backend failure before)', () => {
    typed('f32(vi + u32(7) / 2)', 'f32((vi + 3u))', 4);
  });

  it('a written number keeps its ECMAScript value: 7 / 2 is 3.5', () => {
    typed('f32(7 / 2)', '3.5', 3.5);
    typed('f32(u32(7)) / 2', '3.5', 3.5);
  });

  it('a division by zero and the negation of a u32 stay refused, in both halves', () => {
    for (const [body, message] of [
      [
        'f32(u32(7) / 0)',
        'TS8003: Division by zero: "0" is 0 on every invocation. WGSL refuses it and GLSL ES 3.00 leaves it undefined.',
      ],
      [
        'f32(-u32(7))',
        'TS8003: Unary "-" is not defined on u32; WGSL has no negation for an unsigned integer. Write 0u - x to wrap, or i32(x) to change kind first.',
      ],
    ] as const) {
      const source = fn(body);
      expect(compile(source).diagnostics.map((d) => `${d.code}: ${d.message}`)).toEqual([message]);
      expect(editor(source)).toEqual([message]);
    }
  });

  it('emits the integer division in GLSL ES 3.00 too', () => {
    const source = `"use typeshade";
interface VsOut { pos: builtin<"position">; uv: location<0, vec2>; }
@vertex export function vs(i: builtin<"vertex_index">): VsOut {
  const x = f32(i) * 0.5;
  return { pos: vec4(x, x, 0., 1.), uv: vec2(x, x) };
}
@fragment export function fs(uv: location<0, vec2>): vec4 {
  return vec4(f32(u32(uv.x) + u32(7) / 2), 0., 0., 1.);
}`;
    const result = compile(source);
    expect(result.diagnostics).toEqual([]);
    expect(editor(source)).toEqual([]);
    expect(result.wgsl).toContain('(u32(uv.x) + 3u)');
    expect(result.glsl?.fragment).toContain('(_f2u(uv.x) + 3u)');
  });
});
