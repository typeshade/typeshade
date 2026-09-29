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
import { stageOf, type ModuleDecl } from './ir/nodes.js';
import { fn, module, vec4 } from './ir/index.js';
import { vec2fT, vec4fT } from './ir/types.js';
import { builtin, ioStruct, location } from './sot.js';
import { emitGlslStages } from './backends/glsl.js';
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
      // The GLSL pair is there exactly when the module has an entry of each stage and the GLSL
      // writer spells them, whether the entries were written in TypeScript or with `fn()`.
      const pair = (['vertex', 'fragment'] as const).every((s) =>
        m.funcs.some((f) => stageOf(f) === s),
      );
      let spelled = false;
      if (pair)
        try {
          emitGlslStages(m);
          spelled = true;
        } catch {
          spelled = false;
        }
      expect(p.glsl !== undefined, 'glsl').toBe(spelled);
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

  describe("a texture's sample type agrees with the calls that read it (change 0028)", () => {
    /** The texture bindings the WGSL passes to a sampling call together with a plain sampler:
     *  read from the text the manifest carries, not from the IR the analysis reads, so the two
     *  are independent. A call's arguments are split at the commas outside a bracket, and a
     *  texture is any argument that names a texture binding: a `textureGather` puts its
     *  component first, and a sampler is any that names a plain `sampler` binding, so
     *  `textureSampleCompare`, whose sampler is a comparison one, pairs nothing. */
    const sampledInText = (
      wgsl: string,
      textures: ReadonlySet<string>,
      samplers: ReadonlySet<string>,
    ): Set<string> => {
      const sampled = new Set<string>();
      for (const call of wgsl.matchAll(/\btexture(?:Sample|Gather)\w*\(/g)) {
        const args: string[] = [];
        let depth = 1;
        let from = call.index + call[0].length;
        for (let i = from; depth > 0; i++) {
          const c = wgsl[i];
          if (c === '(') depth++;
          else if (c === ')' && --depth === 0) args.push(wgsl.slice(from, i));
          else if (c === ',' && depth === 1) {
            args.push(wgsl.slice(from, i));
            from = i + 1;
          }
        }
        const names = args.map((a) => a.trim());
        if (names.some((n) => samplers.has(n)))
          for (const n of names) if (textures.has(n)) sampled.add(n);
      }
      return sampled;
    };

    const handles = (b: { type: { kind: string } }): boolean =>
      b.type.kind === 'texture' || b.type.kind === 'depth-texture';
    const textured = corpus
      .filter((ex) => ex.module.bindings.some(handles))
      .map((ex) => ({ ex, p: buildManifest(ex.module, { console: true }) }));
    const got: Record<string, number> = {};

    for (const { ex, p } of textured)
      it(ex.id, () => {
        const named = (kind: string) =>
          new Set(p.bindings.filter((b) => b.resource.resourceKind === kind).map((b) => b.name));
        const samplers = new Set(
          p.bindings
            .filter((b) => b.resource.resourceKind === 'sampler' && !b.resource.samplerComparison)
            .map((b) => b.name),
        );
        const sampled = sampledInText(p.wgsl, named('texture'), samplers);
        const reflected = new Map(
          reflect(ex.module)
            .bindGroups.flatMap((g) => g.entries)
            .map((e) => [e.name, e.sampleType]),
        );
        for (const b of p.bindings.filter((x) => x.resource.resourceKind === 'texture')) {
          const r = b.resource;
          // WebGPU's word for the element, and for `f32` the calls: a sampler reads it, or none does.
          const want = r.textureDepth
            ? 'depth'
            : r.textureElem === 'u32'
              ? 'uint'
              : r.textureElem === 'i32'
                ? 'sint'
                : r.textureDim !== '2d-ms' && sampled.has(b.name)
                  ? 'float'
                  : 'unfilterable-float';
          expect(r.sampleType, `${ex.id}: ${b.name}`).toBe(want);
          // The manifest carries what reflect() reports.
          expect(r.sampleType, `${b.name} against reflect()`).toBe(reflected.get(b.name));
          got[want] = (got[want] ?? 0) + 1;
        }
        // Nothing but a texture has one.
        for (const b of p.bindings.filter((x) => x.resource.resourceKind !== 'texture'))
          expect(b.resource, b.name).not.toHaveProperty('sampleType');
      });

    it("the recorded variant lays a texture out as the program's does", () => {
      const src = `"use typeshade";
declare const photo: texture_2d<f32>;
declare const trail: texture_2d<f32>;
declare const smp: sampler;
class Color { @location(0) c: vec4; }
@vertex
export function vs(@builtin("vertex_index") vi: u32): vec4 {
  return vec4(f32(vi), 0., 0., 1.);
}
@fragment
export function fs(@builtin("position") p: vec4): Color {
  console.log("at", p.x);
  return { c: textureSample(photo, smp, p.xy) + textureLoad(trail, vec2i(p.xy), 0) };
}
`;
      const r = compile(src);
      expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
      const p = buildManifest(r.module, { console: true });
      const of = (bs: readonly { name: string; resource: { sampleType?: string } }[]) =>
        Object.fromEntries(
          bs.filter((b) => b.name !== '_console').map((b) => [b.name, b.resource.sampleType]),
        );
      expect(p.console).toBeDefined();
      expect(of(p.bindings)).toEqual({
        photo: 'float',
        trail: 'unfilterable-float',
        smp: undefined,
      });
      expect(of(p.console!.bindings)).toEqual(of(p.bindings));
    });

    it('reads a text call by its arguments, so it can see a failure', () => {
      const t = new Set(['a', 'b', 'c', 'd']);
      const s = new Set(['smp']);
      const wgsl = [
        'let x = textureSample(a, smp, vec2<f32>(0.0, 1.0));',
        'let y = textureLoad(b, vec2<i32>(0, 0), 0);',
        'let z = textureGather(2, c, smp, uv);',
        'let w = textureSampleCompare(d, cmp, uv, 0.5);',
      ].join('\n');
      expect([...sampledInText(wgsl, t, s)].sort()).toEqual(['a', 'c']);
      expect(sampledInText('let x = textureSample(a, cmp, uv);', t, s).size).toBe(0);
    });

    it('covers each way a texture is laid out, over the corpus', () => {
      expect(textured.length).toBeGreaterThanOrEqual(9);
      // Read by a sampler, only loaded or sized, a multisampled one and the depth textures.
      expect(got['float']).toBeGreaterThanOrEqual(8);
      expect(got['unfilterable-float']).toBeGreaterThanOrEqual(2);
      expect(got['depth']).toBeGreaterThanOrEqual(4);
    });
  });

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

  it("reads an entry's stage through stageOf, so a module written with fn() has its GLSL and vertex layout", () => {
    // A `fn()` handle, what `module()` puts in `funcs`, carries the stage in `attrs` and no
    // `stage` field. Read from the field, this module had neither its GLSL pair nor its vertex
    // layout, though the writer spells both and reflect() reports the layout.
    const VsOut = ioStruct('VsOut', {
      pos: builtin('position', vec4fT),
      uv: location(0, vec2fT),
    });
    const vs = fn(
      'vs',
      { p: location(0, vec2fT) },
      ({ p }) => VsOut.construct({ pos: vec4(p, 0, 1), uv: p }),
      { stage: 'vertex' },
    );
    const fs = fn('fs', { vo: VsOut }, ({ vo }) => vec4(vo.uv, 0, 1), {
      stage: 'fragment',
      retAttr: '@location(0)',
    });
    const m = module({ structs: [VsOut.decl], funcs: [vs, fs] });
    expect(m.funcs.map((f) => f.stage)).toEqual([undefined, undefined]);
    const p = buildManifest(m);
    expect(p.glsl).toEqual(emitGlslStages(m));
    expect(p.vertexLayout).toEqual({
      attributes: [{ name: 'p', location: 0, offset: 0, format: 'float32x2', type: 'vec2<f32>' }],
      arrayStride: 8,
    });
    expect(p.vertexLayout?.arrayStride).toBe(reflect(m).vertex?.arrayStride);
    expect(p.entries.find((e) => e.name === 'vs')?.vertex).toEqual(p.vertexLayout);
  });
});
