// The program runtime (change 0025 step 2, Rule 11.11) against a recording fake device: what
// it creates and when, its bind-group layouts, its refusals and their sentences, and the
// console's events. Its results on a real device are the compile gate's program tier
// (`scripts/entry-calls-page.ts`), which dispatches every compute entry of the examples. Step 3's
// tests hold the call layer and the runtime to one device and one `Resident` (Rule 11.8).
//
// Verifies: Rule 11.8, Rule 11.11.

import { describe, expect, it } from 'vitest';
import { compile } from '../compiler/ts/compile.js';
import { packModule } from '../compiler/ts/pack.js';
import type { ConsoleEvent } from '../core/console.js';
import { configure, resident, residentState } from '../core/resident.js';
import { DEVICE_VIEW, gpuDevice, imageOf } from '../core/host-entry.js';
import type { PackOptions } from '../core/manifest-types.js';
import { VERSION } from '../core/version.js';
import { repack } from '../emit.js';
import { createRuntime, runtime } from './runtime.js';

/** A device that records every object it creates and every command it is given. */
function fakeDevice(features: string[] = []) {
  const made: Record<string, number> = {};
  const count = (k: string): void => {
    made[k] = (made[k] ?? 0) + 1;
  };
  const layouts: object[] = [];
  const groups: { entries: { binding: number; resource: { size?: number } }[] }[] = [];
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
    groups,
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

const manifest = (src: string, console = false, ir = false) => {
  const r = compile(src);
  expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return packModule(r.module, { console, ir });
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

describe('the load-time emitter (change 0025 section 5, Rule 11.11)', () => {
  it('records a program its build did not, emitted again from its IR', async () => {
    const fake = fakeDevice();
    const events: ConsoleEvent[] = [];
    const asked: PackOptions[] = [];
    const rt = await createRuntime({
      device: fake.device,
      console: (e) => events.push(e),
      emit: (p, o) => (asked.push(o), repack(p, o)),
    });
    const built = manifest(SCALE, false, true);
    expect(built.console).toBeUndefined();
    // Loaded as it is, it records nothing and is not emitted again.
    expect(rt.load(built).recording).toBe(false);
    expect(asked).toEqual([]);
    const program = rt.load(built, { console: true });
    expect(program.recording).toBe(true);
    expect(asked).toEqual([{ console: true }]);
    // It runs as the build that recorded runs: the same buffer gives the same event.
    const pipeline = await program.compute();
    const words = new Uint32Array(64);
    words[0] = 5;
    words.set([0, 3, 0, 0, 3], 2);
    fake.setConsole(words);
    const out = fake.device.createBuffer({ size: 16, usage: 0x80 });
    const f = rt.frame();
    f.dispatch(pipeline, { params: { scale: 1 }, xs: new Float32Array(4), out }, 1);
    await f.submit();
    expect(events).toEqual([
      expect.objectContaining({ method: 'log', args: ['i', 3], invocation: [3, 0, 0] }),
    ]);
  });

  it('refuses with no emitter, with no IR, and with IR another version wrote', async () => {
    const fake = fakeDevice();
    const built = manifest(SCALE, false, true);
    const plain = await createRuntime({ device: fake.device });
    expect(() => plain.load(built, { console: true })).toThrow(
      'load({ console: true }): this manifest carries no recorded variant. Build it with packModule(m, { console: true }) or in vite dev, or build it with its IR (ir: true) and create the runtime with createRuntime({ emit: repack }), repack from typeshade/emit.',
    );
    const rt = await createRuntime({ device: fake.device, emit: repack });
    expect(() => rt.load(manifest(SCALE), { console: true })).toThrow(
      'load({ console: true }): this manifest carries no recorded variant and no IR to emit one from. Build it with packModule(m, { console: true }) or in vite dev, or with its IR: packModule(m, { ir: true }) or typeshade({ ir: true }).',
    );
    const other = { ...built, ir: { ...built.ir!, compiler: '0.0.0-other' } };
    expect(() => rt.load(other, { console: true })).toThrow(
      `This program's IR was written by typeshade 0.0.0-other, and this is typeshade ${VERSION}: only the version that wrote it reads it. Build the program again with typeshade ${VERSION}; its emitted text still loads as it is.`,
    );
    // A load that needs no new emit reads the emitted text, whoever wrote the IR.
    expect(rt.load(other).recording).toBe(false);
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
