// A reference write can invalidate the caller's uniformity facts (#180, #1088).
// Verifies: Rule 8.5 (docs/language-design.md).
import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const shader = (helpers: string, body: string): string => `"use typeshade";
declare const k: uniform<f32>;
declare const out: storage<array<f32>, "read_write">;
function edge(x: f32): bool { return x > 0.5; }
${helpers}
export const cs = compute([64, 1, 1], function cs(lid: builtin<"local_invocation_id", vec3u>): void {
${body}
 out[lid.x] = 1.;
});`;
const setter = 'function set(a: inout<f32>, x: f32): void { a = x; }';

function readBoth(source: string) {
  const result = compile(source, { fileName: 'reference-proof.shade.ts' });
  const compiler = result.diagnostics.map((d) => `${d.code} ${d.message}`);
  const service = createTypeshadeLanguageService();
  service.openDocument('reference-proof.shade.ts', source);
  const editor = service
    .getDiagnostics('reference-proof.shade.ts')
    .map((d) => `${d.code} ${d.message}`);
  service.closeDocument('reference-proof.shade.ts');
  expect(editor).toEqual(compiler);
  return { result, compiler };
}

describe('a pure helper proof requires a module without reference parameters', () => {
  it.each([
    [
      'a direct setter',
      setter,
      'let a = k; set(a, f32(lid.x)); if (edge(a)) { workgroupBarrier(); }',
    ],
    [
      'a nested setter',
      `${setter}\nfunction nested(a: inout<f32>, x: f32): void { set(a, x); }`,
      'let a = k; nested(a, f32(lid.x)); if (edge(a)) { workgroupBarrier(); }',
    ],
    [
      'reference-dependent caller control flow',
      setter,
      'let a = k; set(a, f32(lid.x)); if (a > 0.5) { if (edge(k)) { workgroupBarrier(); } }',
    ],
    [
      'a mutating method',
      'class Box { value: f32 = 0.; set(x: f32): void { this.value = x; } }',
      'const box = new Box(); box.value = k; box.set(f32(lid.x)); if (edge(box.value)) { workgroupBarrier(); }',
    ],
    [
      'a written capture',
      '',
      'let a = k; const set = (x: f32): void => { a = x; }; set(f32(lid.x)); if (edge(a)) { workgroupBarrier(); }',
    ],
    [
      'a uniform setter, conservatively',
      setter,
      'let a = k; set(a, k); if (edge(a)) { workgroupBarrier(); }',
    ],
    [
      'an unused reference function, conservatively',
      setter,
      'if (edge(k)) { workgroupBarrier(); }',
    ],
    [
      'an unused out parameter, conservatively',
      'function initialize(a: out<f32>): void { a = 1.; }',
      'if (edge(k)) { workgroupBarrier(); }',
    ],
  ])('keeps the unknown floor with %s', (_name, helpers, body) => {
    const { result, compiler } = readBoth(shader(helpers, body));
    // Includes references introduced by class/closure lowering, without an authored inout.
    expect(result.module.funcs.some((f) => f.params.some((p) => p.mode !== undefined))).toBe(true);
    expect(compiler).toHaveLength(1);
    expect(compiler[0]).toContain('TS8052 workgroupBarrier() is reached under');
    expect(result.wgsl).toBeUndefined();
  });

  it.each(['edge(k)', 'edge(1.)'])('still accepts %s without reference parameters', (condition) => {
    const { result, compiler } = readBoth(shader('', `if (${condition}) { workgroupBarrier(); }`));
    expect(compiler).toEqual([]);
    expect(result.wgsl).toContain('workgroupBarrier()');
  });

  it('still refuses a varying argument without reference parameters', () => {
    const { compiler } = readBoth(shader('', 'if (edge(f32(lid.x))) { workgroupBarrier(); }'));
    expect(compiler).toHaveLength(1);
    expect(compiler[0]).toContain('TS8052 workgroupBarrier() is reached under "lid"');
  });
});
