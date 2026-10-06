// The program runtime (change 0025 step 2, Rule 11.11) against a recording fake device: what
// it creates and when, its bind-group layouts, its refusals and their sentences, and the
// console's events. Its results on a real device are the compile gate's program tier
// (`scripts/entry-calls-page.ts`), which dispatches every compute entry of the examples and draws
// its render case (`scripts/render-case.ts`: indexed draws, a depth state, a load op and vertex
// pulling, each frame held to a picture), which this recording device sees only as command names.
// Step 3's tests hold the call layer and the runtime to one device and one `Resident`
// (Rule 11.8). Change
// 0028's override values are held here to what each stage is created with, each refusal and the
// pipeline cache's key, and on a real device by `journeys/overrides`; its texture sample types to
// the layout each texture is given, and on a real device by `journeys/textures`; its console
// counts to what `submit()` resolves to and to what a runtime given a sink prints, and on a real
// device by the journeys' harness, which reads them from `submit()`; its program packed under emit
// options to the text a shader module is made from and the layout it is given, and on a real
// device by `journeys/emit-options`; its texture reads to the bytes a copy is asked for and the
// numbers each format decodes to, and to the order the queue runs a read and a frame in, and on a
// real device by `journeys/hdr-target`.
//
// Verifies: Rule 11.8, Rule 11.11.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { compile } from '../compiler/ts/compile.js';
import { packModule } from '../compiler/ts/pack.js';
import type { ConsoleEvent } from '../core/console.js';
import { configure, resident, residentState } from '../core/resident.js';
import { DEVICE_VIEW, gpuDevice, imageOf } from '../core/host-entry.js';
import { createRuntime, runtime, type Frame, type Runtime } from './runtime.js';
import type { Texture } from './resources.js';
import { repack } from '../emit.js';

/** What a pipeline is created with: the stages carry the `constants` the runtime hands WebGPU. */
interface PipelineDescriptor {
  readonly vertex?: { readonly constants?: Record<string, number> };
  readonly fragment?: { readonly constants?: Record<string, number> };
  readonly compute?: { readonly constants?: Record<string, number> };
}

/** A command encoder of the recording device: what the queue does once it is given the encoder's
 *  command buffer, in the order the queue is given them. */
interface FakeEncoder {
  readonly effects: (() => void)[];
}

/** A device that records every object it creates and every command it is given. */
function fakeDevice(features: string[] = []) {
  const made: Record<string, number> = {};
  const count = (k: string): void => {
    made[k] = (made[k] ?? 0) + 1;
  };
  const layouts: object[] = [];
  const modules: string[] = [];
  const groups: { entries: { binding: number; resource: { size?: number } }[] }[] = [];
  const commands: string[] = [];
  const pipelines: { kind: 'compute' | 'render'; descriptor: PipelineDescriptor }[] = [];
  // The command buffers the queue was given, by the encoder that made each, in order. The queue
  // runs an encoder's effects when it is given the buffer, as the GPU runs the commands in the
  // order they were submitted, and not when they were recorded.
  const submitted: FakeEncoder[] = [];
  // What the texture holds: the texels' bytes, tightly packed, which a copy back takes at the
  // moment the queue runs it. A copy is what `read()` and `readFloats()` submit.
  let texels: Uint8Array = new Uint8Array(0);
  const copies: { aspect?: string; bytesPerRow: number; size: readonly number[] }[] = [];
  // What the GPU wrote into the console buffers: the n-th one copied back since `setConsole` reads
  // the n-th of the words, and the last of them when there are fewer.
  let consoleWords: readonly Uint32Array[] = [];
  let copied = 0;
  const buffer = (d: { size: number; usage: number }) => {
    count('buffer');
    const bytes = new ArrayBuffer(d.size);
    const b = {
      size: d.size,
      usage: d.usage,
      bytes,
      words: undefined as Uint32Array | undefined,
      async mapAsync() {
        if (b.words !== undefined && d.usage & 0x1)
          new Uint32Array(bytes).set(b.words.subarray(0, d.size / 4));
      },
      getMappedRange: () => bytes,
      unmap() {},
      destroy() {},
    };
    return b;
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
      submit: (buffers: readonly { encoder?: FakeEncoder }[] = []) => {
        commands.push('submit');
        for (const { encoder } of buffers) {
          if (encoder === undefined) continue;
          submitted.push(encoder);
          for (const run of encoder.effects) run();
        }
      },
      writeBuffer: () => {
        count('writeBuffer');
      },
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
    createShaderModule: (d: { code: string }) => (count('shaderModule'), modules.push(d.code), {}),
    createBindGroupLayout: (d: { entries: object[] }) => {
      count('bindGroupLayout');
      layouts.push(d);
      return { entries: d.entries };
    },
    createPipelineLayout: () => (count('pipelineLayout'), {}),
    createBindGroup: (d: (typeof groups)[number]) => (count('bindGroup'), groups.push(d), {}),
    createComputePipelineAsync: async (d: PipelineDescriptor) => (
      count('pipeline'),
      pipelines.push({ kind: 'compute', descriptor: d }),
      {}
    ),
    createRenderPipelineAsync: async (d: PipelineDescriptor) => (
      count('pipeline'),
      pipelines.push({ kind: 'render', descriptor: d }),
      { d }
    ),
    createCommandEncoder: () => {
      const encoder = {
        effects: [] as (() => void)[],
        beginComputePass: () => pass,
        beginRenderPass: () => pass,
        copyBufferToBuffer: (_from: object, _at: number, to: { words?: Uint32Array }) => {
          commands.push('copy');
          to.words = consoleWords[Math.min(copied++, consoleWords.length - 1)];
        },
        copyTextureToBuffer: (
          source: { aspect?: string },
          to: { buffer: { bytes: ArrayBuffer }; bytesPerRow: number },
          size: readonly number[],
        ) => {
          copies.push({
            ...(source.aspect !== undefined ? { aspect: source.aspect } : {}),
            bytesPerRow: to.bytesPerRow,
            size,
          });
          // Each row of the texture lands at a multiple of `bytesPerRow` in the buffer.
          encoder.effects.push(() => {
            const rows = size[1]!;
            const row = texels.length / rows;
            for (let y = 0; y < rows; y++)
              new Uint8Array(to.buffer.bytes).set(
                texels.subarray(y * row, (y + 1) * row),
                y * to.bytesPerRow,
              );
          });
        },
        finish: () => ({ encoder }),
      };
      return encoder;
    },
    pushErrorScope: () => {},
    popErrorScope: async () => null,
  };
  return {
    device,
    made,
    layouts,
    modules,
    groups,
    commands,
    pipelines,
    submitted,
    copies,
    /** The bytes the texture holds from now on, until the next call. */
    setTexels: (bytes: ArrayLike<number>) => {
      texels = Uint8Array.from(bytes);
    },
    setConsole: (...w: Uint32Array[]) => {
      consoleWords = w;
      copied = 0;
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

/** A multisampled colour texture and its depth, loaded texel by texel, beside a texture a
 *  filtering sampler samples. */
const MSAA = `"use typeshade";
declare const msaa: texture_multisampled_2d<f32>;
declare const depthMs: texture_depth_multisampled_2d;
declare const photo: texture_2d<f32>;
declare const smp: sampler;
class Color { @location(0) c: vec4; }
@vertex
export function vs(@builtin("vertex_index") vi: u32): vec4 {
  return vec4(f32(vi), 0., 0., 1.);
}
@fragment
export function fs(@builtin("position") p: vec4): Color {
  const c: vec2i = vec2i(p.xy);
  return { c: textureLoad(msaa, c, 0) * textureLoad(depthMs, c, 0) + textureSample(photo, smp, p.xy) };
}
`;

/** A vertex entry and a fragment entry that logs the pixel's x: the console buffer is the fragment
 *  stage's alone. */
const PIXELS = `"use typeshade";
class VsOut { @builtin("position") p: vec4; }
class Color { @location(0) c: vec4; }
@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  return { p: vec4(f32(vi), 0., 0., 1.) };
}
@fragment
export function fs(v: VsOut): Color {
  console.log("at", v.p.x);
  return { c: vec4(1.) };
}
`;

/** A compute entry that makes two calls: a `console.log` and a `console.table`, which prints as
 *  two calls of the host's console and is one line. */
const TABLES = `"use typeshade";
declare const out: storage<array<f32>, "read_write">;
@compute([64])
export function main(@builtin("global_invocation_id") gid: vec3u) {
  console.log("i", gid.x);
  console.table(vec2(1., 2.));
  out[gid.x] = 1.;
}
`;

/** One override of each type, read by a compute entry and by the stages of a render pair: the
 *  vertex entry reads `gain` alone, the fragment entry the other three. A stage is still created
 *  with every value the host gives, which WebGPU takes for any name the module declares
 *  (measured on Chromium 141, and held by `journeys/overrides`). */
const TUNED = `"use typeshade";
const gain: override<f32> = 0.5;
const rounds: override<i32> = 4;
const bins: override<u32> = 16;
const dim: override<bool> = false;
declare const xs: storage<array<f32>>;
declare const out: storage<array<f32>, "read_write">;
class VsOut { @builtin("position") p: vec4; }
class Color { @location(0) c: vec4; }
@compute([64])
export function main(@builtin("global_invocation_id") gid: vec3u) {
  const i = gid.x;
  if (i >= arrayLength(xs)) { return; }
  out[i] = xs[i] * gain;
}
@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  return { p: vec4(f32(vi) * gain, 0., 0., 1.) };
}
@fragment
export function fs(v: VsOut): Color {
  return { c: vec4(f32(rounds), f32(bins), dim ? 1. : 0., 1.) };
}
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
    const { writeBuffer: _w, ...after2 } = fake.made;
    for (let i = 0; i < 58; i++) await frame();
    const { writeBuffer: _w2, ...after60 } = fake.made;
    expect(after60).toEqual(after2);
    expect(fake.made.pipeline).toBe(1);
    expect(fake.made.shaderModule).toBe(1);
  });

  it('binds a storage array at the size of its data, which the pool rounds up (#367)', async () => {
    // WGSL's `arrayLength` is the bound size over the stride. The pool hands out a buffer
    // rounded to 16 bytes, and bound whole it made five `f32`s an array of 8.
    const fake = fakeDevice();
    const rt = await createRuntime({ device: fake.device });
    const pack = manifest(SCALE);
    const pipeline = await rt.load(pack).compute();
    const f = rt.frame();
    const values = { params: { scale: 2 }, xs: new Float32Array(5), out: new Float32Array(5) };
    f.dispatch(pipeline, values, 1);
    await f.submit();
    const size = (name: string) => {
      const b = pack.bindings.find((x) => x.name === name)!;
      return fake.groups.flatMap((g) => g.entries).find((x) => x.binding === b.binding)!.resource
        .size;
    };
    expect([size('xs'), size('out'), size('params')]).toEqual([20, 20, undefined]);
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

  it('lays out a multisampled f32 texture unfilterable-float, which WebGPU requires', async () => {
    const fake = fakeDevice();
    const rt = await createRuntime({ device: fake.device });
    await rt.load(manifest(MSAA)).render();
    const { entries } = fake.layouts.at(-1) as { entries: { texture?: object }[] };
    expect(entries.filter((e) => e.texture !== undefined)).toEqual([
      {
        binding: 0,
        visibility: 0x2,
        texture: { sampleType: 'unfilterable-float', viewDimension: '2d', multisampled: true },
      },
      {
        binding: 1,
        visibility: 0x2,
        texture: { sampleType: 'depth', viewDimension: '2d', multisampled: true },
      },
      {
        binding: 2,
        visibility: 0x2,
        texture: { sampleType: 'float', viewDimension: '2d', multisampled: false },
      },
    ]);
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

describe('override values by name (change 0028 item 1, Rule 11.11)', () => {
  const setup = async () => {
    const fake = fakeDevice();
    const rt = await createRuntime({ device: fake.device });
    const m = manifest(TUNED);
    return { fake, rt, m, program: rt.load(m) };
  };
  /** The refusal a call gives: a `TypeError`, with exactly this sentence. */
  const refused = async (call: Promise<unknown>, sentence: string): Promise<void> => {
    const err = await call.then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(TypeError);
    expect((err as Error).message).toBe(sentence);
  };
  const F32 = '3.4028234663852886e+38';

  it('creates the vertex, fragment and compute stages with the values, by the names the WGSL declares', async () => {
    const { fake, m, program } = await setup();
    // The manifest's names are the WGSL's (surface §15): one authority.
    expect(m.overrides.map((o) => [o.name, o.type])).toEqual([
      ['gain', 'f32'],
      ['rounds', 'i32'],
      ['bins', 'u32'],
      ['dim', 'bool'],
    ]);
    for (const o of m.overrides) expect(m.wgsl).toContain(`override ${o.name}: ${o.type} =`);
    const constants = { gain: 3, rounds: -2, bins: 8, dim: true };
    await program.render({ targets: ['bgra8unorm'], constants });
    await program.compute('main', { constants });
    const [render, compute] = fake.pipelines;
    // WebGPU's constants are numbers: a bool is 0 or 1.
    const values = { gain: 3, rounds: -2, bins: 8, dim: 1 };
    expect(render!.kind).toBe('render');
    expect(render!.descriptor.vertex!.constants).toEqual(values);
    expect(render!.descriptor.fragment!.constants).toEqual(values);
    expect(compute!.kind).toBe('compute');
    expect(compute!.descriptor.compute!.constants).toEqual(values);
    // A depth-only pipeline has no fragment stage to create with them.
    await program.render({ fragment: null, constants: { gain: 2 } });
    const depthOnly = fake.pipelines[2]!.descriptor;
    expect(depthOnly.vertex!.constants).toEqual({ gain: 2 });
    expect(depthOnly.fragment).toBeUndefined();
  });

  it('hands WebGPU only the values it is given, and none when it is given none', async () => {
    const { fake, program } = await setup();
    await program.render();
    await program.compute();
    // An empty record gives none either: the same pipelines, made once.
    await program.render({ constants: {} });
    await program.compute('main', { constants: {} });
    expect(fake.made.pipeline).toBe(2);
    for (const { descriptor } of fake.pipelines)
      for (const stage of [descriptor.vertex, descriptor.fragment, descriptor.compute])
        if (stage !== undefined) expect(stage).not.toHaveProperty('constants');
    // An override the record leaves out takes the default its declaration states, so WebGPU is
    // told the ones given and no more.
    await program.render({ constants: { bins: 8 } });
    await program.compute('main', { constants: { gain: 2 } });
    expect(fake.pipelines[2]!.descriptor.vertex!.constants).toEqual({ bins: 8 });
    expect(fake.pipelines[2]!.descriptor.fragment!.constants).toEqual({ bins: 8 });
    expect(fake.pipelines[3]!.descriptor.compute!.constants).toEqual({ gain: 2 });
  });

  it("refuses a name the manifest's overrides do not list, and names the overrides it has", async () => {
    const { fake, rt, program } = await setup();
    const has = '"gain" (f32), "rounds" (i32), "bins" (u32), "dim" (bool)';
    await refused(
      program.render({ constants: { gian: 3 } }),
      `The program has no override "gian"; its overrides are ${has}.`,
    );
    await refused(
      program.compute('main', { constants: { gian: 3 } }),
      `The program has no override "gian"; its overrides are ${has}.`,
    );
    // The name that is wrong is the one named, beside names that are right.
    await refused(
      program.render({ constants: { gain: 3, roundz: 1, bins: 8 } }),
      `The program has no override "roundz"; its overrides are ${has}.`,
    );
    await refused(
      rt.load(manifest(SCALE)).compute('main', { constants: { scale: 2 } }),
      'The program has no override "scale"; its overrides are none.',
    );
    await refused(
      program.compute('main', { constants: 3 as never }),
      'The constants are number 3, not an object of override names and values.',
    );
    await refused(
      program.render({ constants: [1] as never }),
      'The constants are an array of length 1, not an object of override names and values.',
    );
    // Refused where the host called, before any GPU object is made.
    expect(fake.made.pipeline).toBeUndefined();
  });

  const takes = {
    gain: `a finite number no larger than ${F32} in magnitude`,
    rounds: 'a whole number from -2147483648 to 2147483647',
    bins: 'a whole number from 0 to 4294967295',
    dim: 'a boolean or a finite number, where 0 is false',
  } as const;
  const wrong: readonly [name: keyof typeof takes, value: unknown, got: string][] = [
    ['gain', NaN, 'number NaN'],
    ['gain', Infinity, 'number Infinity'],
    ['gain', -Infinity, 'number -Infinity'],
    ['gain', 3.5e38, 'number 3.5e+38'],
    ['gain', '1', 'the string "1"'],
    ['gain', true, 'boolean true'],
    ['gain', null, 'null'],
    ['gain', undefined, 'undefined'],
    ['rounds', 1.5, 'number 1.5'],
    ['rounds', 2 ** 31, 'number 2147483648'],
    ['rounds', -(2 ** 31) - 1, 'number -2147483649'],
    ['rounds', 4294967295, 'number 4294967295'],
    ['rounds', NaN, 'number NaN'],
    ['rounds', '4', 'the string "4"'],
    ['rounds', false, 'boolean false'],
    ['bins', -1, 'number -1'],
    ['bins', 2 ** 32, 'number 4294967296'],
    ['bins', 0.5, 'number 0.5'],
    ['bins', Infinity, 'number Infinity'],
    ['bins', {}, 'an object'],
    ['dim', 'yes', 'the string "yes"'],
    ['dim', NaN, 'number NaN'],
    ['dim', Infinity, 'number Infinity'],
    ['dim', null, 'null'],
    ['dim', undefined, 'undefined'],
    ['dim', [true], 'an array of length 1'],
  ];

  for (const [name, value, got] of wrong)
    it(`refuses ${name} given ${got}, and says what its type takes`, async () => {
      const { fake, program } = await setup();
      const type = { gain: 'f32', rounds: 'i32', bins: 'u32', dim: 'bool' }[name];
      const sentence = `The override "${name}" (${type}) takes ${takes[name]}; got ${got}.`;
      await refused(program.render({ constants: { [name]: value } as never }), sentence);
      await refused(program.compute('main', { constants: { [name]: value } as never }), sentence);
      expect(fake.made.pipeline).toBeUndefined();
    });

  it('takes what each type holds: an f32 up to its largest, an i32 and a u32 to the ends of their range, a bool as a boolean or a number', async () => {
    const { fake, rt, m } = await setup();
    // A program of its own for each call, so the cache never answers in place of the device.
    const held = async (constants: Record<string, number | boolean>) => {
      const before = fake.pipelines.length;
      await rt.load(m).compute('main', { constants });
      expect(fake.pipelines.length).toBe(before + 1);
      return fake.pipelines.at(-1)!.descriptor.compute!.constants!;
    };
    expect(
      await held({ gain: 3.4028234663852886e38, rounds: -(2 ** 31), bins: 2 ** 32 - 1 }),
    ).toEqual({
      gain: 3.4028234663852886e38,
      rounds: -2147483648,
      bins: 4294967295,
    });
    expect(await held({ gain: -3.4028234663852886e38, rounds: 2 ** 31 - 1, bins: 0 })).toEqual({
      gain: -3.4028234663852886e38,
      rounds: 2147483647,
      bins: 0,
    });
    expect(await held({ gain: 1e-50 })).toEqual({ gain: 1e-50 });
    // A bool given as a boolean is 1 or 0; given as a number it is false at 0 and true at any
    // other, as WebGPU's constants take it.
    for (const [given, given01] of [
      [true, 1],
      [false, 0],
      [0, 0],
      [-0, 0],
      [1, 1],
      [2, 1],
      [-1, 1],
      [0.5, 1],
    ] as const)
      expect(Object.is((await held({ dim: given })).dim, given01)).toBe(true);
    // An f32 keeps -0, and an integer has none.
    expect(Object.is((await held({ gain: -0 })).gain, -0)).toBe(true);
    expect(Object.is((await held({ rounds: -0 })).rounds, 0)).toBe(true);
  });

  it('keys the pipeline cache on the values: a change in one override makes another pipeline, the same values give one back', async () => {
    const { fake, program } = await setup();
    const a = await program.render({ constants: { gain: 3, rounds: 1 } });
    expect(fake.made.pipeline).toBe(1);
    // The same values, in another order: the same pipeline.
    expect(await program.render({ constants: { rounds: 1, gain: 3 } })).toBe(a);
    expect(fake.made.pipeline).toBe(1);
    // One override differs: a second pipeline, and each state keeps its own.
    const b = await program.render({ constants: { gain: 3, rounds: 2 } });
    expect(b).not.toBe(a);
    expect(fake.made.pipeline).toBe(2);
    expect(await program.render({ constants: { gain: 3, rounds: 2 } })).toBe(b);
    expect(await program.render({ constants: { gain: 3, rounds: 1 } })).toBe(a);
    // The states of one program that give none, or an empty record, are one pipeline.
    const bare = await program.render();
    expect(await program.render({ constants: {} })).toBe(bare);
    expect(bare).not.toBe(a);
    expect(fake.made.pipeline).toBe(3);
    // A bool is its value, whatever it is spelled as; an f32 tells -0 from 0; an integer cannot.
    const on = await program.render({ constants: { dim: true } });
    expect(await program.render({ constants: { dim: 1 } })).toBe(on);
    expect(await program.render({ constants: { dim: 7 } })).toBe(on);
    expect(await program.render({ constants: { dim: false } })).not.toBe(on);
    const zero = await program.render({ constants: { gain: 0 } });
    expect(await program.render({ constants: { gain: -0 } })).not.toBe(zero);
    const none = await program.render({ constants: { rounds: 0 } });
    expect(await program.render({ constants: { rounds: -0 } })).toBe(none);
    // The rest of the state counts as before.
    expect(
      await program.render({ constants: { gain: 3, rounds: 1 }, primitive: { cullMode: 'back' } }),
    ).not.toBe(a);
    const made = fake.made.pipeline;
    // A compute pipeline is keyed the same way, by its entry and its values.
    const c = await program.compute('main', { constants: { gain: 3 } });
    expect(await program.compute('main', { constants: { gain: 3 } })).toBe(c);
    expect(await program.compute('main', { constants: { gain: 4 } })).not.toBe(c);
    expect(await program.compute('main')).not.toBe(c);
    expect(await program.compute()).toBe(await program.compute('main'));
    expect(fake.made.pipeline).toBe(made! + 3);
  });

  it('is typed as a record of names to numbers and booleans', async () => {
    const { program } = await setup();
    await program.render({ constants: { gain: 1, dim: true } });
    await program.compute('main', { constants: { rounds: 2, dim: false } });
    // @ts-expect-error a string is no override's value
    await expect(program.render({ constants: { gain: '1' } })).rejects.toThrow(TypeError);
    // @ts-expect-error `constants` is a record, not a list
    await expect(program.compute('main', { constants: [1, 2] })).rejects.toThrow(TypeError);
  });
});

/** A texture of each kind of layout: `level` only loaded, `photo` read through `smp`, an integer
 *  texture of each sign, a multisampled one, a depth one read by comparison, and a compute entry
 *  that loads `level` as well. The fake device cannot tell whether WebGPU accepts a layout; the
 *  journey does. */
const TEXTURES = `"use typeshade";
declare const level: texture_2d<f32>;
declare const photo: texture_2d<f32>;
declare const ids: texture_2d<u32>;
declare const deltas: texture_2d<i32>;
declare const msaa: texture_multisampled_2d<f32>;
declare const shadow: texture_depth_2d;
declare const smp: sampler;
declare const cmp: sampler_comparison;
class Color { @location(0) c: vec4; }
@vertex
export function vs(@builtin("vertex_index") vi: u32): vec4 {
  return vec4(f32(vi), 0., 0., 1.);
}
@fragment
export function fs(@builtin("position") p: vec4): Color {
  const at = vec2i(p.xy);
  const held = f32(textureLoad(ids, at, 0).x) + f32(textureLoad(deltas, at, 0).x);
  const lit = textureSampleCompare(shadow, cmp, p.xy, 0.5);
  return { c: textureLoad(level, at, 0) + textureLoad(msaa, at, 0) + textureSample(photo, smp, p.xy) + vec4(held + lit) };
}
declare const sink: storage<array<f32>, "read_write">;
@compute([64])
export function probe(@builtin("global_invocation_id") gid: vec3u) {
  sink[gid.x] = textureLoad(level, vec2i(gid.xy), 0).x;
}
`;

describe("a texture's sample type (change 0028 item 2, Rule 11.11)", () => {
  /** The `sampleType` of each texture the last layout holds, by the name the source gives it. */
  const layoutOf = (fake: ReturnType<typeof fakeDevice>, m: ReturnType<typeof manifest>) => {
    const { entries } = fake.layouts.at(-1) as {
      entries: { binding: number; texture?: { sampleType: string } }[];
    };
    const name = (binding: number) => m.bindings.find((b) => b.binding === binding)!.name;
    return Object.fromEntries(
      entries
        .filter((e) => e.texture !== undefined)
        .map((e) => [name(e.binding), e.texture!.sampleType]),
    );
  };

  it('lays out a texture the program only loads unfilterable-float, and one a sampler reads float (#404)', async () => {
    const fake = fakeDevice();
    const rt = await createRuntime({ device: fake.device });
    const m = manifest(TEXTURES);
    await rt.load(m).render();
    // `level` is what stepinside's `r32float` inverse-depth texture is: read with textureLoad,
    // and WebGPU refuses an `r32float` view in a layout that says 'float'.
    expect(layoutOf(fake, m)).toEqual({
      level: 'unfilterable-float',
      photo: 'float',
      ids: 'uint',
      deltas: 'sint',
      msaa: 'unfilterable-float',
      shadow: 'depth',
    });
    // The sampler beside them is the filtering one `photo` needs, and the comparison one.
    const { entries } = fake.layouts.at(-1) as { entries: { sampler?: { type: string } }[] };
    expect(entries.flatMap((e) => (e.sampler === undefined ? [] : [e.sampler.type]))).toEqual([
      'filtering',
      'comparison',
    ]);
  });

  it('lays a compute entry out from the same sample type, whichever stage reads the texture', async () => {
    const fake = fakeDevice();
    const rt = await createRuntime({ device: fake.device });
    const m = manifest(TEXTURES);
    await rt.load(m).compute('probe');
    // The compute entry only loads `level`; `photo` is the fragment entry's, and is not here.
    expect(layoutOf(fake, m)).toEqual({ level: 'unfilterable-float' });
  });

  it("takes the sample type from the manifest and not from the texture's element", async () => {
    // Bindings a host builds by hand or edits are the manifest's: the runtime asks it.
    const fake = fakeDevice();
    const rt = await createRuntime({ device: fake.device });
    const m = manifest(TEXTURES);
    const edited = {
      ...m,
      bindings: m.bindings.map((b) =>
        b.name === 'photo' || b.name === 'level'
          ? {
              ...b,
              resource: {
                ...b.resource,
                sampleType:
                  b.name === 'photo' ? ('unfilterable-float' as const) : ('float' as const),
              },
            }
          : b,
      ),
    };
    await rt.load(edited).render();
    expect(layoutOf(fake, m)).toMatchObject({ photo: 'unfilterable-float', level: 'float' });
  });

  it('lays a texture of a manifest written before it out from its element, as it was', async () => {
    const fake = fakeDevice();
    const rt = await createRuntime({ device: fake.device });
    const m = manifest(TEXTURES);
    const old = {
      ...m,
      bindings: m.bindings.map((b) => {
        const { sampleType: _dropped, ...resource } = b.resource;
        return { ...b, resource };
      }),
    };
    expect(m.bindings.some((b) => b.resource.sampleType !== undefined)).toBe(true);
    await rt.load(old).render();
    expect(layoutOf(fake, m)).toEqual({
      level: 'float',
      photo: 'float',
      ids: 'uint',
      deltas: 'sint',
      msaa: 'unfilterable-float',
      shadow: 'depth',
    });
  });

  it('carries the sample type in the manifest as JSON, beside the rest of the resource', () => {
    const m = manifest(TEXTURES);
    const texture = (name: string) => m.bindings.find((b) => b.name === name)!.resource;
    expect(texture('level')).toMatchObject({
      resourceKind: 'texture',
      textureDim: '2d',
      textureElem: 'f32',
      sampleType: 'unfilterable-float',
    });
    expect(texture('shadow')).toMatchObject({ textureDepth: true, sampleType: 'depth' });
    expect(JSON.parse(JSON.stringify(m)).bindings).toEqual(m.bindings);
  });
});

/** Every call any method of the host's console received while `run` ran, which the test's own
 *  reporter never sees. */
async function printedBy(
  run: () => Promise<unknown>,
): Promise<{ method: string; args: unknown[] }[]> {
  const calls: { method: string; args: unknown[] }[] = [];
  const spies = (['log', 'info', 'debug', 'warn', 'error', 'table'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      calls.push({ method, args });
    }),
  );
  try {
    await run();
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
  return calls;
}

/** The words a console buffer holds once the GPU has written `calls` into it: the cursor, the
 *  count of calls it had no room for, then each call's words (its site, its invocation, its
 *  values). */
const written = (calls: readonly (readonly number[])[], dropped = 0): Uint32Array => {
  const words = calls.flat();
  return Uint32Array.of(words.length, dropped, ...words);
};
const bits = (x: number): number => new Uint32Array(Float32Array.of(x).buffer)[0]!;
/** What `SCALE`'s `console.log("i", i)` writes for the invocation `i`. */
const scaleCall = (i: number): number[] => [0, i, 0, 0, i];

describe("the console's counts (change 0028 item 3, Rule 11.11)", () => {
  type Sink = (e: ConsoleEvent) => void;
  /** A runtime on the fake device whose `console` option is `option`, which is left out when
   *  undefined, and a program of it that records. */
  const setup = async (option?: 'print' | Sink) => {
    const fake = fakeDevice();
    const rt = await createRuntime({
      device: fake.device,
      // Room for a few lines: the fake device writes what a test says the GPU wrote.
      consoleBytes: 256,
      ...(option !== undefined ? { console: option } : {}),
    });
    const scale = await rt.load(manifest(SCALE, true)).compute();
    /** The bindings of a dispatch of `SCALE`: each dispatch packs its own. */
    const bound = () => ({
      params: { scale: 1 },
      xs: new Float32Array(4),
      out: new Float32Array(4),
    });
    return { fake, rt, scale, bound };
  };
  const sinking = () => {
    const events: ConsoleEvent[] = [];
    return { events, sink: ((e) => void events.push(e)) as Sink };
  };

  it('resolves to a row for each dispatch that recorded: its entry, the lines it kept and the calls it dropped', async () => {
    const { events, sink } = sinking();
    const { fake, rt, scale, bound } = await setup(sink);
    // The first buffer kept two lines and the second one, which had no room for seven more.
    fake.setConsole(written([scaleCall(0), scaleCall(1)]), written([scaleCall(2)], 7));
    const f = rt.frame();
    f.dispatch(scale, bound(), 1);
    f.dispatch(scale, bound(), 1);
    const result = await f.submit();
    expect(result).toEqual({
      console: [
        { entry: 'main', lines: 2, dropped: 0 },
        { entry: 'main', lines: 1, dropped: 7 },
      ],
    });
    // `lines` is what the sink was handed, one for each call the entries made.
    expect(events.map((e) => e.args)).toEqual([
      ['i', 0],
      ['i', 1],
      ['i', 2],
    ]);
  });

  it("names a draw's fragment entry, and lists the rows in the order the dispatches and draws were recorded", async () => {
    const { events, sink } = sinking();
    const { fake, rt, scale, bound } = await setup(sink);
    const pixels = rt.load(manifest(PIXELS, true));
    expect(pixels.recording).toBe(true);
    const draw = await pixels.render();
    const target = rt.texture({ size: [4, 4], format: 'rgba8unorm' });
    fake.setConsole(
      written([scaleCall(0)]),
      written([[0, 2, 1, 0, bits(2.5)]], 1),
      written([scaleCall(1), scaleCall(2)]),
    );
    const f = rt.frame();
    f.dispatch(scale, bound(), 1);
    f.pass({ color: [target] }, (p) => p.draw(draw, {}, { count: 3 }));
    f.dispatch(scale, bound(), 1);
    expect((await f.submit()).console).toEqual([
      { entry: 'main', lines: 1, dropped: 0 },
      { entry: 'fs', lines: 1, dropped: 1 },
      { entry: 'main', lines: 2, dropped: 0 },
    ]);
    // A fragment's line is its pixel's.
    expect(events.map((e) => [e.args, e.invocation])).toEqual([
      [
        ['i', 0],
        [0, 0, 0],
      ],
      [
        ['at', 2.5],
        [2, 1, 0],
      ],
      [
        ['i', 1],
        [1, 0, 0],
      ],
      [
        ['i', 2],
        [2, 0, 0],
      ],
    ]);
  });

  it('resolves to the same counts when the host submits its own encoders', async () => {
    const { events, sink } = sinking();
    const { fake, rt, scale, bound } = await setup(sink);
    const encoder = fake.device.createCommandEncoder();
    scale.dispatch(encoder, bound(), 1);
    scale.dispatch(encoder, bound(), 1);
    // A dispatch whose entry made no call is a row all the same, with no lines.
    fake.setConsole(written([scaleCall(3)]), written([]));
    expect(await rt.submit(encoder)).toEqual({
      console: [
        { entry: 'main', lines: 1, dropped: 0 },
        { entry: 'main', lines: 0, dropped: 0 },
      ],
    });
    expect(events.map((e) => e.args)).toEqual([['i', 3]]);
  });

  it('gives each submit the rows of its own dispatches and draws', async () => {
    const { fake, rt, scale, bound } = await setup(sinking().sink);
    fake.setConsole(written([scaleCall(0)]));
    const first = rt.frame();
    first.dispatch(scale, bound(), 1);
    expect((await first.submit()).console).toEqual([{ entry: 'main', lines: 1, dropped: 0 }]);
    // The second submit does not carry the first's row.
    fake.setConsole(written([scaleCall(0), scaleCall(1), scaleCall(2)], 4));
    const second = rt.frame();
    second.dispatch(scale, bound(), 1);
    expect((await second.submit()).console).toEqual([{ entry: 'main', lines: 3, dropped: 4 }]);
    // Nothing recorded since: no rows.
    expect(await rt.frame().submit()).toEqual({ console: [] });
    expect(await rt.submit(fake.device.createCommandEncoder())).toEqual({ console: [] });
  });

  it('resolves to no rows for a program that does not record', async () => {
    const fake = fakeDevice();
    const rt = await createRuntime({ device: fake.device });
    const program = rt.load(manifest(SCALE));
    expect(program.recording).toBe(false);
    const scale = await program.compute();
    const f = rt.frame();
    f.dispatch(
      scale,
      { params: { scale: 1 }, xs: new Float32Array(4), out: new Float32Array(4) },
      1,
    );
    expect(await f.submit()).toEqual({ console: [] });
    expect(fake.commands).not.toContain('copy');
  });

  it('counts a console.table as one line, though it is printed as two calls', async () => {
    const fake = fakeDevice();
    const rt = await createRuntime({ device: fake.device, consoleBytes: 256 });
    const m = manifest(TABLES, true);
    const tables = await rt.load(m).compute();
    expect(m.console!.log.sites.map((site) => site.method)).toEqual(['log', 'table']);
    fake.setConsole(
      written([
        [0, 2, 0, 0, 2],
        [1, 2, 0, 0, bits(1), bits(2)],
      ]),
    );
    const f = rt.frame();
    f.dispatch(tables, { out: new Float32Array(4) }, 1);
    let result: Awaited<ReturnType<typeof f.submit>> | undefined;
    const printed = await printedBy(async () => {
      result = await f.submit();
    });
    expect(result).toEqual({ console: [{ entry: 'main', lines: 2, dropped: 0 }] });
    // The log line, then the table's prefix on a `log` and the table: three calls, two lines.
    expect(printed.map((c) => c.method)).toEqual(['log', 'log', 'table']);
    expect(printed[2]!.args).toEqual([[1, 2]]);
  });

  describe('a runtime given a sink', () => {
    it('prints nothing, the warning for the calls that did not fit included, and its host reads the count', async () => {
      const { events, sink } = sinking();
      const { fake, rt, scale, bound } = await setup(sink);
      fake.setConsole(written([scaleCall(0), scaleCall(1)], 5));
      const f = rt.frame();
      f.dispatch(scale, bound(), 1);
      let result: Awaited<ReturnType<typeof f.submit>> | undefined;
      const printed = await printedBy(async () => {
        result = await f.submit();
      });
      expect(printed).toEqual([]);
      expect(events).toHaveLength(2);
      expect(result).toEqual({ console: [{ entry: 'main', lines: 2, dropped: 5 }] });
      // The host's own encoders, the same.
      const encoder = fake.device.createCommandEncoder();
      scale.dispatch(encoder, bound(), 1);
      fake.setConsole(written([scaleCall(2)], 9));
      const again = await printedBy(async () => {
        result = await rt.submit(encoder);
      });
      expect(again).toEqual([]);
      expect(result).toEqual({ console: [{ entry: 'main', lines: 1, dropped: 9 }] });
    });
  });

  describe("a runtime that prints, which is 'print' and the default", () => {
    for (const [what, option] of [
      ['by default', undefined],
      ["given 'print'", 'print' as const],
    ] as const)
      it(`prints the lines and the warning as it did, and resolves to the counts, ${what}`, async () => {
        const { fake, rt, scale, bound } = await setup(option);
        fake.setConsole(written([scaleCall(0), scaleCall(1)], 5), written([], 2));
        const f = rt.frame();
        f.dispatch(scale, bound(), 1);
        f.dispatch(scale, bound(), 1);
        let result: Awaited<ReturnType<typeof f.submit>> | undefined;
        const printed = await printedBy(async () => {
          result = await f.submit();
        });
        expect(result).toEqual({
          console: [
            { entry: 'main', lines: 2, dropped: 5 },
            { entry: 'main', lines: 0, dropped: 2 },
          ],
        });
        // A line with its prefix and its arguments, and one warning for each buffer that dropped.
        expect(printed.map((c) => c.method)).toEqual(['log', 'log', 'warn', 'warn']);
        expect(printed.slice(0, 2).map((c) => c.args.slice(3))).toEqual([
          ['i', 0],
          ['i', 1],
        ]);
        expect(printed[2]!.args[0]).toContain(
          'main(): 5 console calls did not fit the console buffer.',
        );
        expect(printed[3]!.args[0]).toContain(
          'main(): 2 console calls did not fit the console buffer.',
        );
      });

    it('prints no warning for a buffer that dropped nothing', async () => {
      const { fake, rt, scale, bound } = await setup();
      fake.setConsole(written([scaleCall(0)]));
      const f = rt.frame();
      f.dispatch(scale, bound(), 1);
      const printed = await printedBy(() => f.submit());
      expect(printed.map((c) => c.method)).toEqual(['log']);
    });
  });

  it('is typed as a list of rows, each an entry and two counts', () => {
    type Rows = {
      readonly console: readonly {
        readonly entry: string;
        readonly lines: number;
        readonly dropped: number;
      }[];
    };
    expectTypeOf<Awaited<ReturnType<Frame['submit']>>>().toEqualTypeOf<Rows>();
    expectTypeOf<Awaited<ReturnType<Runtime['submit']>>>().toEqualTypeOf<Rows>();
    // The counts are read, not written.
    const write = (rows: Rows): void => {
      // @ts-expect-error a row's counts are readonly
      rows.console[0]!.lines = 0;
    };
    expect(write).toBeTypeOf('function');
  });
});

describe('one resource model with the call layer (change 0025 step 3, Rule 11.8)', () => {
  it('configure({ runtime }) puts the call layer and the default runtime on its device', async () => {
    const fake = fakeDevice();
    const rt = await createRuntime({ device: fake.device });
    configure({ runtime: rt });
    try {
      expect(await gpuDevice()).toBe(fake.device);
      expect(await runtime()).toBe(rt);
    } finally {
      configure({ runtime: null });
    }
    expect(() => configure({ runtime: {} as never })).toThrow(
      'configure(): runtime takes a runtime from createRuntime(), or null.',
    );
  });

  it('binds a Resident as one buffer, uploaded once and again after write()', async () => {
    const fake = fakeDevice();
    const rt = await createRuntime({ device: fake.device });
    const pipeline = await rt.load(manifest(DRAW)).render();
    const tint = resident([1, 0, 0, 1] as [number, number, number, number]);
    const target = rt.texture({ size: [4, 4], format: 'rgba8unorm' });
    const frame = async () => {
      const f = rt.frame();
      f.pass({ color: [target] }, (p) =>
        p.draw(pipeline, { tint }, { vertices: new Float32Array(6), count: 3 }),
      );
      await f.submit();
    };
    await frame();
    const buffers = fake.made.buffer;
    const writes = fake.made.writeBuffer;
    await frame();
    // The Resident's buffer is made once; the second frame writes only the vertices.
    expect(fake.made.buffer).toBe(buffers);
    expect(fake.made.writeBuffer! - writes!).toBe(1);
    tint.write([0, 1, 0, 1]);
    await frame();
    expect(fake.made.writeBuffer! - writes!).toBe(3);
    expect(await tint.read()).toEqual([0, 1, 0, 1]);
    tint.destroy();
    await expect(frame()).rejects.toThrow('This Resident was destroyed');
  });

  // A draw's vertex and index data from a Resident (change 0053, #391): uploaded once, bound as
  // it is after, and the same device buffer a binding of the handle uses.
  it("takes a Resident as a draw's indices and vertices, uploaded once and again after write()", async () => {
    const fake = fakeDevice();
    const rt = await createRuntime({ device: fake.device });
    const pipeline = await rt.load(manifest(DRAW)).render();
    const indices = resident(new Uint32Array([0, 1, 2]));
    const vertices = resident(new Float32Array(6));
    const target = rt.texture({ size: [4, 4], format: 'rgba8unorm' });
    const frame = async () => {
      const f = rt.frame();
      f.pass({ color: [target] }, (p) =>
        p.draw(pipeline, { tint: [1, 0, 0, 1] }, { vertices, indices, count: 3 }),
      );
      await f.submit();
    };
    await frame();
    expect(fake.commands).toContain('setIndexBuffer');
    expect(fake.commands).toContain('drawIndexed 3');
    const buffers = fake.made.buffer;
    const writes = fake.made.writeBuffer;
    await frame();
    // The second frame makes no buffer and writes only the plain uniform.
    expect(fake.made.buffer).toBe(buffers);
    expect(fake.made.writeBuffer! - writes!).toBe(1);
    indices.write(new Uint32Array([2, 1, 0]));
    await frame();
    expect(fake.made.writeBuffer! - writes!).toBe(3);
  });

  it('binds one device buffer for a Resident that is both the indices and a binding', async () => {
    const fake = fakeDevice();
    const rt = await createRuntime({ device: fake.device });
    const pipeline = await rt.load(manifest(DRAW)).render();
    const target = rt.texture({ size: [4, 4], format: 'rgba8unorm' });
    const made = async (tint: object, indices: object): Promise<number> => {
      const before = fake.made.buffer ?? 0;
      const f = rt.frame();
      f.pass({ color: [target] }, (p) =>
        p.draw(
          pipeline,
          { tint },
          { vertices: new Float32Array(6), indices: indices as Uint32Array, count: 3 },
        ),
      );
      await f.submit();
      return (fake.made.buffer ?? 0) - before;
    };
    // A first draw fills the runtime's pool, so the counts below are the Residents' alone.
    await made([1, 0, 0, 1], new Uint32Array([0, 1, 2]));
    const one = resident(new Uint32Array([0, 1, 2, 0]));
    const shared = await made(one, one);
    const two = await made(
      resident(new Uint32Array([0, 1, 2, 0])),
      resident(new Uint32Array([0, 1, 2, 0])),
    );
    expect(two - shared).toBe(1);
  });

  it("refuses a Resident the geometry's field does not take, naming the field", async () => {
    const fake = fakeDevice();
    const rt = await createRuntime({ device: fake.device });
    const pipeline = await rt.load(manifest(DRAW)).render();
    const target = rt.texture({ size: [4, 4], format: 'rgba8unorm' });
    const draw = (geometry: object) => {
      const f = rt.frame();
      f.pass({ color: [target] }, (p) =>
        p.draw(pipeline, { tint: [1, 0, 0, 1] }, geometry as { count: number }),
      );
    };
    expect(() =>
      draw({ vertices: new Float32Array(6), indices: resident(new Float32Array(3)), count: 3 }),
    ).toThrow(
      /the geometry's indices is a Resident of .*; indices take a Resident of a Uint32Array\.$/,
    );
    expect(() => draw({ vertices: resident([1, 2, 3]), count: 3 })).toThrow(
      /the geometry's vertices is a Resident of .*; vertices take a Resident of a Float32Array, an Int32Array or a Uint32Array\.$/,
    );
  });

  it('keeps the device copy the newer when a later use only reads it', () => {
    const fake = fakeDevice();
    const s = residentState(resident(new Float32Array(4)))!;
    const d = fake.device as unknown as Parameters<typeof s.bufferFor>[0];
    const layout = undefined as unknown as Parameters<typeof s.bufferFor>[1];
    const bytes = () => new ArrayBuffer(16);
    s.bufferFor(d, layout, bytes, false);
    expect(s.fresh).toBe('both');
    s.bufferFor(d, layout, bytes, true);
    expect(s.fresh).toBe('device');
    // A map writes it on the device, and the reduction after only reads it: read() must still
    // download what the map wrote.
    s.bufferFor(d, layout, bytes, false);
    expect(s.fresh).toBe('device');
  });

  it('holds any host value, and refuses what no binding holds', () => {
    expect(() => resident({ viewProj: new Array(16).fill(0), time: 0 })).not.toThrow();
    expect(() => resident(3)).not.toThrow();
    expect(() => resident(undefined)).toThrow(
      'resident(): takes a host value (a number, a tuple, a typed array, an array or an object), not a undefined.',
    );
    expect(() => resident(new Uint8Array(4))).toThrow('not a Uint8Array, which no binding holds');
    expect(() => resident([1]).write(null as never)).toThrow(
      'write(): takes a host value, not null.',
    );
  });

  it("hands the call layer a Texture's view, which it binds as it is", async () => {
    const fake = fakeDevice();
    const rt = await createRuntime({ device: fake.device });
    const t = rt.texture({ size: [8, 8], format: 'rgba8unorm' });
    expect(DEVICE_VIEW in t).toBe(true);
    const img = imageOf(t);
    expect(typeof img === 'object' && img.view !== undefined && img.width === 8).toBe(true);
  });
});

describe('the load-time emitter as the runtime plug-in (change 0025 step 6, Rule 11.11)', () => {
  it('records a program the build did not record, when the runtime has the emitter and the manifest its IR', async () => {
    const r = compile(SCALE);
    const built = packModule(r.module!, { ir: true });
    expect(built.console).toBeUndefined();
    const plain = await createRuntime({ device: fakeDevice().device });
    expect(() => plain.load(built, { console: true })).toThrow(
      'load({ console: true }): this manifest carries no recorded variant; build it with packModule(m, { console: true }) or in vite dev, or pass the load-time emitter, createRuntime({ emit: repack }), with a manifest that carries its IR.',
    );
    const rt = await createRuntime({ device: fakeDevice().device, emit: repack });
    const program = rt.load(built, { console: true });
    expect(program.recording).toBe(true);
    expect(program.manifest.console?.wgsl).toContain('_console');
    // Without the option, the program is loaded as the build wrote it.
    expect(rt.load(built).recording).toBe(false);
    expect(() => rt.load(packModule(r.module!), { console: true })).toThrow(
      'load({ console: true }): this manifest carries no recorded variant and no IR to emit one from; build it with packModule(m, { ir: true }) or typeshade({ ir: true }).',
    );
  });
});

/** A compute entry that computes in `f64`, which the WGSL holds as two `f32`s: the `'float'` flavor
 *  of that emulation reads the `_fp64` guard, a binding the manifest lists, and the `'integer'`
 *  flavor reads none. It logs, so the recorded variant has a `_console` buffer beside the guard. */
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

describe('a program packed under emit options (change 0028 item 4, Rule 11.11)', () => {
  const module = () => {
    const r = compile(DOUBLES);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    return r.module!;
  };
  /** The slots of the layout the last pipeline was made with, which a texture is the guard in. */
  const layout = (fake: ReturnType<typeof fakeDevice>) =>
    (fake.layouts.at(-1) as { entries: { binding: number; texture?: object }[] }).entries;

  it("makes its shader module from the manifest's text and lays it out by the manifest's bindings", async () => {
    const texts = new Set<string>();
    for (const fp64Flavor of ['float', 'integer'] as const) {
      const fake = fakeDevice();
      const rt = await createRuntime({ device: fake.device });
      const pack = packModule(module(), { emit: { level: 'O1', fp64Flavor } });
      const pipeline = await rt.load(pack).compute();
      texts.add(pack.wgsl);
      expect(fake.modules, fp64Flavor).toEqual([pack.wgsl]);
      // The flavor is the manifest's: its bindings say whether the guard is one, and the layout
      // follows them, a texture for the guard where there is one.
      expect(pack.bindings.map((b) => b.name)).toEqual(
        fp64Flavor === 'float' ? ['zoom', 'out', '_fp64'] : ['zoom', 'out'],
      );
      expect(
        layout(fake).map((e) => e.binding),
        fp64Flavor,
      ).toEqual(pack.bindings.map((b) => b.binding));
      expect(layout(fake).filter((e) => e.texture !== undefined)).toHaveLength(
        fp64Flavor === 'float' ? 1 : 0,
      );
      // The runtime binds the guard itself where the manifest lists one: the host gives the two
      // bindings the program declares.
      const f = rt.frame();
      f.dispatch(pipeline, { zoom: { cx: 1, scale: 2 }, out: new Float32Array(4) }, 1);
      await f.submit();
      expect(fake.groups.at(-1)!.entries.map((e) => e.binding)).toEqual(
        pack.bindings.map((b) => b.binding),
      );
    }
    // Two programs, which the runtime runs as the manifests give them.
    expect(texts.size).toBe(2);
  });

  it('emits the recorded variant a load-time emitter adds under the options the manifest records', async () => {
    const emit = { level: 'O0', fp64Flavor: 'integer' } as const;
    const built = packModule(module(), { ir: true, emit });
    expect(built.console).toBeUndefined();
    const fake = fakeDevice();
    const rt = await createRuntime({ device: fake.device, emit: repack });
    const program = rt.load(built, { console: true });
    await program.compute();
    // The variant the build would have written under those options, and not the defaults'.
    const direct = packModule(module(), { console: true, emit });
    expect(program.manifest.emit).toEqual(emit);
    expect(program.manifest.console?.wgsl).toBe(direct.console!.wgsl);
    expect(fake.modules).toEqual([direct.console!.wgsl]);
    expect(direct.console!.wgsl).not.toBe(packModule(module(), { console: true }).console!.wgsl);
    // Its layout is the variant's: the two bindings and the console buffer, no guard.
    expect(direct.console!.bindings.map((b) => b.name)).toEqual(['zoom', 'out', '_console']);
    expect(layout(fake).map((e) => e.binding)).toEqual(
      direct.console!.bindings.map((b) => b.binding),
    );
    expect(layout(fake).filter((e) => e.texture !== undefined)).toEqual([]);
  });
});

/** The bytes of one texel of each format `read()` copies, from the format table of the WebGPU
 *  specification: every uncompressed colour format, and `depth32float`. */
const TEXEL_BYTES: Readonly<Record<string, number>> = {
  r8unorm: 1,
  r8snorm: 1,
  r8uint: 1,
  r8sint: 1,
  r16unorm: 2,
  r16snorm: 2,
  r16uint: 2,
  r16sint: 2,
  r16float: 2,
  rg8unorm: 2,
  rg8snorm: 2,
  rg8uint: 2,
  rg8sint: 2,
  r32uint: 4,
  r32sint: 4,
  r32float: 4,
  rg16unorm: 4,
  rg16snorm: 4,
  rg16uint: 4,
  rg16sint: 4,
  rg16float: 4,
  rgba8unorm: 4,
  'rgba8unorm-srgb': 4,
  rgba8snorm: 4,
  rgba8uint: 4,
  rgba8sint: 4,
  bgra8unorm: 4,
  'bgra8unorm-srgb': 4,
  rgb9e5ufloat: 4,
  rgb10a2uint: 4,
  rgb10a2unorm: 4,
  rg11b10ufloat: 4,
  rg32uint: 8,
  rg32sint: 8,
  rg32float: 8,
  rgba16unorm: 8,
  rgba16snorm: 8,
  rgba16uint: 8,
  rgba16sint: 8,
  rgba16float: 8,
  rgba32uint: 16,
  rgba32sint: 16,
  rgba32float: 16,
  depth32float: 4,
};

/** Every format of `GPUTextureFormat`, read from the declaration `@webgpu/types` carries: the one
 *  authority for which formats exist (AGENTS.md#gate-discipline). */
const WEBGPU_FORMATS: readonly string[] = (() => {
  const types = readFileSync(
    fileURLToPath(new URL('../../node_modules/@webgpu/types/dist/index.d.ts', import.meta.url)),
    'utf8',
  );
  const union = /type GPUTextureFormat =([^;]*);/.exec(types)?.[1] ?? '';
  return [...union.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
})();

/** IEEE 754 binary16 as the standard states it, a sign, a 5-bit exponent and a 10-bit significand:
 *  the runtime's decode is written another way, and the two agree on every one of the 65536. */
function halfOf(h: number): number {
  const sign = h >> 15 === 1 ? -1 : 1;
  const exponent = (h >> 10) & 31;
  const fraction = h & 1023;
  if (exponent === 0) return sign * fraction * 2 ** -24;
  if (exponent === 31) return fraction === 0 ? sign * Infinity : NaN;
  return sign * (1024 + fraction) * 2 ** (exponent - 25);
}

/** The bytes of a list of numbers stored as `Array`, little-endian as WebGPU lays them out. */
const bytesOf = (
  Array:
    | typeof Uint8Array
    | typeof Int8Array
    | typeof Uint16Array
    | typeof Int16Array
    | typeof Uint32Array
    | typeof Float32Array,
  values: readonly number[],
): Uint8Array => new Uint8Array(Array.from(values).buffer);

describe("a texture's bytes and numbers (change 0028 item 5, Rule 11.11)", () => {
  /** A runtime on the recording device and a texture of `format`, `size` texels. */
  const setup = async (format: string, size: [number, number] = [3, 2]) => {
    const fake = fakeDevice();
    const rt = await createRuntime({ device: fake.device });
    return { fake, rt, texture: rt.texture({ size, format }) };
  };
  const refused = async (call: Promise<unknown>): Promise<string> => {
    const err = await call.then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(TypeError);
    return (err as Error).message;
  };
  /** The formats of `GPUTextureFormat` that `read()` copies: the uncompressed colour formats and
   *  `depth32float`; every other one is compressed, or a depth or stencil format it cannot copy. */
  const copyable = WEBGPU_FORMATS.filter(
    (f) =>
      (!/^(bc\d|etc2|eac|astc)/.test(f) && !/^(depth|stencil)/.test(f)) || f === 'depth32float',
  );

  it('knows the formats WebGPU has: the floor of a list read from the types, and the table this file states', () => {
    // The instrument: a parse that found nothing would make every loop below pass on nothing.
    expect(WEBGPU_FORMATS.length).toBeGreaterThan(100);
    expect(WEBGPU_FORMATS).toContain('rgba16float');
    expect(WEBGPU_FORMATS).toContain('astc-12x12-unorm-srgb');
    expect(copyable.length).toBe(44);
    // The bytes of a texel are stated here for exactly the formats `read()` copies.
    expect([...copyable].sort()).toEqual(Object.keys(TEXEL_BYTES).sort());
  });

  describe('read()', () => {
    for (const [format, texel] of Object.entries(TEXEL_BYTES))
      it(`copies a ${format} texture, ${texel} byte${texel > 1 ? 's' : ''} to a texel, rows tightly packed`, async () => {
        // A copy needs each row padded to a multiple of 256 bytes: a row of 3 texels is 48 bytes
        // at most and takes one stride, and a row of 17 texels of `rgba32float` is 272 and two.
        for (const width of [3, 17]) {
          const { fake, texture } = await setup(format, [width, 2]);
          const bytes = Uint8Array.from({ length: width * 2 * texel }, (_, i) => (i * 7 + 3) % 251);
          fake.setTexels(bytes);
          const got = await texture.read();
          expect(got).toBeInstanceOf(Uint8Array);
          expect([...got]).toEqual([...bytes]);
          const stride = Math.ceil((width * texel) / 256) * 256;
          expect(fake.copies).toEqual([
            {
              ...(format === 'depth32float' ? { aspect: 'depth-only' } : {}),
              bytesPerRow: stride,
              size: [width, 2, 1],
            },
          ]);
        }
      });

    it('refuses a compressed format and each depth and stencil format it cannot copy, naming what it copies', async () => {
      const refusedFormats = WEBGPU_FORMATS.filter((f) => !copyable.includes(f));
      // The BC, ETC2, EAC and ASTC formats, and stencil8, depth16unorm, depth24plus and the two
      // combined depth and stencil formats.
      expect(refusedFormats.length).toBe(WEBGPU_FORMATS.length - 44);
      expect(refusedFormats).toContain('bc1-rgba-unorm');
      expect(refusedFormats).toContain('depth24plus');
      for (const format of refusedFormats) {
        const { fake, texture } = await setup(format);
        expect(await refused(texture.read()), format).toBe(
          `read() cannot copy a ${format} texture back; it copies every uncompressed colour format and depth32float.`,
        );
        // Refused before anything reaches the queue.
        expect(fake.submitted, format).toEqual([]);
        expect(fake.copies, format).toEqual([]);
      }
    });

    it('reads the texture it was called on, as it was, whatever resize() does while the read is pending', async () => {
      const { fake, texture } = await setup('r8unorm', [3, 2]);
      fake.setTexels([1, 2, 3, 4, 5, 6]);
      const pending = texture.read();
      texture.resize(5, 4);
      expect([...(await pending)]).toEqual([1, 2, 3, 4, 5, 6]);
      expect(fake.copies).toEqual([{ bytesPerRow: 256, size: [3, 2, 1] }]);
      expect([texture.width, texture.height]).toEqual([5, 4]);
    });

    it('reads a texture the host made, in the layout of its format: a bgra8unorm texel is blue, green, red, alpha', async () => {
      const fake = fakeDevice();
      const rt = await createRuntime({ device: fake.device });
      const host = fake.device.createTexture({ size: [2, 1], format: 'bgra8unorm' });
      const texture = rt.texture(host);
      fake.setTexels([10, 20, 30, 255, 40, 50, 60, 128]);
      expect([...(await texture.read())]).toEqual([10, 20, 30, 255, 40, 50, 60, 128]);
      // The numbers are the bytes' in the same order, each over 255.
      const numbers = await texture.readFloats();
      expect([...numbers]).toEqual(
        [10, 20, 30, 255, 40, 50, 60, 128].map((v) => Math.fround(v / 255)),
      );
    });
  });

  describe('readFloats()', () => {
    /** Each format `readFloats()` decodes, named by the store its channels have: `u8` and `u16` are
     *  `unorm` (0 to 1), `s8` and `s16` are `snorm` (-1 to 1), `half` and `f32` are floats. */
    const STORES: readonly [format: string, channels: number, store: keyof typeof RAW][] = [
      ['r8unorm', 1, 'u8'],
      ['rg8unorm', 2, 'u8'],
      ['rgba8unorm', 4, 'u8'],
      ['rgba8unorm-srgb', 4, 'u8'],
      ['bgra8unorm', 4, 'u8'],
      ['bgra8unorm-srgb', 4, 'u8'],
      ['r8snorm', 1, 's8'],
      ['rg8snorm', 2, 's8'],
      ['rgba8snorm', 4, 's8'],
      ['r16unorm', 1, 'u16'],
      ['rg16unorm', 2, 'u16'],
      ['rgba16unorm', 4, 'u16'],
      ['r16snorm', 1, 's16'],
      ['rg16snorm', 2, 's16'],
      ['rgba16snorm', 4, 's16'],
      ['r16float', 1, 'half'],
      ['rg16float', 2, 'half'],
      ['rgba16float', 4, 'half'],
      ['r32float', 1, 'f32'],
      ['rg32float', 2, 'f32'],
      ['rgba32float', 4, 'f32'],
      ['depth32float', 1, 'f32'],
    ];
    /** The stored values of each store, its ends and the ones around them, and what a number of
     *  the store is: `unorm` over the largest value, `snorm` the same and never below -1. */
    const RAW = {
      u8: {
        values: [0, 1, 51, 127, 128, 254, 255],
        make: bytesOf.bind(null, Uint8Array),
        number: (v: number) => v / 255,
      },
      s8: {
        values: [-128, -127, -64, -1, 0, 1, 64, 127],
        make: bytesOf.bind(null, Int8Array),
        number: (v: number) => Math.max(v / 127, -1),
      },
      u16: {
        values: [0, 1, 257, 32767, 32768, 65534, 65535],
        make: bytesOf.bind(null, Uint16Array),
        number: (v: number) => v / 65535,
      },
      s16: {
        values: [-32768, -32767, -1, 0, 1, 16384, 32767],
        make: bytesOf.bind(null, Int16Array),
        number: (v: number) => Math.max(v / 32767, -1),
      },
      half: {
        values: [
          0x0000, 0x3c00, 0xc000, 0x3800, 0x7bff, 0x0001, 0x03ff, 0x0400, 0x8000, 0x7c00, 0xfc00,
          0x3555, 0x7e00,
        ],
        make: bytesOf.bind(null, Uint16Array),
        number: halfOf,
      },
      f32: {
        values: [0, 1, -1, 0.5, 3.5, 1e30, -0, Infinity, -Infinity, NaN, 1.17549435e-38, 2 ** -149],
        make: bytesOf.bind(null, Float32Array),
        number: (v: number) => v,
      },
    } as const;

    for (const [format, channels, store] of STORES)
      it(`decodes a ${format} texture: ${channels} number${channels > 1 ? 's' : ''} to a texel`, async () => {
        const [width, height] = [5, 2];
        const { fake, texture } = await setup(format, [width, height]);
        const { values, make, number } = RAW[store];
        const stored = Array.from(
          { length: width * height * channels },
          (_, i) => values[i % values.length]!,
        );
        fake.setTexels(make(stored));
        const got = await texture.readFloats();
        expect(got).toBeInstanceOf(Float32Array);
        expect(got.length).toBe(width * height * channels);
        const want = stored.map((v) => Math.fround(number(v)));
        // Object.is: -0 is not 0, and NaN is NaN.
        for (const [i, v] of got.entries())
          expect(Object.is(v, want[i]), `${format} number ${i}: ${v} for ${want[i]}`).toBe(true);
        // The copy is the one read() makes.
        expect(fake.copies).toEqual([
          {
            ...(format === 'depth32float' ? { aspect: 'depth-only' } : {}),
            bytesPerRow: 256,
            size: [width, height, 1],
          },
        ]);
      });

    it('decodes every half float: all 65536 bit patterns, each as the standard says', async () => {
      const { fake, texture } = await setup('r16float', [256, 256]);
      const patterns = Array.from({ length: 65536 }, (_, i) => i);
      fake.setTexels(bytesOf(Uint16Array, patterns));
      const got = await texture.readFloats();
      expect(got.length).toBe(65536);
      let wrong = 0;
      for (const h of patterns) if (!Object.is(got[h], Math.fround(halfOf(h)))) wrong++;
      expect(wrong).toBe(0);
      // A few of them by their value, not by the formula above.
      expect([
        got[0x3c00],
        got[0xc000],
        got[0x7bff],
        got[0x0400],
        got[0x0001],
        got[0x7c00],
      ]).toEqual([1, -2, 65504, 2 ** -14, 2 ** -24, Infinity]);
      expect(Object.is(got[0x8000], -0)).toBe(true);
      expect(Number.isNaN(got[0x7e00])).toBe(true);
    });

    it('gives a unorm channel 0 to 1 and an snorm one -1 to 1, the least snorm value clamped to -1', async () => {
      const { fake, texture } = await setup('rgba8snorm', [1, 1]);
      fake.setTexels(bytesOf(Int8Array, [-128, -127, 127, 0]));
      expect([...(await texture.readFloats())]).toEqual([-1, -1, 1, 0]);
      const u = await setup('rgba8unorm', [1, 1]);
      u.fake.setTexels([0, 255, 51, 102]);
      expect([...(await u.texture.readFloats())]).toEqual([
        0,
        1,
        Math.fround(0.2),
        Math.fround(0.4),
      ]);
    });

    it('gives an sRGB format the numbers it stores, not the linear values a shader reads', async () => {
      const { fake, texture } = await setup('rgba8unorm-srgb', [1, 1]);
      fake.setTexels([128, 128, 128, 128]);
      expect([...(await texture.readFloats())]).toEqual(Array(4).fill(Math.fround(128 / 255)));
    });

    it('decodes the packed formats: rgb10a2unorm, rg11b10ufloat and rgb9e5ufloat', async () => {
      const words = (...w: number[]) => bytesOf(Uint32Array, w);
      // rgb10a2unorm: red in bits 0 to 9, green 10 to 19, blue 20 to 29, alpha in the top two.
      const unorm = await setup('rgb10a2unorm', [2, 1]);
      unorm.fake.setTexels(
        words(1023 | (0 << 10) | (512 << 20) | (3 << 30), 1 | (1023 << 10) | (0 << 20) | (1 << 30)),
      );
      expect([...(await unorm.texture.readFloats())]).toEqual(
        [1, 0, 512 / 1023, 1, 1 / 1023, 1, 0, 1 / 3].map(Math.fround),
      );
      // rg11b10ufloat: red and green of 5 exponent bits and 6 of mantissa, blue of 5 and 5.
      const small = await setup('rg11b10ufloat', [3, 1]);
      const r11g11b10 = (r: number, g: number, b: number) => (r | (g << 11) | (b << 22)) >>> 0;
      small.fake.setTexels(
        words(
          r11g11b10(15 << 6, 14 << 6, 16 << 5), // 1, 0.5, 2
          r11g11b10((30 << 6) | 63, 31 << 6, (30 << 5) | 31), // the largest finite of red, infinity, the largest of blue
          r11g11b10(1, (31 << 6) | 1, 15 << 5), // the least subnormal, not a number, 1
        ),
      );
      const got = await small.texture.readFloats();
      expect([...got.slice(0, 9)].map((v, i) => (i === 7 ? Number.isNaN(v) : v))).toEqual([
        1,
        0.5,
        2,
        65024,
        Infinity,
        64512,
        2 ** -20,
        true,
        1,
      ]);
      expect(got.length).toBe(9);
      // rgb9e5ufloat: three 9-bit mantissas under a shared 5-bit exponent, over 2^24.
      const shared = await setup('rgb9e5ufloat', [3, 1]);
      const e5b9g9r9 = (r: number, g: number, b: number, e: number) =>
        (r | (g << 9) | (b << 18) | (e << 27)) >>> 0;
      shared.fake.setTexels(
        words(
          e5b9g9r9(256, 128, 511, 16), // 1, 0.5, 511/256
          e5b9g9r9(511, 511, 511, 31), // the format's largest, 65408
          e5b9g9r9(1, 0, 0, 0), // 2^-24
        ),
      );
      expect([...(await shared.texture.readFloats())]).toEqual([
        1,
        0.5,
        511 / 256,
        65408,
        65408,
        65408,
        2 ** -24,
        0,
        0,
      ]);
    });

    it('refuses an integer format with a TypeError that names read(), which copies its bytes, and copies nothing', async () => {
      const integers = copyable.filter((f) => /(uint|sint)$/.test(f));
      expect(integers.length).toBe(19);
      for (const format of integers) {
        const { fake, texture } = await setup(format);
        expect(await refused(texture.readFloats()), format).toBe(
          `readFloats() takes a float, unorm or snorm format and depth32float; a ${format} texture holds integers, which read() gives as bytes.`,
        );
        expect(fake.submitted, format).toEqual([]);
        // The bytes are what read() gives.
        fake.setTexels(Array(TEXEL_BYTES[format]! * 6).fill(1));
        expect((await texture.read()).length, format).toBe(TEXEL_BYTES[format]! * 6);
      }
    });

    it('refuses a format it cannot copy as read() does, in its own name', async () => {
      const { fake, texture } = await setup('depth24plus');
      expect(await refused(texture.readFloats())).toBe(
        'readFloats() cannot copy a depth24plus texture back; it copies every uncompressed colour format and depth32float.',
      );
      expect(fake.submitted).toEqual([]);
    });

    it('decodes every format it takes, and only those: the float, unorm and snorm ones, and depth32float', async () => {
      const decoded = new Set(STORES.map(([format]) => format));
      for (const format of ['rgb10a2unorm', 'rg11b10ufloat', 'rgb9e5ufloat']) decoded.add(format);
      const named = copyable.filter((f) => !/(uint|sint)$/.test(f));
      expect([...decoded].sort()).toEqual([...named].sort());
      expect(decoded.size).toBe(25);
    });
  });

  describe('what a read reads', () => {
    /** A texture that holds `before`, a frame recorded to draw `after` into it, and the runtime. */
    const scene = async () => {
      const { fake, rt, texture } = await setup('rgba8unorm', [2, 1]);
      const before = [1, 2, 3, 4, 5, 6, 7, 8];
      const after = [9, 10, 11, 12, 13, 14, 15, 16];
      fake.setTexels(before);
      const pipeline = await rt.load(manifest(DRAW)).render();
      const frame = rt.frame();
      frame.pass({ color: [texture] }, (p) =>
        p.draw(pipeline, { tint: [1, 0, 0, 1] }, { vertices: new Float32Array(6), count: 3 }),
      );
      // What the queue does when it runs the frame: the texture holds what the pass drew.
      (frame.encoder as FakeEncoder).effects.push(() => fake.setTexels(after));
      return { fake, rt, texture, frame, before, after };
    };

    it('runs a read started before a later frame is submitted before that frame, and one started after after it', async () => {
      const { fake, texture, frame, before, after } = await scene();
      // The frame is recorded, and not read: a recorded frame has not been submitted.
      const early = texture.read();
      const submitting = frame.submit();
      // `frame.submit()` has handed the queue the frame before it awaited, though its promise is
      // pending: a read started now is a read of the frame.
      const late = texture.read();
      // The frame runs after the early read's copy and before the late one's, whichever resolves first.
      expect([...(await late)]).toEqual(after);
      expect([...(await early)]).toEqual(before);
      await submitting;
      expect(fake.submitted).toHaveLength(3);
      expect(fake.submitted[1]).toBe(frame.encoder);
      expect(fake.submitted[0]).not.toBe(frame.encoder);
      expect(fake.submitted[2]).not.toBe(frame.encoder);
      // Each read's copy was the whole of its submit.
      expect(fake.copies).toHaveLength(2);
    });

    it('does the same for readFloats(), which copies at the call as read() does', async () => {
      const { fake, texture, frame, before, after } = await scene();
      const early = texture.readFloats();
      const submitting = frame.submit();
      const late = texture.readFloats();
      expect([...(await early)]).toEqual(before.map((v) => Math.fround(v / 255)));
      expect([...(await late)]).toEqual(after.map((v) => Math.fround(v / 255)));
      await submitting;
      expect(fake.submitted[1]).toBe(frame.encoder);
      expect(fake.submitted).toHaveLength(3);
    });

    it("does the same for the host's own encoders, which rt.submit() hands the queue before it awaits", async () => {
      const { fake, rt, texture, before, after } = await scene();
      const encoder = fake.device.createCommandEncoder();
      encoder.effects.push(() => fake.setTexels(after));
      const early = texture.read();
      const submitting = rt.submit(encoder);
      const late = texture.read();
      expect([...(await early)]).toEqual(before);
      expect([...(await late)]).toEqual(after);
      await submitting;
      expect(fake.submitted).toHaveLength(3);
      expect(fake.submitted[1]).toBe(encoder);
    });

    it('does not read what is recorded and not yet submitted, and a read made after sees it once the frame is submitted', async () => {
      const { fake, texture, frame, before, after } = await scene();
      expect([...(await texture.read())]).toEqual(before);
      expect(fake.submitted).toHaveLength(1);
      await frame.submit();
      expect([...(await texture.read())]).toEqual(after);
    });
  });

  it('is typed as bytes for read() and numbers for readFloats()', () => {
    expectTypeOf<Texture['read']>().toEqualTypeOf<() => Promise<Uint8Array>>();
    expectTypeOf<Texture['readFloats']>().toEqualTypeOf<() => Promise<Float32Array>>();
  });
});

describe('the WebGL2 tier of the program runtime (change 0054 decision 2, Rule 11.11)', () => {
  /** What a WebGL2 context is to the runtime: an object with its methods. The dispatches' runs
   *  on a real context are the user journeys' WebGL2 arm (`journeys/_harness.mjs`). */
  const fakeGl = () =>
    ({
      getParameter: () => 0,
      createTransformFeedback: () => ({}),
      getExtension: () => null,
      // What a runtime's drawing state makes when it first draws.
      createFramebuffer: () => ({}),
      createSampler: () => ({}),
      samplerParameteri: () => {},
    }) as unknown as WebGL2RenderingContext;

  it('takes the tier of the device it is given, and reports it', async () => {
    const gl = fakeGl();
    const onGl = await createRuntime({ device: gl });
    expect(onGl.tier).toBe('webgl2');
    expect(onGl.device).toBe(gl);
    const onGpu = await createRuntime({ device: fakeDevice().device });
    expect(onGpu.tier).toBe('webgpu');
    expectTypeOf(onGl.tier).toEqualTypeOf<'webgpu' | 'webgl2'>();
  });

  it('checks prefer, and names why each tier it tried is not here', async () => {
    await expect(createRuntime({ prefer: [] })).rejects.toThrow(
      'createRuntime(): prefer takes a non-empty list of tiers.',
    );
    await expect(createRuntime({ prefer: ['cpu' as never] })).rejects.toThrow(
      'createRuntime(): "cpu" is not a tier of the program runtime; its tiers are webgpu and webgl2.',
    );
    await expect(createRuntime({ prefer: ['webgl2', 'webgl2'] })).rejects.toThrow(
      'createRuntime(): prefer names a tier twice.',
    );
    // Node has neither.
    await expect(createRuntime()).rejects.toThrow(
      'createRuntime(): no tier it may use is here (webgpu: navigator.gpu is undefined; webgl2: the environment makes no WebGL2 context).',
    );
    await expect(createRuntime({ prefer: ['webgl2'] })).rejects.toThrow(
      'createRuntime(): no tier it may use is here (webgl2: the environment makes no WebGL2 context).',
    );
  });

  it('carries each compute entry’s pass program in the manifest, or why it has none', () => {
    const scale = manifest(SCALE);
    const program = scale.gl?.computes?.['main'];
    expect(program !== undefined && !('none' in program) && program.entry).toBe('main');
    // A 2D texture the pass program reads by its own name, with the sampler its calls pass it.
    const textured = manifest(`"use typeshade";
declare const photo: texture_2d<f32>;
declare const smp: sampler;
declare const out: storage<array<f32>, "read_write">;
@compute([1])
export function main(@builtin("global_invocation_id") gid: vec3u) {
  out[gid.x] = textureLoad(photo, vec2i(0), 0).x + textureSampleLevel(photo, smp, vec2f(0.5), 0.).y;
}
`);
    const sampled = textured.gl?.computes?.['main'];
    expect(sampled !== undefined && !('none' in sampled) && sampled.textures).toEqual([
      { name: 'photo', sampler: 'smp', sample: 'float' },
    ]);
    // A storage texture: the call layer's words (`host-face.ts`, `glTier`).
    const stored = manifest(`"use typeshade";
declare const img: texture_storage_2d<"r32float", "write">;
@compute([1])
export function main(@builtin("global_invocation_id") gid: vec3u) {
  textureStore(img, vec2i(i32(gid.x), 0), vec4f(1.));
}
`);
    expect(stored.gl?.computes?.['main']).toEqual({
      none: 'it reaches the texture_storage_2d<r32float, write> "img", which the WebGL2 tier does not bind yet',
    });
    // A module with no compute entry carries none.
    expect(manifest(DRAW).gl?.computes).toBeUndefined();
  });

  it('runs compute entries and draws, and refuses what WebGL2 has no form of', async () => {
    const rt = await createRuntime({ device: fakeGl() });
    const program = rt.load(manifest(TUNED));
    expect(program.recording).toBe(false);
    const pipeline = await program.compute('main');
    expect(pipeline.entry).toBe('main');
    const texture =
      (o: object): (() => unknown) =>
      () =>
        rt.texture(o as never);
    expect(texture({ size: [4, 4, 2], format: 'rgba8unorm' })).toThrow(
      'texture(): the WebGL2 tier makes 2D textures of one layer; an array or a 3D texture is not here yet.',
    );
    expect(texture({ size: [4, 4], format: 'rgba8unorm', sampleCount: 4 })).toThrow(
      'texture(): the WebGL2 tier has no multisampled texture: GLSL ES 3.00 cannot read one (sampler2DMS is ES 3.10).',
    );
    expect(texture({ size: [4, 4], format: 'rgba8unorm', storage: true })).toThrow(
      'texture(): the WebGL2 tier has no storage texture yet.',
    );
    expect(texture({ size: [4, 4], format: 'bc1-rgba-unorm' })).toThrow(
      'texture(): WebGL2 has no bc1-rgba-unorm texture.',
    );
    const f = rt.frame();
    expect(() => f.pass({ color: [{} as never] }, () => {})).toThrow(
      'pass(): a colour target on WebGL2 is a Texture of the runtime, or its context for the canvas; got an object.',
    );
    let raw: unknown;
    f.pass({}, (p) => {
      raw = (() => {
        try {
          return p.raw;
        } catch (e) {
          return (e as Error).message;
        }
      })();
    });
    expect(raw).toBe('A pass on WebGL2 has no GPURenderPassEncoder.');
    expect(() => f.encoder).toThrow('A frame on WebGL2 has no GPUCommandEncoder.');
    await expect(rt.submit({})).rejects.toThrow(
      'submit(...encoders): a WebGL2 runtime has no command encoders; submit a frame, rt.frame().submit().',
    );
    expect(() => rt.load(manifest(SCALE), { console: true })).toThrow(
      'load({ console: true }): the WebGL2 tier of the program runtime does not record console calls.',
    );
    await expect(program.render({ multisample: { count: 4 } })).rejects.toThrow(
      'The render pipeline of "fs" (typeshade-input.ts:20): the WebGL2 tier draws with one sample; a multisampled target is not here.',
    );
  });

  it('carries each vertex and fragment entry’s GLSL program in the manifest, or why it has none', () => {
    const drawn = manifest(DRAW);
    const vs = drawn.gl?.vertices?.['vs'];
    expect(vs !== undefined && 'vertex' in vs && vs.vertex.startsWith('#version 300 es')).toBe(
      true,
    );
    // GLSL ES 3.00 takes a uniform block of a struct, and the writer refuses any other.
    expect(drawn.gl?.draws?.['fs']).toEqual({
      none: "the GLSL backend refuses it: glsl-es300: uniform binding 'tint' must be a struct (a std140 UBO block)",
    });
    // Each entry's program is its own: a compute entry that writes storage, in the same module,
    // leaves the vertex and fragment entries theirs.
    const tuned = manifest(TUNED);
    for (const p of [tuned.gl?.vertices?.['vs'], tuned.gl?.draws?.['fs']])
      expect(p !== undefined && !('none' in p)).toBe(true);
    // Vertex pulling: a read-only storage array is a data texture the runtime uploads.
    const pulled = manifest(`"use typeshade";
declare const verts: storage<array<vec4>>;
@vertex
export function vs(@builtin("vertex_index") vi: u32): vec4 { return verts[vi]; }
@fragment
export function fs(@builtin("position") p: vec4): vec4 { return vec4(1.); }
`);
    const pv = pulled.gl?.vertices?.['vs'];
    expect(pv !== undefined && 'vertex' in pv && pv.data).toEqual(['verts']);
    // A storage array a fragment entry writes has no GLSL ES 3.00 form.
    const writes = manifest(`"use typeshade";
declare const hits: storage<array<u32>, "read_write">;
@vertex
export function vs(@builtin("vertex_index") vi: u32): vec4 { return vec4(0.); }
@fragment
export function fs(@builtin("position") p: vec4): vec4 { hits[0] = u32(1); return vec4(1.); }
`);
    expect(writes.gl?.draws?.['fs']).toEqual({
      none: 'it reaches the storage binding "hits", and GLSL ES 3.00 has no storage buffer',
    });
  });

  it('refuses what a dispatch on WebGPU refuses, when the dispatch is recorded', async () => {
    const rt = await createRuntime({ device: fakeGl() });
    const pipeline = await rt.load(manifest(TUNED)).compute('main');
    const f = rt.frame();
    const xs = new Float32Array(4);
    expect(() => f.dispatch(pipeline, { xs, out: new Float32Array(4), ys: 1 } as never, 1)).toThrow(
      '"main" (typeshade-input.ts:10) reaches no binding "ys"; it binds "xs", "out".',
    );
    expect(() => f.dispatch(pipeline, { xs } as never, 1)).toThrow(
      '"main" (typeshade-input.ts:10), binding "out" (array<f32>) is not given.',
    );
    expect(() => f.dispatch(pipeline, { xs, out: xs }, [1, 1, 1, 1])).toThrow(
      '"main" (typeshade-input.ts:10): workgroups is an array of length 4; give n or [x, y?, z?], whole numbers.',
    );
    const r = resident(new Float32Array(4));
    expect(() => f.dispatch(pipeline, { xs: r, out: r }, 1)).toThrow(
      '"main" (typeshade-input.ts:10), binding "out" (array<f32>) is the same resident array as binding "xs".',
    );
    expect(() => pipeline.dispatch({}, { xs, out: xs }, 1)).toThrow(
      'dispatch() on WebGL2 records into a frame of the runtime, rt.frame(); got an object.',
    );
    await f.submit();
    expect(() => f.dispatch(pipeline, { xs, out: xs }, 1)).toThrow(
      'This frame was submitted already; make a new one with rt.frame().',
    );
  });

  it('refuses an entry with no pass program, naming why', async () => {
    const rt = await createRuntime({ device: fakeGl() });
    const p = manifest(SCALE);
    const none = { ...p, gl: { computes: { main: { none: 'it reaches X' } } } };
    await expect(rt.load(none).compute('main')).rejects.toThrow(
      '"main" (typeshade-input.ts:6) has no WebGL2 program: it reaches X.',
    );
    const old = { ...p, gl: undefined };
    await expect(rt.load(old).compute('main')).rejects.toThrow(
      'The manifest carries no WebGL2 program for "main" (typeshade-input.ts:6); pack it again with this version of typeshade.',
    );
  });

  it('pins the overrides a pipeline names in its pass program, typed as each is declared', async () => {
    const rt = await createRuntime({ device: fakeGl() });
    const program = rt.load(manifest(TUNED));
    const tuned = (await program.compute('main', {
      constants: { gain: 2, rounds: 7, bins: 3, dim: true },
    })) as unknown as { gl: { vertex: string } };
    const head = tuned.gl.vertex.split('\n').slice(0, 5);
    expect(head).toEqual([
      '#version 300 es',
      '#define gain 2.0',
      '#define rounds 7',
      '#define bins 3u',
      '#define dim true',
    ]);
    // The same values give the same pipeline back; none gives the program as packed.
    expect(
      await program.compute('main', { constants: { dim: true, bins: 3, rounds: 7, gain: 2 } }),
    ).toBe(tuned);
    const plain = (await program.compute('main')) as unknown as { gl: { vertex: string } };
    expect(plain.gl.vertex.split('\n')[1]).not.toMatch(/^#define/);
  });

  it("moves a Resident's version when its host copy may have changed, and not otherwise", async () => {
    // A WebGL2 draw keeps the version it uploaded, and uploads again once the version moves.
    const r = resident(new Float32Array([1, 2]));
    const state = residentState(r)!;
    const before = state.version;
    state.fresh = 'both';
    state.fresh = 'device';
    expect(state.version).toBe(before);
    r.write(new Float32Array([3, 4]));
    expect(state.version).toBe(before + 1);
    await state.sync();
    expect(state.version).toBe(before + 2);
  });

  it('is not a runtime the call layer takes', async () => {
    const rt = await createRuntime({ device: fakeGl() });
    expect(() => configure({ runtime: rt })).toThrow(
      'configure(): runtime takes a WebGPU runtime; on WebGL2 the calls use a context of their own.',
    );
  });
});
