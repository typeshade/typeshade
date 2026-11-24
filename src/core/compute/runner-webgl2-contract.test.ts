import { describe, it, expect } from 'vitest';
import type { ModuleDecl } from '../ir/index.js';
import {
  fn,
  module,
  If,
  Return,
  storageBuffer,
  resource,
  builtin,
  bitcastU32,
  f32T,
  u32T,
  i32T,
  vec3uT,
  vec4uT,
  voidT,
} from '../ir/index.js';
import { createComputeRunner } from '../../compute.js';

type Elem = typeof f32T | typeof u32T | typeof i32T;

function kernelOf(opts: { inputName?: string; elem?: Elem } = {}): ModuleDecl {
  const inputName = opts.inputName ?? 'feat_data';
  const elem = opts.elem ?? f32T;
  const input = storageBuffer(inputName, elem, { group: 0, binding: 0, access: 'read' });
  const out = storageBuffer('out_value', u32T, { group: 0, binding: 1, access: 'read_write' });
  const dispatch = resource('u_dispatch', vec4uT, { group: 0, binding: 2 });
  const kernel = fn(
    'scale_features',
    { gid: builtin('global_invocation_id', vec3uT) },
    voidT,
    ({ gid }) => {
      const i = gid.x;
      If(i.ge(dispatch.node.x), () => {
        Return();
      });
      out.at(i).assign(bitcastU32(input.at(i)));
    },
    { stage: 'compute', workgroupSize: 64, portable: true },
  );
  return module({
    bindings: [input.binding, out.binding, dispatch.binding],
    funcs: [kernel],
  });
}

interface Call {
  readonly name: string;
  readonly args: readonly unknown[];
}

interface StubOptions {
  readonly blend?: boolean;
  readonly program?: object | null;
  readonly activeUnit?: number;
  readonly tex0?: object | null;
  readonly viewport?: readonly number[];
  readonly framebufferStatus?: number;
  readonly failFramebuffer?: boolean;
  readonly failTextureAt?: number;
}

const COMPLETE = 0x8cd5;
const INCOMPLETE = 0x8cd6;

function glStub(init: StubOptions = {}) {
  const calls: Call[] = [];
  const consts = new Map<string, number>([
    ['FRAMEBUFFER_COMPLETE', COMPLETE],
    ['COMPILE_STATUS', 0x8b81],
    ['LINK_STATUS', 0x8b82],
    ['TEXTURE0', 0x84c0],
    ['BLEND', 0x0be2],
    ['VIEWPORT', 0x0ba2],
    ['CURRENT_PROGRAM', 0x8b8d],
    ['ACTIVE_TEXTURE', 0x84e0],
    ['TEXTURE_BINDING_2D', 0x8069],
  ]);
  let nextConst = 0x3000;
  const constant = (name: string): number => {
    if (!consts.has(name)) consts.set(name, nextConst++);
    return consts.get(name)!;
  };
  const enabled = new Set<number>(init.blend ? [constant('BLEND')] : []);
  const bindings = new Map<number, object | null>();
  if (init.tex0 !== undefined) bindings.set(constant('TEXTURE0'), init.tex0);
  let activeUnit = init.activeUnit ?? constant('TEXTURE0');
  let program: object | null = init.program ?? null;
  let viewport = [...(init.viewport ?? [0, 0, 640, 480])];
  let textureCount = 0;
  const api: Record<string, (...args: never[]) => unknown> = {
    createShader: () => ({}),
    createProgram: () => ({ kind: 'program' }),
    createTexture: () => {
      textureCount += 1;
      return init.failTextureAt === textureCount ? null : { kind: 'texture', id: textureCount };
    },
    createFramebuffer: () => (init.failFramebuffer ? null : { kind: 'framebuffer' }),
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getUniformLocation: (...a: never[]) => ({ kind: 'location', name: a[1] as unknown as string }),
    checkFramebufferStatus: () => init.framebufferStatus ?? COMPLETE,
    enable: (...a: never[]) => enabled.add(a[0] as unknown as number),
    disable: (...a: never[]) => enabled.delete(a[0] as unknown as number),
    isEnabled: (...a: never[]) => enabled.has(a[0] as unknown as number),
    useProgram: (...a: never[]) => {
      program = (a[0] as object | null) ?? null;
    },
    activeTexture: (...a: never[]) => {
      activeUnit = a[0] as unknown as number;
    },
    bindTexture: (...a: never[]) => bindings.set(activeUnit, (a[1] as object | null) ?? null),
    deleteTexture: (...a: never[]) => {
      for (const [unit, t] of bindings) if (t === a[0]) bindings.set(unit, null);
    },
    viewport: (...a: never[]) => {
      viewport = a.map(Number);
    },
    readPixels: (...a: never[]) => {
      const grid = a[6] as unknown as Uint32Array;
      for (let i = 0; i < grid.length; i++) grid[i] = i + 1;
    },
    getParameter: (...a: never[]) => {
      const pname = a[0] as unknown as number;
      if (pname === constant('VIEWPORT')) return Int32Array.from(viewport);
      if (pname === constant('CURRENT_PROGRAM')) return program;
      if (pname === constant('ACTIVE_TEXTURE')) return activeUnit;
      if (pname === constant('TEXTURE_BINDING_2D')) return bindings.get(activeUnit) ?? null;
      return 0;
    },
  };
  const gl = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (/^[A-Z0-9_]+$/.test(prop) && !(prop in api)) return constant(prop);
        return (...args: never[]) => {
          calls.push({ name: prop, args });
          return prop in api ? api[prop]!(...args) : undefined;
        };
      },
    },
  ) as unknown as WebGL2RenderingContext;
  return {
    gl,
    calls,
    constant,
    named: (name: string) => calls.filter((c) => c.name === name),
    indexOf: (name: string) => calls.findIndex((c) => c.name === name),
    lastIndexOf: (name: string) => calls.map((c) => c.name).lastIndexOf(name),
    blendEnabled: () => enabled.has(constant('BLEND')),
    currentProgram: () => program,
    activeUnit: () => activeUnit,
    bindingOn: (unit: number) => bindings.get(unit) ?? null,
    viewport: () => viewport,
  };
}

async function runnerOn(s: ReturnType<typeof glStub>, m: ModuleDecl = kernelOf()) {
  return createComputeRunner(m, { prefer: ['webgl2'], gl: s.gl });
}

async function attempt(run: () => Promise<Uint32Array>): Promise<unknown> {
  try {
    await run();
  } catch (e) {
    return e;
  }
  return undefined;
}

describe('createComputeRunner webgl2 tier: draw state', () => {
  it('sets the data texture to NEAREST filtering and CLAMP_TO_EDGE wrapping', async () => {
    const s = glStub();
    const r = await runnerOn(s);
    await r.run(new Float32Array([1, 2, 3]));
    const params = s.named('texParameteri').map((c) => c.args.slice(1));
    const nearest = s.constant('NEAREST');
    const clamp = s.constant('CLAMP_TO_EDGE');
    expect(params.slice(0, 4)).toEqual([
      [s.constant('TEXTURE_MIN_FILTER'), nearest],
      [s.constant('TEXTURE_MAG_FILTER'), nearest],
      [s.constant('TEXTURE_WRAP_S'), clamp],
      [s.constant('TEXTURE_WRAP_T'), clamp],
    ]);
  });

  it('sets the output texture to NEAREST filtering', async () => {
    const s = glStub();
    const r = await runnerOn(s);
    await r.run(new Float32Array([1, 2, 3]));
    const params = s.named('texParameteri').map((c) => c.args.slice(1));
    expect(params.slice(4, 6)).toEqual([
      [s.constant('TEXTURE_MIN_FILTER'), s.constant('NEAREST')],
      [s.constant('TEXTURE_MAG_FILTER'), s.constant('NEAREST')],
    ]);
  });

  it('disables BLEND and clears the integer target with clearBufferuiv before the draw', async () => {
    const s = glStub({ blend: true });
    const r = await runnerOn(s);
    await r.run(new Float32Array([1, 2, 3]));
    const draw = s.indexOf('drawArrays');
    const disable = s.calls.findIndex(
      (c) => c.name === 'disable' && c.args[0] === s.constant('BLEND'),
    );
    const clear = s.indexOf('clearBufferuiv');
    expect(disable).toBeGreaterThan(-1);
    expect(disable).toBeLessThan(draw);
    expect(clear).toBeGreaterThan(-1);
    expect(clear).toBeLessThan(draw);
    expect(s.named('clearBufferuiv')[0]!.args).toEqual([
      s.constant('COLOR'),
      0,
      new Uint32Array([0, 0, 0, 0]),
    ]);
    expect(s.indexOf('clearColor')).toBe(-1);
  });

  it('passes the invocation count and the grid width in the dispatch uniform', async () => {
    const s = glStub();
    const r = await runnerOn(s);
    await r.run(new Float32Array([1, 2, 3, 4, 5]));
    await r.run(new Float32Array(3000));
    const uniforms = s.named('uniform4uiv').map((c) => c.args[1]);
    expect(uniforms).toEqual([new Uint32Array([5, 5, 0, 0]), new Uint32Array([3000, 2048, 0, 0])]);
  });

  it('binds the data texture to unit 0 for the sampler', async () => {
    const s = glStub();
    const r = await runnerOn(s);
    await r.run(new Float32Array([1, 2, 3]));
    expect(s.named('uniform1i').map((c) => c.args[1])).toEqual([0]);
  });

  it('looks the uniforms up under their GLSL spellings', async () => {
    const s = glStub();
    await runnerOn(s, kernelOf({ inputName: 'input' }));
    const names = s.named('getUniformLocation').map((c) => c.args[1]);
    expect(names).toEqual(['input_', 'u_dispatch']);
  });
});

describe('createComputeRunner webgl2 tier: grid and upload', () => {
  it('wraps both textures at 2048 texels and trims the grid padding from the result', async () => {
    const s = glStub();
    const r = await runnerOn(s);
    const got = await r.run(new Float32Array(3000));
    const sizes = s.named('texImage2D').map((c) => [c.args[3], c.args[4]]);
    expect(sizes).toEqual([
      [2048, 2],
      [2048, 2],
    ]);
    expect(s.named('readPixels')[0]!.args.slice(2, 4)).toEqual([2048, 2]);
    expect(got.length).toBe(3000);
    expect(got[0]).toBe(1);
    expect(got[2999]).toBe(3000);
  });

  it('keeps a short grid one row wide', async () => {
    const s = glStub();
    const r = await runnerOn(s);
    const got = await r.run(new Float32Array(10), 7);
    expect(s.named('texImage2D').map((c) => [c.args[3], c.args[4]])).toEqual([
      [10, 1],
      [7, 1],
    ]);
    expect(got.length).toBe(7);
  });

  it('zero-pads a partial last row so the upload covers the whole texture', async () => {
    const s = glStub();
    const r = await runnerOn(s);
    const data = Float32Array.from({ length: 2049 }, (_, i) => i + 1);
    await r.run(data);
    const upload = s.named('texSubImage2D')[0]!;
    const lanes = upload.args[8] as Float32Array;
    expect(upload.args.slice(4, 6)).toEqual([2048, 2]);
    expect(lanes.length).toBe(4096);
    expect(Array.from(lanes.subarray(0, 2049))).toEqual(Array.from(data));
    expect(lanes.subarray(2049).every((v) => v === 0)).toBe(true);
  });

  it('uploads the window of a subarray, not the start of its backing buffer', async () => {
    const s = glStub();
    const r = await runnerOn(s);
    const backing = Float32Array.from({ length: 12 }, (_, i) => i + 100);
    await r.run(backing.subarray(4, 9));
    const lanes = s.named('texSubImage2D')[0]!.args[8] as Float32Array;
    expect(Array.from(lanes)).toEqual([104, 105, 106, 107, 108]);
  });

  it('reads an integer input through a view of the caller window, unconverted', async () => {
    for (const elem of [u32T, i32T]) {
      const s = glStub();
      const r = await runnerOn(s, kernelOf({ elem }));
      const backing = new Float32Array(12);
      const bits = new Uint32Array(backing.buffer);
      bits.set([0, 0, 0, 0, 0xdeadbeef, 7, 0x80000001, 3, 9, 0, 0, 0]);
      await r.run(backing.subarray(4, 9));
      const lanes = s.named('texSubImage2D')[0]!.args[8] as Uint32Array | Int32Array;
      expect(lanes.constructor).toBe(elem === u32T ? Uint32Array : Int32Array);
      expect(Array.from(new Uint32Array(lanes.buffer, lanes.byteOffset, lanes.length))).toEqual([
        0xdeadbeef, 7, 0x80000001, 3, 9,
      ]);
    }
  });
});

describe('createComputeRunner webgl2 tier: lifetime', () => {
  it('emits and links once at construction, not per run', async () => {
    const s = glStub();
    const r = await runnerOn(s);
    expect(s.named('shaderSource').length).toBe(2);
    await r.run(new Float32Array([1]));
    await r.run(new Float32Array([1, 2]));
    expect(s.named('shaderSource').length).toBe(2);
    expect(s.named('linkProgram').length).toBe(1);
  });

  it('resolves webgl2 by default when only a context is present, and reports the skipped webgpu', async () => {
    const s = glStub();
    const r = await createComputeRunner(kernelOf(), { gl: s.gl });
    expect(r.backend).toBe('webgl2');
    expect(r.rejected.map((x) => x.backend)).toEqual(['webgpu']);
  });

  it('returns a promise from run on the cpu and webgl2 tiers', async () => {
    const s = glStub();
    const gl = await runnerOn(s);
    const cpu = await createComputeRunner(kernelOf(), { prefer: ['cpu'] });
    expect(gl.run(new Float32Array([1]))).toBeInstanceOf(Promise);
    expect(cpu.run(new Float32Array([1]))).toBeInstanceOf(Promise);
  });

  it('releases the program and the data texture once, however often dispose is called', async () => {
    const s = glStub();
    const r = await runnerOn(s);
    r.dispose();
    r.dispose();
    expect(s.named('deleteProgram').length).toBe(1);
    expect(s.named('deleteTexture').length).toBe(1);
  });

  it('refuses to run after dispose', async () => {
    const s = glStub();
    const r = await runnerOn(s);
    r.dispose();
    const error = await attempt(async () => r.run(new Float32Array([1])));
    expect(String(error)).toMatch(/runner has been disposed/);
  });
});

describe('createComputeRunner webgl2 tier: host state on every exit', () => {
  const host = { kind: 'host-program' };
  const hostTex = { kind: 'host-texture' };
  const hostViewport = [10, 20, 300, 200];

  it('restores the viewport after a dispatch', async () => {
    const s = glStub({ viewport: hostViewport });
    const r = await runnerOn(s);
    await r.run(new Float32Array(3000));
    expect(s.named('viewport')[0]!.args).toEqual([0, 0, 2048, 2]);
    expect(s.viewport()).toEqual(hostViewport);
  });

  it('unbinds the framebuffer after a dispatch', async () => {
    const s = glStub();
    const r = await runnerOn(s);
    await r.run(new Float32Array([1]));
    const binds = s.named('bindFramebuffer');
    expect(binds.at(-1)!.args[1]).toBeNull();
  });

  it('restores BLEND, program, texture and viewport when the framebuffer is incomplete', async () => {
    const s = glStub({
      blend: true,
      program: host,
      tex0: hostTex,
      viewport: hostViewport,
      framebufferStatus: INCOMPLETE,
    });
    const r = await runnerOn(s);
    const error = await attempt(async () => r.run(new Float32Array([1, 2])));
    expect(String(error)).toMatch(/R32UI framebuffer incomplete \(0x8cd6\)/);
    expect(s.blendEnabled()).toBe(true);
    expect(s.currentProgram()).toBe(host);
    expect(s.bindingOn(s.constant('TEXTURE0'))).toBe(hostTex);
    expect(s.viewport()).toEqual(hostViewport);
    expect(s.named('deleteFramebuffer').length).toBe(1);
    expect(s.named('deleteTexture').length).toBe(1);
  });

  it('restores the host state and frees the output texture when createFramebuffer fails', async () => {
    const s = glStub({ blend: true, program: host, tex0: hostTex, failFramebuffer: true });
    const r = await runnerOn(s);
    const error = await attempt(async () => r.run(new Float32Array([1, 2])));
    expect(String(error)).toMatch(/gl\.createFramebuffer failed/);
    expect(s.blendEnabled()).toBe(true);
    expect(s.currentProgram()).toBe(host);
    expect(s.bindingOn(s.constant('TEXTURE0'))).toBe(hostTex);
    expect(s.named('deleteTexture').length).toBe(1);
  });

  it('restores the host state when the output texture cannot be created', async () => {
    const s = glStub({ blend: true, program: host, tex0: hostTex, failTextureAt: 2 });
    const r = await runnerOn(s);
    const error = await attempt(async () => r.run(new Float32Array([1, 2])));
    expect(String(error)).toMatch(/gl\.createTexture \(out\) failed/);
    expect(s.blendEnabled()).toBe(true);
    expect(s.currentProgram()).toBe(host);
    expect(s.bindingOn(s.constant('TEXTURE0'))).toBe(hostTex);
  });

  it('restores the host texture binding after the last delete', async () => {
    const s = glStub({ tex0: hostTex });
    const r = await runnerOn(s);
    await r.run(new Float32Array([1, 2]));
    const lastDelete = s.lastIndexOf('deleteTexture');
    const restore = s.calls.findLastIndex((c) => c.name === 'bindTexture' && c.args[1] === hostTex);
    expect(lastDelete).toBeGreaterThan(-1);
    expect(restore).toBeGreaterThan(lastDelete);
  });

  it('takes the texture snapshot before the data upload binds its own texture', async () => {
    const s = glStub({ tex0: hostTex, activeUnit: 0x84c3 });
    const r = await runnerOn(s);
    await r.run(new Float32Array([1, 2]));
    const snapshot = s.calls.findIndex(
      (c) => c.name === 'getParameter' && c.args[0] === s.constant('TEXTURE_BINDING_2D'),
    );
    const firstBind = s.indexOf('bindTexture');
    expect(snapshot).toBeGreaterThan(-1);
    expect(snapshot).toBeLessThan(firstBind);
  });
});
