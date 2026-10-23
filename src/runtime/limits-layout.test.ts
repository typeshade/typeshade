// The limits the runtime derives for a pipeline equal what its layout holds (change 0051, "One
// authority"). The derivation (`needOfEntry` over `bindingsOf`) and the layout (`#shape`) read the
// same selection, and this test holds them to each other on the manifests of the examples and on a
// program that records beside an `_fp64` guard, so a change to one that the other does not follow
// fails here. A recording device sees the bind group layouts the runtime makes.
//
// Verifies: Rule 11.11.

import { describe, expect, it } from 'vitest';
import { examples } from '../../examples/index.js';
import { shadeExamples } from '../../examples/_shade.js';
import { compile } from '../compiler/ts/compile.js';
import { packModule } from '../compiler/ts/pack.js';
import type { Pack } from '../core/manifest-types.js';
import { repack } from '../emit.js';
import { bindingsOf, canRecord, needOfEntry, PIPELINE_LIMITS } from './limits.js';
import { createRuntime } from './runtime.js';

interface LayoutEntry {
  readonly binding: number;
  readonly visibility: number;
  readonly buffer?: { readonly type: string };
  readonly texture?: object;
  readonly sampler?: object;
  readonly storageTexture?: object;
}

/** A device that records the bind group layouts it is given. */
function recordingDevice(features: readonly string[] = []) {
  const layouts: { entries: LayoutEntry[] }[] = [];
  const device = {
    features: new Set<string>(features),
    limits: {},
    queue: {
      submit() {},
      writeBuffer() {},
      writeTexture() {},
      onSubmittedWorkDone: async () => {},
    },
    createBuffer: () => ({ destroy() {} }),
    createShaderModule: () => ({}),
    createBindGroupLayout: (d: { entries: LayoutEntry[] }) => (
      layouts.push(d),
      { entries: d.entries }
    ),
    createPipelineLayout: () => ({}),
    createComputePipelineAsync: async () => ({}),
    createRenderPipelineAsync: async () => ({}),
    pushErrorScope() {},
    popErrorScope: async () => null,
  };
  return { device, layouts };
}

/** What a pipeline's layouts hold, limit by limit, for the stage bits in `stages`. */
function layoutCounts(layouts: readonly { entries: LayoutEntry[] }[], stage: number) {
  const counts: Record<string, number> = {};
  const add = (name: string, e: LayoutEntry, test: boolean): void => {
    if (test && (e.visibility & stage) !== 0) counts[name] = (counts[name] ?? 0) + 1;
  };
  let top = -1;
  for (const l of layouts)
    for (const e of l.entries) {
      add('maxStorageBuffersPerShaderStage', e, e.buffer?.type.includes('storage') === true);
      add('maxUniformBuffersPerShaderStage', e, e.buffer?.type === 'uniform');
      add('maxSampledTexturesPerShaderStage', e, e.texture !== undefined);
      add('maxSamplersPerShaderStage', e, e.sampler !== undefined);
      add('maxStorageTexturesPerShaderStage', e, e.storageTexture !== undefined);
      if ((e.visibility & stage) !== 0) top = Math.max(top, e.binding);
    }
  counts.maxBindGroups = layouts.length;
  return { counts, top };
}

/** Make every pipeline of `pack` and compare what the derivation needs with what the layouts hold.
 *  Returns the number of pipelines compared and the largest storage-buffer count seen. */
async function compareAll(pack: Pack, records: boolean) {
  let pipelines = 0;
  let storage = 0;
  const entries = pack.entries;
  const fragments = entries.filter((e) => e.stage === 'fragment');
  const vertexes = entries.filter((e) => e.stage === 'vertex');
  const bindings = bindingsOf(pack, records && canRecord(pack, true));
  const cases: {
    entries: (typeof entries)[number][];
    make: (p: Awaited<ReturnType<typeof load>>) => Promise<unknown>;
  }[] = [];
  for (const e of entries.filter((x) => x.stage === 'compute'))
    cases.push({ entries: [e], make: (p) => p.program.compute(e.name) });
  for (const v of vertexes)
    for (const f of fragments.length > 0 ? fragments : [undefined])
      cases.push({
        entries: f === undefined ? [v] : [v, f],
        make: (p) =>
          p.program.render({
            vertex: v.name,
            ...(f === undefined ? { fragment: null } : { fragment: f.name }),
          }),
      });
  for (const c of cases) {
    const loaded = await load(pack, records);
    try {
      await c.make(loaded);
    } catch {
      // A render state the defaults cannot make (a target format): not a pipeline of this test.
      continue;
    }
    pipelines++;
    const needs = c.entries.map((e) => needOfEntry(bindings, e, records && loaded.recording));
    for (const limit of PIPELINE_LIMITS) {
      const want = Math.max(...needs.map((n) => n.need[limit] ?? 0));
      let got: number;
      if (limit === 'maxBindGroups') got = loaded.layouts.length;
      else if (limit === 'maxBindingsPerBindGroup')
        got = Math.max(-1, ...loaded.layouts.flatMap((l) => l.entries.map((e) => e.binding))) + 1;
      else
        got = Math.max(
          ...c.entries.map((e) => {
            const stage = { vertex: 1, fragment: 2, compute: 4 }[e.stage as 'vertex'];
            return layoutCounts(loaded.layouts, stage).counts[limit] ?? 0;
          }),
        );
      expect(got, `${limit} of ${c.entries.map((e) => e.name).join('+')}`).toBe(want);
      if (limit === 'maxStorageBuffersPerShaderStage') storage = Math.max(storage, got);
    }
  }
  return { pipelines, storage };
}

async function load(pack: Pack, records: boolean) {
  const { device, layouts } = recordingDevice(pack.features);
  const rt = await createRuntime({ device: device as never, ...(records ? { emit: repack } : {}) });
  const program = rt.load(pack, records ? { console: true } : undefined);
  const recording = records && canRecord(pack, true);
  return { program, layouts, recording };
}

const DOUBLES = `"use typeshade";
class Zoom { cx: f64; scale: f64; }
declare const zoom: uniform<Zoom>;
declare const out: storage<array<f32>, "read_write">;
@compute([4])
export function main(@builtin("global_invocation_id") gid: vec3u) {
  const x: f64 = zoom.cx + f64(f32(gid.x)) * zoom.scale;
  console.log("x", f32(x));
  out[gid.x] = f32(fract(x * 1000));
}
`;

describe('the derived need of a pipeline equals its layout (change 0051, one authority)', () => {
  it('holds on every example that packs, with a floor on what was compared', async () => {
    let pipelines = 0;
    let storage = 0;
    let uniform = 0;
    for (const ex of [...examples, ...shadeExamples]) {
      let pack: Pack;
      try {
        pack = packModule(ex.module);
      } catch {
        continue;
      }
      const r = await compareAll(pack, false);
      pipelines += r.pipelines;
      storage = Math.max(storage, r.storage);
      uniform += pack.bindings.filter((b) => b.resource.resourceKind === 'uniform-buffer').length;
    }
    // The instrument: a test that compared nothing, or nothing with a storage buffer, proves nothing.
    expect(pipelines).toBeGreaterThan(20);
    expect(storage).toBeGreaterThanOrEqual(2);
    expect(uniform).toBeGreaterThan(5);
  });

  it('holds for a program that records beside an _fp64 guard: its recorded variant, and the one the emitter makes', async () => {
    const r = compile(DOUBLES);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    const emit = { level: 'O1', fp64Flavor: 'float' } as const;
    const built = packModule(r.module!, { console: true, emit });
    // The instrument: the manifest holds both the console buffer and the guard in its variant.
    const names = built.console!.bindings.map((b) => b.name);
    expect(names).toEqual(['zoom', 'out', '_console', '_fp64']);
    const direct = await compareAll(built, true);
    expect(direct.pipelines).toBe(1);
    expect(direct.storage).toBe(2);
    // A manifest that carries only its IR: the derivation predicts the variant the emitter makes.
    const ir = packModule(r.module!, { ir: true, emit });
    const emitted = await compareAll(ir, true);
    expect(emitted.pipelines).toBe(1);
    expect(emitted.storage).toBe(2);
  });
});
