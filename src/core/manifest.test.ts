// The manifest (Rule 11.10, change 0025): its version, its JSON round trip, and its byte layouts
// against `reflect()` and the call layer, over every example.
//
// Verifies: Rule 6.8, Rule 11.10.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { examples } from '../../examples/index.js';
import { shadeExamples } from '../../examples/_shade.js';
import { compile } from '../compiler/ts/compile.js';
import { hostFace } from '../compiler/ts/host-face.js';
import { reflect } from './reflect.js';
import { buildManifest, packLayout, PACK_SCHEMA, type PackLayout } from './manifest.js';
import type { ModuleDecl } from './ir/nodes.js';
import { VERSION } from './version.js';

const ROOT = join(import.meta.dirname, '..', '..');

const corpus = [...examples, ...shadeExamples].filter(
  (e): e is typeof e & { module: ModuleDecl } => e.module !== undefined,
);

/** Every struct layout a manifest binding carries, flattened to `Struct.field@offset`. */
function structOffsets(l: PackLayout, out: Map<string, number>, name?: string): void {
  if (l.kind === 'array') structOffsets(l.element, out, name);
  if (l.kind !== 'struct' || name === undefined) return;
  for (const f of l.fields) out.set(`${name}.${f.name}`, f.offset);
}

describe('the manifest (Rule 11.10)', () => {
  it('records the package version that wrote it', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      version: string;
    };
    expect(VERSION).toBe(pkg.version);
  });

  it(`covers the corpus (${corpus.length} modules)`, () => {
    expect(corpus.length).toBeGreaterThan(80);
  });

  for (const ex of corpus) {
    it(`${ex.id}: is schema 1, survives JSON, and agrees with reflect() (Rule 6.8)`, () => {
      const m = ex.module;
      const p = buildManifest(m, { console: true });
      expect(p.schema).toBe(PACK_SCHEMA);
      expect(p.compiler).toBe(VERSION);
      expect(JSON.parse(JSON.stringify(p))).toEqual(p);

      const r = reflect(m);
      // The same slots, the injected ones among them.
      const slots = (xs: readonly { name: string; group: number; binding: number }[]) =>
        xs.map((b) => `${b.group}:${b.binding}:${b.name}`).sort();
      expect(slots(p.bindings)).toEqual(slots(r.bindGroups.flatMap((g) => g.entries)));
      // The same entries.
      expect(p.entries.map((e) => `${e.stage}:${e.name}`).sort()).toEqual(
        r.entries.map((e) => `${e.stage}:${e.name}`).sort(),
      );
      // Each struct binding's field offsets are reflect()'s, byte for byte.
      const reflected = new Map<string, number>();
      for (const s of [...r.uniforms, ...r.storage])
        for (const f of s.fields) reflected.set(`${s.name}.${f.name}`, f.offset);
      for (const b of p.bindings) {
        if (b.layout === undefined || !b.type.startsWith('struct:')) continue;
        const ours = new Map<string, number>();
        structOffsets(b.layout, ours, b.type.slice('struct:'.length));
        for (const [k, off] of ours) if (reflected.has(k)) expect(off, k).toBe(reflected.get(k));
      }
      // One vertex layout.
      if (r.vertex !== undefined) {
        expect(p.vertexLayout?.arrayStride).toBe(r.vertex.arrayStride);
        expect(p.vertexLayout?.attributes.map((a) => [a.name, a.offset])).toEqual(
          r.vertex.attributes.map((a) => [a.name, a.offset]),
        );
      }
      // The recorded variant adds the console buffer and nothing else a host binds by name.
      if (p.console !== undefined) {
        const names = new Set(p.bindings.map((b) => b.name));
        const added = p.console.bindings.filter((b) => !names.has(b.name)).map((b) => b.name);
        expect(added).toEqual(['_console']);
      }
    });
  }

  it("a data texture's format is the sampler the GLSL declares for it", () => {
    const src = `"use typeshade";
declare const heights: storage<array<f32>>;
declare const ids: storage<array<u32>>;
declare const offsets: storage<array<i32>>;
declare const uvs: storage<array<vec2>>;
class VsOut {
  @builtin("position") pos: vec4;
  @location(0) @interpolate("flat") i: u32;
}
@vertex
export function vs(@builtin("vertex_index") v: u32): VsOut {
  return { pos: vec4(f32(v), heights[v], 0., 1.), i: v };
}
class Color {
  @location(0) color: vec4;
}
@fragment
export function fs(o: VsOut): Color {
  return { color: vec4(f32(ids[o.i]), f32(offsets[o.i]), uvs[o.i].x, 1.) };
}
`;
    const r = compile(src);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    const p = buildManifest(r.module);
    expect(p.glsl).toBeDefined();
    const glsl = `${p.glsl!.vertex}\n${p.glsl!.fragment}`;
    const want = { r32float: 'sampler2D', r32uint: 'usampler2D', r32sint: 'isampler2D' };
    const seen: string[] = [];
    for (const b of p.bindings) {
      expect(b.dataTexture, b.name).toBeDefined();
      const m = new RegExp(`uniform (?:\\w+ )*(\\w*sampler2D) ${b.name};`).exec(glsl);
      expect(m?.[1], b.name).toBe(want[b.dataTexture!.format]);
      seen.push(`${b.name}:${b.dataTexture!.format}x${b.dataTexture!.lanes}`);
    }
    expect(seen).toEqual([
      'heights:r32floatx1',
      'ids:r32uintx1',
      'offsets:r32sintx1',
      'uvs:r32floatx2',
    ]);
    // The interpolation reflect() leaves out.
    expect(
      p.entries.find((e) => e.name === 'fs')?.inputs?.find((x) => x.name === 'i'),
    ).toMatchObject({ location: 0, interpolate: 'flat' });
  });

  it("the call layer's layouts are the manifest's", () => {
    const file = join(ROOT, 'examples', 'gpu-console.shade.ts');
    const source = readFileSync(file, 'utf8');
    const face = hostFace(source, { fileName: file });
    const m = compile(source, { fileName: file }).module;
    const p = buildManifest(m);
    let checked = 0;
    for (const e of face.exports ?? []) {
      if (e.kind !== 'compute') continue;
      for (const b of e.entry.bindings) {
        if (!('layout' in b)) continue;
        expect(packLayout(b.layout)).toEqual(p.bindings.find((x) => x.name === b.name)?.layout);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('carries a struct parameter of a vertex entry in its vertex layout', () => {
    const file = join(ROOT, 'examples', 'hello-vsin.shade.ts');
    const r = compile(readFileSync(file, 'utf8'), { fileName: file });
    const p = buildManifest(r.module);
    const vs = p.entries.find((e) => e.name === 'vs');
    expect(vs?.vertex).toEqual({
      attributes: [
        { name: 'position', location: 0, offset: 0, format: 'float32x3', type: 'vec3<f32>' },
        { name: 'uv', location: 1, offset: 12, format: 'float32x2', type: 'vec2<f32>' },
      ],
      arrayStride: 20,
    });
    // reflect() gave none for a struct parameter before the manifest (change 0025).
    expect(reflect(r.module).vertex?.attributes.map((a) => a.offset)).toEqual([0, 12]);
  });
});
