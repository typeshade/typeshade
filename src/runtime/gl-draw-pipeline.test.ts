import { describe, expect, it } from 'vitest';
import { compile } from '../compiler/ts/compile.js';
import { packModule } from '../compiler/ts/pack.js';
import type { Pack } from '../core/manifest-types.js';
import { GL_TOPOLOGY } from '../rhi/webgl2.js';
import { GlDrawing, GlRenderPrograms, GlTextureImpl, recordPass } from './gl-draw.js';
import { recordingRhi, type RecordingOptions } from '../rhi/recording-rhi.js';

const manifestOf = (source: string): Pack => {
  const r = compile(source);
  expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return packModule(r.module, { console: false });
};

const MANY = manifestOf(`"use typeshade";
interface VsOut { p: builtin<"position">; }
interface Color { c: location<0, vec4>; }
class Tint { c: vec4; }
declare const zb: uniform<Tint>;
declare const ab: uniform<Tint>;
declare const zt: texture_2d<f32>;
declare const at: texture_2d<f32>;
declare const zs: sampler;
declare const as: sampler;
declare const zd: storage<array<vec4>>;
declare const ad: storage<array<vec4>>;
@vertex export function vs(vi: builtin<"vertex_index">): VsOut { return { p: vec4(f32(vi), 0., 0., 1.) + zd[0] + ad[0] }; }
@fragment export function fs(v: VsOut): Color {
  return { c: zb.c + ab.c + textureSample(zt, zs, vec2(0.3)) + textureSample(at, as, vec2(0.3)) };
}
`);

const ONE = manifestOf(`"use typeshade";
interface VsOut { p: builtin<"position">; }
interface Color { c: location<0, vec4>; }
class Tint { c: vec4; }
declare const tint: uniform<Tint>;
@vertex export function vs(vi: builtin<"vertex_index">): VsOut { return { p: vec4(f32(vi), 0., 0., 1.) }; }
@fragment export function fs(v: VsOut): Color { return { c: tint.c }; }
`);

const TWO = manifestOf(`"use typeshade";
interface VsOut { p: builtin<"position">; }
interface Colors { a: location<0, vec4>; b: location<1, vec4>; }
@vertex export function vs(vi: builtin<"vertex_index">): VsOut { return { p: vec4(f32(vi), 0., 0., 1.) }; }
@fragment export function fs(v: VsOut): Colors { return { a: vec4(1.), b: vec4(0.) }; }
`);

const setup = (manifest: Pack, options?: RecordingOptions) => {
  const rec = recordingRhi(options);
  const d = new GlDrawing(rec.rhi);
  return { rec, d, programs: new GlRenderPrograms(d, manifest) };
};

const refusal = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run();
  } catch (e) {
    return e instanceof TypeError ? e.message : `not a TypeError: ${String(e)}`;
  }
  return 'no refusal';
};

describe('the bind group layout of a render pipeline', () => {
  it('takes the blocks, the textures and the data each by name, then the samplers', async () => {
    const { rec, programs } = setup(MANY);
    await programs.render({});
    const entries = rec.layouts[0]!;
    expect(entries.map((e) => e.label)).toEqual(['ab', 'zb', 'at', 'zt', 'ad', 'zd', 'as', 'zs']);
    expect(entries.map((e) => e.binding)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(entries.filter((e) => e.samplerBinding !== undefined)).toEqual([
      expect.objectContaining({ label: 'at', samplerBinding: 6 }),
      expect.objectContaining({ label: 'zt', samplerBinding: 7 }),
    ]);
  });

  it('leaves out of the bind group a block the driver found inactive', async () => {
    const { rec, d, programs } = setup(ONE, { inactive: [0] });
    const pipe = await programs.render({});
    const target = new GlTextureImpl(d, { size: [1, 1], format: 'rgba8unorm' });
    await recordPass(d, { color: [target] }, (pass) => pass.draw(pipe, {}, { count: 3 }))();
    expect(rec.bindGroups).toEqual([[]]);
  });

  it('keeps the active block in the bind group', async () => {
    const { rec, d, programs } = setup(ONE);
    const pipe = await programs.render({});
    const target = new GlTextureImpl(d, { size: [1, 1], format: 'rgba8unorm' });
    const tint = { c: [1, 0, 0, 1] };
    await recordPass(d, { color: [target] }, (pass) => pass.draw(pipe, { tint }, { count: 3 }))();
    expect(rec.bindGroups.map((g) => g.map((e) => e.binding))).toEqual([[0]]);
  });
});

describe('a render pipeline the device refused', () => {
  it('is built again by the next state that asks for it', async () => {
    const { rec, programs } = setup(ONE, { rejectPipelines: 1 });
    await expect(programs.render({})).rejects.toThrow('the device refused the pipeline');
    await expect(programs.render({})).resolves.toBeDefined();
    expect(rec.pipelines).toBe(2);
  });

  it('is kept by the next state that asks for it once the device has made it', async () => {
    const { rec, programs } = setup(ONE);
    const first = await programs.render({});
    expect(await programs.render({})).toBe(first);
    expect(rec.pipelines).toBe(1);
  });
});

describe('a state the WebGL2 tier does not draw', () => {
  const where = 'The render pipeline of "fs"';
  const blend = (color: object, alpha: object = {}) => ({
    targets: [{ format: 'rgba8unorm', blend: { color, alpha } }],
  });

  it.each([
    [
      { primitive: { topology: 'sideways' } },
      `${where}: "sideways" is not a topology; WebGPU's are ${Object.keys(GL_TOPOLOGY).join(', ')}.`,
    ],
    [blend({ srcFactor: 'sideways' }), `${where}: "sideways" is not a blend factor.`],
    [blend({}, { dstFactor: 'sideways' }), `${where}: "sideways" is not a blend factor.`],
    [blend({ operation: 'sideways' }), `${where}: "sideways" is not a blend operation.`],
    [blend({}, { operation: 'sideways' }), `${where}: "sideways" is not a blend operation.`],
  ])('refuses %j in the sentence it has always used', async (state, sentence) => {
    const { rec, programs } = setup(ONE);
    expect(await refusal(() => programs.render(state as never))).toBe(sentence);
    expect(rec.pipelines).toBe(0);
  });

  it.each([
    [[{ format: 'rgba8unorm', blend: { color: {}, alpha: {} } }, { format: 'rgba8unorm' }]],
    [[{ format: 'rgba8unorm' }, { format: 'rgba8unorm', writeMask: 3 }]],
  ])('refuses targets that blend or mask apart: %j', async (targets) => {
    const { rec, programs } = setup(TWO);
    expect(await refusal(() => programs.render({ targets } as never))).toBe(
      `${where}: targets that blend or mask apart are not supported yet on the WebGL2 tier (Rule 11.11); give its targets one blend and one writeMask.`,
    );
    expect(rec.pipelines).toBe(0);
  });

  it('draws targets that blend and mask alike', async () => {
    const { rec, programs } = setup(TWO);
    const targets = [
      { format: 'rgba8unorm', writeMask: 7 },
      { format: 'rgba8unorm', writeMask: 7 },
    ];
    await expect(programs.render({ targets } as never)).resolves.toBeDefined();
    expect(rec.pipelines).toBe(1);
  });
});

describe('targets that give no write mask', () => {
  it.each([
    [[{ format: 'rgba8unorm' }, { format: 'rgba8unorm', writeMask: 15 }]],
    [[{ format: 'rgba8unorm', writeMask: 15 }, { format: 'rgba8unorm' }]],
    [[{ format: 'rgba8unorm' }, { format: 'rgba8unorm' }]],
  ])('draw alike with the mask 15: %j', async (targets) => {
    const { rec, programs } = setup(TWO);
    await expect(programs.render({ targets } as never)).resolves.toBeDefined();
    expect(rec.pipelines).toBe(1);
  });
});

describe('a stage the manifest gives no WebGL2 program', () => {
  const without = (gl: Pack['gl']): Pack => ({ ...ONE, gl });

  it('is refused with the sentence that says to pack the manifest again', async () => {
    const { rec, programs } = setup(without({ vertices: ONE.gl!.vertices, draws: {} }));
    expect(await refusal(() => programs.render({}))).toBe(
      'The manifest carries no WebGL2 program for "fs" (typeshade-input.ts:7); pack it again with this version of typeshade.',
    );
    expect(rec.pipelines).toBe(0);
  });

  it('is refused with the reason the manifest gives when the stage has none', async () => {
    const { programs } = setup(
      without({ vertices: ONE.gl!.vertices, draws: { fs: { none: 'it writes nothing' } } }),
    );
    expect(await refusal(() => programs.render({}))).toBe(
      '"fs" (typeshade-input.ts:7) has no WebGL2 program: it writes nothing.',
    );
  });
});
