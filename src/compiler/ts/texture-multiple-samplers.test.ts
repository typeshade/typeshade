// Verifies: Rule 10.3, Rule 11.10, Rule 12.3, Rule 12.7.
// #448, Chromium 156.0.8078.4 / Google SwiftShader: nearest/linear reads of the
// same 2x1 texture gave WebGPU [0,64,0,255], but a linked GL pipeline gave
// [64,64,0,255]. The load-only fragment also erased a vertex's linear sampler
// ([64,0,0,255] became [0,0,0,255]). The compile gate draws independent references,
// swaps sampler states to prove its pixel check, and checks the new refusals.
import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';
import { checkDocuments } from '../../language-service/check.js';
import {
  emitGlslEntries,
  emitGlslFragment,
  emitGlslModule,
  emitGlslStages,
} from '../../core/backends/glsl.js';
import { buildManifest } from '../../core/manifest.js';
import { mapStmt } from '../../core/passes/opt/ir-transform.js';

const URI = '/sampler-pairs.shade.ts';
const PREFIX = `"use typeshade";
declare const photo: texture_2d<f32>;
declare const other: texture_2d<f32>;
declare const nearest: sampler;
declare const linear: sampler;
`;
const SAMPLE = 'textureSample(photo, nearest, vec2(0.3))';
const OTHER_SAMPLE = 'textureSample(photo, linear, vec2(0.3))';
const fragment = (body: string, declarations = '') => `${PREFIX}${declarations}
export const fs = fragment(function fs(): vec4 { ${body} });
`;
const WHY =
  'glsl-es300: it samples "photo" with "nearest" and "linear", and GLSL ES 3.00 fuses a texture with one sampler. ' +
  'Declare the texture twice, one binding per sampler.';

function checked(source: string) {
  const c = compile(source, { fileName: URI });
  expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  expect(c.wgsl).toBeDefined();
  const ls = createTypeshadeLanguageService();
  ls.openDocument(URI, source);
  // Per-keystroke diagnostics deliberately do not run a backend. The check API does.
  expect(ls.getDiagnostics(URI)).toEqual([]);
  const pane = ls.getCompiledOutput(URI, 'glsl-fragment');
  ls.closeDocument(URI);
  const report = checkDocuments([{ uri: URI, path: URI, text: source }]);
  expect(report.errors).toBe(0);
  expect(report.diagnostics.map((d) => [d.code, d.message])).toEqual(
    c.diagnostics.map((d) => [d.code, d.message]),
  );
  return { c, pane, report };
}

describe('GLSL refuses two samplers for one texture', () => {
  it.each([
    ['direct', fragment(`return ${SAMPLE} + ${OTHER_SAMPLE};`)],
    [
      'local aliases',
      fragment(
        'const t = photo; const s = linear; return ' +
          SAMPLE +
          ' + textureSample(t, s, vec2(0.3));',
      ),
    ],
    [
      'reachable helpers',
      fragment(
        'return a() + b();',
        `function a(): vec4 { return ${SAMPLE}; } function b(): vec4 { return ${OTHER_SAMPLE}; }`,
      ),
    ],
  ])('refuses %s with the target warning, preserving WGSL', (_name, source) => {
    const { c, pane } = checked(source);
    expect(c.glsl).toBeUndefined();
    expect(c.diagnostics).toMatchObject([
      {
        code: 'TS8015',
        category: 'warning',
        message: `Backend emit failed: ${WHY}`,
        fileName: URI,
      },
    ]);
    expect(
      pane?.diagnostics.map(({ code, message, severity, span }) => ({
        code,
        message,
        category: severity,
        start: span.start,
        length: span.length,
      })),
    ).toEqual(
      c.diagnostics.map(({ code, message, category, start, length }) => ({
        code,
        message,
        category,
        start,
        length,
      })),
    );
    expect(() => emitGlslModule(c.module, 'fragment')).toThrow(WHY);
    expect(() => emitGlslStages(c.module)).toThrow(WHY);
    expect(() => emitGlslFragment(c.module, 'fragment', { entryPoints: true })).toThrow(WHY);
    const entries = emitGlslEntries(c.module, [{ stage: 'fragment', name: 'fs' }]);
    expect(entries.lowered).toBe(true);
    expect(entries.programs[0]).toBeInstanceOf(Error);
    expect((entries.programs[0] as Error).message).toBe(WHY);
    expect(buildManifest(c.module).gl?.draws?.fs).toMatchObject({
      none: `the GLSL backend refuses it: ${WHY.slice(0, -1)}`,
    });
  });

  it.each([
    ['one sampler', fragment(`return ${SAMPLE} + textureSample(photo, nearest, vec2(0.7));`)],
    ['two textures', fragment(`return ${SAMPLE} + textureSample(other, linear, vec2(0.3));`)],
    ['sample and load', fragment(`return ${SAMPLE} + textureLoad(photo, vec2i(0), 0);`)],
    [
      'unreached helper',
      fragment(`return ${SAMPLE};`, `function unused(): vec4 {return ${OTHER_SAMPLE};}`),
    ],
    [
      'unreached conflicting helper',
      fragment(
        `return ${SAMPLE};`,
        `function unused(): vec4 {return ${SAMPLE} + ${OTHER_SAMPLE};}`,
      ),
    ],
    [
      'scoped texture shadow',
      fragment(
        `let c = vec4(0.); { const photo = other; c = textureSample(photo, nearest, vec2(0.3)); } return c + textureSample(photo, linear, vec2(0.3));`,
      ),
    ],
    [
      'local name shadow',
      fragment(
        `const linear = nearest; return ${SAMPLE} + textureSample(photo, linear, vec2(0.7));`,
      ),
    ],
  ])('keeps %s accepted in both halves', (_name, source) => {
    const { c, pane } = checked(source);
    expect(c.diagnostics).toEqual([]);
    expect(c.glsl?.fragment).toContain('uniform sampler2D photo;');
    expect(pane?.diagnostics).toEqual([]);
  });

  it('checks only the selected entry, including batched per-entry emit', () => {
    const source = `${PREFIX}
export const bad = fragment(function bad(): vec4 { return ${SAMPLE} + ${OTHER_SAMPLE}; });
export const good = fragment(function good(): vec4 { return ${SAMPLE}; });
`;
    const { module } = compile(source);
    expect(emitGlslStages(module, { fragmentEntry: 'good' }).fragment).toContain('texture(photo,');
    expect(() => emitGlslStages(module, { fragmentEntry: 'bad' })).toThrow(WHY);
    const { programs } = emitGlslEntries(module, [
      { stage: 'fragment', name: 'bad' },
      { stage: 'fragment', name: 'good' },
    ]);
    expect(programs[0]).toBeInstanceOf(Error);
    expect(typeof programs[1]).toBe('string');
  });

  it('checks the selected vertex and fragment together, without refusing either stage alone', () => {
    const source = `${PREFIX}
export const vs = vertex(function vs(): vec4 { return textureSampleLevel(photo, nearest, vec2(0.3), 0.); });
export const fs = fragment(function fs(): vec4 { return ${OTHER_SAMPLE}; });
`;
    const { c } = checked(source);
    expect(c.glsl).toBeUndefined();
    expect(c.diagnostics[0]?.message).toBe(`Backend emit failed: ${WHY}`);
    expect(emitGlslModule(c.module, 'vertex')).toContain('textureLod(photo,');
    expect(emitGlslModule(c.module, 'fragment')).toContain('texture(photo,');
    expect(() => emitGlslStages(c.module)).toThrow(WHY);
  });

  it('resolves a public IR local shadow before checking pairs', () => {
    const source = `${PREFIX}
function helper(uv: vec2): vec4 { const local = other; return textureSampleLevel(local, linear, uv, 0.); }
export const fs = fragment(function fs(): vec4 { return textureSampleLevel(photo, nearest, vec2(0.3), 0.) + helper(vec2(0.7)); });
`;
    const { module, diagnostics } = compile(source);
    expect(diagnostics).toEqual([]);
    // Unlike source lowering, public IR need not globally uniquify function-local names.
    const shadowed = {
      ...module,
      funcs: module.funcs.map((f) =>
        f.name !== 'helper'
          ? f
          : {
              ...f,
              body: f.body.map((s) => {
                const renamed = mapStmt(s, (e) =>
                  e.op === 'varref' && e.name === 'local' ? { ...e, name: 'photo' } : e,
                );
                return renamed.s === 'let' && renamed.name === 'local'
                  ? { ...renamed, name: 'photo' }
                  : renamed;
              }),
            },
      ),
    };
    const glsl = emitGlslModule(shadowed, 'fragment');
    expect(glsl).toContain('textureLod(other,');
    expect(glsl).toContain('textureLod(photo,');
  });

  it('keeps target-reserved binding names in the warning', () => {
    const source = fragment(`return ${SAMPLE} + ${OTHER_SAMPLE};`)
      .replaceAll('photo', 'input')
      .replaceAll('nearest', 'texture')
      .replaceAll('linear', 'buffer');
    const { c } = checked(source);
    expect(c.glsl).toBeUndefined();
    expect(c.diagnostics[0]?.message).toBe(
      `Backend emit failed: ${WHY.replaceAll('photo', 'input').replaceAll('nearest', 'texture').replaceAll('linear', 'buffer')}`,
    );
  });

  it('keeps separate textures across stages and ignores unselected sibling entries', () => {
    const source = `${PREFIX}
export const vs = vertex(function vs(): vec4 { return textureSampleLevel(photo, nearest, vec2(0.3), 0.); });
export const bad = fragment(function bad(): vec4 { return ${OTHER_SAMPLE}; });
export const good = fragment(function good(): vec4 { return textureSample(other, linear, vec2(0.3)); });
`;
    const { module } = compile(source);
    expect(emitGlslStages(module, { fragmentEntry: 'good' }).fragment).toContain('texture(other,');
    expect(() => emitGlslStages(module, { fragmentEntry: 'bad' })).toThrow(WHY);
  });

  it('checks a library fragment without introducing a new entry requirement', () => {
    const source = `${PREFIX}
export function a(): vec4 { return ${SAMPLE}; }
export function b(): vec4 { return ${OTHER_SAMPLE}; }
`;
    const { module } = compile(source);
    expect(() => emitGlslFragment(module)).toThrow(WHY);
    const valid = compile(source.replaceAll('photo, linear', 'other, linear')).module;
    expect(emitGlslFragment(valid).source).toContain('texture(other,');
  });

  it('keeps a single comparison sampler in the manifest and refuses two', () => {
    const source = `"use typeshade";
declare const shadow: texture_depth_2d;
declare const a: sampler_comparison;
declare const b: sampler_comparison;
export const fs = fragment(function fs(): vec4 { return vec4(textureSampleCompare(shadow, a, vec2(0.3), 0.5)); });
`;
    const { c } = checked(source);
    expect(c.diagnostics).toEqual([]);
    expect(buildManifest(c.module).gl?.draws?.fs).toHaveProperty('samplers', { shadow: 'a' });
    const both = source.replace(
      'return vec4(',
      'return vec4(textureSampleCompare(shadow, b, vec2(0.7), 0.5) + ',
    );
    const r = checked(both).c;
    expect(r.glsl).toBeUndefined();
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0]?.message).toContain('it samples "shadow" with "b" and "a"');
  });
});
