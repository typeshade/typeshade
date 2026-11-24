import { describe, expect, it } from 'vitest';
import { compile } from '../compiler/ts/compile.js';
import { packModule } from '../compiler/ts/pack.js';
import type { Pack } from '../core/manifest-types.js';
import { residentState } from '../core/resident.js';
import { array } from '../runtime.js';
import {
  GlDrawing,
  GlRenderPrograms,
  GlSamplerImpl,
  GlTextureImpl,
  recordPass,
} from './gl-draw.js';
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

const idsOf = (elem: string): Pack =>
  manifestOf(`${HEAD}declare const ids: storage<array<${elem}>>;
@vertex export function vs(vi: builtin<"vertex_index">): VsOut { return { p: vec4(f32(ids[vi]), 0., 0., 1.) }; }
${FRAGMENT}`);

const IDS = idsOf('u32');

const IDS_AND_VERTICES = manifestOf(`${HEAD}interface VsIn { pos: location<0, vec2>; }
declare const ids: storage<array<u32>>;
@vertex export function vs(v: VsIn): VsOut { return { p: vec4(v.pos + vec2(f32(ids[0])), 0., 1.) }; }
${FRAGMENT}`);

const UINT_VERTEX = manifestOf(`${HEAD}interface VsIn { id: location<0, u32>; }
@vertex export function vs(v: VsIn): VsOut { return { p: vec4(f32(v.id), 0., 0., 1.) }; }
${FRAGMENT}`);

const PHOTO = manifestOf(`"use typeshade";
interface VsOut { p: builtin<"position">; }
interface Color { c: location<0, vec4>; }
declare const photo: texture_2d<f32>;
declare const linear: sampler;
@vertex export function vs(vi: builtin<"vertex_index">): VsOut { return { p: vec4(f32(vi), 0., 0., 1.) }; }
@fragment export function fs(v: VsOut): Color { return { c: textureSample(photo, linear, vec2(0.3)) }; }
`);

const tint = () => ({ c: [1, 0, 0, 1] });
const host = (kind: string, size = 24) => ({ __rhi: kind, size });

const setup = async (manifest: Pack, state: object = {}) => {
  const rec = recordingRhi();
  const d = new GlDrawing(rec.rhi);
  const pipe = await new GlRenderPrograms(d, manifest).render(state);
  const target = new GlTextureImpl(d, { size: [1, 1], format: 'rgba8unorm' });
  const run = (record: (pass: RenderPass, pipe: RenderPipeline) => void) =>
    recordPass(d, { color: [target] }, (pass) => record(pass, pipe))();
  const draw = (values: object, geometry: Geometry) =>
    run((pass, p) => pass.draw(p, values as never, geometry));
  return { rec, d, pipe, target, run, draw };
};

const floats = (bytes: Uint8Array): number[] =>
  Array.from(new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4));

describe('a draw takes what it binds when it is recorded', () => {
  it('copies a typed array of vertices at the record', async () => {
    const { rec, run } = await setup(DRAW);
    const vertices = new Float32Array([1, 2, 3, 4, 5, 6]);
    await run((pass, pipe) => {
      pass.draw(pipe, { tint: tint() }, { vertices, count: 3 });
      vertices.fill(9);
    });
    expect(floats(rec.writes.find((w) => w.bytes.length === 24)!.bytes)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
  });

  it('packs a plain value of a block at the record', async () => {
    const { rec, run } = await setup(DRAW);
    const value = tint();
    await run((pass, pipe) => {
      pass.draw(pipe, { tint: value }, { vertices: new Float32Array(6), count: 3 });
      value.c[0] = 7;
    });
    expect(floats(rec.writes.find((w) => w.bytes.length === 16)!.bytes)).toEqual([1, 0, 0, 1]);
  });

  it('takes the device texture of a binding at the record, so a resize after it does not move it', async () => {
    const { rec, d, run } = await setup(PHOTO);
    const photo = new GlTextureImpl(d, { size: [2, 2], format: 'rgba8unorm' });
    const linear = new GlSamplerImpl(rec.rhi, undefined);
    const original = rec.textures.at(-1);
    await run((pass, pipe) => {
      pass.draw(pipe, { photo, linear } as never, { count: 3 });
      photo.resize(4, 4);
    });
    const view = rec.bindGroups[0]!.map((e) => e.resource).find((r) => 'view' in r);
    if (view === undefined || !('view' in view)) throw new Error('the draw bound no texture view');
    expect((view.view as unknown as { of: unknown }).of).toBe(original);
  });
});

describe('the buffers a draw makes for itself', () => {
  it('are destroyed after the draw, each one', async () => {
    const { rec, draw } = await setup(DRAW);
    await draw({ tint: tint() }, { vertices: new Float32Array(6), count: 3 });
    const made = rec.log.filter((e) => e.startsWith('createBuffer')).map((e) => /#\d+/.exec(e)![0]);
    expect(made).toHaveLength(2);
    const drawAt = rec.log.findIndex((e) => e.startsWith('draw('));
    for (const id of made) expect(rec.log.indexOf(`destroyBuffer${id}`)).toBeGreaterThan(drawAt);
  });

  it('are none for a buffer of the host, which is bound as it is', async () => {
    const { rec, draw } = await setup(DRAW);
    await draw({ tint: tint() }, { vertices: host('buffer') as never, count: 3 });
    expect(rec.bufferDescs.filter((b) => b.usage.includes('vertex'))).toEqual([]);
    expect(rec.log.some((e) => e.startsWith('setVertexBuffer'))).toBe(true);
  });

  it('are none for the vertices of an entry that reads no attribute', async () => {
    const { rec, draw } = await setup(IDS);
    await draw({ tint: tint(), ids: new Uint32Array(3) }, { count: 3 });
    expect(rec.log.some((e) => e.startsWith('setVertexBuffer'))).toBe(false);
  });
});

describe('the index buffer of a draw', () => {
  const formatOf = async (indices: unknown): Promise<string | undefined> => {
    const { rec, draw } = await setup(DRAW);
    await draw({ tint: tint() }, { vertices: new Float32Array(6), indices, count: 3 } as never);
    return /setIndexBuffer\(buffer#\d+,(\w+)\)/.exec(rec.log.join('\n'))?.[1];
  };

  it.each([
    ['a Uint32Array', new Uint32Array(3), 'uint32'],
    ['a Uint16Array', new Uint16Array(3), 'uint16'],
    ['a Buffer', array([0, 1, 2]), 'uint32'],
    ['a host buffer of uint32', { buffer: host('buffer', 12), format: 'uint32' }, 'uint32'],
    ['a host buffer of uint16', { buffer: host('buffer', 6), format: 'uint16' }, 'uint16'],
    ['a host buffer of no format', { buffer: host('buffer', 6) }, 'uint16'],
  ])('is %s and is set as %s', async (_name, indices, format) => {
    expect(await formatOf(indices)).toBe(format);
  });

  it('draws without indices when the geometry has none', async () => {
    const { rec, draw } = await setup(DRAW);
    await draw({ tint: tint() }, { vertices: new Float32Array(6), count: 3 });
    expect(rec.log.some((e) => e.startsWith('setIndexBuffer'))).toBe(false);
    expect(rec.log).toContain('draw(3,1)');
  });
});

describe('a value the layout of a binding cannot hold', () => {
  it('is refused in a sentence that names the binding', async () => {
    const { draw } = await setup(DRAW);
    expect(() =>
      draw({ tint: { c: [1, 0, 0] } }, { vertices: new Float32Array(6), count: 3 }),
    ).toThrow(
      new TypeError(
        '"fs" (typeshade-input.ts:8), binding "tint" (struct:Tint): tint.c got an array of length 3.',
      ),
    );
  });
});

describe('an open Buffer a draw uses', () => {
  const read = async (b: unknown): Promise<unknown> =>
    await (b as { read(): Promise<unknown> }).read();

  it('takes the scalar its binding reads', async () => {
    const { draw } = await setup(IDS);
    const ids = array([1, 2, 3]);
    await draw({ tint: tint(), ids }, { count: 3 });
    expect(await read(ids)).toBeInstanceOf(Uint32Array);
  });

  it('takes u32 as the element of its indices', async () => {
    const { draw } = await setup(DRAW);
    const indices = array([0, 1, 2]);
    await draw({ tint: tint() }, { vertices: new Float32Array(6), indices, count: 3 } as never);
    expect(await read(indices)).toBeInstanceOf(Uint32Array);
  });

  it('takes the scalar the vertex attributes read, for a pipeline with no fragment', async () => {
    const { draw } = await setup(UINT_VERTEX, { fragment: null });
    const vertices = array([1, 2, 3]);
    await draw({}, { vertices: vertices as never, count: 3 });
    expect(await read(vertices)).toBeInstanceOf(Uint32Array);
  });

  it('stays open when the draw is refused after the binding was checked', async () => {
    const { draw } = await setup(IDS_AND_VERTICES);
    const ids = array([1, 2, 3]);
    expect(() => draw({ tint: tint(), ids }, { count: 3 })).toThrow('reads vertex attributes');
    expect(await read(ids)).toBeInstanceOf(Float32Array);
  });
});

describe('the stencil reference of a pass', () => {
  it('records no step of its own: a stencil draw passes it to its own call', async () => {
    const { rec, d, target, pipe } = await setup(DRAW, {
      depth: { format: 'depth24plus-stencil8', stencil: {} },
    });
    const depth = new GlTextureImpl(d, { size: [1, 1], format: 'depth24plus-stencil8' });
    await recordPass(d, { color: [target], depth }, (pass) => {
      pass.setStencilReference(5);
      pass.draw(pipe, { tint: tint() } as never, { vertices: new Float32Array(6), count: 3 });
      pass.setStencilReference(2);
    })();
    expect(rec.log.filter((e) => e.startsWith('setStencilReference'))).toEqual([
      'setStencilReference(5)',
    ]);
  });
});

describe('the data texture of a storage binding', () => {
  it.each([
    ['u32', new Uint32Array(3)],
    ['i32', new Int32Array(3)],
    ['f32', new Float32Array(3)],
  ])('is made for %s data with that element', async (elem, ids) => {
    const { rec, draw } = await setup(idsOf(elem));
    await draw({ tint: tint(), ids }, { count: 3 });
    expect(rec.bufferDescs.filter((b) => b.usage.includes('storage'))).toEqual([
      expect.objectContaining({ elem }),
    ]);
  });
});

describe('a pass is recorded as its frame is built', () => {
  const geometry = { vertices: new Float32Array(6), count: 3 };

  it('refuses its targets before it calls the record of its draws', async () => {
    const { d } = await setup(DRAW);
    let called = 0;
    expect(() =>
      recordPass(d, { color: [{}] } as never, () => {
        called++;
      }),
    ).toThrow(TypeError);
    expect(called).toBe(0);
  });

  it('takes its attachments at the record, so a resize after it does not move them', async () => {
    const { rec, d } = await setup(DRAW);
    const target = new GlTextureImpl(d, { size: [2, 2], format: 'rgba8unorm' });
    const original = rec.textures.at(-1);
    const run = recordPass(d, { color: [target] }, () => undefined);
    target.resize(4, 4);
    await run();
    const view = rec.passDescs[0]!.colorAttachments[0]!.view as unknown as { of: unknown };
    expect(view.of).toBe(original);
  });

  it('runs the state calls and the draws in the order they were recorded', async () => {
    const { rec, run } = await setup(DRAW);
    await run((pass, pipe) => {
      pass.setViewport(0, 0, 1, 1);
      pass.draw(pipe, { tint: tint() } as never, geometry);
      pass.setScissorRect(0, 0, 1, 1);
      pass.setBlendConstant([0, 0, 0, 1]);
    });
    const calls = rec.log
      .map((e) => /^(setViewport|setPipeline|draw|setScissorRect|setBlendConstant)\(/.exec(e)?.[1])
      .filter((e) => e !== undefined);
    expect(calls).toEqual([
      'setViewport',
      'setPipeline',
      'draw',
      'setScissorRect',
      'setBlendConstant',
    ]);
  });
});

describe('a Buffer the pass reads before it draws', () => {
  it('has its zeros made first when it is a zeroed one that no host copy holds', async () => {
    const { rec, draw } = await setup(IDS);
    await draw({ tint: tint(), ids: array(3, 'u32') }, { count: 3 });
    const upload = rec.writes.find((w) => w.bytes.length === 12);
    expect(Array.from(upload!.bytes)).toEqual(new Array(12).fill(0));
  });

  it('is brought up to date first when a call on the device wrote it', async () => {
    const { draw } = await setup(IDS);
    const ids = array(new Uint32Array(3));
    const state = residentState(ids)!;
    let synced = 0;
    Object.assign(state, {
      fresh: 'device',
      sync: async () => {
        synced++;
        return false;
      },
    });
    await draw({ tint: tint(), ids }, { count: 3 });
    expect(synced).toBe(1);
  });
});
