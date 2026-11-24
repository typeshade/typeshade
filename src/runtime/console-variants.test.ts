// Verifies: Rule 11.9, Rule 11.10, Rule 11.11.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { packModule } from '../compiler/ts/pack.js';
import { bothTake } from '../core/testing/both-halves.js';
import { createRuntime } from './runtime.js';

const SCALE = readFileSync(
  new URL('../../journeys/_console-variants/console.shade.ts', import.meta.url),
  'utf8',
);

const DOUBLES = `"use typeshade";
class Zoom { cx: f64; scale: f64; }
declare const zoom: uniform<Zoom>;
declare const out: storage<array<f32>, "read_write">;
@compute([4]) export function main(gid: builtin<"global_invocation_id">) {
  const x: f64 = zoom.cx + f64(f32(gid.x)) * zoom.scale;
  console.log("x", f32(x));
  out[gid.x] = f32(fract(x * 1000));
}
`;

function recordingDevice() {
  const modules: string[] = [];
  const layouts: { entries: { binding: number }[] }[] = [];
  const device = {
    features: new Set<string>(),
    limits: {},
    queue: {
      submit() {},
      writeBuffer() {},
      writeTexture() {},
      onSubmittedWorkDone: async () => {},
    },
    createBuffer: () => ({ destroy() {} }),
    createShaderModule: (d: { code: string }) => (modules.push(d.code), {}),
    createBindGroupLayout: (d: { entries: { binding: number }[] }) => (layouts.push(d), d),
    createPipelineLayout: () => ({}),
    createComputePipelineAsync: async () => ({}),
    createRenderPipelineAsync: async () => ({}),
    pushErrorScope() {},
    popErrorScope: async () => null,
  };
  return { device: device as never, modules, layouts };
}

const scale = (options?: Parameters<typeof packModule>[1]) =>
  packModule(bothTake(SCALE, { fileName: 'console.shade.ts' }).result.module!, options);

describe('loading a retained console variant (change 0085)', () => {
  it('selects the variant without an emitter, without changing the manifest and without enabling the next load', async () => {
    const built = scale();
    const saved = JSON.stringify(built);
    const fake = recordingDevice();
    const emit = vi.fn(() => {
      throw new Error('A retained variant must not call the emitter.');
    });
    const rt = await createRuntime({ device: fake.device, emit });
    expect(built.ir).toBeUndefined();
    expect(rt.load(built).recording).toBe(false);
    const enabled = rt.load(built, { console: true });
    expect(enabled.recording).toBe(true);
    await enabled.compute();
    expect(fake.modules).toEqual([built.variants!.console!.wgsl]);
    expect(rt.load(built, { console: false }).recording).toBe(false);
    expect(rt.load(built).recording).toBe(false);
    expect(enabled.manifest).toBe(built);
    expect(JSON.stringify(built)).toBe(saved);
    expect(emit).not.toHaveBeenCalled();
  });

  it('refuses a manifest with neither a variant nor IR', async () => {
    const rt = await createRuntime({ device: recordingDevice().device });
    expect(() => rt.load(scale({ console: 'never' }), { console: true })).toThrow(TypeError);
  });

  it.each(['float', 'integer'] as const)(
    'lays a pipeline out by the variant bindings under the %s fp64 flavor',
    async (fp64Flavor) => {
      const module = bothTake(DOUBLES, { fileName: 'doubles.shade.ts' }).result.module!;
      const built = packModule(module, { emit: { fp64Flavor } });
      const fake = recordingDevice();
      const rt = await createRuntime({ device: fake.device });
      await rt.load(built, { console: true }).compute();
      const recorded = built.variants!.console!;
      expect(fake.modules).toEqual([recorded.wgsl]);
      expect(recorded.bindings.map((b) => b.name)).toEqual(
        fp64Flavor === 'float' ? ['zoom', 'out', '_console', '_fp64'] : ['zoom', 'out', '_console'],
      );
      expect(fake.layouts.flatMap((l) => l.entries.map((e) => e.binding)).sort()).toEqual(
        recorded.bindings.map((b) => b.binding).sort(),
      );
    },
  );
});
