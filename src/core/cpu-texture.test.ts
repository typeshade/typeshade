// Verifies: Rule 11.7 (docs/language-design.md; traced in reqs/).
//
// The CPU tier's texture memory (change 0077): each format's conversion on a store, the channels
// a load gives, and the edge, where a load reads the nearest texel inside and a store outside is
// dropped (surface §33).

import { describe, expect, it } from 'vitest';
import { CpuTexture, cpuFormatGap, cpuTextureCall } from './cpu-texture.js';
import { compileModule } from './oracle.js';
import { compileModuleJs } from './cpu-codegen.js';
import { compile } from '../compiler/ts/compile.js';

describe('a CPU texture', () => {
  it('rounds a unorm and an snorm store to the nearest step, and clamps it to the range', async () => {
    const u = new CpuTexture(4, 1, 'rgba8unorm');
    u.store([0, 0], [0.5, 1.5, -0.25, Number.NaN]);
    u.store([1, 0], [1 / 255, 254.5 / 255, 0.25, 1]);
    expect([...(await u.read())].slice(0, 8)).toEqual([128, 255, 0, 0, 1, 255, 64, 255]);
    const s = new CpuTexture(1, 1, 'rgba8snorm');
    s.store([0, 0], [-2, -0.5, 0.5, 1]);
    expect(s.load([0, 0])).toEqual([-1, Math.round(-0.5 * 127) / 127, Math.round(63.5) / 127, 1]);
  });

  it('keeps an f32 for a float format and the low bits for an integer one', () => {
    const f = new CpuTexture(1, 1, 'rg32float');
    f.store([0, 0], [0.1, 2.5, 9, 9]);
    expect(f.load([0, 0])).toEqual([Math.fround(0.1), 2.5, 0, 1]);
    const i = new CpuTexture(1, 1, 'rgba8uint');
    i.store([0, 0], [257, 3, 0, 255]);
    expect(i.load([0, 0])).toEqual([1, 3, 0, 255]);
  });

  it('keeps bgra8unorm bytes in blue, green, red, alpha order', async () => {
    const t = new CpuTexture(1, 1, 'bgra8unorm');
    t.store([0, 0], [1, 0.5, 0, 1]);
    expect([...(await t.read())]).toEqual([0, 128, 255, 255]);
    expect(t.load([0, 0])).toEqual([1, 128 / 255, 0, 1]);
  });

  it('reads the nearest texel inside for a load outside, and drops a store outside', () => {
    const t = new CpuTexture(2, 2, 'r32float');
    t.store([1, 1], [7, 0, 0, 0]);
    t.store([2, 0], [9, 0, 0, 0]);
    t.store([-1, 0], [9, 0, 0, 0]);
    expect([...t.texels]).toEqual([0, 0, 0, 7]);
    expect(t.load([5, 9])).toEqual([7, 0, 0, 1]);
  });

  it('answers the three builtins, and leaves any other call and texture to the stubs', () => {
    const t = new CpuTexture(3, 2, 'r32uint');
    expect(cpuTextureCall('textureDimensions', [t as never])).toEqual([3, 2]);
    expect(cpuTextureCall('textureStore', [t as never, [2, 1], [5, 0, 0, 0]])).toBe(0);
    expect(cpuTextureCall('textureLoad', [t as never, [2, 1]])).toEqual([5, 0, 0, 1]);
    expect(cpuTextureCall('textureSample', [t as never, [0, 0]])).toBeUndefined();
    expect(
      cpuTextureCall('textureLoad', [
        [0, 0, 0, 0],
        [0, 0],
      ]),
    ).toBeUndefined();
  });

  it('names the formats it holds when it does not hold one', () => {
    expect(cpuFormatGap('rgba16float')).toMatch(
      /^the CPU tier holds no rgba16float texture; it holds rgba8unorm, /,
    );
    expect(cpuFormatGap('r32float')).toBeUndefined();
  });
});

// Rule 11.7 holds the generated code and the interpreter to each other. A texture of the CPU
// tier's memory, bound with setBinding, is read by both walks: the interpreter once threw at the
// first textureLoad on it, while compileModuleJs read the texel (change 0077, part 5).
describe('a CPU texture bound to a module', () => {
  const source = `"use typeshade";
declare const cache: texture_2d<u32>;
declare const image: texture_2d<f32>;
export function readCache(x: i32, y: i32): vec4u { return textureLoad(cache, vec2i(x, y), 0); }
export function cacheSize(): vec2u { return textureDimensions(cache); }
export function readImage(x: i32, y: i32): vec4 { return textureLoad(image, vec2i(x, y), 0); }
`;
  const result = compile(source, { fileName: 'bound-texture.shade.ts' });

  it('compiles', () => {
    expect(result.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  });

  for (const precision of ['f32', 'f64'] as const)
    it(`is read alike by the interpreter and the generated code at ${precision}`, () => {
      const cache = new CpuTexture(3, 2, 'rgba32uint');
      cache.store([2, 1], [7, 8, 9, 0xffffffff]);
      const image = new CpuTexture(1, 1, 'rgba32float');
      image.store([0, 0], [0.1, -2, 0.5, 1]);
      const answers = [compileModule, compileModuleJs].map((walk) => {
        const cpu = walk(result.module, { precision });
        cpu.setBinding('cache', cache as never);
        cpu.setBinding('image', image as never);
        return [cpu.fns.readCache!(2, 1), cpu.fns.cacheSize!(), cpu.fns.readImage!(0, 0)];
      });
      expect(answers[0]).toEqual([
        [7, 8, 9, 0xffffffff],
        [3, 2],
        [Math.fround(0.1), -2, 0.5, 1],
      ]);
      expect(answers[1]).toEqual(answers[0]);
    });

  // AGENTS.md#gate-discipline: the same call on a value that is not a CPU texture still reaches
  // the stub contract, so the test above reads a texture and not a stub.
  it('keeps the stub contract for a binding that is not a CPU texture', () => {
    const cpu = compileModule(result.module, { precision: 'f32' });
    cpu.setBinding('cache', 0);
    expect(() => cpu.fns.readCache!(0, 0)).toThrow(/GPU-only/);
    const stubbed = compileModule(result.module, { precision: 'f32', gpuStubs: true });
    stubbed.setBinding('cache', 0);
    expect(stubbed.fns.readCache!(0, 0)).toEqual([0, 0, 0, 1]);
  });
});
