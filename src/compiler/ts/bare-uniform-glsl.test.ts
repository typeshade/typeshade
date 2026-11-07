// Verifies: Rule 4.8, Rule 6.8, Rule 11.10 (docs/language-design.md; traced in reqs/).
// Change 0127: private GLSL blocks do not change authored types or serialized host layouts.
import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { hostFace } from './host-face.js';
import { packModule, type PackLayout } from './pack.js';
import { repack } from '../../emit.js';
import { checkDocuments } from '../../language-service/check.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';
import { emitGlslStages } from '../../core/backends/glsl.js';
import { emitModule } from '../../core/backends/wgsl.js';
import { minify, mangle } from '../../emit-prod.js';

const FILE = '/bare-uniform.shade.ts';
const sourceOf = (type: string, value: string, wrapped = false): string => `"use typeshade";
${wrapped ? `interface Params { value: ${type}; }` : ''}
declare const U: uniform<${wrapped ? 'Params' : type}>;
export const fs = fragment(function fs(): location<0, vec4> {
  return vec4(${value.replaceAll('U', wrapped ? 'U.value' : 'U')}, 0., 0., 1.);
});`;

function both(source: string) {
  const result = compile(source, { fileName: FILE });
  const checked = checkDocuments([{ path: FILE, uri: FILE, text: source }]);
  expect(
    checked.diagnostics.map(({ code, message, offset, length, severity }) => ({
      code,
      message,
      start: offset,
      length,
      category: severity,
    })),
  ).toEqual(
    result.diagnostics.map(({ code, message, start, length, category }) => ({
      code,
      message,
      start,
      length,
      category,
    })),
  );
  return result;
}

const scalars = ['f32', 'i32', 'u32'] as const;
const cases: { type: string; value: string; layout: PackLayout }[] = scalars.map((type) => ({
  type,
  value: 'f32(U)',
  layout: { kind: 'scalar', type },
}));
for (const type of scalars)
  for (const size of [2, 3, 4])
    cases.push({
      type: `vec${size}${type === 'f32' ? '' : type === 'i32' ? 'i' : 'u'}`,
      value: `(${Array.from({ length: size }, (_, i) => `f32(U[${i}])`).join(' + ')})`,
      layout: { kind: 'vector', size, type },
    });
for (const columns of [2, 3, 4])
  for (const rows of [3, 4])
    cases.push({
      type: `mat${columns}x${rows}`,
      value: `(${Array.from({ length: columns }, (_, c) =>
        Array.from({ length: rows }, (_, r) => `U[${c}][${r}]`).join(' + '),
      ).join(' + ')})`,
      layout: { kind: 'matrix', columns, rows, columnStride: 16 },
    });

describe('bare uniform values keep their logical contract on WebGL2', () => {
  it.each(cases)(
    '$type gains a block in both checks and keeps its host layout',
    ({ type, value, layout }) => {
      const source = sourceOf(type, value);
      const result = both(source);
      expect(result.diagnostics).toEqual([]);
      const authored = JSON.stringify(result.module);
      const pack = packModule(result.module, { ir: true });
      const binding = pack.bindings.find((b) => b.name === 'U')!;
      expect(binding.layout).toEqual(layout);
      expect(binding.group).toBe(0);
      expect(binding.binding).toBe(0);
      expect(result.module.bindings[0]!.type.kind).not.toBe('struct');
      expect(result.module.structs).toEqual([]);
      const draw = pack.gl!.draws!.fs!;
      expect(draw).not.toHaveProperty('none');
      if ('none' in draw) throw new Error(draw.none);
      expect(draw.blocks).toEqual({ U: expect.any(String) });
      expect(draw.fragment).toContain(`uniform ${draw.blocks.U} {`);
      expect(draw.fragment).toContain('U._value_');
      expect(repack(pack)).toEqual(pack);
      expect(emitModule(result.module)).toBe(result.wgsl);
      expect(JSON.stringify(result.module)).toBe(authored);
      const face = hostFace(source, { fileName: FILE });
      expect(face.diagnostics).toEqual([]);
      const entry = face.exports?.find((e) => e.kind === 'fragment');
      expect(entry?.kind).toBe('fragment');
      if (entry?.kind !== 'fragment') throw new Error('Missing host fragment');
      expect(entry.entry.noGl).toBeUndefined();
      expect(entry.entry.gl?.blocks).toEqual(draw.blocks);
      const service = createTypeshadeLanguageService();
      service.openDocument(FILE, source);
      try {
        expect(service.getDiagnostics(FILE)).toEqual([]);
        expect(service.getHover(FILE, { line: 2, character: 14 })).toBeDefined();
      } finally {
        service.closeDocument(FILE);
      }
      expect(both(sourceOf(type, value, true)).diagnostics).toEqual([]);
    },
  );

  it.each([2, 3, 4])(
    'keeps mat%ix2 refused, bare and nested, with the same remedy and span',
    (columns) => {
      for (const wrapped of [false, true]) {
        const source = sourceOf(`mat${columns}x2`, 'U[0][0]', wrapped);
        const result = both(source);
        expect(result.diagnostics).toHaveLength(1);
        const diagnostic = result.diagnostics[0]!;
        expect(diagnostic.code).toBe('TS8051');
        expect(diagnostic.message).toContain('uniform');
        expect(diagnostic.message).toContain(`mat${columns}x2`);
        expect(diagnostic.message).toContain('16');
        expect(diagnostic.start).toBe(source.indexOf('uniform<'));
        expect(diagnostic.length).toBe(`uniform<${wrapped ? 'Params' : `mat${columns}x2`}>`.length);
        expect(diagnostic.message).toBe(
          `"${wrapped ? 'Params.value' : 'U'}" is in a uniform: mat${columns}x2 in std140 is not supported — ` +
            'WGSL gives a two-row matrix a column stride of 8 and GLSL std140 rounds every column to 16, ' +
            'so the two targets would disagree on this field and every field after it; ' +
            `carry it as mat${columns}x4 (measured: both targets stride 16) or as ${columns} vec2 fields.`,
        );
        expect(result.wgsl).toBeUndefined();
        expect(result.glsl).toBeUndefined();
      }
    },
  );

  it('keeps a bare array as a real backend shortfall', () => {
    const result = both(sourceOf('array<vec4, 2>', 'U[0].x'));
    expect(result.diagnostics.map((d) => [d.code, d.category])).toEqual([['TS8015', 'warning']]);
    expect(result.diagnostics[0]!.message).toContain('must be a struct');
    expect(result.wgsl).toBeDefined();
    expect(result.glsl).toBeUndefined();
  });

  it.each(['float', 'integer'] as const)(
    'keeps f64 host layouts and the %s flavor across re-emission',
    (fp64Flavor) => {
      for (const [type, value] of [
        ['f64', 'f32(U * U)'],
        ['vec2f64', 'f32(U.x * U.y)'],
      ]) {
        const result = both(sourceOf(type!, value!));
        expect(result.diagnostics).toEqual([]);
        const packed = packModule(result.module, { ir: true, emit: { fp64Flavor } });
        expect(packed.bindings.find((b) => b.name === 'U')!.layout).toMatchObject({ type: 'f64' });
        expect(packed.gl?.draws?.fs).not.toHaveProperty('none');
        expect(repack(packed)).toEqual(packed);
        expect(packed.bindings.some((b) => b.name === '_fp64')).toBe(fp64Flavor === 'float');
      }
    },
  );

  it('keeps shared blocks, unused omission, shadowing and generated-name collisions', () => {
    const source = `"use typeshade";
declare const U: uniform<f32>;
declare const idle: uniform<f32>;
const U_block_: f32 = 0.25;
function local(U: f32): f32 { return U + U_block_; }
export const vs = vertex(function vs(vi: builtin<"vertex_index", u32>): builtin<"position", vec4> {
  return vec4(f32(vi) + U, 0., 0., 1.);
});
export const fs = fragment(function fs(): location<0, vec4> {
  let v: f32 = U;
  if (v > 0.) { const U: f32 = 0.5; v += local(U); }
  return vec4(v + U, 0., 0., 1.);
});`;
    const result = both(source);
    expect(result.diagnostics).toEqual([]);
    const pack = packModule(result.module, { ir: true });
    const vertex = pack.gl!.vertices!.vs!;
    const fragment = pack.gl!.draws!.fs!;
    if ('none' in vertex || 'none' in fragment) throw new Error('Missing render stage');
    expect(vertex.blocks).toEqual(fragment.blocks);
    expect(Object.keys(vertex.blocks)).toEqual(['U']);
    expect(vertex.blocks.U).not.toBe('U_block_');
    expect(fragment.fragment).not.toContain('U_1._value_');
    expect(repack(pack)).toEqual(pack);
    const optimized = emitGlslStages(result.module, { plugins: [mangle(), minify()] });
    expect(optimized.fragment).toContain(vertex.blocks.U);
  });
});
