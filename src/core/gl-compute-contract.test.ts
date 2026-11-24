import { describe, expect, it } from 'vitest';
import { compile } from '../compiler/ts/compile.js';
import { buildGlCompute, GL_ALL_RUN, GL_FIRST_PASS } from './passes/gl-compute.js';
import { compile as compileGl, runGlCompute } from './gl-compute.js';

interface Stub {
  readonly gl: WebGL2RenderingContext;
  readonly calls: unknown[][];
  validPrograms: boolean;
  framebufferComplete: boolean;
}

function stubGl(): Stub {
  const calls: unknown[][] = [];
  const constants = new Map<string, number>([['NO_ERROR', 0]]);
  const state = { validPrograms: true, framebufferComplete: true };
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
          if (key === 'isProgram') return state.validPrograms;
          if (/^(getShaderParameter|getProgramParameter)$/.test(key)) return true;
          if (key === 'getError') return 0;
          if (key === 'getParameter') return 256;
          if (key === 'getUniformBlockIndex') return 0;
          if (key === 'clientWaitSync') return constants.get('WAIT_FAILED') ?? 0x1ffff;
          if (key === 'checkFramebufferStatus')
            return state.framebufferComplete ? constants.get('FRAMEBUFFER_COMPLETE') : 0;
          if (/^(create|fenceSync|getUniformLocation)/.test(key)) return {};
          return undefined;
        };
      },
    },
  ) as WebGL2RenderingContext;
  return {
    gl,
    calls,
    get validPrograms() {
      return state.validPrograms;
    },
    set validPrograms(v: boolean) {
      state.validPrograms = v;
    },
    get framebufferComplete() {
      return state.framebufferComplete;
    },
    set framebufferComplete(v: boolean) {
      state.framebufferComplete = v;
    },
  };
}

function storageEntry(access: 'read' | 'write') {
  const body =
    access === 'write'
      ? 'textureStore(img, vec2i(i32(gid.x), 0), vec4f(1.));'
      : 'out[gid.x] = textureLoad(img, vec2i(i32(gid.x), 0)).x;';
  return buildGlCompute(
    compile(`"use typeshade";
declare const img: texture_storage_2d<"rgba32float", "${access}">;
declare const out: storage<array<f32>, "read_write">;
@compute([4]) export function main(gid: builtin<"global_invocation_id">) {
  ${body}
}
`).module,
    'main',
  );
}

const storageInput = () => ({
  workgroups: [1, 1, 1] as const,
  memory: { out: new Uint32Array(4) },
  storageTextures: { img: { texture: {} as WebGLTexture, width: 4, height: 1 } },
});

describe('the WebGL2 compute executor on a context that records its calls', () => {
  it('links a program again once its context no longer holds it', () => {
    const stub = stubGl();
    const first = compileGl(stub.gl, 'vertex', 'fragment', 'probe');
    expect(compileGl(stub.gl, 'vertex', 'fragment', 'probe')).toBe(first);
    stub.validPrograms = false;
    const relinked = compileGl(stub.gl, 'vertex', 'fragment', 'probe');
    expect(relinked).not.toBe(first);
    expect(stub.calls.filter((c) => c[0] === 'linkProgram')).toHaveLength(2);
  });

  it('refuses a written storage texture its context cannot render to before any draw', async () => {
    const stub = stubGl();
    stub.framebufferComplete = false;
    await expect(runGlCompute(stub.gl, storageEntry('write'), storageInput())).rejects.toThrow(
      "the storage texture 'img' is rgba32float, which this WebGL2 context does not render to",
    );
    expect(stub.calls.some((c) => c[0] === 'drawArrays')).toBe(false);
  });

  it('asks no render check of a storage texture the entry only reads', async () => {
    const stub = stubGl();
    stub.framebufferComplete = false;
    await runGlCompute(stub.gl, storageEntry('read'), storageInput()).catch(() => undefined);
    expect(stub.calls.some((c) => c[0] === 'checkFramebufferStatus')).toBe(false);
    expect(stub.calls.some((c) => c[0] === 'drawArrays')).toBe(true);
  });

  it('starts the first pass with the first-pass and all-run flags the pass program reads', async () => {
    const stub = stubGl();
    const plain = buildGlCompute(
      compile(`"use typeshade";
declare const out: storage<array<f32>, "read_write">;
@compute([4]) export function main(gid: builtin<"global_invocation_id">) {
  out[gid.x] = 1.;
}
`).module,
      'main',
    );
    await runGlCompute(stub.gl, plain, {
      workgroups: [1, 1, 1],
      memory: { out: new Uint32Array(4) },
    }).catch(() => undefined);
    const controls = stub.calls.filter(
      (c) => c[0] === 'bufferData' && c[2] instanceof Uint32Array && c[2].length >= 8,
    );
    expect(controls.length).toBeGreaterThan(0);
    expect((controls[0]![2] as Uint32Array)[7]).toBe(GL_FIRST_PASS | GL_ALL_RUN);
  });
});
