// The program runtime's CPU tier (change 0120, milestone M3): a program loaded from a manifest that
// carries its CPU program (O2 (a)), its dispatches and passes run on the CPU backend of the render
// hardware interface, and the refusal of a manifest that carries none.

import { describe, expect, it } from 'vitest';
import { compile } from '../compiler/ts/compile.js';
import { packModule } from '../compiler/ts/pack.js';
import type { Pack } from '../core/manifest-types.js';
import { cpuProgramOf } from '../core/testing/cpu-program.js';
import { CPU_PROGRAM } from '../rhi/cpu-program.js';
import type { RhiBuffer } from '../rhi/rhi.js';
import { cpuRuntime } from './cpu.js';
import { NO_CPU_PROGRAM, type RuntimeImpl } from './runtime.js';

/** `source`'s manifest with its CPU program under `CPU_PROGRAM`, as a module's default export
 *  carries it. */
function manifestWithCpu(source: string): Pack {
  const r = compile(source);
  expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  const pack = packModule(r.module);
  Object.defineProperty(pack, CPU_PROGRAM, { value: cpuProgramOf(source) });
  return pack;
}

const SCALE = `"use typeshade";
class Params {
  scale: f32;
}
declare const params: uniform<Params>;
declare const xs: storage<array<f32>>;
declare const out: storage<array<f32>, "read_write">;
@compute([4, 1, 1]) export function scale(g: builtin<"global_invocation_id", vec3u>): void {
  out[g.x] = xs[g.x] * params.scale + f32(g.x);
}
`;

const QUAD = `"use typeshade";
class Tint {
  c: vec4;
}
declare const tint: uniform<Tint>;
@vertex export function vs(q: location<0, vec2>): builtin<"position", vec4> {
  return vec4(q, 0., 1.);
}
@fragment export function fs(): vec4 {
  return tint.c;
}
`;

describe("the program runtime's CPU tier", () => {
  it('is the tier of a runtime on the CPU backend', () => {
    const rt = cpuRuntime();
    expect(rt.tier).toBe('cpu');
    expect(rt.info.tier).toBe('cpu');
    rt.destroy();
  });

  it('refuses a manifest that carries no CPU program: one from packModule(), or read from JSON', () => {
    const rt = cpuRuntime();
    const r = compile(SCALE);
    expect(() => rt.load(packModule(r.module))).toThrow(new TypeError(NO_CPU_PROGRAM));
    // The CPU program rides outside the JSON: a manifest that carries one loses it in a round trip.
    const carried = manifestWithCpu(SCALE);
    expect(() => rt.load(carried)).not.toThrow();
    expect(JSON.stringify(carried)).toBe(JSON.stringify(packModule(r.module)));
    expect(() => rt.load(JSON.parse(JSON.stringify(carried)) as Pack)).toThrow(
      new TypeError(NO_CPU_PROGRAM),
    );
    expect(NO_CPU_PROGRAM).toBe(
      "load(): the CPU tier runs a module's CPU program, which this manifest does not carry; a manifest read from JSON or made by packModule() has none. Load the default export of the module's host import (change 0120, O2 (a)).",
    );
  });

  it('runs a dispatch with the CPU code, and writes the storage buffer it binds', async () => {
    const rt = cpuRuntime() as unknown as RuntimeImpl;
    const pipeline = await rt.load(manifestWithCpu(SCALE)).compute('scale');
    // The CPU tier has no native device: the host buffer a test binds is the backend's own.
    const out = rt.rhi.createBuffer({ size: 32, usage: ['storage', 'copy-src'] });
    const xs = Float32Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
    const f = rt.frame();
    f.dispatch(pipeline, { params: { scale: 0.5 }, xs, out }, 2);
    await f.submit();
    const read = rt.rhi.createBuffer({ size: 32, usage: ['map-read', 'copy-dst'] });
    const encoder = rt.rhi.createCommandEncoder();
    encoder.copyBufferToBuffer(out as RhiBuffer, 0, read, 0, 32);
    await rt.rhi.submit([encoder]);
    expect([...new Float32Array(await rt.rhi.readBuffer(read))]).toEqual(
      [...xs].map((x, i) => x * 0.5 + i),
    );
    rt.destroy();
  });

  it('draws indexed vertices from a typed array into a texture, and reads it back', async () => {
    const rt = cpuRuntime();
    const pipeline = await rt.load(manifestWithCpu(QUAD)).render({
      targets: [{ format: 'rgba8unorm' }],
    });
    const target = rt.texture({ size: [4, 4], format: 'rgba8unorm' });
    // A quad over the left half of clip space, as two triangles of four indexed vertices.
    const vertices = new Float32Array([-1, -1, 0, -1, 0, 1, -1, 1]);
    const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
    const f = rt.frame();
    f.pass({ color: [{ target, clear: [0, 0, 0, 1] }] }, (p) =>
      p.draw(pipeline, { tint: { c: [1, 0.2, 0.6, 1] } }, { vertices, indices, count: 6 }),
    );
    await f.submit();
    const px = [...(await target.read())];
    const want: number[] = [];
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 4; x++) want.push(...(x < 2 ? [255, 51, 153, 255] : [0, 0, 0, 255]));
    expect(px).toEqual(want);
    rt.destroy();
  });

  it("draws into a canvas's 2d context and shows the frame when the frame is submitted", async () => {
    const shown: number[][] = [];
    const context = {
      canvas: { width: 2, height: 2 },
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(4 * w * h) }),
      putImageData: (image: { data: Uint8ClampedArray }) => shown.push([...image.data]),
    };
    const rt = cpuRuntime();
    const pipeline = await rt.load(manifestWithCpu(QUAD)).render({
      targets: [{ format: 'rgba8unorm' }],
    });
    const f = rt.frame();
    f.pass({ color: [{ target: context, clear: [0, 0, 0, 1] }] }, (p) =>
      p.draw(
        pipeline,
        { tint: { c: [0, 1, 0, 1] } },
        { vertices: new Float32Array([-1, -1, 3, -1, -1, 3]), count: 3 },
      ),
    );
    expect(shown).toEqual([]);
    await f.submit();
    expect(shown).toEqual([[0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255]]);
    rt.destroy();
  });
});
