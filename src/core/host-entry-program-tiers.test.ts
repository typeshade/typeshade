import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configure } from './resident.js';
import {
  WIDE,
  fakeGpu,
  FakeImageData,
  loadEntries,
  type Entries,
} from './testing/entry-program-harness.js';
import { recordingGl, dispatched, lastArgs, bits } from '../runtime/gl-compute-host-harness.js';
import { cpuRuntimeOf } from './host-draw.js';
import { GlRuntimeImpl } from '../runtime/gl.js';
import { CPU_PROGRAM } from '../rhi/cpu-program.js';
import { hostFace } from '../compiler/ts/host-face.js';

const entries = (recordConsole?: boolean, source?: string) =>
  loadEntries(hostFace, recordConsole, source);

const seen = vi.hoisted(() => ({
  packs: [] as unknown[],
  holds: [] as [object, unknown][],
  context: null as unknown,
}));
vi.mock('./gl-context.js', async (original) => ({
  ...(await original<typeof import('./gl-context.js')>()),
  glContext: () => seen.context,
}));
vi.mock('./gl-compute.js', async (original) => ({
  ...(await original<typeof import('./gl-compute.js')>()),
  runGlCompute: vi.fn(async () => ({ passes: 1, barrierPhases: 0 })),
}));
vi.mock('../rhi/cpu.js', async (original) => {
  const real = await original<typeof import('../rhi/cpu.js')>();
  return {
    ...real,
    holdValue: (...a: Parameters<typeof real.holdValue>) => {
      seen.holds.push([a[0], a[1]]);
      return real.holdValue(...a);
    },
  };
});
vi.mock('../runtime/program.js', async (original) => {
  const real = await original<typeof import('../runtime/program.js')>();
  class Recording extends real.ProgramImpl {
    constructor(...a: ConstructorParameters<typeof real.ProgramImpl>) {
      super(...a);
      seen.packs.push(a[1]);
    }
  }
  return { ...real, ProgramImpl: Recording };
});

let recorded: ReturnType<typeof recordingGl>;
const g = globalThis as Record<string, unknown>;
const floats = (...xs: number[]) => Float32Array.of(...xs);
const args = () => ({
  params: { k: 2 },
  xs: floats(1, 2, 3),
  out: floats(0, 0, 0),
  total: floats(0),
});
const image = () => ({ photo: new FakeImageData(2, 1), smp: {}, out: floats(0) });

beforeEach(() => {
  seen.packs.length = 0;
  seen.holds.length = 0;
  g['ImageData'] = FakeImageData;
  recorded = recordingGl();
  seen.context = recorded.gl;
});
afterEach(() => {
  delete g['ImageData'];
  vi.restoreAllMocks();
  configure({ runtime: null });
  configure({});
});

const onCpu = async (): Promise<Entries> => {
  configure({ prefer: ['cpu'] });
  return entries();
};

describe('the CPU tier of an entry call', () => {
  it('computes on the host numbers and writes back only the bindings the entry writes', async () => {
    const m = await onCpu();
    const a = args();
    await m.scale(a, 1);
    expect(a.xs).toEqual(floats(1, 2, 3));
    expect(a.out).toEqual(floats(2, 4, 6));
    expect(a.total).toEqual(floats(7));
  });

  const lastHold = (): unknown[] => {
    const last = new Map<object, unknown>();
    for (const [buffer, slot] of seen.holds) last.set(buffer, slot);
    return [...last.values()];
  };

  it('lets go of every buffer value when the call ends', async () => {
    const m = await onCpu();
    await m.scale(args(), 1);
    expect(seen.holds).toHaveLength(8);
    expect(lastHold()).toEqual([undefined, undefined, undefined, undefined]);
  });

  it('lets go of every buffer value and leaves the caller values alone when the pass fails', async () => {
    const m = await onCpu();
    const a = args();
    await m.scale(args(), 1);
    seen.holds.length = 0;
    vi.spyOn(cpuRuntimeOf().rhi, 'createCommandEncoder').mockImplementationOnce(() => {
      throw new Error('no encoder');
    });
    await expect(m.scale(a, 1)).rejects.toThrow('no encoder');
    expect(lastHold()).toEqual([undefined, undefined, undefined, undefined]);
    expect(a.out).toEqual(floats(0, 0, 0));
  });

  it('leaves a binding it does not write as the host gave it', async () => {
    const m = await onCpu();
    const params = { k: 0.1 };
    await m.scale({ ...args(), params }, 1);
    expect(params).toEqual({ k: 0.1 });
  });

  it('gives its buffers back to the pool when the call ends', async () => {
    const m = await onCpu();
    await m.scale(args(), 1);
    const make = vi.spyOn(cpuRuntimeOf().rhi, 'createBuffer');
    await m.scale(args(), 1);
    expect(make).not.toHaveBeenCalled();
  });

  it('puts its program in the manifest of the call and makes it once for each entry', async () => {
    const m = await onCpu();
    await m.scale(args(), 1);
    await m.scale(args(), 1);
    expect(seen.packs).toHaveLength(1);
    const pack = seen.packs[0] as Record<string | symbol, never>;
    expect(pack['gl']).toBeUndefined();
    expect(pack['console']).toBeUndefined();
    const program = pack[CPU_PROGRAM] as {
      entries: Record<string, { workgroupSize: number[]; stage: string }>;
      bindings: { name: string; kind: string }[];
    };
    expect(program.entries['scale']).toMatchObject({ workgroupSize: [4, 1, 1], stage: 'compute' });
    expect(program.bindings.map((b) => `${b.name}:${b.kind}`)).toEqual([
      'params:uniform',
      'xs:storage',
      'out:storage',
      'total:storage',
    ]);
  });
});

describe('the WebGPU tier manifest of an entry call', () => {
  it('names each binding by its slot, reaches the handles, and carries no CPU program and no WebGL2 program', async () => {
    const gpu = fakeGpu();
    configure({ runtime: { device: gpu.device }, prefer: ['webgpu'] });
    const m = await entries();
    await m.look(image(), 1);
    const pack = seen.packs.at(-1) as { bindings: { name: string; layout: unknown }[] } & Record<
      string | symbol,
      unknown
    >;
    expect(pack.bindings.map((b) => b.name)).toEqual(['out', 'photo', 'smp']);
    expect(pack['gl']).toBeUndefined();
    expect(pack[CPU_PROGRAM]).toBeUndefined();
    expect(gpu.textures.map((t) => [t.format, t.destroys])).toEqual([['rgba8unorm', 1]]);
  });
});

describe('the recorded console variant of an entry call', () => {
  const shoutArgs = () => ({ out: floats(0) });

  it('is in the manifest on WebGPU only, with the injected console binding', async () => {
    const gpu = fakeGpu();
    configure({ runtime: { device: gpu.device }, prefer: ['webgpu'] });
    const m = await entries(true);
    await m.shout(shoutArgs(), 1);
    const pack = seen.packs.at(-1) as {
      console?: { bindings: { name: string; injected?: boolean }[] };
    };
    expect(pack.console?.bindings.map((b) => [b.name, b.injected])).toEqual([
      ['out', undefined],
      ['_console', true],
    ]);
  });

  it('is in no manifest of the WebGL2 tier and no manifest of the CPU tier', async () => {
    configure({ runtime: null, prefer: ['webgl2'] });
    const m = await entries(true);
    const load = vi.spyOn(GlRuntimeImpl.prototype, 'load');
    await m.shout(shoutArgs(), 1);
    expect(load.mock.calls[0]![0]).not.toHaveProperty('console');
    configure({ prefer: ['cpu'] });
    await m.shout(shoutArgs(), 1);
    expect(seen.packs.at(-1)).not.toHaveProperty('console');
    expect(seen.packs).toHaveLength(1);
  });
});

describe('the WebGL2 tier of an entry call', () => {
  const onGl = async () => {
    configure({ runtime: null, prefer: ['webgl2'] });
    return entries();
  };

  it('hands the dispatch each storage binding as packed words and each uniform as the host gave it', async () => {
    const m = await onGl();
    const a = args();
    await m.scale(a, 1);
    const { memory, uniforms } = lastArgs();
    expect(memory['xs']).toEqual(bits([1, 2, 3]));
    expect(uniforms?.['params']).toEqual({ k: 2 });
  });

  it('makes the manifest and loads the program once for each entry', async () => {
    const m = await onGl();
    const load = vi.spyOn(GlRuntimeImpl.prototype, 'load');
    await m.scale(args(), 1);
    await m.scale(args(), 1);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('refuses a Texture of the WebGPU device, and deletes the textures it made before', async () => {
    const m = await onGl();
    const texture = { width: 2, height: 1, [Symbol.for('typeshade.deviceView')]: () => ({}) };
    await expect(m.look({ photo: texture, smp: {}, out: floats(0) }, 1)).rejects.toThrow(
      'look(): binding "photo" is a Texture on the WebGPU device, which the WebGL2 tier does not read yet (Rule 8.24); pass an image source for a call that may fall back.',
    );
  });

  it('reads back into the caller value in place only what the entry writes', async () => {
    const m = await onGl();
    dispatched.mockImplementationOnce(async (_gl, _program, a) => {
      a.memory['out']!.set(bits([5, 6, 7]));
      a.memory['xs']!.set(bits([8, 8, 8]));
      a.memory['total']!.set(bits([9]));
      return { passes: 1, barrierPhases: 0 };
    });
    const a = args();
    await m.scale(a, 1);
    expect(a.out).toEqual(floats(5, 6, 7));
    expect(a.xs).toEqual(floats(1, 2, 3));
    expect(a.total).toEqual(floats(9));
  });

  it('makes the manifest with its own binding names, the uniform layout and the WebGL2 pass program', async () => {
    const m = await onGl();
    const load = vi.spyOn(GlRuntimeImpl.prototype, 'load');
    await m.scale(args(), 1);
    const pack = load.mock.calls[0]![0] as unknown as {
      bindings: { name: string; layout: { kind: string } }[];
      gl: { computes: Record<string, unknown> };
    };
    expect(pack.bindings.map((b) => b.name)).toEqual(['params', 'xs', 'out', 'total']);
    expect(pack.bindings[0]!.layout.kind).toBe('struct');
    expect(Object.keys(pack.gl.computes)).toEqual(['scale']);
  });

  it('uploads each image as an RGBA8 texture, reaches its handles in the manifest and deletes the texture after', async () => {
    const m = await onGl();
    const load = vi.spyOn(GlRuntimeImpl.prototype, 'load');
    await m.look(image(), 1);
    const pack = load.mock.calls[0]![0] as unknown as { bindings: { name: string }[] };
    expect(pack.bindings.map((b) => b.name)).toEqual(['out', 'photo', 'smp']);
    expect(recorded.calls).toContain('texStorage2D(TEXTURE_2D,1,RGBA8,2,1)');
    expect(recorded.calls.filter((c) => c.startsWith('deleteTexture'))).toHaveLength(1);
  });

  it('deletes the image texture when the dispatch fails', async () => {
    const m = await onGl();
    dispatched.mockImplementationOnce(async () => {
      throw new Error('dispatch failed');
    });
    await expect(m.look(image(), 1)).rejects.toThrow('dispatch failed');
    expect(recorded.calls.filter((c) => c.startsWith('deleteTexture'))).toHaveLength(1);
  });
});

describe('an entry of a module that emulates f64', () => {
  const wide = () => entries(false, WIDE) as unknown as Promise<{ dbl: Entries['scale'] }>;
  const args = () => ({ values: Float64Array.of(1, 2, 3) });

  it('keeps the guard out of the manifest of the CPU tier', async () => {
    configure({ prefer: ['cpu'] });
    const m = await wide();
    await m.dbl(args(), 1);
    const names = (seen.packs.at(-1) as { bindings: { name: string }[] }).bindings.map(
      (b) => b.name,
    );
    expect(names).toEqual(['values']);
  });

  it('leaves the guard texture to the runtime on WebGPU', async () => {
    const gpu = fakeGpu();
    configure({ runtime: { device: gpu.device }, prefer: ['webgpu'], fp64Flavor: 'float' });
    const m = await wide();
    await m.dbl(args(), 1);
    expect(gpu.textures.map((t) => [t.format, t.destroys])).toEqual([['rgba8unorm', 0]]);
  });
});
