// The program runtime (change 0025 step 2, Rule 11.11) against a recording fake device: what
// it creates and when, its bind-group layouts, its refusals and their sentences, and the
// console's events. Its results on a real device are the compile gate's program tier
// (`scripts/entry-calls-page.ts`), which dispatches every compute entry of the examples. Step 3's
// tests hold the call layer and the runtime to one device and one `Resident` (Rule 11.8). Change
// 0028's override values are held here to what each stage is created with, each refusal and the
// pipeline cache's key, and on a real device by `journeys/overrides`; its texture sample types to
// the layout each texture is given, and on a real device by `journeys/textures`.
//
// Verifies: Rule 11.8, Rule 11.11.

import { describe, expect, it } from 'vitest';
import { compile } from '../compiler/ts/compile.js';
import { packModule } from '../compiler/ts/pack.js';
import type { ConsoleEvent } from '../core/console.js';
import { configure, resident, residentState } from '../core/resident.js';
import { DEVICE_VIEW, gpuDevice, imageOf } from '../core/host-entry.js';
import { createRuntime, runtime } from './runtime.js';
import { repack } from '../emit.js';

/** What a pipeline is created with: the stages carry the `constants` the runtime hands WebGPU. */
interface PipelineDescriptor {
  readonly vertex?: { readonly constants?: Record<string, number> };
  readonly fragment?: { readonly constants?: Record<string, number> };
  readonly compute?: { readonly constants?: Record<string, number> };
}

/** A device that records every object it creates and every command it is given. */
function fakeDevice(features: string[] = []) {
  const made: Record<string, number> = {};
  const count = (k: string): void => {
    made[k] = (made[k] ?? 0) + 1;
  };
  const layouts: object[] = [];
  const groups: { entries: { binding: number; resource: { size?: number } }[] }[] = [];
  const commands: string[] = [];
  const pipelines: { kind: 'compute' | 'render'; descriptor: PipelineDescriptor }[] = [];
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
    createShaderModule: () => (count('shaderModule'), {}),
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
    groups,
    commands,
    pipelines,
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
