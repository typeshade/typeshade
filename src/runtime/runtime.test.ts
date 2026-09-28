// The program runtime (change 0025 step 2, Rule 11.11) against a recording fake device: what
// it creates and when, its bind-group layouts, its refusals and their sentences, and the
// console's events. Its results on a real device are the compile gate's program tier
// (`scripts/entry-calls-page.ts`), which dispatches every compute entry of the examples.
//
// Verifies: Rule 11.11.

import { describe, expect, it } from 'vitest';
import { compile } from '../compiler/ts/compile.js';
import { packModule } from '../compiler/ts/pack.js';
import type { ConsoleEvent } from '../core/console.js';
import { createRuntime } from './runtime.js';

/** A device that records every object it creates and every command it is given. */
function fakeDevice(features: string[] = []) {
  const made: Record<string, number> = {};
  const count = (k: string): void => {
    made[k] = (made[k] ?? 0) + 1;
  };
  const layouts: object[] = [];
  const commands: string[] = [];
  let consoleWords: Uint32Array | undefined;
  const buffer = (d: { size: number; usage: number }) => {
    count('buffer');
    const bytes = new ArrayBuffer(d.size);
    return {
      size: d.size,
      usage: d.usage,
      bytes,
      async mapAsync() {
        if (consoleWords !== undefined && d.usage & 0x1)
          new Uint32Array(bytes).set(consoleWords.subarray(0, d.size / 4));
      },
      getMappedRange: () => bytes,
      unmap() {},
      destroy() {},
    };
  };
  const pass = {
    setPipeline: () => commands.push('setPipeline'),
    setBindGroup: (i: number) => commands.push(`setBindGroup ${i}`),
    setVertexBuffer: () => commands.push('setVertexBuffer'),
    setIndexBuffer: () => commands.push('setIndexBuffer'),
    dispatchWorkgroups: (x: number, y: number, z: number) =>
      commands.push(`dispatch ${x} ${y} ${z}`),
    draw: (n: number) => commands.push(`draw ${n}`),
    drawIndexed: (n: number) => commands.push(`drawIndexed ${n}`),
    end: () => commands.push('end'),
  };
  const device = {
    features: new Set(features),
    queue: {
      submit: () => commands.push('submit'),
      writeBuffer: () => {},
      writeTexture: () => {},
      onSubmittedWorkDone: async () => {},
    },
    createBuffer: buffer,
    createTexture: (d: { size: number[]; format: string }) => {
      count('texture');
      return {
        width: d.size[0],
        height: d.size[1],
        format: d.format,
        createView: () => ({}),
        destroy() {},
      };
    },
    createSampler: () => (count('sampler'), {}),
    createShaderModule: () => (count('shaderModule'), {}),
    createBindGroupLayout: (d: { entries: object[] }) => {
      count('bindGroupLayout');
      layouts.push(d);
      return { entries: d.entries };
    },
    createPipelineLayout: () => (count('pipelineLayout'), {}),
    createBindGroup: () => (count('bindGroup'), {}),
    createComputePipelineAsync: async () => (count('pipeline'), {}),
    createRenderPipelineAsync: async (d: object) => (count('pipeline'), { d }),
    createCommandEncoder: () => ({
      beginComputePass: () => pass,
      beginRenderPass: () => pass,
      copyBufferToBuffer: () => commands.push('copy'),
      copyTextureToBuffer: () => {},
      finish: () => ({}),
    }),
    pushErrorScope: () => {},
    popErrorScope: async () => null,
  };
  return {
    device,
    made,
    layouts,
    commands,
    setConsole: (w: Uint32Array) => {
      consoleWords = w;
    },
  };
}

const SCALE = `"use typeshade";
class Params { scale: f32; }
declare const params: uniform<Params>;
declare const xs: storage<array<f32>>;
declare const out: storage<array<f32>, "read_write">;
@compute([64])
export function main(@builtin("global_invocation_id") gid: vec3u) {
  const i = gid.x;
  if (i >= arrayLength(xs)) { return; }
  out[i] = xs[i] * params.scale;
  console.log("i", i);
}
`;

const DRAW = `"use typeshade";
class VsIn { @location(0) pos: vec2; }
class VsOut { @builtin("position") p: vec4; }
class Color { @location(0) c: vec4; }
declare const tint: uniform<vec4>;
@vertex
export function vs(v: VsIn): VsOut { return { p: vec4(v.pos, 0., 1.) }; }
@fragment
export function fs(v: VsOut): Color { return { c: tint }; }
`;

const manifest = (src: string, console = false) => {
  const r = compile(src);
  expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return packModule(r.module, { console });
};

describe('the program runtime (Rule 11.11)', () => {
  it('creates nothing per frame once the frames repeat', async () => {
    const fake = fakeDevice();
    const rt = await createRuntime({ device: fake.device });
    const pipeline = await rt.load(manifest(SCALE)).compute();
    const out = fake.device.createBuffer({ size: 400, usage: 0x80 });
    const xs = new Float32Array(100);
    const frame = async () => {
      const f = rt.frame();
      f.dispatch(pipeline, { params: { scale: 2 }, xs, out }, 2);
      await f.submit();
    };
    await frame();
    await frame();
    const after2 = { ...fake.made };
    for (let i = 0; i < 58; i++) await frame();
    expect(fake.made).toEqual(after2);
    expect(fake.made.pipeline).toBe(1);
    expect(fake.made.shaderModule).toBe(1);
  });

  it("lays out each binding the pipeline's entries reach, visible to the stages that reach it", async () => {
    const fake = fakeDevice();
    const rt = await createRuntime({ device: fake.device });
    await rt.load(manifest(DRAW)).render();
    expect(fake.layouts).toEqual([
      { entries: [{ binding: 0, visibility: 0x2, buffer: { type: 'uniform' } }] },
    ]);
    await rt.load(manifest(SCALE)).compute();
    expect(fake.layouts.at(-1)).toEqual({
      entries: [
        { binding: 0, visibility: 0x4, buffer: { type: 'uniform' } },
        { binding: 1, visibility: 0x4, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: 0x4, buffer: { type: 'storage' } },
      ],
    });
  });

  it('refuses by name, with the entry and its line', async () => {
    const fake = fakeDevice();
    const rt = await createRuntime({ device: fake.device });
    const program = rt.load(manifest(SCALE));
    const pipeline = await program.compute();
    const out = fake.device.createBuffer({ size: 16, usage: 0x80 });
    const xs = new Float32Array(4);
    expect(() =>
      rt.frame().dispatch(pipeline, { params: { scale: 1 }, xs, out, nope: 1 }, 1),
    ).toThrow(
      '"main" (typeshade-input.ts:6) reaches no binding "nope"; it binds "params", "xs", "out".',
    );
    expect(() => rt.frame().dispatch(pipeline, { params: { scale: 1 }, out }, 1)).toThrow(
      '"main" (typeshade-input.ts:6), binding "xs" (array<f32>) is not given.',
    );
    expect(() => rt.frame().dispatch(pipeline, { params: { scale: 'x' }, xs, out }, 1)).toThrow(
      /binding "params" \(struct:Params\): params\.scale/,
    );
    await expect(program.render()).rejects.toThrow('The program has no @vertex entry.');
    await expect(program.compute('other')).rejects.toThrow(
      'The program has no @compute entry "other"; its @compute entries are "main".',
    );
  });

  it('refuses a manifest of another schema, and a feature the device lacks', async () => {
    const fake = fakeDevice();
    const rt = await createRuntime({ device: fake.device });
    const m = manifest(SCALE);
    expect(() => rt.load({ ...m, schema: 2 } as unknown as typeof m)).toThrow(
      /This manifest is schema 2 \(written by typeshade .*\); this runtime \(typeshade .*\) reads schema 1\./,
    );
    expect(() => rt.load({ ...m, features: ['shader-f16'] })).toThrow(
      'The program needs the "shader-f16" feature, which this device lacks',
    );
  });

  it("checks a target's format against the output it holds", async () => {
    const fake = fakeDevice();
    const rt = await createRuntime({ device: fake.device });
    await expect(rt.load(manifest(DRAW)).render({ targets: ['rgba32uint'] })).rejects.toThrow(
      '"fs" (typeshade-input.ts:8) writes vec4<f32> at @location(0), which a rgba32uint target cannot hold',
    );
  });

  it("records the console and hands the decoded events to the host's sink", async () => {
    const fake = fakeDevice();
    const events: ConsoleEvent[] = [];
    const rt = await createRuntime({ device: fake.device, console: (e) => events.push(e) });
    const m = manifest(SCALE, true);
    const program = rt.load(m);
    expect(program.recording).toBe(true);
    const pipeline = await program.compute();
    // The buffer the GPU would write: one entry, site 0, invocation [3, 0, 0], the value 3.
    const log = m.console!.log;
    const words = new Uint32Array(64);
    words[0] = 5;
    words.set([0, 3, 0, 0, 3], 2);
    fake.setConsole(words);
    const out = fake.device.createBuffer({ size: 16, usage: 0x80 });
    const f = rt.frame();
    f.dispatch(pipeline, { params: { scale: 1 }, xs: new Float32Array(4), out }, 1);
    await f.submit();
    expect(log.sites.length).toBe(1);
    expect(events).toEqual([
      expect.objectContaining({ method: 'log', args: ['i', 3], invocation: [3, 0, 0] }),
    ]);
    expect(fake.commands).toContain('copy');
  });

  it('draws a mesh from a typed array, in a pass of the frame', async () => {
    const fake = fakeDevice();
    const rt = await createRuntime({ device: fake.device });
    const pipeline = await rt.load(manifest(DRAW)).render();
    const target = rt.texture({ size: [4, 4], format: 'rgba8unorm' });
    const f = rt.frame();
    f.pass({ color: [target] }, (p) =>
      p.draw(pipeline, { tint: [1, 0, 0, 1] }, { vertices: new Float32Array(6), count: 3 }),
    );
    await f.submit();
    expect(fake.commands.filter((c) => c !== 'submit')).toEqual([
      'setPipeline',
      'setBindGroup 0',
      'setVertexBuffer',
      'draw 3',
      'end',
    ]);
  });
});
