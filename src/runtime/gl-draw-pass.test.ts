import { describe, expect, it } from 'vitest';
import { compile } from '../compiler/ts/compile.js';
import { packModule } from '../compiler/ts/pack.js';
import type { Pack } from '../core/manifest-types.js';
import { residentState } from '../core/resident.js';
import { array } from '../runtime.js';
import { GlDrawing, GlRenderPrograms, GlTextureImpl, recordPass } from './gl-draw.js';
import type { Geometry, RenderPipeline } from './program.js';
import { recordingRhi } from '../rhi/recording-rhi.js';
import type { RenderPass } from './runtime.js';

const manifestOf = (source: string): Pack => {
  const r = compile(source);
  expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return packModule(r.module, { console: false });
};

const HEAD = `"use typeshade";
interface VsOut { p: builtin<"position">; }
interface Color { c: location<0, vec4>; }
class Tint { c: vec4; }
declare const tint: uniform<Tint>;
`;
const FRAGMENT = `@fragment export function fs(v: VsOut): Color { return { c: tint.c }; }`;

const DRAW = manifestOf(`${HEAD}interface VsIn { pos: location<0, vec2>; }
@vertex export function vs(v: VsIn): VsOut { return { p: vec4(v.pos, 0., 1.) }; }
${FRAGMENT}`);

const IDS = manifestOf(`${HEAD}declare const ids: storage<array<u32>>;
@vertex export function vs(vi: builtin<"vertex_index">): VsOut { return { p: vec4(f32(ids[vi]), 0., 0., 1.) }; }
${FRAGMENT}`);

const tint = () => ({ c: [1, 0, 0, 1] });

const setup = async (manifest: Pack, state: object = {}) => {
  const rec = recordingRhi();
  const d = new GlDrawing(rec.rhi);
  const pipe = await new GlRenderPrograms(d, manifest).render(state);
  const target = new GlTextureImpl(d, { size: [1, 1], format: 'rgba8unorm' });
  const draw = (values: object, geometry: Geometry) =>
    recordPass(d, { color: [target] }, (pass: RenderPass) =>
      pass.draw(pipe as RenderPipeline, values as never, geometry),
    )();
  return { rec, d, target, draw };
};

describe('the depth attachment of a pass', () => {
  it('is taken at the record, so a resize after it does not move it', async () => {
    const { rec, d } = await setup(DRAW);
    const target = new GlTextureImpl(d, { size: [2, 2], format: 'rgba8unorm' });
    const depth = new GlTextureImpl(d, { size: [2, 2], format: 'depth24plus' });
    const original = rec.textures.at(-1);
    const run = recordPass(d, { color: [target], depth }, () => undefined);
    depth.resize(4, 4);
    await run();
    const view = rec.passDescs[0]!.depthStencilAttachment!.view as unknown as { of: unknown };
    expect(view.of).toBe(original);
  });
});

describe('the attachments of a pass', () => {
  it('have one size', async () => {
    const { d } = await setup(DRAW);
    const small = new GlTextureImpl(d, { size: [1, 1], format: 'rgba8unorm' });
    const large = new GlTextureImpl(d, { size: [2, 2], format: 'rgba8unorm' });
    expect(() => recordPass(d, { color: [small, large] }, () => undefined)).toThrow(
      new TypeError('pass(): every attachment of a pass has one size.'),
    );
  });
});

describe('the blend constant of a pass', () => {
  const callsOf = (log: string[]): string[] =>
    log.filter((e) => /^(setBlendConstant|draw)\(/.test(e));

  it('is set again after a draw that declared one, and not again once a call set it', async () => {
    const { rec, d, target } = await setup(DRAW);
    const programs = new GlRenderPrograms(d, DRAW);
    const declares = await programs.render({ blendConstant: [1, 0, 0, 1] });
    const bare = await programs.render({});
    const geometry = { vertices: new Float32Array(6), count: 3 };
    await recordPass(d, { color: [target] }, (pass) => {
      pass.draw(declares, { tint: tint() } as never, geometry);
      pass.draw(bare, { tint: tint() } as never, geometry);
      pass.draw(declares, { tint: tint() } as never, geometry);
      pass.setBlendConstant([0, 1, 0, 1]);
      pass.draw(bare, { tint: tint() } as never, geometry);
    })();
    expect(callsOf(rec.log)).toEqual([
      'setBlendConstant([1,0,0,1])',
      'draw(3,1)',
      'setBlendConstant([0,0,0,0])',
      'draw(3,1)',
      'setBlendConstant([1,0,0,1])',
      'draw(3,1)',
      'setBlendConstant([0,1,0,1])',
      'draw(3,1)',
    ]);
  });
});

describe('a Resident of the geometry', () => {
  const update = (value: unknown): void => {
    residentState(value)!.fresh = 'host';
  };
  const geometries = {
    vertices: (r: unknown) => ({ vertices: r, count: 3 }),
    indices: (r: unknown) => ({ vertices: new Float32Array(6), indices: r, count: 3 }),
  };

  it.each([
    ['vertices', 'vertex', 24, () => array(new Float32Array(6))],
    ['indices', 'index', 12, () => array(new Uint32Array(3))],
  ] as const)('is brought up to date first: its %s', async (field, _usage, _size, make) => {
    const { draw } = await setup(DRAW);
    const resident = make();
    let synced = 0;
    Object.assign(residentState(resident)!, {
      fresh: 'device',
      sync: async () => {
        synced++;
        return false;
      },
    });
    await draw({ tint: tint() }, geometries[field](resident) as never);
    expect(synced).toBe(1);
  });

  it.each([
    ['vertices', 'vertex', 24, () => array(new Float32Array(6))],
    ['indices', 'index', 12, () => array(new Uint32Array(3))],
  ] as const)(
    'is uploaded again only when its %s host copy has changed',
    async (field, usage, size, make) => {
      const { rec, draw } = await setup(DRAW);
      const resident = make();
      const drawIt = () => draw({ tint: tint() }, geometries[field](resident) as never);
      const written = () => rec.writes.filter((w) => w.bytes.length === size).length;
      await drawIt();
      await drawIt();
      expect(rec.bufferDescs.filter((b) => b.usage.includes(usage))).toHaveLength(1);
      expect(written()).toBe(1);
      update(resident);
      await drawIt();
      expect(written()).toBe(2);
    },
  );

  it('is uploaded again only when the host copy of its data binding has changed', async () => {
    const { rec, draw } = await setup(IDS);
    const ids = array(new Uint32Array(3));
    const drawIt = () => draw({ tint: tint(), ids }, { count: 3 });
    const written = () => rec.writes.filter((w) => w.bytes.length === 12).length;
    await drawIt();
    await drawIt();
    expect(rec.bufferDescs.filter((b) => b.usage.includes('storage'))).toHaveLength(1);
    expect(written()).toBe(1);
    update(ids);
    await drawIt();
    expect(written()).toBe(2);
  });
});
