// A pass on WebGL2 leaves no error on its context.
//
// A pass detaches the colour attachments it does not use. It once did so up to
// `COLOR_ATTACHMENT7` whatever the context allowed, and on a context whose
// `MAX_COLOR_ATTACHMENTS` is lower (SwiftShader's) each detach past the limit was `INVALID_ENUM`.
// The error stayed on the context, which the call layer shares with the program runtime where
// there is no WebGPU, and the next kernel call's `getError()` reported it as its own failure
// (`WebGL2 error 0x500`). This suite holds the pass to a context that refuses an attachment at or
// above 4; `bun run gate:journeys` holds the same order of calls on a real WebGL2 context.
//
// The pass procedure of proposal 0064 (PR-1) is held here as the order of the calls the context
// receives: `calls` logs every call as `name(args)`, with each constant printed by its name, and
// each object by the name the fake gives it. The journeys hold the same order on a real context.

import { describe, expect, it } from 'vitest';
import { compile as compileTs } from '../compiler/ts/compile.js';
import { packModule } from '../compiler/ts/pack.js';
import { createRuntime, type RenderPass } from './runtime.js';
import { GlDrawing, GlTextureImpl, recordPass } from './gl-draw.js';

const COLOR_ATTACHMENT0 = 0x8ce0;
const MAX_COLOR_ATTACHMENTS = 0x8cdf;
const INVALID_ENUM = 0x500;

/** A WebGL2 context that does nothing, allows `max` colour attachments, and keeps the first error
 *  a call raises until `getError()` reads it, as WebGL2 does. Its host state is what a runtime
 *  reads at the start of a pass: a viewport of 1, 2, 3, 4, a depth range of 0.125 to 0.875 and a
 *  blend constant of 0.5, 0.25, 0.125, 0.0625. `linked` says whether `isProgram` answers true, which
 *  makes the runtime's own `compile()` reuse a program it linked before. */
function fakeGl(
  max: number,
  linked = true,
  viewportLimit = 8192,
): { gl: WebGL2RenderingContext; attached: number[]; calls: string[] } {
  let error = 0;
  const attached: number[] = [];
  const calls: string[] = [];
  const values: Record<string, number> = {
    NO_ERROR: 0,
    NONE: 0,
    INVALID_ENUM,
    MAX_COLOR_ATTACHMENTS,
    COLOR_ATTACHMENT0,
    FRAMEBUFFER: 0x8d40,
    TEXTURE_2D: 0x0de1,
    DEPTH_STENCIL_ATTACHMENT: 0x821a,
  };
  const names = new Map<number, string>();
  for (const [name, value] of Object.entries(values)) if (value !== 0) names.set(value, name);
  // Every other constant gets a value of its own, from 0x4000 on, the first time a call reads it.
  let next = 0x4000;
  const valueOf = (name: string): number => {
    if (!(name in values)) {
      values[name] = next++;
      names.set(values[name], name);
    }
    return values[name];
  };
  const show = (v: unknown): string => {
    if (typeof v === 'number') return names.get(v) ?? String(v);
    if (v !== null && typeof v === 'object' && '__name' in v)
      return (v as { __name: string }).__name;
    if (Array.isArray(v) || ArrayBuffer.isView(v))
      return `[${Array.from(v as ArrayLike<number>)
        .map((x) => names.get(x) ?? String(x))
        .join(',')}]`;
    return String(v);
  };
  const named = (name: string): object => ({ __name: name });
  let framebuffers = 0;
  const host: Record<string, (...a: unknown[]) => unknown> = {
    getParameter: (p) => {
      switch (names.get(p as number)) {
        case 'MAX_COLOR_ATTACHMENTS':
          return max;
        case 'VIEWPORT':
          return new Int32Array([1, 2, 3, 4]);
        case 'DEPTH_RANGE':
          return new Float32Array([0.125, 0.875]);
        case 'BLEND_COLOR':
          return new Float32Array([0.5, 0.25, 0.125, 0.0625]);
        case 'MAX_VIEWPORT_DIMS':
          return new Int32Array([viewportLimit, viewportLimit]);
        default:
          return 0;
      }
    },
    getError: () => {
      const e = error;
      error = 0;
      return e;
    },
    framebufferTexture2D: (_target, attachment) => {
      const at = attachment as number;
      if (at >= COLOR_ATTACHMENT0 && at < COLOR_ATTACHMENT0 + 16) {
        if (at - COLOR_ATTACHMENT0 >= max) {
          if (error === 0) error = INVALID_ENUM;
          return;
        }
        attached.push(at - COLOR_ATTACHMENT0);
      }
    },
    createFramebuffer: () => named(framebuffers++ === 0 ? 'fbo' : 'blitFbo'),
    createSampler: () => named('sampler'),
    createTexture: () => named('texture'),
    createShader: () => named('shader'),
    createProgram: () => named('program'),
    createVertexArray: () => named('vao'),
    createBuffer: () => named('buffer'),
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    isProgram: () => linked,
    getExtension: () => null,
    // A stencil call takes FRONT or BACK as its face; any other constant is an invalid enum.
    stencilFuncSeparate: (face) => faceOk(face),
    stencilOpSeparate: (face) => faceOk(face),
    stencilMaskSeparate: (face) => faceOk(face),
  };
  const faceOk = (face: unknown): void => {
    if ((face === valueOf('FRONT') || face === valueOf('BACK')) === false && error === 0)
      error = INVALID_ENUM;
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
  return { gl, attached, calls };
}

/** The calls of the pass procedure's own list: the state and the draw calls, not the set-up. */
const PASS_CALLS = [
  'bindFramebuffer',
  'disable',
  'enable',
  'getParameter',
  'viewport',
  'depthRange',
  'blendColor',
  'scissor',
  'drawBuffers',
  'colorMask',
  'depthMask',
  'stencilMask',
  'clearBufferfv',
  'clearBufferiv',
  'clearBufferfi',
  'useProgram',
];
const passCalls = (calls: readonly string[]): string[] =>
  calls.filter((c) => PASS_CALLS.some((n) => c.startsWith(`${n}(`)));

/** The message a call throws, or 'no refusal'. A refusal is a TypeError; a test asserts the whole. */
const refusalOf = (run: () => unknown): string => {
  try {
    run();
  } catch (e) {
    return e instanceof TypeError ? e.message : `not a TypeError: ${String(e)}`;
  }
  return 'no refusal';
};

/** `refusalOf` for a call that returns a promise: a rejection is the refusal. */
const refusalOfAsync = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run();
  } catch (e) {
    return e instanceof TypeError ? e.message : `not a TypeError: ${String(e)}`;
  }
  return 'no refusal';
};

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

const FRAG_DEPTH = `"use typeshade";
class VsOut { @builtin("position") p: vec4; }
class Depth { @builtin("frag_depth") depth: f32; }
@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  return { p: vec4(f32(vi), 0., 0., 1.) };
}
@fragment
export function fs(v: VsOut): Depth { return { depth: 0.5 }; }
`;

const manifest = (src: string) => {
  const r = compileTs(src);
  if (r.diagnostics.some((d) => d.category === 'error'))
    throw new Error('the source does not compile');
  return packModule(r.module, { console: false });
};

describe('a WebGL2 pass and MAX_COLOR_ATTACHMENTS', () => {
  it('detaches only the attachments the context has, and leaves getError() clean', async () => {
    const { gl, attached } = fakeGl(4);
    const d = new GlDrawing(gl);
    expect(d.maxColorAttachments).toBe(4);
    await recordPass(d, {}, () => undefined)();
    expect(gl.getError()).toBe(0);
    expect(attached).toEqual([0, 1, 2, 3]);
  });

  it('the fake refuses an attachment past its limit (the instrument is not blind)', () => {
    const { gl } = fakeGl(4);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, COLOR_ATTACHMENT0 + 6, gl.TEXTURE_2D, null, 0);
    expect(gl.getError()).toBe(INVALID_ENUM);
    expect(gl.getError()).toBe(0);
  });
});

describe('the WebGL2 pass procedure (proposal 0064, PR-1)', () => {
  it('runs the pass procedure in the order the proposal gives, with the recorded steps in the middle', async () => {
    const { gl, calls } = fakeGl(4);
    const d = new GlDrawing(gl);
    const colour = new GlTextureImpl(d, { size: [16, 12], format: 'rgba8unorm' });
    const depth = new GlTextureImpl(d, { size: [16, 12], format: 'depth24plus-stencil8' });
    const run = recordPass(d, { color: [colour], depth }, (p) => {
      p.setViewport(3, 2, 8, 6, 0.25, 0.75);
      p.setScissorRect(10, 6, 20, 20);
      p.setBlendConstant([0.25, 0.5, 0.75, 1]);
    });
    calls.length = 0;
    await run();
    expect(passCalls(calls)).toEqual([
      'bindFramebuffer(FRAMEBUFFER,fbo)',
      'disable(SCISSOR_TEST)',
      'getParameter(VIEWPORT)',
      'getParameter(DEPTH_RANGE)',
      'getParameter(BLEND_COLOR)',
      'viewport(0,0,16,12)',
      'depthRange(0,1)',
      'blendColor(0,0,0,0)',
      'drawBuffers([COLOR_ATTACHMENT0])',
      'colorMask(true,true,true,true)',
      'depthMask(true)',
      'stencilMask(4294967295)',
      'clearBufferfv(COLOR,0,[0,0,0,0])',
      'clearBufferfv(DEPTH,0,[1])',
      'clearBufferiv(STENCIL,0,[0])',
      'viewport(3,2,8,6)',
      'depthRange(0.25,0.75)',
      'enable(SCISSOR_TEST)',
      'scissor(10,6,6,6)',
      'blendColor(0.25,0.5,0.75,1)',
      'useProgram(null)',
      'disable(SCISSOR_TEST)',
      'colorMask(true,true,true,true)',
      'depthMask(true)',
      'stencilMask(4294967295)',
      'viewport(1,2,3,4)',
      'depthRange(0.125,0.875)',
      'blendColor(0.5,0.25,0.125,0.0625)',
      'bindFramebuffer(FRAMEBUFFER,null)',
    ]);
    expect(calls.some((c) => c.startsWith('clearBufferfi('))).toBe(false);
  });

  it('gives each pass the host state at its start and no state of the pass before it', async () => {
    const { gl, calls } = fakeGl(4);
    const d = new GlDrawing(gl);
    const colour = new GlTextureImpl(d, { size: [16, 12], format: 'rgba8unorm' });
    const runPass = async (record: Parameters<typeof recordPass>[2]): Promise<string[]> => {
      calls.length = 0;
      await recordPass(d, { color: [colour] }, record)();
      return passCalls(calls);
    };
    const first = await runPass(() => undefined);
    await runPass((p) => {
      p.setViewport(3, 2, 8, 6, 0.25, 0.75);
      p.setBlendConstant([1, 1, 1, 1]);
    });
    const third = await runPass(() => undefined);
    expect(third).toEqual(first);
    expect(first.slice(1, 8)).toEqual([
      'disable(SCISSOR_TEST)',
      'getParameter(VIEWPORT)',
      'getParameter(DEPTH_RANGE)',
      'getParameter(BLEND_COLOR)',
      'viewport(0,0,16,12)',
      'depthRange(0,1)',
      'blendColor(0,0,0,0)',
    ]);
  });

  it('turns a canvas target over, and takes the scissor off before each blit, so a scissor does not clip it', async () => {
    const { gl, calls } = fakeGl(4);
    const d = new GlDrawing(gl);
    const run = recordPass(d, { color: [{ target: gl, load: 'load' }] }, () => undefined);
    calls.length = 0;
    await run();
    const blits = calls.flatMap((c, i) => (c.startsWith('blitFramebuffer(') ? [i] : []));
    expect(blits).toHaveLength(2);
    for (const i of blits) {
      const toggles = calls
        .slice(0, i)
        .filter((c) => c === 'disable(SCISSOR_TEST)' || c === 'enable(SCISSOR_TEST)');
      expect(toggles.at(-1)).toBe('disable(SCISSOR_TEST)');
    }
  });

  it('clips a scissor to the target, passes it through when it fits, and keeps its y as the texture row', async () => {
    const { gl, calls } = fakeGl(4);
    const d = new GlDrawing(gl);
    const colour = new GlTextureImpl(d, { size: [16, 12], format: 'rgba8unorm' });
    const scissorOf = async (x: number, y: number, w: number, h: number): Promise<string[]> => {
      calls.length = 0;
      const run = recordPass(d, { color: [colour] }, (p) => p.setScissorRect(x, y, w, h));
      await run();
      return calls.filter((c) => c.startsWith('scissor(') || c === 'enable(SCISSOR_TEST)');
    };
    expect(await scissorOf(3, 2, 9, 5)).toEqual(['enable(SCISSOR_TEST)', 'scissor(3,2,9,5)']);
    expect(await scissorOf(10, 6, 20, 20)).toEqual(['enable(SCISSOR_TEST)', 'scissor(10,6,6,6)']);
    // A rectangle wholly past the target keeps its size at zero, on this tier as on WebGPU.
    expect(await scissorOf(20, 20, 4, 4)).toEqual(['enable(SCISSOR_TEST)', 'scissor(16,12,0,0)']);
  });

  it('refuses what the pass calls do not take, in whole, on this tier too', async () => {
    // The fake's MAX_VIEWPORT_DIMS is 4096 here, so the limit in the sentence is the context's own (T2).
    const { gl } = fakeGl(4, true, 4096);
    const rt = await createRuntime({ device: gl });
    const target = rt.texture({ size: [16, 12], format: 'rgba8unorm' });
    const got: string[] = [];
    rt.frame().pass({ color: [target] }, (p) => {
      got.push(refusalOf(() => p.setViewport(0, 0, 0.5, 4)));
      got.push(refusalOf(() => p.setViewport(0, 0, 4097, 4)));
      got.push(refusalOf(() => p.setViewport(0, 0, 4, 4, 0.8, 0.2)));
      got.push(refusalOf(() => p.setScissorRect(0, 0, -1, 4)));
      got.push(refusalOf(() => p.setBlendConstant([0.25, 0.5, 0.75])));
    });
    expect(got).toEqual([
      'pass.setViewport takes whole numbers; width is 0.5.',
      'pass.setViewport takes a width and a height from 0 to 4096, the viewport limit here; got width 4097.',
      'pass.setViewport takes depths with 0 <= minDepth <= maxDepth <= 1; got minDepth 0.8 and maxDepth 0.2.',
      'pass.setScissorRect takes whole numbers from 0 up; got width -1.',
      'pass.setBlendConstant takes four numbers; color has 3 numbers.',
    ]);
  });

  it('pins the viewport bounds at the limit of 8192, the edges in and out (T3)', async () => {
    const { gl, calls } = fakeGl(4);
    const rt = await createRuntime({ device: gl });
    const target = rt.texture({ size: [16, 12], format: 'rgba8unorm' });
    const got: string[] = [];
    calls.length = 0;
    const f = rt.frame();
    f.pass({ color: [target] }, (p) => {
      for (const args of [
        [-16384, 0, 8192, 8192],
        [0, 0, 8192, 8192],
        [8191, 0, 8192, 8192],
      ] as readonly (readonly [number, number, number, number])[])
        got.push(refusalOf(() => p.setViewport(args[0], args[1], args[2], args[3])));
      for (const args of [
        [-16385, 0, 8192, 8192],
        [0, 0, 8193, 8192],
        [8192, 0, 8192, 8192],
      ] as readonly (readonly [number, number, number, number])[])
        got.push(refusalOf(() => p.setViewport(args[0], args[1], args[2], args[3])));
    });
    await f.submit();
    expect(got).toEqual([
      'no refusal',
      'no refusal',
      'no refusal',
      'pass.setViewport takes x and y from -16384, and x + width and y + height up to 16383, the viewport bounds here; got x -16385.',
      'pass.setViewport takes a width and a height from 0 to 8192, the viewport limit here; got width 8193.',
      'pass.setViewport takes x and y from -16384, and x + width and y + height up to 16383, the viewport bounds here; got x + width 16384.',
    ]);
    // The three accepted rectangles reach the context as they were given.
    expect(
      passCalls(calls).filter((c) => c.startsWith('viewport(') && c.includes(',8192,')),
    ).toEqual([
      'viewport(-16384,0,8192,8192)',
      'viewport(0,0,8192,8192)',
      'viewport(8191,0,8192,8192)',
    ]);
  });
});

describe('render pipelines and blend constants on WebGL2 (proposal 0064, PR-1)', () => {
  it('sets a declared blend constant before its draw and the pass value again before an undeclared draw after it (R32)', async () => {
    const { gl, calls } = fakeGl(4);
    const rt = await createRuntime({ device: gl });
    const program = rt.load(manifest(DRAW));
    const a = await program.render({ blendConstant: [1, 0, 0, 1] });
    const b = await program.render({});
    const colour = rt.texture({ size: [16, 12], format: 'rgba8unorm' });
    const geometry = { vertices: new Float32Array(6), count: 3 };
    calls.length = 0;
    const f = rt.frame();
    f.pass({ color: [colour] }, (p) => {
      p.setBlendConstant([0, 1, 0, 1]);
      p.draw(a, { tint: { c: [1, 0, 0, 1] } }, geometry);
      p.draw(b, { tint: { c: [1, 0, 0, 1] } }, geometry);
      p.draw(b, { tint: { c: [1, 0, 0, 1] } }, geometry);
    });
    await f.submit();
    // The pass sets its constant to 0 at its start and gives the host's back at its end; between
    // them, the draws set the constants of R32.
    expect(calls.filter((c) => /^(blendColor|drawArraysInstanced)\(/.test(c))).toEqual([
      'blendColor(0,0,0,0)',
      'blendColor(0,1,0,1)',
      'blendColor(1,0,0,1)',
      'drawArraysInstanced(TRIANGLES,0,3,1)',
      'blendColor(0,1,0,1)',
      'drawArraysInstanced(TRIANGLES,0,3,1)',
      'drawArraysInstanced(TRIANGLES,0,3,1)',
      'blendColor(0.5,0.25,0.125,0.0625)',
    ]);
  });

  it('restores the default pass value before an undeclared draw after a declared one, with no setBlendConstant call (T1)', async () => {
    const { gl, calls } = fakeGl(4);
    const rt = await createRuntime({ device: gl });
    const program = rt.load(manifest(DRAW));
    const declares = await program.render({ blendConstant: [1, 0, 0, 1] });
    const bare = await program.render({});
    const colour = rt.texture({ size: [16, 12], format: 'rgba8unorm' });
    const geometry = { vertices: new Float32Array(6), count: 3 };
    const tint = { tint: { c: [1, 0, 0, 1] } };
    calls.length = 0;
    const f = rt.frame();
    f.pass({ color: [colour] }, (p) => {
      p.draw(declares, tint, geometry);
      p.draw(bare, tint, geometry);
    });
    await f.submit();
    expect(calls.filter((c) => /^(blendColor|drawArraysInstanced)\(/.test(c))).toEqual([
      'blendColor(0,0,0,0)',
      'blendColor(1,0,0,1)',
      'drawArraysInstanced(TRIANGLES,0,3,1)',
      'blendColor(0,0,0,0)',
      'drawArraysInstanced(TRIANGLES,0,3,1)',
      'blendColor(0.5,0.25,0.125,0.0625)',
    ]);
  });

  it('copies the pass value at the record of an undeclared draw, not at its run (T1)', async () => {
    const { gl, calls } = fakeGl(4);
    const rt = await createRuntime({ device: gl });
    const program = rt.load(manifest(DRAW));
    const declares = await program.render({ blendConstant: [1, 0, 0, 1] });
    const bare = await program.render({});
    const colour = rt.texture({ size: [16, 12], format: 'rgba8unorm' });
    const geometry = { vertices: new Float32Array(6), count: 3 };
    const tint = { tint: { c: [1, 0, 0, 1] } };
    calls.length = 0;
    const f = rt.frame();
    f.pass({ color: [colour] }, (p) => {
      p.draw(declares, tint, geometry);
      p.draw(bare, tint, geometry);
      p.setBlendConstant([0, 1, 0, 1]);
      p.draw(bare, tint, geometry);
    });
    await f.submit();
    // The second draw's restore is the pass value at its record, [0,0,0,0], although the pass
    // sets [0,1,0,1] before the third draw runs.
    expect(calls.filter((c) => /^(blendColor|drawArraysInstanced)\(/.test(c))).toEqual([
      'blendColor(0,0,0,0)',
      'blendColor(1,0,0,1)',
      'drawArraysInstanced(TRIANGLES,0,3,1)',
      'blendColor(0,0,0,0)',
      'drawArraysInstanced(TRIANGLES,0,3,1)',
      'blendColor(0,1,0,1)',
      'drawArraysInstanced(TRIANGLES,0,3,1)',
      'blendColor(0.5,0.25,0.125,0.0625)',
    ]);
  });

  it('changes no blend bookkeeping for a draw the pass refuses (R1): the next undeclared draw still gets the pass value', async () => {
    const { gl, calls } = fakeGl(4);
    const rt = await createRuntime({ device: gl });
    const program = rt.load(manifest(DRAW));
    const declares = await program.render({ blendConstant: [1, 0, 0, 1] });
    const bare = await program.render({});
    const colour = rt.texture({ size: [16, 12], format: 'rgba8unorm' });
    const geometry = { vertices: new Float32Array(6), count: 3 };
    const tint = { tint: { c: [1, 0, 0, 1] } };
    calls.length = 0;
    const f = rt.frame();
    const refused: string[] = [];
    f.pass({ color: [colour] }, (p) => {
      p.draw(declares, tint, geometry);
      // B: undeclared, with a binding the pipeline does not reach. The draw is refused.
      refused.push(refusalOf(() => p.draw(bare, { bogus: {} } as never, geometry)));
      p.draw(bare, tint, geometry);
    });
    await f.submit();
    expect(refused).toEqual([
      '"fs" (typeshade-input.ts:9) reaches no binding "bogus"; it binds "tint".',
    ]);
    expect(calls.filter((c) => /^(blendColor|drawArraysInstanced)\(/.test(c))).toEqual([
      'blendColor(0,0,0,0)',
      'blendColor(1,0,0,1)',
      'drawArraysInstanced(TRIANGLES,0,3,1)',
      'blendColor(0,0,0,0)',
      'drawArraysInstanced(TRIANGLES,0,3,1)',
      'blendColor(0.5,0.25,0.125,0.0625)',
    ]);
  });

  it('gives two spellings of one state one object, and a state that differs only in blendConstant a new object over the same program', async () => {
    const { gl, calls } = fakeGl(4, false);
    const rt = await createRuntime({ device: gl });
    const program = rt.load(manifest(DRAW));
    const bare = await program.render({});
    expect(await program.render({ primitive: {} })).toBe(bare);
    const linked = calls.filter((c) => c.startsWith('createProgram(')).length;
    expect(linked).toBe(1);
    calls.length = 0;
    const c0 = await program.render({ blendConstant: [0, 0, 0, 1] });
    const c1 = await program.render({ blendConstant: [1, 1, 1, 1] });
    expect(c0).not.toBe(c1);
    expect(c0).not.toBe(bare);
    // The program was linked once: a second state that differs only in the constant builds nothing.
    expect(
      calls.filter((c) => c.startsWith('createProgram(') || c.startsWith('createShader(')),
    ).toEqual([]);
  });

  it('refuses a depth range other than 0 to 1 under a fragment that writes frag_depth, with the whole sentence, and draws under the default range', async () => {
    const { gl } = fakeGl(4);
    const rt = await createRuntime({ device: gl });
    const pipeline = await rt.load(manifest(FRAG_DEPTH)).render();
    const colour = rt.texture({ size: [16, 12], format: 'rgba8unorm' });
    const f = rt.frame();
    expect(
      refusalOf(() =>
        f.pass({ color: [colour] }, (p) => {
          p.setViewport(0, 0, 16, 12, 0.25, 0.75);
          p.draw(pipeline, {}, { count: 3 });
        }),
      ),
    ).toBe(
      'pass.draw: the pipeline of "fs" writes frag_depth, and the depth range is 0.25 to 0.75; the WebGL2 tier refuses this range.',
    );
    expect(
      refusalOf(() =>
        rt.frame().pass({ color: [colour] }, (p) => {
          p.draw(pipeline, {}, { count: 3 });
        }),
      ),
    ).toBe('no refusal');
  });

  it('refuses the render-state keys and values of PR-1 with the same sentences as WebGPU', async () => {
    const { gl } = fakeGl(4);
    const rt = await createRuntime({ device: gl });
    const program = rt.load(manifest(DRAW));
    const sets = 'The render pipeline of "fs" (typeshade-input.ts:9) sets';
    expect(await refusalOfAsync(() => program.render({ label: 'x' } as never))).toBe(
      `${sets} label, which RenderState does not take.`,
    );
    expect(
      await refusalOfAsync(() =>
        program.render({ depth: { format: 'depth24plus', compare: 'lesss' } } as never),
      ),
    ).toBe(
      `${sets} depth.compare to "lesss"; it takes never, less, equal, less-equal, greater, not-equal, greater-equal or always.`,
    );
    expect(
      await refusalOfAsync(() => program.render({ blendConstant: [2, 0, 0, 0] } as never)),
    ).toBe(`${sets} blendConstant to [2, 0, 0, 0]; it takes four numbers from 0 to 1.`);
  });
});

describe('stencil, depth bias and the sample mask on WebGL2 (proposal 0064, PR-2)', () => {
  const sets = 'The render pipeline of "fs" (typeshade-input.ts:9) sets';
  const geometry = { vertices: new Float32Array(6), count: 3 };
  const tint = { tint: { c: [1, 0, 0, 1] } };
  const STENCIL = { format: 'depth24plus-stencil8', stencil: {} } as const;
  const setup = async (linked = true) => {
    const { gl, calls } = fakeGl(4, linked);
    const rt = await createRuntime({ device: gl });
    return { gl, calls, rt, program: rt.load(manifest(DRAW)) };
  };
  /** The calls from the last `colorMask` before each draw, up to and including that draw. */
  const drawSlices = (calls: readonly string[]): string[][] => {
    const slices: string[][] = [];
    calls.forEach((c, d) => {
      if (!c.startsWith('drawArraysInstanced(')) return;
      const m = calls
        .slice(0, d)
        .map((x) => x.startsWith('colorMask('))
        .lastIndexOf(true);
      slices.push(calls.slice(m + 1, d + 1));
    });
    return slices;
  };
  /** The reference of each `stencilFuncSeparate(FRONT, …)` call, in order. */
  const refsOf = (calls: readonly string[]): number[] =>
    calls
      .map((c) => /^stencilFuncSeparate\(FRONT,[A-Z_]+,(-?\d+),/.exec(c))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => Number(m[1]));

  it('makes the calls of one stencil draw in full, in order, after the colour mask, each face with its own compare (L1)', async () => {
    const { calls, rt, program } = await setup();
    const pipe = await program.render({
      depth: {
        format: 'depth24plus-stencil8',
        compare: 'less',
        write: true,
        stencil: {
          compare: 'equal',
          front: { compare: 'greater', failOp: 'invert', depthFailOp: 'zero', passOp: 'replace' },
          back: {
            failOp: 'increment-wrap',
            depthFailOp: 'decrement-clamp',
            passOp: 'increment-clamp',
          },
          readMask: 15,
          writeMask: 240,
          reference: 3,
        },
      },
    });
    const colour = rt.texture({ size: [16, 12], format: 'rgba8unorm' });
    const depth = rt.texture({ size: [16, 12], format: 'depth24plus-stencil8' });
    calls.length = 0;
    const f = rt.frame();
    f.pass({ color: [colour], depth }, (p) => p.draw(pipe, tint, geometry));
    await f.submit();
    expect(drawSlices(calls)).toEqual([
      [
        'enable(STENCIL_TEST)',
        'stencilFuncSeparate(FRONT,GREATER,3,15)',
        'stencilFuncSeparate(BACK,EQUAL,3,15)',
        'stencilOpSeparate(FRONT,INVERT,ZERO,REPLACE)',
        'stencilOpSeparate(BACK,INCR_WRAP,DECR,INCR)',
        'stencilMaskSeparate(FRONT,240)',
        'stencilMaskSeparate(BACK,240)',
        'disable(POLYGON_OFFSET_FILL)',
        'drawArraysInstanced(TRIANGLES,0,3,1)',
      ],
    ]);
  });

  it('swaps the faces when the front and the back are given the other way round (L5)', async () => {
    const { calls, rt, program } = await setup();
    const a = await program.render({
      depth: { ...STENCIL, stencil: { front: { failOp: 'invert' }, back: { failOp: 'zero' } } },
    });
    const b = await program.render({
      depth: { ...STENCIL, stencil: { front: { failOp: 'zero' }, back: { failOp: 'invert' } } },
    });
    const colour = rt.texture({ size: [16, 12], format: 'rgba8unorm' });
    const depth = rt.texture({ size: [16, 12], format: 'depth24plus-stencil8' });
    calls.length = 0;
    const f = rt.frame();
    f.pass({ color: [colour], depth }, (p) => {
      p.draw(a, tint, geometry);
      p.draw(b, tint, geometry);
    });
    await f.submit();
    const ops = calls.filter((c) => c.startsWith('stencilOpSeparate('));
    expect(ops).toEqual([
      'stencilOpSeparate(FRONT,INVERT,KEEP,KEEP)',
      'stencilOpSeparate(BACK,ZERO,KEEP,KEEP)',
      'stencilOpSeparate(FRONT,ZERO,KEEP,KEEP)',
      'stencilOpSeparate(BACK,INVERT,KEEP,KEEP)',
    ]);
  });

  it('sets both states on every draw, and a plain draw after a stencil draw turns the stencil test off (L2)', async () => {
    const { calls, rt, program } = await setup();
    const st = await program.render({ depth: STENCIL });
    const plain = await program.render({});
    const colour = rt.texture({ size: [16, 12], format: 'rgba8unorm' });
    const depth = rt.texture({ size: [16, 12], format: 'depth24plus-stencil8' });
    calls.length = 0;
    const f = rt.frame();
    f.pass({ color: [colour], depth }, (p) => {
      p.setStencilReference(0);
      p.draw(st, tint, geometry);
      p.draw(plain, tint, geometry);
    });
    await f.submit();
    const [first, second] = drawSlices(calls);
    expect(first!.slice(0, 2)).toEqual([
      'enable(STENCIL_TEST)',
      'stencilFuncSeparate(FRONT,ALWAYS,0,255)',
    ]);
    expect(second).toEqual([
      'disable(STENCIL_TEST)',
      'disable(POLYGON_OFFSET_FILL)',
      'drawArraysInstanced(TRIANGLES,0,3,1)',
    ]);
    // A plain draw with no depth state at all sets both states off.
    calls.length = 0;
    const g = rt.frame();
    g.pass({ color: [colour] }, (p) => p.draw(plain, tint, geometry));
    await g.submit();
    expect(drawSlices(calls)[0]).toEqual([
      'disable(STENCIL_TEST)',
      'disable(POLYGON_OFFSET_FILL)',
      'drawArraysInstanced(TRIANGLES,0,3,1)',
    ]);
  });

  it('copies the reference at the record of each draw, and starts each pass at 0 (L3)', async () => {
    const { calls, rt, program } = await setup();
    const st0 = await program.render({ depth: STENCIL });
    const st1 = await program.render({ depth: { ...STENCIL, stencil: { reference: 1 } } });
    const colour = rt.texture({ size: [16, 12], format: 'rgba8unorm' });
    const depth = rt.texture({ size: [16, 12], format: 'depth24plus-stencil8' });
    calls.length = 0;
    const st00 = await program.render({ depth: { ...STENCIL, stencil: { reference: 0 } } });
    const plain = await program.render({});
    const f = rt.frame();
    f.pass({ color: [colour], depth }, (p) => {
      p.setStencilReference(3);
      p.draw(st1, tint, geometry);
      p.draw(st0, tint, geometry);
      p.setStencilReference(5);
      p.draw(st0, tint, geometry);
      // A declared 0 is declared: it does not fall back to the pass value 5.
      p.draw(st00, tint, geometry);
      p.setStencilReference(4);
    });
    // The second pass starts at 0 although the first set 4. A draw recorded at 0 keeps 0 when the
    // pass value changes after its record.
    f.pass({ color: [colour], depth: { target: depth, load: 'load' } }, (p) => {
      p.draw(st0, tint, geometry);
      p.setStencilReference(9);
    });
    // A plain draw after a set value records no stencil function.
    f.pass({ color: [colour], depth: { target: depth, load: 'load' } }, (p) => {
      p.setStencilReference(2);
      p.draw(plain, tint, geometry);
    });
    await f.submit();
    expect(refsOf(calls)).toEqual([1, 3, 5, 0, 0]);
  });

  it('accepts the reference edges 0 and 255 and refuses 256 and -1 on this tier (T3)', async () => {
    const { calls, rt, program } = await setup();
    const st0 = await program.render({ depth: STENCIL });
    const colour = rt.texture({ size: [16, 12], format: 'rgba8unorm' });
    const depth = rt.texture({ size: [16, 12], format: 'depth24plus-stencil8' });
    calls.length = 0;
    const f = rt.frame();
    f.pass({ color: [colour], depth }, (p) => {
      p.setStencilReference(255);
      p.draw(st0, tint, geometry);
      p.setStencilReference(0);
      p.draw(st0, tint, geometry);
      for (const bad of [256, -1])
        expect(() => p.setStencilReference(bad)).toThrow(
          `pass.setStencilReference takes a whole number from 0 to 255; reference is ${bad}.`,
        );
    });
    await f.submit();
    expect(refsOf(calls)).toEqual([255, 0]);
  });

  it('refuses a reference past 255 before the pass value changes, and the draw takes the value before it (L3)', async () => {
    const { calls, rt, program } = await setup();
    const st0 = await program.render({ depth: STENCIL });
    const colour = rt.texture({ size: [16, 12], format: 'rgba8unorm' });
    const depth = rt.texture({ size: [16, 12], format: 'depth24plus-stencil8' });
    calls.length = 0;
    const f = rt.frame();
    f.pass({ color: [colour], depth }, (p) => {
      expect(() => p.setStencilReference(300)).toThrow(
        'pass.setStencilReference takes a whole number from 0 to 255; reference is 300.',
      );
      p.draw(st0, tint, geometry);
    });
    await f.submit();
    expect(refsOf(calls)).toEqual([0]);
  });

  it('sets the depth function and the depth mask of a stencil draw with write false and compare greater (T5)', async () => {
    const { calls, rt, program } = await setup();
    const pipe = await program.render({
      depth: { format: 'depth24plus-stencil8', compare: 'greater', write: false, stencil: {} },
    });
    const colour = rt.texture({ size: [16, 12], format: 'rgba8unorm' });
    const depth = rt.texture({ size: [16, 12], format: 'depth24plus-stencil8' });
    calls.length = 0;
    const f = rt.frame();
    f.pass({ color: [colour], depth }, (p) => p.draw(pipe, tint, geometry));
    await f.submit();
    const beforeDraw = calls.slice(
      0,
      calls.findIndex((c) => c.startsWith('drawArraysInstanced(')),
    );
    expect(beforeDraw.filter((c) => /^depth(Func|Mask)\(/.test(c)).slice(-2)).toEqual([
      'depthFunc(GREATER)',
      'depthMask(false)',
    ]);
  });

  it('keeps the blend bookkeeping of a refused or dropped draw as it was (R1, L4)', async () => {
    const { calls, rt, program } = await setup();
    const declares = await program.render({ blendConstant: [1, 0, 0, 1] });
    const bare = await program.render({});
    const bad = await program.render({ depth: STENCIL });
    const masked = await program.render({ blendConstant: [0, 1, 0, 1], multisample: { mask: 0 } });
    const colour = rt.texture({ size: [16, 12], format: 'rgba8unorm' });
    const depth24 = rt.texture({ size: [16, 12], format: 'depth24plus' });
    const run = async (body: (p: RenderPass) => void, depth?: unknown) => {
      calls.length = 0;
      const f = rt.frame();
      f.pass({ color: [colour], ...(depth !== undefined ? { depth } : {}) } as never, body);
      await f.submit();
      return calls.filter((c) => /^(blendColor|drawArraysInstanced)\(/.test(c));
    };
    // (a) a refused draw between two draws.
    expect(
      await run((p) => {
        p.draw(declares, tint, geometry);
        expect(() => p.draw(bad, tint, geometry)).toThrow('has no stencil aspect');
        // The stencil check comes before the bindings are read: a bad binding does not change the refusal.
        expect(() => p.draw(bad, { ...tint, bogus: 1 } as never, geometry)).toThrow(
          'has no stencil aspect',
        );
        p.draw(bare, tint, geometry);
      }, depth24),
    ).toEqual([
      'blendColor(0,0,0,0)',
      'blendColor(1,0,0,1)',
      'drawArraysInstanced(TRIANGLES,0,3,1)',
      'blendColor(0,0,0,0)',
      'drawArraysInstanced(TRIANGLES,0,3,1)',
      'blendColor(0.5,0.25,0.125,0.0625)',
    ]);
    // (b) a draw the record refuses, a binding the pipeline does not reach.
    expect(
      await run((p) => {
        p.draw(declares, tint, geometry);
        expect(() => p.draw(declares, { ...tint, bogus: 1 } as never, geometry)).toThrow(
          'reaches no binding "bogus"',
        );
        p.draw(bare, tint, geometry);
      }),
    ).toEqual([
      'blendColor(0,0,0,0)',
      'blendColor(1,0,0,1)',
      'drawArraysInstanced(TRIANGLES,0,3,1)',
      'blendColor(0,0,0,0)',
      'drawArraysInstanced(TRIANGLES,0,3,1)',
      'blendColor(0.5,0.25,0.125,0.0625)',
    ]);
    // (c) a masked-off draw declares a constant and sets nothing; the next draw sets nothing.
    expect(
      await run((p) => {
        p.draw(masked, tint, geometry);
        p.draw(bare, tint, geometry);
      }),
    ).toEqual([
      'blendColor(0,0,0,0)',
      'drawArraysInstanced(TRIANGLES,0,3,1)',
      'blendColor(0.5,0.25,0.125,0.0625)',
    ]);
    // (d) a declared draw, a masked one, then an undeclared draw: the pass value again, once.
    const d = await run((p) => {
      p.draw(declares, tint, geometry);
      p.draw(masked, tint, geometry);
      p.draw(bare, tint, geometry);
    });
    expect(d.filter((c) => c === 'blendColor(0,1,0,1)')).toEqual([]);
    expect(d.filter((c) => c === 'blendColor(0,0,0,0)')).toHaveLength(2);
    expect(d.filter((c) => c.startsWith('drawArraysInstanced('))).toHaveLength(2);
  });

  it('gives the polygon offset the slope as its factor and the constant as its units (L6)', async () => {
    const { calls, rt, program } = await setup();
    const colour = rt.texture({ size: [16, 12], format: 'rgba8unorm' });
    const depth = rt.texture({ size: [16, 12], format: 'depth32float' });
    const draw = async (state: object) => {
      const pipe = await program.render(state as never);
      calls.length = 0;
      const f = rt.frame();
      f.pass({ color: [colour], depth }, (p) => p.draw(pipe, tint, geometry));
      await f.submit();
      return drawSlices(calls)[0]!.filter((c) =>
        /polygonOffset|POLYGON_OFFSET_FILL|STENCIL_TEST/.test(c),
      );
    };
    expect(await draw({ depth: { format: 'depth32float', bias: { constant: -2 } } })).toEqual([
      'disable(STENCIL_TEST)',
      'enable(POLYGON_OFFSET_FILL)',
      'polygonOffset(0,-2)',
    ]);
    expect(
      await draw({ depth: { format: 'depth32float', bias: { constant: -2147483648 } } }),
    ).toEqual([
      'disable(STENCIL_TEST)',
      'enable(POLYGON_OFFSET_FILL)',
      'polygonOffset(0,-2147483648)',
    ]);
    expect(await draw({ depth: { format: 'depth32float', bias: { constant: -0 } } })).toEqual([
      'disable(STENCIL_TEST)',
      'disable(POLYGON_OFFSET_FILL)',
    ]);
  });

  it('refuses each WebGL2-only bias before anything is built, and builds the program once a valid state comes (L7)', async () => {
    const { calls, program } = await setup(false);
    const refusals: [object, string][] = [
      [
        { depth: { format: 'depth24plus', bias: { constant: -2 } } },
        `${sets} depth.bias.constant on depth24plus; the WebGL2 tier takes a bias on depth32float only.`,
      ],
      [
        { depth: { format: 'depth16unorm', bias: { constant: 1 } } },
        `${sets} depth.bias.constant on depth16unorm; the WebGL2 tier takes a bias on depth32float only.`,
      ],
      [
        { depth: { format: 'depth32float-stencil8', bias: { constant: 1 } } },
        `${sets} depth.bias.constant on depth32float-stencil8; the WebGL2 tier takes a bias on depth32float only.`,
      ],
      [
        { depth: { format: 'depth32float', bias: { slopeScale: 2 } } },
        `${sets} depth.bias.slopeScale to 2; the WebGL2 tier refuses a non-zero slope scale, and its unit is not measured there yet.`,
      ],
      [
        { depth: { format: 'depth32float', bias: { slopeScale: -1 } } },
        `${sets} depth.bias.slopeScale to -1; the WebGL2 tier refuses a non-zero slope scale, and its unit is not measured there yet.`,
      ],
      [
        { depth: { format: 'depth32float', bias: { clamp: -0.5 } } },
        `${sets} depth.bias.clamp to -0.5; the WebGL2 tier refuses a non-zero clamp, and no WebGL2 form exists yet.`,
      ],
      [
        { depth: { format: 'depth32float', bias: { clamp: 0.5 } } },
        `${sets} depth.bias.clamp to 0.5; the WebGL2 tier refuses a non-zero clamp, and no WebGL2 form exists yet.`,
      ],
    ];
    for (const [state, sentence] of refusals) {
      calls.length = 0;
      expect(await refusalOfAsync(() => program.render(state as never))).toBe(sentence);
      expect(calls.filter((c) => /^(createShader|createProgram|linkProgram)\(/.test(c))).toEqual(
        [],
      );
    }
    // Accepted: a zero constant and a zero slope on depth24plus, and a constant on depth32float.
    await expect(
      program.render({ depth: { format: 'depth24plus', bias: { constant: 0, slopeScale: 0 } } }),
    ).resolves.toBeDefined();
    await expect(
      program.render({ depth: { format: 'depth32float', bias: { constant: 3 } } }),
    ).resolves.toBeDefined();
    // The refusals left no cache entry: a valid state builds exactly the one program it needs.
    calls.length = 0;
    await program.render({ depth: { format: 'depth16unorm' } });
    expect(calls.filter((c) => c.startsWith('createProgram('))).toHaveLength(1);
  });

  it('drops a draw whose sample mask has bit 0 clear, and records a draw whose bit 0 is set (L8)', async () => {
    const { calls, rt, program } = await setup();
    const colour = rt.texture({ size: [16, 12], format: 'rgba8unorm' });
    const drawsOf = async (mask: number) => {
      const pipe = await program.render({ multisample: { mask } });
      calls.length = 0;
      const f = rt.frame();
      f.pass({ color: [colour] }, (p) => p.draw(pipe, tint, geometry));
      await f.submit();
      return calls.filter((c) => c.startsWith('drawArraysInstanced(')).length;
    };
    expect([
      await drawsOf(0),
      await drawsOf(1),
      await drawsOf(2),
      await drawsOf(0xffffffff),
    ]).toEqual([0, 1, 0, 1]);
    // A masked-off draw is still checked: a binding the pipeline does not reach is refused.
    const masked = await program.render({ multisample: { mask: 0 } });
    rt.frame().pass({ color: [colour] }, (p) => {
      expect(() => p.draw(masked, { ...tint, bogus: 1 } as never, geometry)).toThrow(
        'reaches no binding "bogus"',
      );
    });
    // A masked-off stencil draw into a pass with no stencil aspect is refused, though its bit 0 is clear.
    const stencilMasked = await program.render({ depth: STENCIL, multisample: { mask: 0 } });
    rt.frame().pass(
      { color: [colour], depth: rt.texture({ size: [16, 12], format: 'depth24plus' }) },
      (p) => {
        expect(() => p.draw(stencilMasked, tint, geometry)).toThrow('has no stencil aspect');
      },
    );
  });

  it('ends a pass with the host state and none of the stencil or offset calls (L9, the tail)', async () => {
    const { calls, rt, program } = await setup();
    // WebGL2 takes a bias on depth32float only, and a stencil on a stencil format: two passes.
    const stencil = await program.render({
      depth: { format: 'depth24plus-stencil8', stencil: { writeMask: 0 } },
    });
    const biased = await program.render({
      depth: { format: 'depth32float', bias: { constant: -2 } },
    });
    const colour = rt.texture({ size: [16, 12], format: 'rgba8unorm' });
    const depth = rt.texture({ size: [16, 12], format: 'depth24plus-stencil8' });
    const depth32 = rt.texture({ size: [16, 12], format: 'depth32float' });
    calls.length = 0;
    const f = rt.frame();
    f.pass({ color: [colour], depth }, (p) => p.draw(stencil, tint, geometry));
    f.pass({ color: [colour], depth: depth32 }, (p) => p.draw(biased, tint, geometry));
    await f.submit();
    const tails = calls
      .flatMap((_, i) => (calls[i] === 'useProgram(null)' ? [i] : []))
      .map((i) => calls.slice(i, calls.indexOf('bindFramebuffer(FRAMEBUFFER,null)', i) + 1));
    expect(tails).toHaveLength(2);
    const tail = tails[1]!;
    expect(
      tails[0]!.filter((c) => /STENCIL_TEST|stencilFunc|stencilOp|POLYGON|polygonOffset/.test(c)),
    ).toEqual([]);
    expect(tail).toEqual([
      'useProgram(null)',
      'disable(SCISSOR_TEST)',
      'colorMask(true,true,true,true)',
      'depthMask(true)',
      'stencilMask(4294967295)',
      'viewport(1,2,3,4)',
      'depthRange(0.125,0.875)',
      'blendColor(0.5,0.25,0.125,0.0625)',
      'bindFramebuffer(FRAMEBUFFER,null)',
    ]);
    expect(
      tail.filter((c) => /STENCIL_TEST|stencilFunc|stencilOp|POLYGON|polygonOffset/.test(c)),
    ).toEqual([]);
  });

  it('writes the full write mask before the stencil clear of a pass that follows a pass with no write (L9, step 9)', async () => {
    const { calls, rt, program } = await setup();
    const pipe = await program.render({
      depth: { format: 'depth24plus-stencil8', stencil: { writeMask: 0 } },
    });
    const colour = rt.texture({ size: [16, 12], format: 'rgba8unorm' });
    const depth = rt.texture({ size: [16, 12], format: 'depth24plus-stencil8' });
    const first = rt.frame();
    first.pass({ color: [colour], depth }, (p) => p.draw(pipe, tint, geometry));
    await first.submit();
    calls.length = 0;
    const second = rt.frame();
    second.pass({ color: [colour], depth }, () => {});
    await second.submit();
    const full = calls.indexOf('stencilMask(4294967295)');
    const clear = calls.indexOf('clearBufferiv(STENCIL,0,[0])');
    expect(full).toBeGreaterThanOrEqual(0);
    expect(clear).toBeGreaterThan(full);
  });

  it('refuses a stencil draw into a pass with no stencil aspect, or a different one, on this tier as on WebGPU (L10)', async () => {
    const { calls, rt, program } = await setup();
    const colour = rt.texture({ size: [16, 12], format: 'rgba8unorm' });
    const st = await program.render({ depth: STENCIL });
    const cases: [object | undefined, string][] = [
      [
        undefined,
        'pass.draw: the pipeline of "fs" sets depth.stencil, and the pass has no depth attachment; give the pass a depth attachment of depth24plus-stencil8.',
      ],
      [
        rt.texture({ size: [16, 12], format: 'depth24plus' }),
        'pass.draw: the pipeline of "fs" sets depth.stencil, and the pass depth format depth24plus has no stencil aspect; use depth24plus-stencil8.',
      ],
      [
        rt.texture({ size: [16, 12], format: 'depth32float-stencil8' }),
        'pass.draw: the pipeline of "fs" has depth format depth24plus-stencil8; the pass depth format is depth32float-stencil8, and the two must match; give the pipeline the pass depth format.',
      ],
    ];
    for (const [depth, sentence] of cases) {
      calls.length = 0;
      const opts = depth === undefined ? { color: [colour] } : { color: [colour], depth };
      expect(() => rt.frame().pass(opts as never, (p) => p.draw(st, tint, geometry))).toThrow(
        sentence,
      );
      expect(() => rt.frame().pass(opts as never, (p) => st.draw(p, tint, geometry))).toThrow(
        sentence,
      );
      expect(calls.filter((c) => c.startsWith('drawArraysInstanced('))).toEqual([]);
    }
  });

  it('refuses the state of WebGPU with the same sentence on this tier (L11)', async () => {
    const { program } = await setup();
    const cases: [object, string][] = [
      [
        { depth: { format: 'depth24plus-stencil8', stencil: { reference: 256 } } },
        `${sets} depth.stencil.reference to 256; it takes a whole number from 0 to 255.`,
      ],
      [
        { depth: { format: 'depth24plus-stencil8', stencil: { readMask: 4294967296 } } },
        `${sets} depth.stencil.readMask to 4294967296; it takes a whole number from 0 to 4294967295.`,
      ],
      [
        { multisample: { count: 4, mask: 5 } },
        `${sets} multisample.mask with count 4; the mask takes count 1 only; remove the mask or set count 1.`,
      ],
      [
        { depth: { format: 'depth24plus-stencil8', stencil: { fron: {} } } },
        `${sets} depth.stencil.fron, which depth.stencil does not take; depth.stencil takes the keys compare, failOp, depthFailOp, passOp, front, back, readMask, writeMask and reference.`,
      ],
      [
        { depth: { format: 'depth24plus', depthBias: 1 } },
        `${sets} depth.depthBias, a WebGPU name; the TypeShade name is depth.bias.constant.`,
      ],
      [
        { depth: { format: 'stencil8' } },
        `${sets} depth.format stencil8, which the runtime does not take on either tier; use depth24plus-stencil8.`,
      ],
      [
        { multisample: { count: 4, mask: 0 } },
        `${sets} multisample.mask with count 4; the mask takes count 1 only; remove the mask or set count 1.`,
      ],
      [
        { depth: { format: 'depth24plus-stencil8', stencil: null } },
        `${sets} depth.stencil to null; it takes an object.`,
      ],
      [
        { depth: { format: 'depth24plus-stencil8', stencil: { front: null } } },
        `${sets} depth.stencil.front to null; it takes an object.`,
      ],
      [
        { depth: { format: 'depth24plus-stencil8', stencil: { passOp: null } } },
        `${sets} depth.stencil.passOp to null; it takes keep, zero, replace, invert, increment-clamp, decrement-clamp, increment-wrap or decrement-wrap.`,
      ],
      [
        { depth: { format: 'depth24plus-stencil8', stencil: { compare: null } } },
        `${sets} depth.stencil.compare to null; it takes never, less, equal, less-equal, greater, not-equal, greater-equal or always.`,
      ],
      [
        { depth: { format: 'depth24plus-stencil8', stencil: { readMask: null } } },
        `${sets} depth.stencil.readMask to null; it takes a whole number from 0 to 4294967295.`,
      ],
      [
        { depth: { format: 'depth24plus-stencil8', stencil: { writeMask: null } } },
        `${sets} depth.stencil.writeMask to null; it takes a whole number from 0 to 4294967295.`,
      ],
      [
        { multisample: { mask: null } },
        `${sets} multisample.mask to null; it takes a whole number from 0 to 4294967295.`,
      ],
    ];
    for (const [state, sentence] of cases)
      expect(await refusalOfAsync(() => program.render(state as never))).toBe(sentence);
  });

  it('gives two states that differ only in the reference one program, and a mask of 1 a second one (L12)', async () => {
    const { calls, program } = await setup(false);
    const created = () => calls.filter((c) => c.startsWith('createProgram(')).length;
    const a = await program.render({ depth: { ...STENCIL, stencil: { reference: 1 } } });
    const b = await program.render({ depth: { ...STENCIL, stencil: { reference: 2 } } });
    expect(a).not.toBe(b);
    expect(created()).toBe(1);
    // No reference is part of the program's key, so this state shares the program of `a`.
    const c = await program.render({ depth: { ...STENCIL, stencil: {} } });
    const d = await program.render({
      depth: {
        ...STENCIL,
        stencil: { compare: 'always', readMask: 255, writeMask: 255, reference: undefined },
      },
    });
    expect(c).toBe(d);
    expect(created()).toBe(1);
    const e = await program.render({ depth: { ...STENCIL, stencil: { readMask: 0x105 } } });
    const f = await program.render({ depth: { ...STENCIL, stencil: { readMask: 5 } } });
    expect(e).toBe(f);
    expect(created()).toBe(2);
    await program.render({ multisample: { mask: 1 } });
    expect(created()).toBe(3);
  });

  it('leaves no error on the context after a pass with a stencil draw and a biased draw (L13)', async () => {
    const { gl, rt, program } = await setup();
    const colour = rt.texture({ size: [16, 12], format: 'rgba8unorm' });
    const depth = rt.texture({ size: [16, 12], format: 'depth24plus-stencil8' });
    const st = await program.render({
      depth: { ...STENCIL, stencil: { passOp: 'replace', reference: 1 } },
    });
    const biased = await program.render({
      depth: { format: 'depth24plus-stencil8', bias: { constant: 0 } },
    });
    const f = rt.frame();
    f.pass({ color: [colour], depth }, (p) => {
      p.draw(st, tint, geometry);
      p.draw(biased, tint, geometry);
    });
    await f.submit();
    expect(gl.getError()).toBe(0);
  });
});

describe('the WebGL2 context after a pass (proposal 0064, PR-1, O10 unit leg)', () => {
  it('leaves no error on the context after a pass that sets every PR-1 call', async () => {
    const { gl } = fakeGl(4);
    const d = new GlDrawing(gl);
    const colour = new GlTextureImpl(d, { size: [16, 12], format: 'rgba8unorm' });
    await recordPass(d, { color: [colour] }, (p) => {
      p.setViewport(3, 2, 8, 6, 0.25, 0.75);
      p.setScissorRect(10, 6, 20, 20);
      p.setBlendConstant([0.25, 0.5, 0.75, 1]);
    })();
    expect(gl.getError()).toBe(0);
  });
});
