// The name of an entry's `_impl` wrapper is a name the GLSL writer generates (#612).
//
// An entry whose body has an early return keeps the wrapper: `main()` calls a value function
// that holds the authored body. The writer spelled it `${name}_impl`, and the entry `main`
// reaches the writer as `main_` (it is renamed off the stage's own `main`), so the wrapper was
// `main__impl`. GLSL ES 3.00 §3.8 reserves every identifier that holds `__`, and ANGLE refuses
// it: "'main__impl' : identifiers containing two consecutive underscores (__) are reserved as
// possible future keywords" (Chromium 141.0.7390.37, SwiftShader, measured 2026-10-12). Every
// entry name that ends in `_` gave the same text, and a helper named `fs_impl` beside an
// early-return entry `fs` was a second definition of one function.
//
// Both halves read each source: `compile()` (no diagnostic, and the GLSL), and the language
// service (no diagnostic, and the GLSL its compiled-output pane shows). The WebGL2 half is the
// compile gate's `entry-wrapper` leg (scripts/compile-gate.ts), which compiles and links the
// same sources on ANGLE.
//
// Verifies: Rule 3.5 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compile } from '../../compiler/ts/compile.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

/** A fragment entry named `name` with an early return, the program of #612. */
const earlyReturn = (name: string, helper = ''): string => `"use typeshade"
${helper}
@fragment
export function ${name}(@location(0) uv: vec2): vec4 {
  if (uv.x > 0.5) {
    return vec4(1., 0., 0., 1.)
  }
  return ${helper === '' ? 'vec4(0., 0., 1., 1.)' : 'fs_impl(uv)'}
}
`;

/** Every identifier of `text` that holds two consecutive underscores. */
const doubleUnderscores = (text: string): string[] => text.match(/\b\w*__\w*\b/gu) ?? [];

/** Both halves on `source`: each must take it, and the editor's pane must show compile()'s GLSL. */
function bothHalves(source: string): string {
  const c = compile(source);
  expect(c.diagnostics, 'compile()').toEqual([]);
  const fragment = c.glsl?.fragment ?? '';
  const service = createTypeshadeLanguageService();
  service.openDocument('a.ts', source);
  expect(service.getDiagnostics('a.ts'), 'the editor').toEqual([]);
  expect(service.getCompiledOutput('a.ts', 'glsl-fragment')?.text, 'the pane').toBe(fragment);
  return fragment;
}

describe('the wrapper of an early-return entry (#612)', () => {
  it('spells `main` as `main_impl`, with no `__`', () => {
    const fs = bothHalves(earlyReturn('main'));
    expect(doubleUnderscores(fs)).toEqual([]);
    expect(fs).toContain('vec4 main_impl(vec2 uv) {');
    expect(fs).toContain('_ret = main_impl(uv);');
  });

  it('spells an entry name that ends in `_` with no `__`', () => {
    const fs = bothHalves(earlyReturn('fs_'));
    expect(doubleUnderscores(fs)).toEqual([]);
    expect(fs).toContain('vec4 fs_impl(vec2 uv) {');
    expect(fs).toContain('_ret = fs_impl(uv);');
  });

  it('keeps `fs_impl` for the entry `fs`, as before', () => {
    const fs = bothHalves(earlyReturn('fs'));
    expect(fs).toContain('vec4 fs_impl(vec2 uv) {');
    expect(fs).toContain('_ret = fs_impl(uv);');
  });

  it('keeps the wrapper off a helper of the name it would take', () => {
    const helper = 'function fs_impl(uv: vec2): vec4 { return vec4(uv, 0., 1.) }';
    const fs = bothHalves(earlyReturn('fs', helper));
    // One definition of the helper, one of the wrapper, and the wrapper is what main() calls.
    expect(fs.match(/^vec4 fs_impl\(/gmu)).toHaveLength(1);
    expect(fs).toContain('vec4 fs_impl0(vec2 uv) {');
    expect(fs).toContain('_ret = fs_impl0(uv);');
    expect(fs).toContain('return fs_impl(uv);');
  });
});
