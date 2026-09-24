// Two entries of one stage and GLSL's one `main()` (#213).
//
// Two `@vertex` (or `@fragment`) entries are valid WGSL: an entry point is chosen by name at
// pipeline creation. The GLSL writer spells each entry of a stage as `main()`, and with no entry
// named it kept them all, so `compile()` returned a vertex program with two `main()`s and no
// diagnostic. The writer now fails closed when the caller does not say which (Rules 1.2 and
// 10.3): `compile()` records a `TS8015` warning and keeps `wgsl`, and `emitGlslStages`'s
// `vertexEntry` / `fragmentEntry` still pick one.
//
// Measured on 2026-09-24 through the compile gate's instruments (Chromium's WebGPU and WebGL2 on
// SwiftShader, each handed a broken shader first) (Rule 13.3): the WGSL of both programs below
// is accepted by Tint; the old vertex program with two `main()`s is refused by WebGL2 with
// "'main' : function already has a body"; the programs `vertexEntry: 'vsB'` and
// `fragmentEntry: 'fs2'` give compile and link.

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { emitGlslFragment, emitGlslModule, emitGlslStages } from '../../core/backends/glsl.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';
import { checkDocuments } from '../../language-service/check.js';

const program = (second: string): string => `"use typeshade";
@vertex
export function vsA(@builtin("vertex_index") vi: u32): vec4 {
  return vec4(f32(vi), 0., 0., 1.);
}
${second}
@fragment
export function fs(): vec4 {
  return vec4(1.);
}
`;

const TWO_VERTEX = program(`@vertex
export function vsB(@builtin("vertex_index") vi: u32): vec4 {
  return vec4(0., f32(vi), 0., 1.);
}`);

const TWO_FRAGMENT = program(`@fragment
export function fs2(): vec4 {
  return vec4(0.5);
}`);

const refusal = (stage: string, names: string): string =>
  `glsl-es300: the ${stage} stage has 2 entries (${names}) and a GLSL ES 3.00 shader has one ` +
  `main(); name the one to emit with emitGlslStages's ${stage}Entry option`;

const mains = (glsl: string): number => glsl.match(/\bvoid main\(\)/g)?.length ?? 0;

describe('two entries of one stage, with none named (#213)', () => {
  for (const [label, src, stage, names] of [
    ['two @vertex entries', TWO_VERTEX, 'vertex', 'vsA, vsB'],
    ['two @fragment entries', TWO_FRAGMENT, 'fragment', 'fs2, fs'],
  ] as const) {
    it(`${label}: compile() warns with TS8015, keeps wgsl, and returns no glsl`, () => {
      const r = compile(src);
      expect(r.diagnostics.map((d) => `${d.category} ${d.code} ${d.message}`)).toEqual([
        `warning TS8015 Backend emit failed: ${refusal(stage, names)}`,
      ]);
      expect(r.glsl).toBeUndefined();
      for (const name of names.split(', ')) expect(r.wgsl).toContain(`fn ${name}(`);
    });

    it(`${label}: the language service's GLSL output reports it, and its WGSL does not`, () => {
      const service = createTypeshadeLanguageService();
      service.openDocument('a.ts', src);
      // The editor's own list runs no backend (`check.ts`), as for every TS8015; the program
      // is valid WGSL and draws nothing there.
      expect(service.getDiagnostics('a.ts')).toEqual([]);
      const glsl = service.getCompiledOutput('a.ts', `glsl-${stage}`)!;
      expect(glsl.text).toBe('');
      expect(glsl.diagnostics.map((d) => `${String(d.code)} ${d.message}`)).toEqual([
        `TS8015 Backend emit failed for glsl-${stage}: ${refusal(stage, names)}`,
      ]);
      const wgsl = service.getCompiledOutput('a.ts', 'wgsl')!;
      expect(wgsl.diagnostics).toEqual([]);
      for (const name of names.split(', ')) expect(wgsl.text).toContain(`fn ${name}(`);
    });

    it(`${label}: typeshade check reports the same warning`, () => {
      const result = checkDocuments([{ path: 'a.shade.ts', uri: 'a.shade.ts', text: src }]);
      expect(result.diagnostics.map((d) => `${d.severity} ${d.code} ${d.message}`)).toEqual([
        `warning TS8015 Backend emit failed: ${refusal(stage, names)}`,
      ]);
    });

    it(`${label}: emitGlslModule refuses the stage and spells the other`, () => {
      const { module } = compile(src);
      expect(() => emitGlslModule(module, stage)).toThrow(refusal(stage, names));
      const other = stage === 'vertex' ? 'fragment' : 'vertex';
      expect(mains(emitGlslModule(module, other))).toBe(1);
    });
  }
});

describe('what still emits', () => {
  it("emitGlslStages's vertexEntry picks one main(), holding that entry's body", () => {
    const { vertex, fragment } = emitGlslStages(compile(TWO_VERTEX).module, {
      vertexEntry: 'vsB',
    });
    expect(mains(vertex)).toBe(1);
    expect(vertex).toContain('gl_Position = vec4(0.0, float(vi), 0.0, 1.0);');
    expect(vertex).not.toContain('gl_Position = vec4(float(vi), 0.0, 0.0, 1.0);');
    expect(mains(fragment)).toBe(1);
  });

  it("emitGlslStages's fragmentEntry does the same for the fragment stage", () => {
    const { fragment } = emitGlslStages(compile(TWO_FRAGMENT).module, { fragmentEntry: 'fs2' });
    expect(mains(fragment)).toBe(1);
    expect(fragment).toContain('0.5');
  });

  it('a declarations-only fragment spells no entry, so two of one stage are fine', () => {
    const f = emitGlslFragment(compile(TWO_VERTEX).module, 'vertex');
    expect(mains(f.source)).toBe(0);
  });

  it('one entry per stage compiles to both GLSL stages, as before', () => {
    const src = program('');
    const r = compile(src);
    expect(r.diagnostics).toEqual([]);
    expect(mains(r.glsl!.vertex)).toBe(1);
    expect(mains(r.glsl!.fragment)).toBe(1);
  });
});
