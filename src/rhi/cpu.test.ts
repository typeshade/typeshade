// The CPU backend of the render hardware interface (change 0120, milestone M3): the conformance
// suite's CPU leg, which needs no browser, and what the suite does not hold: its compute
// dispatches against the call layer's CPU tier (Rule 11.7), its refusals with their text, and a
// draw into a canvas.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { hostFace } from '../compiler/ts/host-face.js';
import { cpuProgramOf } from '../core/testing/cpu-program.js';
import { cpuDevice } from './cpu.js';
import type { CpuProgram } from './cpu-program.js';
import { CONFORMANCE, differences, runConformance } from './rhi-conformance.js';
import { STAGE, type RhiDevice } from './rhi.js';

/** The CPU device, whose `createShaderModule` takes a case's `"use typeshade"` source and builds
 *  its CPU program: the conformance suite imports no compiler. */
function compilingDevice(): RhiDevice {
  const device = cpuDevice();
  const built = new Map<string, CpuProgram>();
  return new Proxy(device, {
    get(target, key) {
      if (key === 'createShaderModule')
        return (code: string | CpuProgram) => {
          if (typeof code !== 'string') return target.createShaderModule(code);
          let p = built.get(code);
          if (p === undefined) built.set(code, (p = cpuProgramOf(code)));
          return target.createShaderModule(p);
        };
      const v = Reflect.get(target, key, target) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}

describe('the conformance suite on the CPU backend', () => {
  it('gives every answer, and refuses exactly the cases that name a refusal', async () => {
    const results = await runConformance(compilingDevice());
    expect(results.flatMap(differences)).toEqual([]);
    expect(results.filter((r) => r.skipped !== undefined).map((r) => r.name)).toEqual(
      CONFORMANCE.filter((c) => c.refusedOnCpu !== undefined).map((c) => c.name),
    );
    // The refusals: a texture binding (O6 (a)), a depth test, blending, a stencil test and a
    // topology other than a triangle list (item 4).
    expect(CONFORMANCE.filter((c) => c.refusedOnCpu !== undefined).map((c) => c.name)).toEqual([
      'a texture sampled nearest, its row 0 at the top',
      'a depth test: depth 0 to 1, less, written; the nearest of three triangles stays',
      'the blend constant: a target blended as the constant alone',
      'a stencil reference: written where a draw passes, then tested equal',
      'interpolation: flat on a triangle strip, from the first vertex of each triangle',
    ]);
  });

  it('fails a case whose answer is wrong (the instrument sees a difference)', async () => {
    const device = compilingDevice();
    const bumped = new Proxy(device, {
      get(target, key) {
        if (key === 'readTexture')
          return async (t: never, n: number) => {
            const out = (await target.readTexture(t, n)).slice();
            out[out.length - 1] = (out[out.length - 1]! + 1) & 0xff;
            return out;
          };
        const v = Reflect.get(target, key, target) as unknown;
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
    const results = await runConformance(bumped);
    const drawn = results.filter((r) => r.skipped === undefined && r.name.length > 0);
    // Every case that reads a texture back differs; the buffer and scope cases read none.
    const differing = drawn.filter((r) => differences(r).length > 0).map((r) => r.name);
    expect(differing.length).toBeGreaterThanOrEqual(12);
    expect(differing).toContain(
      'the fill rule: two triangles that share an edge through pixel centres cover each once',
    );
  });

  it('refuses a case it says it refuses only for that reason', async () => {
    // A case refused with another text is a failure, not a skip.
    const results = await runConformance(
      new Proxy(compilingDevice(), {
        get(target, key) {
          if (key === 'createRenderPipeline')
            return () => Promise.reject(new TypeError('something else'));
          const v = Reflect.get(target, key, target) as unknown;
          return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
        },
      }),
    );
    const depth = results.find((r) => r.name.startsWith('a depth test'))!;
    expect(depth.skipped).toBeUndefined();
    expect(differences(depth)).toEqual([`${depth.name}: no answer`]);
  });
});

// ─── compute against the call layer's CPU tier ────────────────────────────────────────────────

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** A compute entry that reaches every builtin, workgroup memory, a uniform, a struct array and
 *  an atomic: what a dispatch must run as the call layer's CPU tier runs it. */
const SCAN = `"use typeshade";
class Params {
  scale!: f32;
  bias!: i32;
}
class Cell {
  sum!: f32;
  at!: vec4u;
}
declare const params: uniform<Params>;
declare const src: storage<array<f32>>;
declare const cells: storage<array<Cell>, "read_write">;
declare const count: storage<array<atomic<u32>>, "read_write">;
let tile: workgroup<array<f32, 4>>;
export const scan = compute([4, 2, 1], function scan(
  gid: builtin<"global_invocation_id", vec3u>,
  lid: builtin<"local_invocation_id", vec3u>,
  li: builtin<"local_invocation_index", u32>,
  wid: builtin<"workgroup_id", vec3u>,
  nwg: builtin<"num_workgroups", vec3u>,
): void {
  const i = gid.y * u32(8) + gid.x;
  tile[lid.x] = tile[lid.x] + src[i] * params.scale;
  cells[i].sum = tile[lid.x] + f32(params.bias);
  cells[i].at = vec4u(li, wid.x, wid.y, nwg.x * u32(10) + nwg.y);
  atomicAdd(count[0], u32(1));
});
`;

/** The call layer's module for `source`, through the generated host module (Rule 11.7). */
async function hostModule(source: string, name: string): Promise<Record<string, unknown>> {
  const face = hostFace(source, {
    fileName: `/app/${name}.shade.ts`,
    runtime: join(import.meta.dirname, '../runtime-internal.ts'),
  });
  expect(face.diagnostics).toEqual([]);
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-rhi-cpu-'));
  dirs.push(dir);
  const file = join(dir, `${name}.mjs`);
  writeFileSync(file, face.code!);
  return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<string, unknown>;
}

describe('a dispatch on the CPU backend', () => {
  it('writes what the call layer CPU tier writes, word for word', async () => {
    const width = 8;
    const height = 4;
    const n = width * height;
    const src = Float32Array.from({ length: n }, (_, i) => Math.fround((i * 7) % 11) / 3 - 1);
    // The call layer: the module's entry called with host values. With no WebGPU and no WebGL2
    // in this environment, it runs on the CPU tier.
    const m = await hostModule(SCAN, 'scan');
    const cellsHost = Array.from({ length: n }, () => ({ sum: 0, at: [0, 0, 0, 0] }));
    const countHost = new Uint32Array(1);
    await (m.scan as (b: object, wg: readonly number[]) => Promise<void>)(
      { params: { scale: 1.5, bias: -2 }, src, cells: cellsHost, count: countHost },
      [width / 4, height / 2, 1],
    );

    // The CPU backend: the same entry, its buffers as bytes.
    const device = cpuDevice();
    const program = cpuProgramOf(SCAN);
    const layout = device.createBindGroupLayout([
      { binding: 0, visibility: STAGE.compute, buffer: { type: 'uniform' } },
      { binding: 1, visibility: STAGE.compute, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: STAGE.compute, buffer: { type: 'storage' } },
      { binding: 3, visibility: STAGE.compute, buffer: { type: 'storage' } },
    ]);
    expect(program.bindings.map((b) => [b.name, b.group, b.binding])).toEqual([
      ['params', 0, 0],
      ['src', 0, 1],
      ['cells', 0, 2],
      ['count', 0, 3],
    ]);
    const params = device.createBuffer({ size: 16, usage: ['uniform', 'copy-dst'] });
    const p = new DataView(new ArrayBuffer(16));
    p.setFloat32(0, 1.5, true);
    p.setInt32(4, -2, true);
    device.writeBuffer(params, 0, p);
    const srcBuffer = device.createBuffer({ size: 4 * n, usage: ['storage', 'copy-dst'] });
    device.writeBuffer(srcBuffer, 0, src);
    // A `Cell` is 32 bytes under std430: `sum` at 0, `at` at 16.
    const cells = device.createBuffer({ size: 32 * n, usage: ['storage', 'copy-src'] });
    const count = device.createBuffer({ size: 4, usage: ['storage', 'copy-src'] });
    const pipeline = await device.createComputePipeline({
      layouts: [layout],
      module: device.createShaderModule(program),
      entryPoint: 'scan',
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(
      0,
      device.createBindGroup(layout, [
        { binding: 0, resource: { buffer: params } },
        { binding: 1, resource: { buffer: srcBuffer } },
        { binding: 2, resource: { buffer: cells } },
        { binding: 3, resource: { buffer: count } },
      ]),
    );
    pass.dispatchWorkgroups(width / 4, height / 2);
    pass.end();
    const readCells = device.createBuffer({ size: 32 * n, usage: ['map-read', 'copy-dst'] });
    const readCount = device.createBuffer({ size: 4, usage: ['map-read', 'copy-dst'] });
    encoder.copyBufferToBuffer(cells, 0, readCells, 0, 32 * n);
    encoder.copyBufferToBuffer(count, 0, readCount, 0, 4);
    await device.submit([encoder]);
    const dv = new DataView(await device.readBuffer(readCells));
    const got = Array.from({ length: n }, (_, i) => ({
      sum: dv.getFloat32(32 * i, true),
      at: [0, 1, 2, 3].map((k) => dv.getUint32(32 * i + 16 + 4 * k, true)),
    }));
    expect(got).toEqual(cellsHost);
    expect(new Uint32Array(await device.readBuffer(readCount))[0]).toBe(countHost[0]);
    // The instrument: the dispatch wrote something, and something the workgroups share.
    expect(countHost[0]).toBe(n);
    expect(got.some((c) => c.sum !== 0)).toBe(true);
  });
});

// ─── refusals ────────────────────────────────────────────────────────────────────────────────

const FULL = `export const vs = vertex(function vs(i: builtin<"vertex_index", u32>): builtin<"position", vec4> {
  const p = vec2(f32((i << u32(1)) & u32(2)), f32(i & u32(2)));
  return vec4(p * 2. - vec2(1., 1.), 0., 1.);
});`;

/** A render pipeline description of `module`'s `vs` and `fs` into one `rgba8unorm` target. */
const pipelineDesc = (device: RhiDevice, program: CpuProgram, extra: object = {}) => ({
  label: 'the render pipeline of "vs" and "fs"',
  layouts: [device.createBindGroupLayout([])],
  module: device.createShaderModule(program),
  vertex: { entryPoint: 'vs', buffers: [] },
  fragment: { entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
  primitive: { topology: 'triangle-list', cullMode: 'none' as const, frontFace: 'ccw' as const },
  multisample: { count: 1, mask: 0xffffffff },
  ...extra,
});

describe('what the CPU backend refuses', () => {
  const plain = cpuProgramOf(`"use typeshade";
${FULL}
export const fs = fragment(function fs(): vec4 {
  return vec4(1., 0., 0., 1.);
});
`);

  it('refuses shader text, and a GPU backend refuses a CPU program', () => {
    expect(() => cpuDevice().createShaderModule('@vertex fn vs() {}')).toThrow(
      "The CPU backend runs a module's CPU program (change 0120, O2), not shader text; it got a string.",
    );
  });

  it('refuses a topology, a depth test, multisampling and blending, each by name', async () => {
    const device = cpuDevice();
    const at = 'The CPU backend cannot make the render pipeline of "vs" and "fs": ';
    const cases: [object, string][] = [
      [
        { primitive: { topology: 'line-list', cullMode: 'none', frontFace: 'ccw' } },
        'it draws a triangle-list, and the pipeline\'s topology is "line-list"',
      ],
      [
        {
          depthStencil: {
            format: 'depth24plus',
            compare: 'less',
            write: true,
            bias: { constant: 0, slopeScale: 0, clamp: 0 },
          },
        },
        'it draws with no depth or stencil test',
      ],
      [{ multisample: { count: 4, mask: 0xffffffff } }, 'it draws with no multisampling'],
      [
        {
          fragment: {
            entryPoint: 'fs',
            targets: [{ format: 'rgba8unorm', blend: { color: {}, alpha: {} } }],
          },
        },
        'it draws with no blending',
      ],
    ];
    for (const [extra, why] of cases)
      await expect(
        device.createRenderPipeline(pipelineDesc(device, plain, extra) as never),
      ).rejects.toThrow(`${at}${why} (change 0120, item 4).`);
    // The same description with none of them is made.
    await expect(
      device.createRenderPipeline(pipelineDesc(device, plain) as never),
    ).resolves.toBeDefined();
  });

  it('refuses an entry that reaches a texture or a derivative (O6 (a))', async () => {
    const device = cpuDevice();
    const sampled = cpuProgramOf(`"use typeshade";
declare const tex: texture_2d<f32>;
declare const smp: sampler;
${FULL}
export const fs = fragment(function fs(p: builtin<"position", vec4>): vec4 {
  return textureSample(tex, smp, p.xy);
});
`);
    await expect(
      device.createRenderPipeline(pipelineDesc(device, sampled) as never),
    ).rejects.toThrow(
      'The CPU backend cannot run "fs": it reaches the texture "tex", which the CPU tier cannot read (change 0120, O6 (a)).',
    );
    const derivative = cpuProgramOf(`"use typeshade";
${FULL}
export const fs = fragment(function fs(p: builtin<"position", vec4>): vec4 {
  return vec4(dpdx(p.x), 0., 0., 1.);
});
`);
    await expect(
      device.createRenderPipeline(pipelineDesc(device, derivative) as never),
    ).rejects.toThrow(
      'The CPU backend cannot run "fs": it reaches dpdx(), which only a GPU computes (change 0120, O6 (a)).',
    );
    expect(() =>
      device.createBindGroupLayout([
        {
          binding: 0,
          visibility: STAGE.fragment,
          label: 'tex',
          texture: { sampleType: 'float', viewDimension: '2d', multisampled: false },
        },
      ]),
    ).toThrow(
      'The CPU backend binds buffers only; binding 0 ("tex") is a texture or a sampler, which the CPU tier cannot read (change 0120, O6 (a)).',
    );
  });
});

// ─── a canvas ────────────────────────────────────────────────────────────────────────────────

describe('a pass into a canvas', () => {
  it("shows the frame on the canvas's 2d context with putImageData when the submit ends", async () => {
    const shown: { data: Uint8ClampedArray; x: number; y: number }[] = [];
    const context = {
      canvas: { width: 3, height: 2 },
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(4 * w * h) }),
      putImageData: (image: { data: Uint8ClampedArray }, x: number, y: number) =>
        shown.push({ data: image.data, x, y }),
    };
    const device = cpuDevice();
    const canvas = device.fromNative('canvas', context)!;
    expect(device.fromNative('canvas', context)).toBe(canvas);
    expect(device.toNative(canvas)).toBe(context);
    const program = cpuProgramOf(`"use typeshade";
${FULL}
export const fs = fragment(function fs(p: builtin<"position", vec4>): vec4 {
  return vec4(floor(p.x) / 255., floor(p.y) / 255., 0.2, 1.);
});
`);
    const pipeline = await device.createRenderPipeline(pipelineDesc(device, program) as never);
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: device.createView(device.currentTexture(canvas)),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: [0, 0, 0, 1],
        },
      ],
    });
    pass.setPipeline(pipeline);
    pass.draw(3);
    pass.end();
    expect(shown).toEqual([]);
    await device.submit([encoder]);
    expect(shown).toHaveLength(1);
    expect(shown[0]!.x).toBe(0);
    expect([...shown[0]!.data]).toEqual(
      [0, 1].flatMap((y) => [0, 1, 2].flatMap((x) => [x, y, 51, 255])),
    );
  });
});
