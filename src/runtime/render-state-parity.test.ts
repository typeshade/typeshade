// The parity matrix of proposal 0064 (Required validation, "Parity matrix"), PR-1 rows: each
// render-state field and pass call has one row, and each row states what the WebGPU descriptor or
// call, the WebGL2 calls and the refusal are. A key of `STATE_KEYS` or a `RenderPass` method of
// `src/__api__/surface.md` with no row fails, so a new field cannot land without its row.
//
// The rows run on two fakes: a WebGPU device that records the descriptors and the pass calls, and
// a WebGL2 context that logs its calls. Each fake is small on purpose: the detailed fakes are in
// `runtime.test.ts` and `gl-draw.test.ts`, which hold the exact orders.
//
// Verifies: Rule 11.11.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compile } from '../compiler/ts/compile.js';
import { packModule } from '../compiler/ts/pack.js';
import { COMPARE_FUNCTIONS, STATE_KEYS, type RenderState } from './program.js';
import { createRuntime } from './runtime.js';

// A uniform block, which WebGL2 takes as a std140 struct (the GLSL writer refuses a bare vec4).
const DRAW = `"use typeshade";
class VsIn { @location(0) pos: vec2; }
class VsOut { @builtin("position") p: vec4; }
class Color { @location(0) c: vec4; }
class Tint { c: vec4; }
declare const tint: uniform<Tint>;
@vertex
export function vs(v: VsIn): VsOut { return { p: vec4(v.pos, 0., 1.) }; }
@fragment
export function fs(v: VsOut): Color { return { c: tint.c }; }
`;

const manifest = () => {
  const r = compile(DRAW);
  expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return packModule(r.module, { console: false });
};

const geometry = { vertices: new Float32Array(6), count: 3 };
const bindings = { tint: { c: [1, 0, 0, 1] } };

/** A WebGPU device: the descriptors it is asked for, and the pass calls it is given. */
function gpuFake() {
  const commands: string[] = [];
  const descriptors: Record<string, unknown>[] = [];
  const show = (v: unknown): string =>
    Array.isArray(v) || ArrayBuffer.isView(v)
      ? Array.from(v as ArrayLike<number>).join(',')
      : String(v);
  const call =
    (name: string) =>
    (...args: unknown[]) =>
      commands.push([name, ...args.map(show)].join(' '));
  const pass = {
    setViewport: call('setViewport'),
    setScissorRect: call('setScissorRect'),
    setBlendConstant: call('setBlendConstant'),
    setPipeline: () => commands.push('setPipeline'),
    setBindGroup: () => undefined,
    setVertexBuffer: () => undefined,
    setIndexBuffer: () => undefined,
    draw: (n: number) => commands.push(`draw ${n}`),
    drawIndexed: () => undefined,
    end: () => commands.push('end'),
  };
  const encoder = {
    beginRenderPass: () => pass,
    beginComputePass: () => pass,
    copyBufferToBuffer: () => undefined,
    finish: () => ({}),
  };
  const buffer = (d: { size: number }) => ({
    size: d.size,
    mapAsync: async () => undefined,
    getMappedRange: () => new ArrayBuffer(d.size),
    unmap: () => undefined,
    destroy: () => undefined,
  });
  const device = {
    features: new Set<string>(),
    limits: { maxTextureDimension2D: 8192 },
    queue: {
      submit: () => undefined,
      writeBuffer: () => undefined,
      writeTexture: () => undefined,
      onSubmittedWorkDone: async () => undefined,
    },
    createBuffer: buffer,
    createTexture: (d: { size: number[]; format: string }) => ({
      width: d.size[0],
      height: d.size[1],
      format: d.format,
      createView: () => ({}),
      destroy: () => undefined,
    }),
    createSampler: () => ({}),
    createShaderModule: () => ({}),
    createBindGroupLayout: (d: { entries: object[] }) => ({ entries: d.entries }),
    createPipelineLayout: () => ({}),
    createBindGroup: () => ({}),
    createRenderPipelineAsync: async (d: Record<string, unknown>) => (descriptors.push(d), {}),
    createComputePipelineAsync: async (d: Record<string, unknown>) => (descriptors.push(d), {}),
    createCommandEncoder: () => encoder,
    pushErrorScope: () => undefined,
    popErrorScope: async () => null,
  };
  return { device, commands, descriptors };
}

/** A WebGL2 context: every call logged as `name(args)`, constants by their names. */
function glFake() {
  const calls: string[] = [];
  const names = new Map<number, string>();
  const values = new Map<string, number>([['NONE', 0]]);
  let next = 0x4000;
  const valueOf = (name: string): number => {
    let v = values.get(name);
    if (v === undefined) {
      v = next++;
      values.set(name, v);
      names.set(v, name);
    }
    return v;
  };
  const show = (v: unknown): string => {
    if (typeof v === 'number') return names.get(v) ?? String(v);
    if (v !== null && typeof v === 'object' && '__name' in v)
      return (v as { __name: string }).__name;
    if (Array.isArray(v) || ArrayBuffer.isView(v))
      return `[${Array.from(v as ArrayLike<number>).join(',')}]`;
    return String(v);
  };
  const named = (name: string) => ({ __name: name });
  const host: Record<string, (...a: unknown[]) => unknown> = {
    getParameter: (p) => {
      switch (names.get(p as number)) {
        case 'MAX_COLOR_ATTACHMENTS':
          return 4;
        case 'VIEWPORT':
          return new Int32Array([1, 2, 3, 4]);
        case 'DEPTH_RANGE':
          return new Float32Array([0, 1]);
        case 'BLEND_COLOR':
          return new Float32Array([0, 0, 0, 0]);
        case 'MAX_VIEWPORT_DIMS':
          return new Int32Array([8192, 8192]);
        default:
          return 0;
      }
    },
    createFramebuffer: () => named('fbo'),
    createSampler: () => named('sampler'),
    createTexture: () => named('texture'),
    createShader: () => named('shader'),
    createProgram: () => named('program'),
    createVertexArray: () => named('vao'),
    createBuffer: () => named('buffer'),
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    isProgram: () => true,
    getExtension: () => null,
  };
  const props: Record<string, unknown> = { drawingBufferWidth: 16, drawingBufferHeight: 12 };
  const gl = new Proxy(
    {},
    {
      get: (_t, key) => {
        if (typeof key !== 'string') return undefined;
        if (key in props) return props[key];
        if (/^[A-Z][A-Z0-9_]*$/.test(key)) return valueOf(key);
        const fn = host[key] ?? (() => undefined);
        return (...a: unknown[]) => {
          if (key !== 'getError') calls.push(`${key}(${a.map(show).join(',')})`);
          return fn(...a);
        };
      },
    },
  ) as unknown as WebGL2RenderingContext;
  return { gl, calls };
}

/** A field of a pipeline descriptor the fake recorded. */
const field = (d: Record<string, unknown>, key: string): Record<string, unknown> =>
  d[key] as Record<string, unknown>;

/** The WebGPU descriptor of a pipeline of `state`, and the pass calls of one draw of it. */
async function onGpu(state: RenderState) {
  const fake = gpuFake();
  const rt = await createRuntime({ device: fake.device as never });
  const pipeline = await rt.load(manifest()).render(state);
  const target = rt.texture({ size: [16, 12], format: 'rgba8unorm' });
  rt.frame().pass({ color: [target] }, (p) => p.draw(pipeline, bindings, geometry));
  return { descriptor: fake.descriptors.at(-1)!, commands: fake.commands };
}

/** The WebGL2 calls of one draw of a pipeline of `state`, from the start of the draw's pass. */
async function onGl(state: RenderState) {
  const { gl, calls } = glFake();
  const rt = await createRuntime({ device: gl });
  const pipeline = await rt.load(manifest()).render(state);
  const target = rt.texture({ size: [16, 12], format: 'rgba8unorm' });
  const f = rt.frame();
  calls.length = 0;
  f.pass({ color: [target] }, (p) => {
    p.draw(pipeline, bindings, geometry);
  });
  await f.submit();
  return calls;
}

const GL_COMPARE: Record<string, string> = {
  never: 'NEVER',
  less: 'LESS',
  equal: 'EQUAL',
  'less-equal': 'LEQUAL',
  greater: 'GREATER',
  'not-equal': 'NOTEQUAL',
  'greater-equal': 'GEQUAL',
  always: 'ALWAYS',
};

/** The member names of an interface line of `surface.md`: the keys of its braces, split at the
 *  semicolons that sit outside any bracket, so a parameter's name is not one of them. */
function membersOf(line: string): string[] {
  const body = line.slice(line.indexOf('{') + 1, line.lastIndexOf('}'));
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of body) {
    if ('([{'.includes(ch)) depth++;
    if (')]}'.includes(ch)) depth--;
    if (ch === ';' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  parts.push(cur);
  return parts
    .map((x) => /^\s*(\w+)\??\s*:/.exec(x)?.[1])
    .filter((x): x is string => x !== undefined);
}

/** The rows this matrix holds: each key of `STATE_KEYS` as `depth.compare`, ..., and each `RenderPass`
 *  method. The last test checks that no key or method of the surface is missing here. */
const ROWS = [
  'vertex',
  'fragment',
  'targets',
  'constants',
  'blendConstant',
  'depth.compare',
  'depth.write',
  'depth.format',
  'primitive.topology',
  'primitive.cullMode',
  'primitive.frontFace',
  'multisample.count',
  'setViewport',
  'setScissorRect',
  'setBlendConstant',
  'draw',
];

describe('the parity matrix of proposal 0064 (PR-1 rows)', () => {
  it('compares depth by the eight CompareFunction names, on both tiers, in the order the type lists them', async () => {
    expect([...COMPARE_FUNCTIONS]).toEqual([
      'never',
      'less',
      'equal',
      'less-equal',
      'greater',
      'not-equal',
      'greater-equal',
      'always',
    ]);
    for (const name of COMPARE_FUNCTIONS) {
      const state = { depth: { format: 'depth24plus', compare: name } } as const;
      const gpu = await onGpu(state);
      expect(field(gpu.descriptor, 'depthStencil').depthCompare).toBe(name);
      const gl = await onGl(state);
      expect(gl).toContain(`depthFunc(${GL_COMPARE[name]})`);
    }
  });

  it('writes depth by depthWriteEnabled on WebGPU and by depthMask on WebGL2', async () => {
    const gpu = await onGpu({ depth: { format: 'depth32float', write: false } });
    expect(field(gpu.descriptor, 'depthStencil')).toEqual({
      format: 'depth32float',
      depthCompare: 'less',
      depthWriteEnabled: false,
    });
    expect(await onGl({ depth: { format: 'depth32float', write: false } })).toContain(
      'depthMask(false)',
    );
  });

  it('draws the topology and culls by the primitive keys, on both tiers', async () => {
    const gpu = await onGpu({
      primitive: { topology: 'line-list', cullMode: 'back', frontFace: 'cw' },
    });
    expect(field(gpu.descriptor, 'primitive')).toEqual({
      topology: 'line-list',
      cullMode: 'back',
      frontFace: 'cw',
    });
    // The GL leg takes the same front face: 'cw' is GL's CCW, because the y flip turns the winding.
    const gl = await onGl({
      primitive: { topology: 'line-list', cullMode: 'back', frontFace: 'cw' },
    });
    expect(gl).toContain('enable(CULL_FACE)');
    expect(gl).toContain('cullFace(BACK)');
    expect(gl).toContain('frontFace(CCW)');
    expect(gl.some((c) => c.startsWith('drawArraysInstanced(LINES,'))).toBe(true);
    // The default 'ccw' is GL's CW.
    const bare = await onGl({ primitive: { topology: 'line-list', cullMode: 'back' } });
    expect(bare).toContain('frontFace(CW)');
  });

  it('gives a multisampled pipeline its count on WebGPU, and refuses it on WebGL2 in the existing sentence', async () => {
    const gpu = await onGpu({ multisample: { count: 4 } });
    expect(field(gpu.descriptor, 'multisample')).toEqual({ count: 4 });
    const { gl } = glFake();
    const rt = await createRuntime({ device: gl });
    await expect(rt.load(manifest()).render({ multisample: { count: 4 } })).rejects.toThrow(
      'The render pipeline of "fs" (typeshade-input.ts:9): the WebGL2 tier draws with one sample; a multisampled target is not here.',
    );
  });

  it('sets a pipeline blend constant before its draw: setBlendConstant on WebGPU, blendColor on WebGL2', async () => {
    const gpu = await onGpu({ blendConstant: [1, 0, 0, 1] });
    const drawAt = gpu.commands.indexOf('draw 3');
    expect(gpu.commands[drawAt - 1]).toBe('setBlendConstant 1,0,0,1');
    const gl = await onGl({ blendConstant: [1, 0, 0, 1] });
    const blendAt = gl.indexOf('blendColor(1,0,0,1)');
    expect(blendAt).toBeGreaterThanOrEqual(0);
    expect(blendAt).toBeLessThan(gl.findIndex((c) => c.startsWith('drawArraysInstanced(')));
  });

  it('refuses a pipeline blend constant of length 3 or of a component outside 0 to 1, with the whole sentence', async () => {
    const { gl } = glFake();
    const rt = await createRuntime({ device: gl });
    const program = rt.load(manifest());
    const sets = 'The render pipeline of "fs" (typeshade-input.ts:9) sets blendConstant';
    await expect(program.render({ blendConstant: [0, 0, 0] } as never)).rejects.toThrow(
      `${sets} to [0, 0, 0]; it takes four numbers from 0 to 1.`,
    );
    await expect(program.render({ blendConstant: [2, 0, 0, 0] } as never)).rejects.toThrow(
      `${sets} to [2, 0, 0, 0]; it takes four numbers from 0 to 1.`,
    );
  });

  it('sets the viewport on WebGPU with its depth range, and on WebGL2 as viewport then depthRange', async () => {
    const fake = gpuFake();
    const rt = await createRuntime({ device: fake.device as never });
    rt.frame().pass({ color: [rt.texture({ size: [16, 12], format: 'rgba8unorm' })] }, (p) =>
      p.setViewport(3, 2, 8, 6, 0.25, 0.75),
    );
    expect(fake.commands).toContain('setViewport 3 2 8 6 0.25 0.75');
    const { gl, calls } = glFake();
    const rt2 = await createRuntime({ device: gl });
    const f = rt2.frame();
    calls.length = 0;
    f.pass({ color: [rt2.texture({ size: [16, 12], format: 'rgba8unorm' })] }, (p) =>
      p.setViewport(3, 2, 8, 6, 0.25, 0.75),
    );
    await f.submit();
    const v = calls.indexOf('viewport(3,2,8,6)');
    expect(v).toBeGreaterThanOrEqual(0);
    expect(calls[v + 1]).toBe('depthRange(0.25,0.75)');
  });

  it('clips the scissor on WebGL2 and enables it, the pass rectangle being clipped to the target', async () => {
    const { gl, calls } = glFake();
    const rt = await createRuntime({ device: gl });
    const target = rt.texture({ size: [16, 12], format: 'rgba8unorm' });
    const f = rt.frame();
    calls.length = 0;
    f.pass({ color: [target] }, (p) => p.setScissorRect(10, 6, 20, 20));
    await f.submit();
    expect(calls).toContain('enable(SCISSOR_TEST)');
    expect(calls).toContain('scissor(10,6,6,6)');
  });

  it('sets the pass blend constant as setBlendConstant on WebGPU and as blendColor on WebGL2', async () => {
    const fake = gpuFake();
    const rt = await createRuntime({ device: fake.device as never });
    rt.frame().pass({ color: [rt.texture({ size: [16, 12], format: 'rgba8unorm' })] }, (p) =>
      p.setBlendConstant(new Float32Array([0.25, 0.5, 0.75, 1])),
    );
    expect(fake.commands).toContain('setBlendConstant 0.25,0.5,0.75,1');
    const { gl, calls } = glFake();
    const rt2 = await createRuntime({ device: gl });
    const f = rt2.frame();
    calls.length = 0;
    f.pass({ color: [rt2.texture({ size: [16, 12], format: 'rgba8unorm' })] }, (p) =>
      p.setBlendConstant([0.25, 0.5, 0.75, 1]),
    );
    await f.submit();
    expect(calls).toContain('blendColor(0.25,0.5,0.75,1)');
  });

  it('names the state keys with no typed row of their own in the existing sentences, which the matrix refers to', async () => {
    const { gl } = glFake();
    const rt = await createRuntime({ device: gl });
    const program = rt.load(manifest());
    await expect(program.render({ vertex: 'nope' })).rejects.toThrow(
      'The program has no @vertex entry "nope"; its @vertex entries are "vs".',
    );
    await expect(program.render({ fragment: 'nope' })).rejects.toThrow(
      'The program has no @fragment entry "nope"; its @fragment entries are "fs".',
    );
    await expect(program.render({ constants: { nope: 1 } })).rejects.toThrow(
      'The program has no override "nope"; its overrides are none.',
    );
    await expect(program.render({ targets: ['rgba32uint'] })).rejects.toThrow(
      'which a rgba32uint target cannot hold;',
    );
  });

  it('has a row for every key of STATE_KEYS and every RenderPass method of the surface', () => {
    // The keys of the state: each top-level key, and each key one level down.
    const stateKeys = [
      ...STATE_KEYS.state.filter((k) => !['depth', 'primitive', 'multisample'].includes(k)),
      ...STATE_KEYS.depth.map((k) => `depth.${k}`),
      ...STATE_KEYS.primitive.map((k) => `primitive.${k}`),
      ...STATE_KEYS.multisample.map((k) => `multisample.${k}`),
    ];
    const surface = readFileSync(
      fileURLToPath(new URL('../__api__/surface.md', import.meta.url)),
      'utf8',
    );
    const pass = surface
      .split('\n')
      .find((l) => l.startsWith('src/runtime/runtime.ts#RenderPass '));
    const methods = membersOf(pass ?? '').filter((m) => m !== 'raw');
    // A key that a row names with another, as one row holds the topology, cull and front face.
    const rowOf: Record<string, string> = {
      'depth.format': 'depth.write',
      'primitive.frontFace': 'primitive.topology',
      'primitive.cullMode': 'primitive.cullMode',
    };
    for (const key of stateKeys)
      expect(ROWS, `no row for the state key ${key}`).toContain(rowOf[key] ?? key);
    for (const m of methods) expect(ROWS, `no row for the RenderPass method ${m}`).toContain(m);
    expect(methods.sort()).toEqual(['draw', 'setBlendConstant', 'setScissorRect', 'setViewport']);
  });
});
