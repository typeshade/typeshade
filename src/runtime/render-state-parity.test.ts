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
import { COMPARE_FUNCTIONS, PASS_KEYS, STATE_KEYS, type RenderState } from './program.js';
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
  // The descriptor of each pass the encoder began, in order.
  const attachments: Record<string, unknown>[] = [];
  const pass = {
    setViewport: call('setViewport'),
    setScissorRect: call('setScissorRect'),
    setBlendConstant: call('setBlendConstant'),
    setStencilReference: call('setStencilReference'),
    setPipeline: () => commands.push('setPipeline'),
    setBindGroup: () => undefined,
    setVertexBuffer: () => undefined,
    setIndexBuffer: () => undefined,
    draw: (n: number) => commands.push(`draw ${n}`),
    drawIndexed: () => undefined,
    end: () => commands.push('end'),
  };
  const encoder = {
    beginRenderPass: (d: Record<string, unknown>) => (attachments.push(d), pass),
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
  return { device, commands, descriptors, attachments };
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
  'depth.bias.constant',
  'depth.bias.slopeScale',
  'depth.bias.clamp',
  'depth.stencil.compare',
  'depth.stencil.failOp',
  'depth.stencil.depthFailOp',
  'depth.stencil.passOp',
  'depth.stencil.front',
  'depth.stencil.back',
  'depth.stencil.readMask',
  'depth.stencil.writeMask',
  'depth.stencil.reference',
  'multisample.mask',
  'setStencilReference',
  'pass.color.target',
  'pass.color.clear',
  'pass.color.load',
  'pass.color.store',
  'pass.depth.target',
  'pass.depth.clear',
  'pass.depth.load',
  'pass.depth.store',
  'pass.depth.readOnly',
  'pass.depth.stencil.clear',
  'pass.depth.stencil.load',
  'pass.depth.stencil.store',
  'pass.depth.stencil.readOnly',
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
    // `bias` and `stencil` are objects of their own: their children are the keys. The face keys
    // of `front` and `back` are one row each, which the row of the shared field covers.
    const stateKeys = [
      ...STATE_KEYS.state.filter((k) => !['depth', 'primitive', 'multisample'].includes(k)),
      ...STATE_KEYS.depth.filter((k) => !['bias', 'stencil'].includes(k)).map((k) => `depth.${k}`),
      ...STATE_KEYS.bias.map((k) => `depth.bias.${k}`),
      ...STATE_KEYS.stencil
        .filter((k) => !['front', 'back'].includes(k))
        .map((k) => `depth.stencil.${k}`),
      'depth.stencil.front',
      'depth.stencil.back',
      ...STATE_KEYS.face.flatMap((k) => [`depth.stencil.front.${k}`, `depth.stencil.back.${k}`]),
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
    const rowFor = (key: string): string => {
      const face = /^depth\.stencil\.(front|back)\.(\w+)$/.exec(key);
      return face !== null ? `depth.stencil.${face[2]}` : (rowOf[key] ?? key);
    };
    for (const key of stateKeys)
      expect(ROWS, `no row for the state key ${key}`).toContain(rowFor(key));
    for (const m of methods) expect(ROWS, `no row for the RenderPass method ${m}`).toContain(m);
    expect(methods.sort()).toEqual([
      'draw',
      'setBlendConstant',
      'setScissorRect',
      'setStencilReference',
      'setViewport',
    ]);
  });
});

/** A WebGPU draw of `state` into a pass with a depth attachment of `depth`: the descriptor, and the
 *  pass calls of the draw. */
async function onGpuDepth(state: RenderState, depth: string) {
  const fake = gpuFake();
  const rt = await createRuntime({ device: fake.device as never });
  const pipeline = await rt.load(manifest()).render(state);
  const target = rt.texture({ size: [16, 12], format: 'rgba8unorm' });
  const d = rt.texture({ size: [16, 12], format: depth as never });
  rt.frame().pass({ color: [target], depth: d }, (p) => p.draw(pipeline, bindings, geometry));
  return { descriptor: fake.descriptors.at(-1)!, commands: fake.commands };
}

/** The WebGL2 calls of one draw of `state` into a pass with a depth attachment of `depth`. */
async function onGlDepth(state: RenderState, depth: string): Promise<string[]> {
  const { gl, calls } = glFake();
  const rt = await createRuntime({ device: gl });
  const pipeline = await rt.load(manifest()).render(state);
  const target = rt.texture({ size: [16, 12], format: 'rgba8unorm' });
  const d = rt.texture({ size: [16, 12], format: depth as never });
  const f = rt.frame();
  calls.length = 0;
  f.pass({ color: [target], depth: d }, (p) => p.draw(pipeline, bindings, geometry));
  await f.submit();
  return calls;
}

/** A promise's refusal message, or 'no refusal'. */
async function refusalOfAsync(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (e) {
    return e instanceof TypeError ? e.message : `not a TypeError: ${String(e)}`;
  }
  return 'no refusal';
}

/** The message a render refuses with, on either tier. */
async function refusalOf(state: RenderState): Promise<string> {
  const { gl } = glFake();
  const rt = await createRuntime({ device: gl });
  try {
    await rt.load(manifest()).render(state);
  } catch (e) {
    return e instanceof TypeError ? e.message : `not a TypeError: ${String(e)}`;
  }
  return 'no refusal';
}

const GL_OPERATION: Record<string, string> = {
  keep: 'KEEP',
  zero: 'ZERO',
  replace: 'REPLACE',
  invert: 'INVERT',
  'increment-clamp': 'INCR',
  'decrement-clamp': 'DECR',
  'increment-wrap': 'INCR_WRAP',
  'decrement-wrap': 'DECR_WRAP',
};

describe('the parity matrix of proposal 0064 (PR-2 rows)', () => {
  const STENCIL_DEPTH = 'depth24plus-stencil8';

  it('compares the stencil by each of the eight names, on both faces, on both tiers', async () => {
    for (const name of COMPARE_FUNCTIONS) {
      const state = { depth: { format: STENCIL_DEPTH, stencil: { compare: name } } } as RenderState;
      const { descriptor } = await onGpuDepth(state, STENCIL_DEPTH);
      expect(field(descriptor, 'depthStencil')).toMatchObject({
        stencilFront: { compare: name },
        stencilBack: { compare: name },
      });
      const gl = await onGlDepth(state, STENCIL_DEPTH);
      expect(gl).toContain(`stencilFuncSeparate(FRONT,${GL_COMPARE[name]},0,255)`);
      expect(gl).toContain(`stencilFuncSeparate(BACK,${GL_COMPARE[name]},0,255)`);
    }
  });

  it('takes each of the eight operations in each of the three places, on both tiers (24 states)', async () => {
    const places = ['failOp', 'depthFailOp', 'passOp'] as const;
    for (const op of Object.keys(GL_OPERATION))
      for (const place of places) {
        const state = { depth: { format: STENCIL_DEPTH, stencil: { [place]: op } } } as RenderState;
        const { descriptor } = await onGpuDepth(state, STENCIL_DEPTH);
        const want = {
          compare: 'always',
          failOp: 'keep',
          depthFailOp: 'keep',
          passOp: 'keep',
          [place]: op,
        };
        expect(field(descriptor, 'depthStencil').stencilFront).toEqual(want);
        const gl = await onGlDepth(state, STENCIL_DEPTH);
        // The GL name sits in the position of the place: fail, zfail, zpass.
        const slot = { failOp: 0, depthFailOp: 1, passOp: 2 }[place];
        const args = ['KEEP', 'KEEP', 'KEEP'];
        args[slot] = GL_OPERATION[op]!;
        expect(gl).toContain(`stencilOpSeparate(FRONT,${args.join(',')})`);
        // A shared operation applies to both faces.
        expect(gl).toContain(`stencilOpSeparate(BACK,${args.join(',')})`);
      }
  });

  it('reaches the right face with front and back overrides, on both tiers', async () => {
    const state = {
      depth: {
        format: STENCIL_DEPTH,
        stencil: { passOp: 'keep', front: { passOp: 'replace' }, back: { passOp: 'zero' } },
      },
    } as RenderState;
    const { descriptor } = await onGpuDepth(state, STENCIL_DEPTH);
    expect(field(descriptor, 'depthStencil')).toMatchObject({
      stencilFront: { passOp: 'replace' },
      stencilBack: { passOp: 'zero' },
    });
    const gl = await onGlDepth(state, STENCIL_DEPTH);
    expect(gl).toContain('stencilOpSeparate(FRONT,KEEP,KEEP,REPLACE)');
    expect(gl).toContain('stencilOpSeparate(BACK,KEEP,KEEP,ZERO)');
  });

  it('takes the masks as their low 8 bits, on both tiers', async () => {
    const read = { depth: { format: STENCIL_DEPTH, stencil: { readMask: 0x105 } } } as RenderState;
    expect(field((await onGpuDepth(read, STENCIL_DEPTH)).descriptor, 'depthStencil')).toMatchObject(
      {
        stencilReadMask: 5,
      },
    );
    expect(await onGlDepth(read, STENCIL_DEPTH)).toContain('stencilFuncSeparate(FRONT,ALWAYS,0,5)');
    const write = {
      depth: { format: STENCIL_DEPTH, stencil: { writeMask: 0x105 } },
    } as RenderState;
    expect(
      field((await onGpuDepth(write, STENCIL_DEPTH)).descriptor, 'depthStencil'),
    ).toMatchObject({
      stencilWriteMask: 5,
    });
    const gl = await onGlDepth(write, STENCIL_DEPTH);
    expect(gl).toContain('stencilMaskSeparate(FRONT,5)');
    expect(gl).toContain('stencilMaskSeparate(BACK,5)');
  });

  it('sets a declared reference before its draw on WebGPU and as the third argument on WebGL2, and refuses 256 on both', async () => {
    const state = { depth: { format: STENCIL_DEPTH, stencil: { reference: 1 } } } as RenderState;
    const { commands } = await onGpuDepth(state, STENCIL_DEPTH);
    expect(commands.filter((c) => /^(setStencilReference|draw) /.test(c))).toEqual([
      'setStencilReference 1',
      'draw 3',
    ]);
    expect(await onGlDepth(state, STENCIL_DEPTH)).toContain(
      'stencilFuncSeparate(FRONT,ALWAYS,1,255)',
    );
    expect(
      await refusalOf({
        depth: { format: STENCIL_DEPTH, stencil: { reference: 256 } },
      } as RenderState),
    ).toBe(
      'The render pipeline of "fs" (typeshade-input.ts:9) sets depth.stencil.reference to 256; it takes a whole number from 0 to 255.',
    );
  });

  it('gives a bias of each field on WebGPU, and on WebGL2 the constant and the slope, and refuses the clamp without its extension (A1)', async () => {
    const state = {
      depth: { format: 'depth32float', bias: { constant: -2, slopeScale: 3, clamp: 0.5 } },
    } as RenderState;
    expect(field((await onGpuDepth(state, 'depth32float')).descriptor, 'depthStencil')).toEqual({
      format: 'depth32float',
      depthCompare: 'less',
      depthWriteEnabled: true,
      depthBias: -2,
      depthBiasSlopeScale: 3,
      depthBiasClamp: 0.5,
    });
    // The fake exposes no EXT_polygon_offset_clamp, so the clamp is refused, with the extension named.
    expect(await refusalOf(state)).toBe(
      'The render pipeline of "fs" (typeshade-input.ts:9) sets depth.bias.clamp to 0.5; the WebGL2 tier takes a non-zero clamp only through EXT_polygon_offset_clamp, and this context lacks it.',
    );
    const bound = {
      depth: { format: 'depth32float', bias: { constant: -2, slopeScale: 3 } },
    } as RenderState;
    expect(await onGlDepth(bound, 'depth32float')).toContain('polygonOffset(3,-2)');
    const constant = { depth: { format: 'depth32float', bias: { constant: -2 } } } as RenderState;
    expect(await onGlDepth(constant, 'depth32float')).toContain('polygonOffset(0,-2)');
    const point = {
      primitive: { topology: 'point-list' },
      depth: { format: 'depth24plus', bias: { constant: 1 } },
    } as RenderState;
    const pointSentence =
      'The render pipeline of "fs" (typeshade-input.ts:9) sets depth.bias.constant 1 on a point-list topology; a bias applies to triangles only; give 0.';
    expect(await refusalOf(point)).toBe(pointSentence);
    const fake = gpuFake();
    const rt = await createRuntime({ device: fake.device as never });
    const refused = await refusalOfAsync(() => rt.load(manifest()).render(point));
    expect(refused).toBe(pointSentence);
  });

  it('sets the sample mask on WebGPU and draws or drops on WebGL2 by bit 0, and refuses a count of 4 with a mask', async () => {
    const keep = { multisample: { mask: 5 } } as RenderState;
    const fake = gpuFake();
    const rt = await createRuntime({ device: fake.device as never });
    await rt.load(manifest()).render(keep);
    expect(fake.descriptors.at(-1)!.multisample).toEqual({ mask: 5 });
    expect(await onGl(keep)).toContain('drawArraysInstanced(TRIANGLES,0,3,1)');
    expect(await onGl({ multisample: { mask: 4 } } as RenderState)).not.toContain(
      'drawArraysInstanced(TRIANGLES,0,3,1)',
    );
    const count = { multisample: { count: 4, mask: 5 } } as RenderState;
    const sentence =
      'The render pipeline of "fs" (typeshade-input.ts:9) sets multisample.mask with count 4; the mask takes count 1 only; remove the mask or set count 1.';
    expect(await refusalOf(count)).toBe(sentence);
  });

  it('records a pass value on WebGPU and nothing on WebGL2, and a stencil draw after it takes the value on both', async () => {
    const state = { depth: { format: STENCIL_DEPTH, stencil: {} } } as RenderState;
    // WebGPU: the value is a pass call; the draw sets it again.
    const fake = gpuFake();
    const rt = await createRuntime({ device: fake.device as never });
    const pipeline = await rt.load(manifest()).render(state);
    const target = rt.texture({ size: [16, 12], format: 'rgba8unorm' });
    const d = rt.texture({ size: [16, 12], format: STENCIL_DEPTH as never });
    rt.frame().pass({ color: [target], depth: d }, (p) => {
      p.setStencilReference(7);
      p.draw(pipeline, bindings, geometry);
    });
    expect(fake.commands.filter((c) => /^(setStencilReference|draw) /.test(c))).toEqual([
      'setStencilReference 7',
      'setStencilReference 7',
      'draw 3',
    ]);
    // WebGL2: no call of its own, and the draw takes the value as its reference.
    const { gl, calls } = glFake();
    const glRt = await createRuntime({ device: gl });
    const glPipe = await glRt.load(manifest()).render(state);
    const glTarget = glRt.texture({ size: [16, 12], format: 'rgba8unorm' });
    const glDepth = glRt.texture({ size: [16, 12], format: STENCIL_DEPTH as never });
    const f = glRt.frame();
    calls.length = 0;
    f.pass({ color: [glTarget], depth: glDepth }, (p) => {
      p.setStencilReference(7);
      p.draw(glPipe, bindings, geometry);
    });
    await f.submit();
    expect(calls.some((c) => c.startsWith('setStencilReference'))).toBe(false);
    expect(calls).toContain('stencilFuncSeparate(FRONT,ALWAYS,7,255)');
  });
});

describe('the parity matrix of proposal 0064 (PR-3 rows)', () => {
  const STENCIL_DEPTH = 'depth24plus-stencil8';
  const refusalOf = (run: () => unknown): string => {
    try {
      run();
    } catch (e) {
      return e instanceof TypeError ? e.message : `not a TypeError: ${String(e)}`;
    }
    return 'no refusal';
  };
  /** The pass-attachment fields of the matrix, as the descriptors and the calls of each tier show them. */
  const tailOf = (calls: readonly string[]): string[] =>
    calls.slice(calls.indexOf('useProgram(null)'));
  const WEBGPU_CANVAS = {
    getCurrentTexture: () => ({ createView: () => ({}), width: 16, height: 12 }),
  };
  const SAME_CANVAS =
    "The colour target 0 is the canvas: store 'discard' is refused; give store 'store'.";
  const gpu = async () => {
    const fake = gpuFake();
    const rt = await createRuntime({ device: fake.device as never });
    return { fake, rt };
  };
  const webgl = async () => {
    const { gl, calls } = glFake();
    const rt = await createRuntime({ device: gl });
    return { gl, calls, rt };
  };

  it('discards a colour target: storeOp on WebGPU, and a clear at the end on WebGL2 (store is the default)', async () => {
    const { fake, rt } = await gpu();
    const target = rt.texture({ size: [16, 12], format: 'rgba8unorm' });
    rt.frame().pass({ color: [{ target, store: 'discard' }] } as never, () => undefined);
    expect(fake.attachments[0]!.colorAttachments).toEqual([
      { view: expect.anything(), loadOp: 'clear', storeOp: 'discard', clearValue: [0, 0, 0, 0] },
    ]);
    const { rt: glRt, calls } = await webgl();
    const glTarget = glRt.texture({ size: [16, 12], format: 'rgba8unorm' });
    const f = glRt.frame();
    calls.length = 0;
    f.pass({ color: [{ target: glTarget, store: 'discard' }] } as never, () => undefined);
    await f.submit();
    expect(tailOf(calls)).toContain('clearBufferfv(COLOR,0,[0,0,0,0])');
    // The default store keeps the attachment: no clear after the pass.
    const g = glRt.frame();
    calls.length = 0;
    g.pass({ color: [glTarget] } as never, () => undefined);
    await g.submit();
    expect(tailOf(calls).some((c) => c.startsWith('clearBufferfv(COLOR'))).toBe(false);
  });

  it('refuses a discard of the canvas with the same sentence on both tiers', async () => {
    const { rt } = await gpu();
    const { rt: glRt, gl } = await webgl();
    const first = refusalOf(() =>
      rt
        .frame()
        .pass({ color: [{ target: WEBGPU_CANVAS, store: 'discard' }] } as never, () => undefined),
    );
    const second = refusalOf(() =>
      glRt.frame().pass({ color: [{ target: gl, store: 'discard' }] } as never, () => undefined),
    );
    expect(first).toBe(SAME_CANVAS);
    expect(second).toBe(SAME_CANVAS);
  });

  it('loads a colour target with load and clears it to the value given, on both tiers', async () => {
    const { fake, rt } = await gpu();
    const target = rt.texture({ size: [16, 12], format: 'rgba8unorm' });
    rt.frame().pass({ color: [{ target, load: 'load' }] } as never, () => undefined);
    expect(fake.attachments[0]!.colorAttachments).toMatchObject([{ loadOp: 'load' }]);
    const { rt: glRt, calls } = await webgl();
    const glTarget = glRt.texture({ size: [16, 12], format: 'rgba8unorm' });
    const f = glRt.frame();
    calls.length = 0;
    f.pass({ color: [{ target: glTarget, load: 'load' }] } as never, () => undefined);
    await f.submit();
    expect(calls.some((c) => c.startsWith('clearBufferfv(COLOR'))).toBe(false);
    const { fake: fake2, rt: rt2 } = await gpu();
    const t2 = rt2.texture({ size: [16, 12], format: 'rgba8unorm' });
    rt2
      .frame()
      .pass({ color: [{ target: t2, clear: [0.25, 0.5, 0.75, 1] }] } as never, () => undefined);
    expect(fake2.attachments[0]!.colorAttachments).toMatchObject([
      { clearValue: [0.25, 0.5, 0.75, 1] },
    ]);
    const g = glRt.frame();
    calls.length = 0;
    g.pass(
      { color: [{ target: glTarget, clear: [0.25, 0.5, 0.75, 1] }] } as never,
      () => undefined,
    );
    await g.submit();
    expect(calls).toContain('clearBufferfv(COLOR,0,[0.25,0.5,0.75,1])');
  });

  it('sets the depth store, load and clear on both tiers: discard, no load of a clear, and the clear value', async () => {
    const { fake, rt } = await gpu();
    const d = rt.texture({ size: [16, 12], format: STENCIL_DEPTH as never });
    const c = rt.texture({ size: [16, 12], format: 'rgba8unorm' });
    rt.frame().pass(
      { color: [c], depth: { target: d, store: 'discard', clear: 0.25 } } as never,
      () => undefined,
    );
    expect(fake.attachments[0]!.depthStencilAttachment).toMatchObject({
      depthStoreOp: 'discard',
      depthClearValue: 0.25,
    });
    rt.frame().pass({ color: [c], depth: { target: d, load: 'load' } } as never, () => undefined);
    expect(fake.attachments[1]!.depthStencilAttachment).toMatchObject({ depthLoadOp: 'load' });
    const { rt: glRt, calls } = await webgl();
    const gd = glRt.texture({ size: [16, 12], format: STENCIL_DEPTH as never });
    const gc = glRt.texture({ size: [16, 12], format: 'rgba8unorm' });
    const f = glRt.frame();
    calls.length = 0;
    f.pass(
      { color: [gc], depth: { target: gd, store: 'discard', clear: 0.25 } } as never,
      () => undefined,
    );
    await f.submit();
    expect(calls).toContain('clearBufferfv(DEPTH,0,[0.25])');
    expect(tailOf(calls)).toContain('clearBufferfv(DEPTH,0,[0])');
    const g = glRt.frame();
    calls.length = 0;
    g.pass({ color: [gc], depth: { target: gd, load: 'load' } } as never, () => undefined);
    await g.submit();
    expect(calls.some((c) => c.startsWith('clearBufferfv(DEPTH'))).toBe(false);
  });

  it('makes a read-only depth an attachment with no clear, load or store on either tier, and refuses a write on both', async () => {
    const { fake, rt } = await gpu();
    const d = rt.texture({ size: [16, 12], format: 'depth24plus' });
    const c = rt.texture({ size: [16, 12], format: 'rgba8unorm' });
    rt.frame().pass({ color: [c], depth: { target: d, readOnly: true } } as never, () => undefined);
    expect(fake.attachments[0]!.depthStencilAttachment).toEqual({
      view: expect.anything(),
      depthReadOnly: true,
    });
    const { rt: glRt, calls } = await webgl();
    const gd = glRt.texture({ size: [16, 12], format: 'depth24plus' });
    const gc = glRt.texture({ size: [16, 12], format: 'rgba8unorm' });
    const f = glRt.frame();
    calls.length = 0;
    f.pass({ color: [gc], depth: { target: gd, readOnly: true } } as never, () => undefined);
    await f.submit();
    expect(calls.some((x) => x.startsWith('clearBufferfv(DEPTH'))).toBe(false);
    const sentence =
      'pass.draw: the pipeline of "fs" writes depth, and the pass depth attachment is read-only; set depth.write to false.';
    const writesGpu = await rt
      .load(manifest())
      .render({ depth: { format: 'depth24plus' } } as never);
    const writesGl = await glRt
      .load(manifest())
      .render({ depth: { format: 'depth24plus' } } as never);
    expect(
      refusalOf(() =>
        rt
          .frame()
          .pass({ color: [c], depth: { target: d, readOnly: true } } as never, (p) =>
            writesGpu.draw(p, bindings, geometry),
          ),
      ),
    ).toBe(sentence);
    expect(
      refusalOf(() =>
        glRt
          .frame()
          .pass({ color: [gc], depth: { target: gd, readOnly: true } } as never, (p) =>
            writesGl.draw(p, bindings, geometry),
          ),
      ),
    ).toBe(sentence);
  });

  it('sets the stencil clear, load, store and readOnly on both tiers, and a read-only stencil takes no clear', async () => {
    const { fake, rt } = await gpu();
    const d = rt.texture({ size: [16, 12], format: STENCIL_DEPTH as never });
    const c = rt.texture({ size: [16, 12], format: 'rgba8unorm' });
    rt.frame().pass(
      { color: [c], depth: { target: d, stencil: { clear: 7 } } } as never,
      () => undefined,
    );
    expect(fake.attachments[0]!.depthStencilAttachment).toMatchObject({
      stencilLoadOp: 'clear',
      stencilClearValue: 7,
    });
    rt.frame().pass(
      { color: [c], depth: { target: d, stencil: { load: 'load' } } } as never,
      () => undefined,
    );
    expect(fake.attachments[1]!.depthStencilAttachment).toMatchObject({ stencilLoadOp: 'load' });
    rt.frame().pass(
      { color: [c], depth: { target: d, stencil: { store: 'discard' } } } as never,
      () => undefined,
    );
    expect(fake.attachments[2]!.depthStencilAttachment).toMatchObject({
      stencilStoreOp: 'discard',
    });
    rt.frame().pass(
      { color: [c], depth: { target: d, stencil: { readOnly: true } } } as never,
      () => undefined,
    );
    expect(fake.attachments[3]!.depthStencilAttachment).toMatchObject({ stencilReadOnly: true });
    const { rt: glRt, calls } = await webgl();
    const gd = glRt.texture({ size: [16, 12], format: STENCIL_DEPTH as never });
    const gc = glRt.texture({ size: [16, 12], format: 'rgba8unorm' });
    const run = async (depth: object) => {
      const f = glRt.frame();
      calls.length = 0;
      f.pass({ color: [gc], depth: { target: gd, ...depth } } as never, () => undefined);
      await f.submit();
      return calls;
    };
    expect(await run({ stencil: { clear: 7 } })).toContain('clearBufferiv(STENCIL,0,[7])');
    expect(
      (await run({ stencil: { load: 'load' } })).some((c) => c.startsWith('clearBufferiv(STENCIL')),
    ).toBe(false);
    expect(tailOf(await run({ stencil: { store: 'discard' } }))).toContain(
      'clearBufferiv(STENCIL,0,[0])',
    );
    expect(
      (await run({ stencil: { readOnly: true } })).some((c) =>
        c.startsWith('clearBufferiv(STENCIL'),
      ),
    ).toBe(false);
  });

  it('has a row for every key of PASS_KEYS, the nested keys included', () => {
    const keys = [
      ...PASS_KEYS.color.map((k) => `pass.color.${k}`),
      ...PASS_KEYS.depth.filter((k) => k !== 'stencil').map((k) => `pass.depth.${k}`),
      ...PASS_KEYS.stencil.map((k) => `pass.depth.stencil.${k}`),
    ];
    for (const key of keys) expect(ROWS, `no row for the pass key ${key}`).toContain(key);
  });
});
