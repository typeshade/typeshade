// A pure callee does not prove its caller's facts sound (#180, #1088).
// Measured 2026-11-07, Chromium 156.0.8078.4 / Google SwiftShader, broken shader first:
// Tint refuses varying reference writes and compound-assignment inputs/control flow with
// "'workgroupBarrier' must only be called from uniform control flow". Uniform neighbors
// compile, but retain the prior conservative floor until caller origins are sound.
// Verifies: Rule 8.5 (docs/language-design.md).
import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const shader = (helpers: string, body: string): string => `"use typeshade";
declare const k: uniform<f32>;
declare const out: storage<array<f32>, "read_write">;
function edge(x: f32): bool { return x > 0.5; }
${helpers}
@compute([64, 1, 1]) export function cs(lid: builtin<"local_invocation_id">): void {
${body}
 out[lid.x] = 1.;
}`;
const setter = 'function set(@inout a: f32, x: f32): void { a = x; }';

function readBoth(source: string) {
  const result = compile(source, { fileName: 'helper-floor.shade.ts' });
  const compiler = result.diagnostics.map((d) => `${d.code} ${d.message}`);
  const service = createTypeshadeLanguageService();
  service.openDocument('helper-floor.shade.ts', source);
  const editor = service
    .getDiagnostics('helper-floor.shade.ts')
    .map((d) => `${d.code} ${d.message}`);
  service.closeDocument('helper-floor.shade.ts');
  expect(editor).toEqual(compiler);
  return { result, compiler };
}

describe('helper conditions retain the unknown floor after caller writes', () => {
  it.each([
    [
      'a direct setter',
      setter,
      'let a = k; set(a, f32(lid.x)); if (edge(a)) { workgroupBarrier(); }',
    ],
    [
      'a nested setter',
      `${setter}\nfunction nested(@inout a: f32, x: f32): void { set(a, x); }`,
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
      'function initialize(@out a: f32): void { a = 1.; }',
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

  it.each([
    [
      'a varying compound argument',
      'let a = f32(lid.x); a += 1.; if (edge(a)) { workgroupBarrier(); }',
    ],
    [
      'compound-dependent caller control',
      'let a = f32(lid.x); a += 1.; if (a > 0.5) { if (edge(k)) { workgroupBarrier(); } }',
    ],
    [
      'a uniform compound argument, conservatively',
      'let a = k; a += 1.; if (edge(a)) { workgroupBarrier(); }',
    ],
    ['a uniform helper argument, conservatively', 'if (edge(k)) { workgroupBarrier(); }'],
    ['a literal helper argument, conservatively', 'if (edge(1.)) { workgroupBarrier(); }'],
  ])('keeps the unknown floor for %s without references', (_name, body) => {
    const { result, compiler } = readBoth(shader('', body));
    expect(result.module.funcs.every((f) => f.params.every((p) => p.mode === undefined))).toBe(
      true,
    );
    expect(compiler).toHaveLength(1);
    expect(compiler[0]).toContain('TS8052 workgroupBarrier() is reached under');
    expect(result.wgsl).toBeUndefined();
  });

  it.each(['k > 0.5', 'true'])('still accepts the inline uniform condition %s', (condition) => {
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
