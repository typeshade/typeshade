// The manifest (Rule 11.10, change 0025): its version, its JSON round trip, and its byte layouts
// against `reflect()` and the call layer, over every example. Change 0028's emit options: a
// manifest packed under each level and flavor holds the text, the GLSL, the bindings and the
// recorded variant those options emit, and `repack` gives it back byte for byte.
//
// Verifies: Rule 6.8, Rule 11.10.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { examples } from '../../examples/index.js';
import { shadeExamples } from '../../examples/_shade.js';
import { compile } from '../compiler/ts/compile.js';
import { hostFace } from '../compiler/ts/host-face.js';
import { packModule } from '../compiler/ts/pack.js';
import { repack } from '../emit.js';
import { obfuscate } from '../emit-prod.js';
import { reflect } from './reflect.js';
import {
  buildManifest,
  packLayout,
  PACK_SCHEMA,
  type Pack,
  type PackLayout,
  type PackOptions,
} from './manifest.js';
import { stageOf, type ModuleDecl } from './ir/nodes.js';
import { fn, module, vec4 } from './ir/index.js';
import { vec2fT, vec4fT } from './ir/types.js';
import { builtin, ioStruct, location } from './sot.js';
import { emitModule, emitModuleAt, wgslBackend } from './backends/wgsl.js';
import { emitGlslStages } from './backends/glsl.js';
import { emitModule as emitWith, type EmitPlugin } from './emit.js';
import { consoleBuffer } from './passes/console-buffer.js';
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

describe('a manifest packed under emit options (change 0028)', () => {
  type Emit = NonNullable<PackOptions['emit']>;
  const LEVELS = ['O0', 'O1', 'O2'] as const;
  const FLAVORS = ['float', 'integer'] as const;
  /** Each level with each flavor, then `parens` and every option at once. */
  const matrix: readonly Emit[] = [
    ...LEVELS.flatMap((level) => FLAVORS.map((fp64Flavor) => ({ level, fp64Flavor }))),
    { parens: 'minimal' },
    { level: 'O0', parens: 'minimal', fp64Flavor: 'integer' },
  ];
  const label = (emit: Emit): string => JSON.stringify(emit);

  /** The WGSL of `m` under `emit`, from the public writer where one takes all of it: `emitModule`
   *  at the default level, and `emitModuleAt` where the other options are the defaults. A level
   *  with a `parens` or a flavor has no public writer, so it goes through the driver both share. */
  const wgslOf = (m: ModuleDecl, emit: Emit): string => {
    const { level, ...writer } = emit;
    if (level === undefined || level === 'O2') return emitModule(m, writer);
    if ((writer.parens ?? 'full') === 'full' && (writer.fp64Flavor ?? 'float') === 'float')
      return emitModuleAt(m, level);
    return emitWith(m, wgslBackend, writer, level);
  };
  const writerOf = ({ level: _level, ...writer }: Emit): Omit<Emit, 'level'> => writer;

  const named = (id: string): ModuleDecl => corpus.find((e) => e.id === id)!.module;
  const compiled = (source: string): ModuleDecl => {
    const r = compile(source, { fileName: 'x.shade.ts' });
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    return r.module!;
  };

  /** Programs that compute in `f64`, which the WGSL holds as two `f32`s and the `'float'` flavor
   *  reads the `_fp64` guard for, each with a `console.*` call: a manifest with the guard and the
   *  recorded variant, whose `_console` buffer the guard is one slot past. One is a compute entry,
   *  and one a full-screen fragment entry, which has a WebGL2 draw that declares the guard. A
   *  module with a compute entry has no GLSL, so the two are apart. */
  const F64_KERNEL = compiled(`"use typeshade";
class Zoom { cx: f64; scale: f64; }
declare const zoom: uniform<Zoom>;
declare const out: storage<array<f32>, "read_write">;
@compute([4])
export function main(@builtin("global_invocation_id") gid: vec3u) {
  const x: f64 = zoom.cx + f64(f32(gid.x)) * zoom.scale;
  console.log("x", f32(x));
  out[gid.x] = f32(fract(x * 1000));
}
`);
  const F64_DRAW = compiled(`"use typeshade";
class Zoom { cx: f64; scale: f64; }
declare const zoom: uniform<Zoom>;
@fragment
export function deep(@builtin("position") p: vec4): vec4 {
  const x: f64 = zoom.cx + f64(p.x) * zoom.scale;
  console.log("x", f32(x));
  return vec4(f32(fract(x * 1000)), p.y / 32, 0, 1);
}
`);

  for (const emit of matrix)
    it(`${label(emit)}: every example holds its WGSL, and repack gives the manifest back byte for byte`, () => {
      const wrong: string[] = [];
      for (const ex of corpus) {
        const built = buildManifest(ex.module, { ir: true, emit });
        expect(built.emit, ex.id).toEqual(emit);
        if (built.wgsl !== wgslOf(ex.module, emit)) wrong.push(`${ex.id}: wgsl`);
        // A manifest travels as JSON, and the load-time emitter reads it from there.
        const again = repack(JSON.parse(JSON.stringify(built)) as Pack);
        expect(Object.keys(again).sort(), ex.id).toEqual(Object.keys(built).sort());
        for (const key of Object.keys(built) as (keyof Pack & string)[])
          if (JSON.stringify(again[key]) !== JSON.stringify(built[key]))
            wrong.push(`${ex.id}: ${key}`);
      }
      expect(wrong).toEqual([]);
    }, 60_000);

  it('changes the text, so the tests above can see a manifest that ignores an option', () => {
    // A test of an option that changes nothing passes whatever the manifest does with it. Each
    // option moves the WGSL the writers emit for many examples, on its own where a combination
    // isolates it, and the defaults, `'O2'` and `'float'`, move none.
    const moved = (emit: Emit): number =>
      corpus.filter((ex) => wgslOf(ex.module, emit) !== emitModule(ex.module)).length;
    expect(moved({ level: 'O0', fp64Flavor: 'float' })).toBeGreaterThan(20);
    expect(moved({ level: 'O1', fp64Flavor: 'float' })).toBeGreaterThan(0);
    expect(moved({ level: 'O2', fp64Flavor: 'integer' })).toBeGreaterThan(10);
    expect(moved({ parens: 'minimal' })).toBeGreaterThan(20);
    expect(moved({ level: 'O2', fp64Flavor: 'float' })).toBe(0);
  });

  describe('the GLSL, the bindings, the recorded variant and the WebGL2 draws are the ones those options emit', () => {
    const subjects: Record<string, ModuleDecl> = {
      'fp64-deep-zoom': named('fp64-deep-zoom'),
      hello: named('hello'),
      'path-tracer': named('path-tracer'),
      'gpu-console': named('gpu-console'),
      'a compute entry in f64': F64_KERNEL,
      'a full-screen draw in f64': F64_DRAW,
    };

    for (const emit of matrix)
      for (const [name, m] of Object.entries(subjects))
        it(`${name} under ${label(emit)}`, () => {
          const writer = writerOf(emit);
          const p = buildManifest(m, { console: true, emit });
          expect(JSON.parse(JSON.stringify(p))).toEqual(p);
          expect(p.emit).toEqual(emit);
          expect(p.wgsl).toBe(wgslOf(m, emit));

          // The GLSL writer has no level: its programs are the ones the other options emit, for a
          // module with an entry of each stage that the writer can spell.
          let glsl: Pack['glsl'];
          try {
            const pair = (['vertex', 'fragment'] as const).every((st) =>
              m.funcs.some((f) => stageOf(f) === st),
            );
            glsl = pair ? emitGlslStages(m, writer) : undefined;
          } catch {
            glsl = undefined;
          }
          expect(p.glsl).toEqual(glsl);

          // `fp64Flavor` decides the `_fp64` guard: a binding of the `'float'` flavor's modules
          // that emulate `f64`, and of no module of the `'integer'` one.
          const slots = (xs: readonly { name: string; group: number; binding: number }[]) =>
            xs.map((b) => `${b.group}:${b.binding}:${b.name}`);
          const reflected = (x: ModuleDecl) =>
            reflect(x, { fp64Flavor: emit.fp64Flavor }).bindGroups.flatMap((g) => g.entries);
          expect(slots(p.bindings)).toEqual(slots(reflected(m)));
          const guard = p.bindings.some((b) => b.name === '_fp64');
          if (emit.fp64Flavor === 'integer') expect(guard).toBe(false);
          if (/f64|fp64/.test(name))
            expect(guard, 'a module that emulates f64').toBe(emit.fp64Flavor !== 'integer');
          for (const e of p.entries)
            expect(
              e.bindings?.some((b) => b.name === '_fp64'),
              `${e.name} reaches the guard`,
            ).toBe(guard);

          // The recorded variant is the program's WGSL and bindings with the console buffer.
          const recorded = consoleBuffer(m);
          if (recorded.log === undefined) expect(p.console).toBeUndefined();
          else {
            expect(p.console?.wgsl).toBe(wgslOf(recorded.module, emit));
            expect(slots(p.console!.bindings)).toEqual(slots(reflected(recorded.module)));
            expect(p.console!.bindings.some((b) => b.name === '_fp64')).toBe(guard);
            // The guard is the last slot, one past `_console`.
            if (guard) expect(p.console!.bindings.at(-1)!.name).toBe('_fp64');
          }

          // Each WebGL2 draw is the fragment program the same options emit for its entry.
          for (const [entry, draw] of Object.entries(p.gl?.draws ?? {})) {
            const expected = (() => {
              try {
                return emitGlslStages(m, { ...writer, fragmentEntry: entry }).fragment;
              } catch {
                return undefined;
              }
            })();
            if ('none' in draw) expect(expected, `${entry}: ${draw.none}`).toBeUndefined();
            else {
              expect(draw.fragment).toBe(expected);
              // A draw declares the guard where its program reads it, and the `'integer'` flavor has none.
              if (!guard) expect(draw.fragment).not.toContain('_fp64');
            }
          }
        });

    it('the f64 subjects reach the guard, the recorded variant and a draw, so the checks above see them', () => {
      const names = (bs: readonly { name: string }[] | undefined) => bs?.map((b) => b.name);
      const kernel = buildManifest(F64_KERNEL, { console: true });
      expect(names(kernel.bindings)).toEqual(['zoom', 'out', '_fp64']);
      expect(names(kernel.console?.bindings)).toEqual(['zoom', 'out', '_console', '_fp64']);
      const draw = buildManifest(F64_DRAW, { console: true });
      expect(names(draw.bindings)).toEqual(['zoom', '_fp64']);
      expect(names(draw.console?.bindings)).toEqual(['zoom', '_console', '_fp64']);
      const gl = draw.gl?.draws['deep'];
      expect(gl !== undefined && !('none' in gl) && gl.fragment.includes('_fp64')).toBe(true);

      // The integer flavor has no guard: not in the bindings, not in what each entry reaches, not
      // in the variant, and not in the program a draw runs.
      const integer = { console: true, emit: { fp64Flavor: 'integer' } } as const;
      const noKernelGuard = buildManifest(F64_KERNEL, integer);
      expect(names(noKernelGuard.bindings)).toEqual(['zoom', 'out']);
      expect(names(noKernelGuard.console?.bindings)).toEqual(['zoom', 'out', '_console']);
      expect(names(noKernelGuard.entries[0]!.bindings)).toEqual(['zoom', 'out']);
      const noDrawGuard = buildManifest(F64_DRAW, integer);
      expect(names(noDrawGuard.bindings)).toEqual(['zoom']);
      expect(names(noDrawGuard.console?.bindings)).toEqual(['zoom', '_console']);
      const noGl = noDrawGuard.gl?.draws['deep'];
      expect(noGl !== undefined && !('none' in noGl) && noGl.fragment.includes('_fp64')).toBe(
        false,
      );
    });
  });

  it('gives the recorded variant back under the options the manifest records', () => {
    // The variant is emitted again at load time, from the IR: under the same options, or its
    // text and its bindings would disagree with the manifest's.
    for (const m of [named('gpu-console'), F64_KERNEL, F64_DRAW])
      for (const emit of matrix) {
        const built = buildManifest(m, { ir: true, emit });
        expect(built.console).toBeUndefined();
        const again = repack(JSON.parse(JSON.stringify(built)) as Pack, { console: true });
        const direct = buildManifest(m, { ir: true, console: true, emit });
        expect(again.console, label(emit)).toBeDefined();
        for (const key of Object.keys(direct) as (keyof Pack & string)[])
          expect(JSON.stringify(again[key]), `${label(emit)}: ${key}`).toBe(
            JSON.stringify(direct[key]),
          );
      }
  });

  it('records nothing when it is given none, and the default is what it was', () => {
    for (const ex of corpus.slice(0, 12)) {
      const plain = buildManifest(ex.module);
      expect(plain, ex.id).not.toHaveProperty('emit');
      // No option, an empty list of plugins and the default of each option emit the same program.
      expect(JSON.stringify(buildManifest(ex.module, { emit: {} }))).toBe(JSON.stringify(plain));
      expect(JSON.stringify(buildManifest(ex.module, { emit: { plugins: [] } }))).toBe(
        JSON.stringify(plain),
      );
      const explicit = buildManifest(ex.module, {
        emit: { level: 'O2', parens: 'full', fp64Flavor: 'float' },
      });
      expect(explicit.emit).toEqual({ level: 'O2', parens: 'full', fp64Flavor: 'float' });
      const { emit: _emit, ...rest } = explicit;
      expect(JSON.stringify(rest), ex.id).toBe(JSON.stringify(plain));
    }
  });

  it('is what packModule() gives', () => {
    const emit: Emit = { level: 'O1', parens: 'minimal', fp64Flavor: 'integer' };
    const m = named('fp64-deep-zoom');
    expect(packModule(m, { emit })).toEqual(buildManifest(m, { emit }));
    expect(packModule(m, { emit }).emit).toEqual(emit);
  });

  describe('a plugin is a function, which a manifest cannot record', () => {
    const banner: EmitPlugin = { name: 'banner', transformText: (code) => `// packed\n${code}` };

    it('is applied to the WGSL, the GLSL and the recorded variant, and is not recorded', () => {
      const m = named('fp64-deep-zoom');
      const p = buildManifest(m, { emit: { plugins: [banner] } });
      expect(p.wgsl).toBe(emitModule(m, { plugins: [banner] }));
      expect(p.wgsl.startsWith('// packed\n')).toBe(true);
      expect(p.glsl).toEqual(emitGlslStages(m, { plugins: [banner] }));
      expect(p.emit).toBeUndefined();
      const logged = buildManifest(F64_DRAW, { console: true, emit: { plugins: [banner] } });
      expect(logged.console?.wgsl.startsWith('// packed\n')).toBe(true);
      const draw = logged.gl?.draws['deep'];
      expect(
        draw !== undefined && !('none' in draw) && draw.fragment.startsWith('// packed\n'),
      ).toBe(true);
      // The options a manifest can record are recorded, beside the plugin.
      const both = buildManifest(m, { emit: { level: 'O0', plugins: [banner] } });
      expect(both.emit).toEqual({ level: 'O0' });
      expect(both.wgsl).toBe(emitWith(m, wgslBackend, { plugins: [banner] }, 'O0'));
    });

    it("reads a WebGL2 draw's block and sampler names from the program the plugins leave alone", () => {
      // `obfuscate()` minifies the text, and a draw reads a uniform block off its spacing.
      const m = named('path-tracer');
      const plain = buildManifest(m).gl?.draws['fs'];
      const shipped = buildManifest(m, { emit: { plugins: obfuscate() } }).gl?.draws['fs'];
      expect(plain !== undefined && 'none' in plain).toBe(false);
      expect(shipped).toEqual({
        ...plain,
        fragment: emitGlslStages(m, { plugins: obfuscate(), fragmentEntry: 'fs' }).fragment,
      });
      expect((shipped as { fragment: string }).fragment.length).toBeLessThan(
        (plain as { fragment: string }).fragment.length,
      );
      expect((shipped as { blocks: object }).blocks).toEqual({ u: 'Frame' });
    });

    it('cannot be packed with the IR, since the load-time emitter could not emit the program again', () => {
      const m = named('hello');
      const sentence =
        'packModule(): { ir: true } cannot go with emit.plugins: a plugin is a function, which a manifest cannot record, so the load-time emitter could not emit the program again under it. Pack the program without ir, or without the plugins.';
      expect(() => buildManifest(m, { ir: true, emit: { plugins: [banner] } })).toThrow(
        new TypeError(sentence),
      );
      expect(() => packModule(m, { ir: true, emit: { plugins: obfuscate() } })).toThrow(
        new TypeError(sentence),
      );
      // The options a manifest can record go with the IR, and so does a list of no plugins.
      expect(buildManifest(m, { ir: true, emit: { level: 'O1', plugins: [] } }).ir).toBeDefined();
      // Packed without it, the manifest cannot be emitted again, which `repack` says.
      expect(() => repack(buildManifest(m, { emit: { plugins: [banner] } }))).toThrow(
        'repack(): this manifest carries no IR',
      );
    });
  });

  describe('refuses a word an option does not take, which a writer reads as another', () => {
    const m = named('hello');
    const refused = (emit: unknown): string => {
      try {
        buildManifest(m, { emit: emit as Emit });
      } catch (e) {
        expect(e).toBeInstanceOf(TypeError);
        return (e as Error).message;
      }
      return 'was not refused';
    };

    it('names the option, what it takes and what it was given', () => {
      expect(refused({ level: 'O3' })).toBe(
        'packModule(): emit.level takes "O0", "O1" or "O2"; got "O3".',
      );
      // The writer reads an unknown level as the full optimizer: `'o0'` would be O2, recorded as `'o0'`.
      expect(refused({ level: 'o0' })).toBe(
        'packModule(): emit.level takes "O0", "O1" or "O2"; got "o0".',
      );
      expect(refused({ parens: 'none' })).toBe(
        'packModule(): emit.parens takes "full" or "minimal"; got "none".',
      );
      expect(refused({ fp64Flavor: 'int' })).toBe(
        'packModule(): emit.fp64Flavor takes "float" or "integer"; got "int".',
      );
      expect(refused({ level: 2 })).toBe(
        'packModule(): emit.level takes "O0", "O1" or "O2"; got a number.',
      );
      expect(refused({ parens: null })).toBe(
        'packModule(): emit.parens takes "full" or "minimal"; got null.',
      );
    });

    it('refuses what is not a set of options, and plugins that are not a list', () => {
      expect(refused('O0')).toBe(
        'packModule(): emit takes an object of options, { level, parens, fp64Flavor, plugins }.',
      );
      expect(refused(null)).toBe(
        'packModule(): emit takes an object of options, { level, parens, fp64Flavor, plugins }.',
      );
      // `obfuscate` and not `obfuscate()`: a function has a length.
      expect(refused({ plugins: obfuscate })).toBe(
        'packModule(): emit.plugins takes a list of plugins, such as the one obfuscate() returns.',
      );
    });

    it('takes every word the writers take, and an absent one is the default', () => {
      for (const level of ['O0', 'O1', 'O2'] as const)
        for (const parens of ['full', 'minimal'] as const)
          for (const fp64Flavor of ['float', 'integer'] as const)
            expect(
              refused({ level, parens, fp64Flavor }),
              label({ level, parens, fp64Flavor }),
            ).toBe('was not refused');
      expect(refused({ level: undefined })).toBe('was not refused');
    });
  });
});
