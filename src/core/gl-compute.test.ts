// The WebGL2 executor of change 0054 (`runGlCompute`) on a context that records its calls. The
// executor itself runs on WebGL2 in the GPU differential (`scripts/gl-compute-arm.ts`) and the
// compile gate; here, what it leaves on a context that outlives a dispatch which throws, what it
// binds to the samplers of a draw, and the error of a draw the context refuses.

import { describe, expect, it } from 'vitest';
import { compile } from '../compiler/ts/compile.js';
import { createTypeshadeLanguageService } from '../language-service/service.js';
import { buildGlCompute } from './passes/gl-compute.js';
import { compile as compileGl, runGlCompute } from './gl-compute.js';

interface Failure {
  method: string;
  at?: number;
  value?: false | null | number;
}

/** WebGL2's error codes: a recording context answers each with its real value. */
const GL_ERRORS: Readonly<Record<string, number>> = {
  NO_ERROR: 0,
  INVALID_ENUM: 0x500,
  INVALID_VALUE: 0x501,
  INVALID_OPERATION: 0x502,
  OUT_OF_MEMORY: 0x505,
  INVALID_FRAMEBUFFER_OPERATION: 0x506,
  CONTEXT_LOST_WEBGL: 0x9242,
};

/** Each sampler a GLSL source declares, by name, with its type. */
function samplersOf(source: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of source.matchAll(/^\s*uniform\s+(?:\w+\s+)*?(\w*sampler\w*)\s+(\w+)\s*;/gm))
    out.set(m[2]!, m[1]!);
  return out;
}

/** What one draw read: its program, the unit each sampler reads, and what each unit holds. */
interface Draw {
  readonly program: object;
  readonly units: ReadonlyMap<string, number>;
  readonly textures: ReadonlyMap<number, ReadonlyMap<number, unknown>>;
  readonly samplers: ReadonlyMap<number, unknown>;
}

/** A WebGL2 context that records every call and runs nothing: each object it makes is a fresh
 *  `{}`, each constant a number of its own (an error code its real value), and `drawArrays` throws
 *  when `failDraw` is set. A draw first checks its program's samplers, as WebGL2 does: each reads
 *  the unit its uniform names, unit 0 until one is given, and a draw that reads one unit as two
 *  sampler types draws nothing and leaves `INVALID_OPERATION` for `getError` (#966). `draws` holds
 *  each draw that passed the check. A fence never signals: it fails, so a read-back throws. */
function recordingGl(
  failDraw: boolean,
  failure?: Failure,
): {
  gl: WebGL2RenderingContext;
  calls: unknown[][];
  objects: Map<string, object[]>;
  draws: Draw[];
} {
  const calls: unknown[][] = [];
  const objects = new Map<string, object[]>();
  const occurrences = new Map<string, number>();
  const constants = new Map<string, number>(Object.entries(GL_ERRORS));
  const constant = (name: string): number => {
    if (!constants.has(name)) constants.set(name, 0x10000 + constants.size);
    return constants.get(name)!;
  };
  const answers: Record<string, unknown> = {
    MAX_ARRAY_TEXTURE_LAYERS: 256,
    MAX_VERTEX_TEXTURE_IMAGE_UNITS: 16,
  };
  // What a draw's check reads: the sources of each program, the unit each sampler uniform names,
  // and what each texture unit holds.
  const sources = new Map<object, string>();
  const attached = new Map<object, object[]>();
  const locations = new Map<object, { program: object; name: string }>();
  const uniformUnits = new Map<object, Map<string, number>>();
  const textures = new Map<number, Map<number, unknown>>();
  const samplers = new Map<number, unknown>();
  const draws: Draw[] = [];
  let unit = 0;
  let program: object | null = null;
  let error = 0;
  const draw = (): boolean => {
    if (program === null) return true;
    const declared = new Map<string, string>();
    for (const shader of attached.get(program) ?? [])
      for (const [name, type] of samplersOf(sources.get(shader) ?? '')) declared.set(name, type);
    const units = new Map<string, number>();
    const types = new Map<number, Set<string>>();
    for (const [name, type] of declared) {
      const at = uniformUnits.get(program)?.get(name) ?? 0;
      units.set(name, at);
      types.set(at, (types.get(at) ?? new Set()).add(type));
    }
    if ([...types.values()].some((t) => t.size > 1)) {
      if (error === 0) error = GL_ERRORS['INVALID_OPERATION']!;
      return false;
    }
    draws.push({
      program,
      units,
      textures: new Map([...textures].map(([u, t]) => [u, new Map(t)])),
      samplers: new Map(samplers),
    });
    return true;
  };
  const gl = new Proxy(
    {},
    {
      get(_, key) {
        if (typeof key !== 'string') return undefined;
        if (/^[A-Z0-9_]+$/.test(key)) return constant(key);
        return (...args: unknown[]) => {
          calls.push([key, ...args]);
          const count = (occurrences.get(key) ?? 0) + 1;
          occurrences.set(key, count);
          if (failure?.method === key && count === (failure.at ?? 1)) {
            if ('value' in failure) return failure.value;
            throw new Error(`injected ${key}`);
          }
          switch (key) {
            case 'shaderSource':
              sources.set(args[0] as object, args[1] as string);
              break;
            case 'attachShader':
              attached.set(args[0] as object, [
                ...(attached.get(args[0] as object) ?? []),
                args[1] as object,
              ]);
              break;
            case 'useProgram':
              program = args[0] as object | null;
              break;
            case 'activeTexture':
              unit = (args[0] as number) - constant('TEXTURE0');
              break;
            case 'bindTexture': {
              const held = textures.get(unit) ?? new Map<number, unknown>();
              textures.set(unit, held.set(args[0] as number, args[1]));
              break;
            }
            case 'bindSampler':
              samplers.set(args[0] as number, args[1]);
              break;
            case 'uniform1i': {
              const at = locations.get(args[0] as object);
              if (at !== undefined) {
                const units = uniformUnits.get(at.program) ?? new Map<string, number>();
                uniformUnits.set(at.program, units.set(at.name, args[1] as number));
              }
              break;
            }
            case 'getError': {
              const e = error;
              error = 0;
              return e;
            }
            case 'clientWaitSync':
              return constant('WAIT_FAILED');
          }
          if (key === 'drawArrays' && draw() && failDraw) throw new Error('lost');
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
            if (key === 'getUniformLocation')
              locations.set(object, { program: args[0] as object, name: args[1] as string });
            return object;
          }
          if (key === 'getUniformBlockIndex') return 0;
          return undefined;
        };
      },
    },
  ) as WebGL2RenderingContext;
  return { gl, calls, objects, draws };
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
@compute([4]) export function main(gid: builtin<"global_invocation_id">) {
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
@compute([4]) export function main(gid: builtin<"global_invocation_id">) { out[gid.x] = gain; }
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

describe('the `_fp64` guard of an entry that emulates f64 on WebGL2 (#966)', () => {
  // The twiddle of an FFT, in the emulated double, as typeshade/typeaudio#9 computes it: the
  // entry reads and writes a storage array, so its memory root is a usampler2DArray on unit 0.
  const SOURCE = `"use typeshade";
declare const data: storage<array<f32>, "read_write">;
function wave(i: u32): f32 {
  const k: f64 = f64(f32(i));
  const angle: f64 = k * 0.7853981633974483;
  return f32(sin(angle)) + f32(cos(angle)) * 2.;
}
@compute([4]) export function twiddle(gid: builtin<"global_invocation_id">) {
  data[gid.x] = data[gid.x] + wave(gid.x);
}
`;
  const compiled = compile(SOURCE, { fileName: 'twiddle.shade.ts' });
  const program = buildGlCompute(compiled.module, 'twiddle');
  const input = () => ({ workgroups: [1, 1, 1] as const, memory: { data: new Uint32Array(4) } });

  it('is a program both halves read clean, whose pass program reads the guard beside a memory root', () => {
    expect(compiled.diagnostics).toEqual([]);
    const service = createTypeshadeLanguageService();
    service.openDocument('twiddle.shade.ts', SOURCE);
    expect(service.getDiagnostics('twiddle.shade.ts')).toEqual([]);
    // The two samplers the draw would read on one unit if the guard had none of its own.
    const declared = samplersOf(program.vertex);
    expect(declared.get('_fp64')).toBe('sampler2D');
    expect(declared.get('_phx_mem0')).toBe('usampler2DArray');
  });

  it('binds a texture of one white texel to the guard, on a unit no other sampler reads', async () => {
    const context = recordingGl(true);
    // The draw passes the context's check, and the stand-in loss after it stops the dispatch.
    await expect(runGlCompute(context.gl, program, input())).rejects.toThrow('lost');
    const [first] = context.draws;
    expect(first).toBeDefined();
    const at = first!.units.get('_fp64')!;
    expect([...first!.units].filter(([name]) => name !== '_fp64').map(([, u]) => u)).not.toContain(
      at,
    );
    const { gl, calls } = context;
    const guard = first!.textures.get(at)?.get(gl.TEXTURE_2D);
    expect(context.objects.get('createTexture')).toContain(guard);
    expect(first!.samplers.get(at) ?? null).toBeNull();
    // Its one texel is white, `RGBA8`, read without a filter that needs a mipmap.
    const made = calls.findIndex((c) => c[0] === 'bindTexture' && c[2] === guard);
    const next = calls.slice(
      made + 1,
      calls.findIndex((c, i) => i > made && c[0] === 'bindTexture'),
    );
    expect(next).toContainEqual(['texStorage2D', gl.TEXTURE_2D, 1, gl.RGBA8, 1, 1]);
    expect(next).toContainEqual([
      'texSubImage2D',
      gl.TEXTURE_2D,
      0,
      0,
      0,
      1,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([255, 255, 255, 255]),
    ]);
    expect(next).toContainEqual([
      'texParameteri',
      gl.TEXTURE_2D,
      gl.TEXTURE_MIN_FILTER,
      gl.NEAREST,
    ]);
    expect(next).toContainEqual([
      'texParameteri',
      gl.TEXTURE_2D,
      gl.TEXTURE_MAG_FILTER,
      gl.NEAREST,
    ]);
    // The dispatch made it and deletes it.
    dispatchReleased(context);
  });

  it('binds no guard for an entry that emulates no f64', async () => {
    const plain = buildGlCompute(
      compile(`"use typeshade";
declare const data: storage<array<f32>, "read_write">;
@compute([4]) export function twice(gid: builtin<"global_invocation_id">) {
  data[gid.x] = data[gid.x] * 2.;
}
`).module,
      'twice',
    );
    expect(samplersOf(plain.vertex).has('_fp64')).toBe(false);
    const context = recordingGl(true);
    await expect(runGlCompute(context.gl, plain, input())).rejects.toThrow('lost');
    expect(context.calls.some((c) => c[0] === 'getUniformLocation' && c[2] === '_fp64')).toBe(
      false,
    );
    expect(context.calls.some((c) => c[0] === 'texStorage2D')).toBe(false);
  });

  it('rejects with the entry and the error when the context refuses its draw, so the call settles', async () => {
    // The pass program with its guard under a name the executor does not bind, as every f64
    // entry's was: its sampler2D reads unit 0, where the memory root's usampler2DArray is, and
    // the context refuses the draw. The refusal is the context's check above, not a stand-in.
    const unbound = { ...program, vertex: program.vertex.replaceAll('_fp64', '_fp64x') };
    const context = recordingGl(false);
    await expect(runGlCompute(context.gl, unbound, input())).rejects.toThrow(
      new Error(
        "typeshade/webgl2: twiddle's pass program did not draw: WebGL2 reported INVALID_OPERATION (0x502)",
      ),
    );
    expect(context.draws).toEqual([]);
    dispatchReleased(context);
  });

  it('names the program of each group of draws: a storage texture read in before the first pass', async () => {
    const reads = buildGlCompute(
      compile(`"use typeshade";
declare const acc: texture_storage_2d<"r32float", "read">;
declare const out: storage<array<f32>, "read_write">;
@compute([4]) export function main(gid: builtin<"global_invocation_id">) {
  out[gid.x] = textureLoad(acc, vec2i(i32(gid.x), 0)).x;
}
`).module,
      'main',
    );
    const context = recordingGl(false, { method: 'getError', value: GL_ERRORS['OUT_OF_MEMORY'] });
    await expect(
      runGlCompute(context.gl, reads, {
        workgroups: [1, 1, 1],
        memory: { out: new Uint32Array(4) },
        storageTextures: { acc: { texture: {} as WebGLTexture, width: 4, height: 1 } },
      }),
    ).rejects.toThrow(
      new Error(
        "typeshade/webgl2: main's read of storage texture 'acc' did not draw: WebGL2 reported OUT_OF_MEMORY (0x505)",
      ),
    );
    dispatchReleased(context);
  });
});
