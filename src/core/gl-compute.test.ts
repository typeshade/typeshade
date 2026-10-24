// The WebGL2 executor of change 0054 (`runGlCompute`) on a context that records its calls. The
// executor itself runs on WebGL2 in the GPU differential (`scripts/gl-compute-arm.ts`) and the
// compile gate; here, what it leaves on a context that outlives a dispatch which throws.

import { describe, expect, it } from 'vitest';
import { compile } from '../compiler/ts/compile.js';
import { buildGlCompute } from './passes/gl-compute.js';
import { compile as compileGl, runGlCompute } from './gl-compute.js';

interface Failure {
  method: string;
  at?: number;
  value?: false | null;
}

/** A WebGL2 context that records every call and runs nothing: each object it makes is a fresh
 *  `{}`, each constant a number of its own, and `drawArrays` throws when `failDraw` is set. */
function recordingGl(
  failDraw: boolean,
  failure?: Failure,
): {
  gl: WebGL2RenderingContext;
  calls: unknown[][];
  objects: Map<string, object[]>;
} {
  const calls: unknown[][] = [];
  const objects = new Map<string, object[]>();
  const occurrences = new Map<string, number>();
  const constants = new Map<string, number>();
  const answers: Record<string, unknown> = {
    MAX_ARRAY_TEXTURE_LAYERS: 256,
    MAX_VERTEX_TEXTURE_IMAGE_UNITS: 16,
  };
  const gl = new Proxy(
    {},
    {
      get(_, key) {
        if (typeof key !== 'string') return undefined;
        if (/^[A-Z0-9_]+$/.test(key)) {
          if (!constants.has(key)) constants.set(key, 0x10000 + constants.size);
          return constants.get(key);
        }
        return (...args: unknown[]) => {
          calls.push([key, ...args]);
          const count = (occurrences.get(key) ?? 0) + 1;
          occurrences.set(key, count);
          if (failure?.method === key && count === (failure.at ?? 1)) {
            if ('value' in failure) return failure.value;
            throw new Error(`injected ${key}`);
          }
          if (key === 'drawArrays' && failDraw) throw new Error('lost');
          if (key === 'getParameter') {
            const name = [...constants].find(([, v]) => v === args[0])?.[0] ?? '';
            return answers[name] ?? 0;
          }
          if (/^(getShaderParameter|getProgramParameter|isProgram)$/.test(key)) return true;
          if (/^(create|fenceSync|getUniformLocation)/.test(key)) {
            const object = {};
            const made = objects.get(key) ?? [];
            made.push(object);
            objects.set(key, made);
            return object;
          }
          if (key === 'getUniformBlockIndex') return 0;
          return undefined;
        };
      },
    },
  ) as WebGL2RenderingContext;
  return { gl, calls, objects };
}

/** Exact identities and once-only deletion, including partially completed allocations. */
function released(context: ReturnType<typeof recordingGl>, kind: string): void {
  const made = context.objects.get(`create${kind}`) ?? [];
  const deleted = context.calls.filter((c) => c[0] === `delete${kind}`).map((c) => c[1]);
  expect(deleted).toHaveLength(made.length);
  expect(new Set(deleted)).toEqual(new Set(made));
}

function dispatchReleased(context: ReturnType<typeof recordingGl>): void {
  for (const kind of ['Texture', 'Buffer', 'TransformFeedback', 'Framebuffer', 'VertexArray'])
    released(context, kind);
}

describe('cached WebGL program ownership', () => {
  it.each([
    ['vertex compile', { method: 'getShaderParameter', value: false }, 'did not compile'],
    ['fragment compile', { method: 'getShaderParameter', at: 2, value: false }, 'did not compile'],
    ['link', { method: 'getProgramParameter', value: false }, 'did not link'],
    ['null fragment shader', { method: 'createShader', at: 2, value: null }, 'could not create'],
  ] as const)(
    'releases an incomplete program after %s failure and allows a clean retry',
    (_name, failure, message) => {
      const context = recordingGl(false, failure);
      const { gl, calls, objects } = context;
      expect(() => compileGl(gl, 'vertex', 'fragment', 'probe')).toThrow(message);
      released(context, 'Shader');
      released(context, 'Program');
      const failed = objects.get('createProgram')![0];
      const retry = compileGl(gl, 'vertex', 'fragment', 'probe');
      expect(retry).not.toBe(failed);
      expect(compileGl(gl, 'vertex', 'fragment', 'probe')).toBe(retry);
      expect(objects.get('createProgram')).toHaveLength(2);
      expect(calls.filter((c) => c[0] === 'deleteProgram').map((c) => c[1])).toEqual([failed]);
      released(context, 'Shader');
      expect(calls.filter((c) => c[0] === 'detachShader' && c[1] === retry)).toHaveLength(2);
    },
  );

  it('does not create shaders when program allocation fails', () => {
    const context = recordingGl(false, { method: 'createProgram', value: null });
    expect(() => compileGl(context.gl, 'vertex', 'fragment', 'probe')).toThrow('could not create');
    expect(context.objects.get('createShader')).toBeUndefined();
    released(context, 'Program');
  });
});

describe('runGlCompute (change 0054)', () => {
  const m = compile(`"use typeshade";
declare const photo: texture_2d<f32>;
declare const smp: sampler;
declare const out: storage<array<f32>, "read_write">;
@compute([4])
export function main(@builtin("global_invocation_id") gid: vec3u) {
  out[gid.x] = textureSampleLevel(photo, smp, vec2f(0.5), 0.).x;
}
`).module;
  const program = buildGlCompute(m, 'main');

  const input = () => ({
    workgroups: [1, 1, 1] as const,
    memory: { out: new Uint32Array(4) },
    textures: { photo: { texture: {} as WebGLTexture, sampler: {} as WebGLSampler } },
  });

  it.each([
    { method: 'texImage3D' },
    { method: 'texStorage3D' },
    { method: 'bufferData' },
    { method: 'getShaderParameter', value: false },
    { method: 'bindVertexArray' },
  ] satisfies readonly Failure[])(
    'releases dispatch allocations when setup fails at $method',
    async (failure) => {
      const context = recordingGl(true, failure);
      const given = input();
      await expect(runGlCompute(context.gl, program, given)).rejects.toThrow(
        failure.method === 'getShaderParameter' ? 'did not compile' : `injected ${failure.method}`,
      );
      expect(context.objects.get('createTexture')!.length).toBeGreaterThan(0);
      dispatchReleased(context);
      expect(
        context.calls.some(
          (c) => c[0] === 'deleteTexture' && c[1] === given.textures.photo.texture,
        ),
      ).toBe(false);
      expect(context.calls.some((c) => c[0] === 'deleteSampler')).toBe(false);
    },
  );

  it('retains the cached pass program when scatter compilation fails', async () => {
    const context = recordingGl(true, { method: 'getShaderParameter', at: 3, value: false });
    await expect(runGlCompute(context.gl, program, input())).rejects.toThrow('did not compile');
    dispatchReleased(context);
    const [pass, failedScatter] = context.objects.get('createProgram')!;
    expect(context.calls.filter((c) => c[0] === 'deleteProgram').map((c) => c[1])).toEqual([
      failedScatter,
    ]);
    // The retry only compiles scatter; its pass is the successful cached program.
    await expect(runGlCompute(context.gl, program, input())).rejects.toThrow('lost');
    expect(context.objects.get('createProgram')).toHaveLength(3);
    expect(context.calls.some((c) => c[0] === 'deleteProgram' && c[1] === pass)).toBe(false);
    dispatchReleased(context);
    released(context, 'Shader');
  });

  it('cleans an earlier root when a later root exceeds the existing texture layer limit', async () => {
    const context = recordingGl(true);
    const twoRoots = {
      ...program,
      layout: { width: 1, layerRows: 1 },
      roots: [...program.roots, { ...program.roots[0]!, name: 'other' }],
    };
    await expect(
      runGlCompute(context.gl, twoRoots, {
        ...input(),
        memory: { out: new Uint32Array(4), other: new Uint32Array(257) },
      }),
    ).rejects.toThrow("'other' needs 257 layers, more than this context's 256");
    expect(context.objects.get('createTexture')).toHaveLength(1);
    dispatchReleased(context);
    expect(context.objects.get('createProgram')).toBeUndefined();
  });

  it('releases setup resources for missing uniforms and uniform upload/binding failures', async () => {
    const uniformProgram = buildGlCompute(
      compile(`"use typeshade";
declare const gain: uniform<f32>;
declare const out: storage<array<f32>, "read_write">;
@compute([4])
export function main(@builtin("global_invocation_id") gid: vec3u) { out[gid.x] = gain; }
`).module,
      'main',
    );
    for (const failure of [
      undefined,
      { method: 'bufferData', at: uniformProgram.slices + 1 },
      { method: 'uniformBlockBinding' },
    ]) {
      const context = recordingGl(true, failure);
      await expect(
        runGlCompute(context.gl, uniformProgram, {
          workgroups: [1, 1, 1],
          memory: { out: new Uint32Array(4) },
          ...(failure === undefined ? {} : { uniforms: { gain: 2 } }),
        }),
      ).rejects.toThrow(
        failure === undefined ? "no value for uniform 'gain'" : `injected ${failure.method}`,
      );
      dispatchReleased(context);
      released(context, 'Shader');
      // Both programs linked successfully before the uniform setup error.
      expect(context.objects.get('createProgram')).toHaveLength(2);
      expect(context.calls.some((c) => c[0] === 'deleteProgram')).toBe(false);
    }
  });

  it('releases dispatch objects after successful empty dispatches while retaining the two linked programs', async () => {
    const context = recordingGl(false);
    const given = { ...input(), workgroups: [0, 1, 1] as const };
    const first = await runGlCompute(context.gl, program, given);
    dispatchReleased(context);
    expect(await runGlCompute(context.gl, program, given)).toEqual(first);
    dispatchReleased(context);
    expect(context.objects.get('createProgram')).toHaveLength(2);
    expect(context.calls.some((c) => c[0] === 'deleteProgram')).toBe(false);
    released(context, 'Shader');
    expect(given.memory.out).toEqual(new Uint32Array(4));
  });

  it('takes its samplers off their units, and deletes what it made, when a pass throws', async () => {
    const { gl, calls } = recordingGl(true);
    const sampler = {} as WebGLSampler;
    await expect(
      runGlCompute(gl, program, {
        workgroups: [1, 1, 1],
        memory: { out: new Uint32Array(4) },
        textures: { photo: { texture: {} as WebGLTexture, sampler } },
      }),
    ).rejects.toThrow('lost');
    const bound = calls.findIndex((c) => c[0] === 'bindSampler' && c[2] === sampler);
    expect(bound).toBeGreaterThanOrEqual(0);
    const unit = calls[bound]![1];
    expect(
      calls.slice(bound).some((c) => c[0] === 'bindSampler' && c[1] === unit && c[2] === null),
    ).toBe(true);
    const made = calls.filter((c) => c[0] === 'createTexture').length;
    const deleted = calls.filter((c) => c[0] === 'deleteTexture').length;
    expect(made).toBeGreaterThan(0);
    expect(deleted).toBe(made);
    expect(calls.some((c) => c[0] === 'deleteVertexArray')).toBe(true);
  });
});
