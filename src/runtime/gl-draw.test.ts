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
import { createRuntime } from './runtime.js';
import { GlDrawing, GlTextureImpl, recordPass } from './gl-draw.js';

const COLOR_ATTACHMENT0 = 0x8ce0;
const MAX_COLOR_ATTACHMENTS = 0x8cdf;
const INVALID_ENUM = 0x500;

/** A WebGL2 context that does nothing, allows `max` colour attachments, and keeps the first error
 *  a call raises until `getError()` reads it, as WebGL2 does. Its host state is what a runtime
 *  reads at the start of a pass: a viewport of 1, 2, 3, 4, a depth range of 0.125 to 0.875 and a
 *  blend colour of 0.5, 0.25, 0.125, 0.0625. `linked` says whether `isProgram` answers true, which
 *  makes the runtime's own `compile()` reuse a program it linked before. */
function fakeGl(
  max: number,
  linked = true,
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
          return new Int32Array([8192, 8192]);
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
    const { gl } = fakeGl(4);
    const rt = await createRuntime({ device: gl });
    const target = rt.texture({ size: [16, 12], format: 'rgba8unorm' });
    const got: string[] = [];
    rt.frame().pass({ color: [target] }, (p) => {
      got.push(refusalOf(() => p.setViewport(0, 0, 0.5, 4)));
      got.push(refusalOf(() => p.setViewport(0, 0, 4, 4, 0.8, 0.2)));
      got.push(refusalOf(() => p.setScissorRect(0, 0, -1, 4)));
      got.push(refusalOf(() => p.setBlendConstant([0.25, 0.5, 0.75])));
    });
    expect(got).toEqual([
      'pass.setViewport takes whole numbers; width is 0.5.',
      'pass.setViewport takes depths with 0 <= minDepth <= maxDepth <= 1; got minDepth 0.8 and maxDepth 0.2.',
      'pass.setScissorRect takes whole numbers from 0 up; got width -1.',
      'pass.setBlendConstant takes four numbers; color has 3 numbers.',
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
      `${sets} label, which RenderState does not take; RenderState takes the keys vertex, fragment, targets, blendConstant, depth, primitive, multisample and constants.`,
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
