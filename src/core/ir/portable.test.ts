// The portable IR (change 0025, Rule 11.10): a module through JSON and back emits the same
// program, byte for byte, so the load-time emitter (`typeshade/emit`) can emit it again without
// the front end.
//
// Verifies: Rule 11.10.

import { describe, expect, it } from 'vitest';
import { examples } from '../../../examples/index.js';
import { shadeExamples } from '../../../examples/_shade.js';
import { compile } from '../../compiler/ts/compile.js';
import { buildManifest } from '../manifest.js';
import { reflect } from '../reflect.js';
import { emitModule } from '../backends/wgsl.js';
import { emitGlslModule } from '../backends/glsl.js';
import { VERSION } from '../version.js';
import type { Expr, ModuleDecl } from './nodes.js';
import { fromPortable, toPortable } from './portable.js';
import { repack } from '../../emit.js';

const corpus = [...examples, ...shadeExamples].filter(
  (e): e is typeof e & { module: ModuleDecl } => e.module !== undefined,
);

/** `m` through the portable IR and JSON, and back. */
const roundTrip = (m: ModuleDecl): ModuleDecl =>
  fromPortable(JSON.parse(JSON.stringify(toPortable(m, VERSION))) as ReturnType<typeof toPortable>);

/** The GLSL of each stage `m` has, or the reason it has none. */
function glslOf(m: ModuleDecl): string[] {
  return (['vertex', 'fragment'] as const).map((stage) => {
    try {
      return emitGlslModule(m, stage);
    } catch (e) {
      return `refused: ${e instanceof Error ? e.message : String(e)}`;
    }
  });
}

describe('the portable IR emits the same program (Rule 11.10)', () => {
  it(`covers the corpus (${corpus.length} modules)`, () => {
    expect(corpus.length).toBeGreaterThan(80);
  });

  for (const ex of corpus) {
    it(`${ex.id}: WGSL, GLSL, reflect(), the console variant and the manifest, byte for byte`, () => {
      const back = roundTrip(ex.module);
      expect(emitModule(back)).toBe(emitModule(ex.module));
      expect(glslOf(back)).toEqual(glslOf(ex.module));
      expect(JSON.stringify(reflect(back))).toBe(JSON.stringify(reflect(ex.module)));
      expect(JSON.stringify(buildManifest(back, { console: true }))).toBe(
        JSON.stringify(buildManifest(ex.module, { console: true })),
      );
    });
  }

  it('keeps -0, NaN and the infinities, which JSON writes as 0 and null', () => {
    const lit = (value: number): Expr => ({
      op: 'lit',
      type: { kind: 'scalar', scalar: 'f32' },
      value,
    });
    const m = {
      consts: [],
      structs: [],
      bindings: [],
      funcs: [],
      vars: [],
      extra: [lit(-0), lit(NaN), lit(Infinity), lit(-Infinity), lit(0)],
    } as unknown as ModuleDecl;
    const back = roundTrip(m) as unknown as { extra: { value: number }[] };
    expect(back.extra.map((e) => e.value)).toEqual([-0, NaN, Infinity, -Infinity, 0]);
    expect(Object.is(back.extra[0]!.value, -0)).toBe(true);
    expect(Object.is(back.extra[4]!.value, 0)).toBe(true);
  });

  it('writes a callee by reference, not inlined at every call', () => {
    // A call the EDSL made carries its callee's declaration. Inlined, `rt-renderer-class` was
    // 1,160,381 bytes of JSON; by reference, a tenth of that.
    const ex = corpus.find((e) => e.id === 'rt-renderer-class')!;
    const text = JSON.stringify(toPortable(ex.module, VERSION));
    const inlined = JSON.stringify(ex.module, (k, v: unknown) => (k === 'declRef' ? { v } : v));
    expect(text).toMatch(/"declRef":\{"\$fn":"[A-Za-z_]\w*"\}/);
    expect(text.length * 5).toBeLessThan(inlined.length);
    expect(emitModule(roundTrip(ex.module))).toBe(emitModule(ex.module));
  });

  it('keeps one node one node where it is used twice', () => {
    // `gradient` reads one vector variable in three places; copies of it were three variables.
    const ex = corpus.find((e) => e.id === 'gradient')!;
    expect(emitModule(roundTrip(ex.module))).toBe(emitModule(ex.module));
    expect(JSON.stringify(toPortable(ex.module, VERSION))).toContain('"$ref":');
  });
});

describe('repack, the load-time emitter (change 0025)', () => {
  const src = `"use typeshade";
declare const out: storage<array<f32>, "read_write">;
@compute([4])
export function main(@builtin("global_invocation_id") gid: vec3u) {
  console.log("x", gid.x);
  out[gid.x] = f32(gid.x);
}
`;
  const m = compile(src, { fileName: 'x.shade.ts' }).module!;

  it('emits the recorded variant a build did not write, as the build would have', () => {
    const built = buildManifest(m, { ir: true });
    expect(built.console).toBeUndefined();
    const again = repack(built, { console: true });
    const direct = buildManifest(m, { console: true, ir: true });
    expect(JSON.stringify(again)).toBe(JSON.stringify(direct));
    // Emitted again with no variant, it is the manifest the build wrote.
    expect(JSON.stringify(repack(built))).toBe(JSON.stringify(built));
  });

  it('refuses a manifest with no IR, and one another version wrote, naming both versions', () => {
    expect(() => repack(buildManifest(m))).toThrow(
      'repack(): this manifest carries no IR; build it with packModule(m, { ir: true }) or typeshade({ ir: true }).',
    );
    const built = buildManifest(m, { ir: true });
    const other = { ...built, ir: { ...built.ir!, version: '0.0.0-other' } };
    expect(() => repack(other, { console: true })).toThrow(
      `repack(): this manifest's IR was written by typeshade 0.0.0-other, and this emitter (typeshade ${VERSION}) reads only its own version's IR; build the manifest again with this version.`,
    );
  });

  it('carries the IR only on request', () => {
    expect(buildManifest(m).ir).toBeUndefined();
    expect(buildManifest(m, { ir: true }).ir?.version).toBe(VERSION);
  });
});
