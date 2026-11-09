// #321 misc#5: an output pane follows the compiler's backend diagnostic policy.
// Verifies: Rule 12.3, Rule 12.5, Rule 12.7 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compile } from '../compiler/ts/compile.js';
import { emitGlslStages } from '../core/backends/glsl.js';
import {
  analyzeSourceFile,
  createTypeshadeLanguageService,
  createTypeshadeLanguageServiceWith,
} from './service.js';
import type { TypeshadeDiagnostic } from './types.js';

const FILE = '/output.shade.ts';
const TARGETS = ['wgsl', 'glsl-vertex', 'glsl-fragment'] as const;
const GLSL = ['glsl-vertex', 'glsl-fragment'] as const;
const RENDER = `@fragment export function fs(): location<0, vec4> {
  return vec4(0., 0., 0., 1.);
}`;
const COMPUTE = '@compute([1]) export function cs(): void {}';
const ARRAY = 'declare const U: uniform<array<vec4, 2>>;';
const source = (body: string) => `"use typeshade";\n${body}`;
const paneDiagnostic = (d: TypeshadeDiagnostic) => ({
  code: d.code,
  message: d.message,
  category: d.severity,
  start: d.span.start,
  length: d.span.length,
});
const compilerDiagnostics = (result: ReturnType<typeof compile>) =>
  result.diagnostics.map(({ code, message, category, start, length }) => ({
    code,
    message,
    category,
    start,
    length,
  }));

describe('compiled output backend diagnostics', () => {
  it.each([
    ['fragment', `${ARRAY}\n${RENDER.replace('vec4(0., 0., 0., 1.)', 'U[0]')}`],
    [
      'vertex',
      `${ARRAY}\n@vertex export function vs(): builtin<"position", vec4> { return U[0]; }`,
    ],
    [
      'render and compute',
      `${ARRAY}\n${RENDER.replace('vec4(0., 0., 0., 1.)', 'U[0]')}\n${COMPUTE}`,
    ],
  ])('reports the compiler warning for a %s GLSL shortfall', (_name, body) => {
    const text = source(body);
    const compiled = compile(text, { fileName: FILE });
    expect(compilerDiagnostics(compiled)).toEqual([
      {
        code: 'TS8015',
        message:
          "Backend emit failed: glsl-es300: uniform binding 'U' must be a struct (a std140 UBO block)",
        category: 'warning',
        start: 0,
        length: '"use typeshade";'.length,
      },
    ]);
    expect(compiled.wgsl).toBeDefined();
    expect(compiled.glsl).toBeUndefined();
    const service = createTypeshadeLanguageService();
    service.openDocument(FILE, text);
    expect(service.getCompiledOutput(FILE, 'wgsl')!.text).toBe(compiled.wgsl);
    expect(service.getCompiledOutput(FILE, 'wgsl')!.diagnostics).toEqual([]);
    for (const target of GLSL) {
      const output = service.getCompiledOutput(FILE, target)!;
      expect(output.text).toBe('');
      expect(output.diagnostics.map(paneDiagnostic)).toEqual(compilerDiagnostics(compiled));
    }
    expect(service.getDiagnostics(FILE)).toEqual([]);
  });

  it.each([
    ['compute only', COMPUTE],
    ['no render entry', `${ARRAY}\nexport function read(): vec4 { return U[0]; }`],
  ])('keeps a GLSL shortfall quiet with %s', (_name, body) => {
    const text = source(body);
    const compiled = compile(text, { fileName: FILE });
    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.wgsl).toBeDefined();
    expect(compiled.glsl).toBeUndefined();
    const service = createTypeshadeLanguageService();
    service.openDocument(FILE, text);
    for (const target of GLSL)
      expect(service.getCompiledOutput(FILE, target)).toEqual({
        target,
        text: '',
        diagnostics: [],
      });
    expect(service.getCompiledOutput(FILE, 'wgsl')!.text).toBe(compiled.wgsl);
    expect(service.getDiagnostics(FILE)).toEqual([]);
  });

  it.each([
    ['render', RENDER],
    ['render and compute', `${RENDER}\n${COMPUTE}`],
    [
      'render reading compute storage',
      `declare const img: storage<array<f32>, "read_write">;
declare const acc: storage<array<atomic<u32>, 1>, "read_write">;
@fragment export function fs(): location<0, vec4> { return vec4(img[0]); }
@compute([1]) export function cs(gid: builtin<"global_invocation_id", vec3u>): void {
  atomicAdd(acc[0], 1);
  img[gid.x] = 2.;
}`,
    ],
  ])('prints the compiler output for valid %s', (_name, body) => {
    const text = source(body);
    const compiled = compile(text, { fileName: FILE });
    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.glsl).toBeDefined();
    const service = createTypeshadeLanguageService();
    service.openDocument(FILE, text);
    const before = service.getDiagnostics(FILE);
    expect(before).toEqual([]);
    for (const target of TARGETS) {
      const output = service.getCompiledOutput(FILE, target)!;
      expect(output.diagnostics).toEqual([]);
      expect(output.text).toBe(
        target === 'wgsl'
          ? compiled.wgsl
          : compiled.glsl![target === 'glsl-vertex' ? 'vertex' : 'fragment'],
      );
    }
    expect(service.getDiagnostics(FILE)).toEqual(before);
  });

  it.each([
    ['WGSL emit', 'export const K: f32 = 1e400;', 'TS8015'],
    ['front end', 'export function read(): u32 { return -1; }', 'TS8003'],
  ])('preserves a real %s error in every target', (_name, body, code) => {
    const text = source(body);
    const compiled = compile(text, { fileName: FILE });
    expect(compiled.diagnostics).toHaveLength(1);
    expect(compiled.diagnostics[0]).toMatchObject({ code, category: 'error' });
    expect(compiled.wgsl).toBeUndefined();
    const service = createTypeshadeLanguageService();
    service.openDocument(FILE, text);
    for (const target of TARGETS) {
      const output = service.getCompiledOutput(FILE, target)!;
      expect(output.text).toBe('');
      expect(output.diagnostics.map(paneDiagnostic)).toEqual(compilerDiagnostics(compiled));
    }
  });

  it('keeps repeated output requests out of cached document diagnostics and analysis', () => {
    let analyses = 0;
    const service = createTypeshadeLanguageServiceWith({}, (sf, imports) => {
      analyses++;
      return analyzeSourceFile(sf, imports);
    });
    service.openDocument(
      FILE,
      source(`${ARRAY}\n${RENDER.replace('vec4(0., 0., 0., 1.)', 'U[0]')}`),
      1,
    );
    const before = service.getDiagnostics(FILE);
    expect(before).toEqual([]);
    const first = service.getCompiledOutput(FILE, 'glsl-fragment');
    for (const target of TARGETS) service.getCompiledOutput(FILE, target);
    expect(service.getCompiledOutput(FILE, 'glsl-fragment')).toEqual(first);
    expect(service.getDiagnostics(FILE)).toEqual(before);
    expect(analyses).toBe(1);
    service.updateDocument(FILE, source(RENDER), 2);
    expect(service.getCompiledOutput(FILE, 'glsl-fragment')!.diagnostics).toEqual([]);
    expect(service.getCompiledOutput(FILE, 'glsl-fragment')!.text).toContain('void main()');
    expect(service.getDiagnostics(FILE)).toEqual([]);
    expect(analyses).toBe(2);
  });

  it('still emits a portable compute IR module with no render entry', () => {
    // The portable flag is an IR declaration, not a TypeShade source spelling. Supply it
    // through the service's analysis seam and compare the actual portable GLSL writer.
    const text = source(`declare const count: uniform<vec4u>;
declare const result: storage<array<u32>, "read_write">;
@compute([1]) export function cs(gid: builtin<"global_invocation_id", vec3u>): void {
  if (gid.x >= count.x) return;
  result[gid.x] = gid.x;
}`);
    const compiled = compile(text, { fileName: FILE });
    expect(compiled.diagnostics).toEqual([]);
    const expected = emitGlslStages({
      ...compiled.module,
      funcs: compiled.module.funcs.map((f) => ({ ...f, portable: true })),
    });
    const service = createTypeshadeLanguageServiceWith({}, (sf, imports) => {
      const analysis = analyzeSourceFile(sf, imports);
      return { ...analysis, funcs: analysis.funcs.map((f) => ({ ...f, portable: true })) };
    });
    service.openDocument(FILE, text);
    for (const target of GLSL) {
      const output = service.getCompiledOutput(FILE, target)!;
      expect(output.diagnostics).toEqual([]);
      expect(output.text).toBe(expected[target === 'glsl-vertex' ? 'vertex' : 'fragment']);
      if (target === 'glsl-fragment') expect(output.text).toContain('void main()');
    }
  });
});
