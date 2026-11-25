import { describe, expect, it } from 'vitest';
import { bothTake } from './testing/both-halves.js';
import {
  buildGlCompute,
  GL_ALL_RUN,
  GL_FIRST_PASS,
  type GlComputeProgram,
} from './passes/gl-compute.js';
import { runGlCompute } from './gl-compute.js';

interface HeadRecord {
  readonly pc: number;
  readonly count?: number;
  readonly key?: number;
  readonly request?: readonly [number, number, number];
}

interface Completing {
  readonly gl: WebGL2RenderingContext;
  readonly calls: unknown[][];
  readonly textures: object[];
}

function completingGl(
  p: GlComputeProgram,
  invocations: number,
  heads: (read: number) => HeadRecord,
  units = 16,
): Completing {
  const calls: unknown[][] = [];
  const textures: object[] = [];
  const constants = new Map<string, number>([['NO_ERROR', 0]]);
  const constant = (name: string): number => {
    if (!constants.has(name)) constants.set(name, 0x10000 + constants.size);
    return constants.get(name)!;
  };
  const head = Math.ceil((p.keysAt + 3) / 4);
  const rowWords = head * 4;
  let headReads = 0;
  const gl = new Proxy(
    {},
    {
      get(_, key) {
        if (typeof key !== 'string') return undefined;
        if (/^[A-Z0-9_]+$/.test(key)) return constant(key);
        return (...args: unknown[]) => {
          calls.push([key, ...args.map((a) => (a instanceof Uint32Array ? a.slice() : a))]);
          if (key === 'isProgram') return true;
          if (/^(getShaderParameter|getProgramParameter)$/.test(key)) return true;
          if (key === 'getError') return 0;
          if (key === 'getParameter')
            return args[0] === constant('MAX_VERTEX_TEXTURE_IMAGE_UNITS') ? units : 256;
          if (key === 'getUniformBlockIndex') return 0;
          if (key === 'clientWaitSync') return constant('ALREADY_SIGNALED');
          if (key === 'checkFramebufferStatus') return constant('FRAMEBUFFER_COMPLETE');
          if (key === 'createTexture') {
            const texture = {};
            textures.push(texture);
            return texture;
          }
          if (key === 'getBufferSubData') {
            const out = args[2] as Uint32Array;
            if (out.length !== invocations * rowWords) return undefined;
            const record = heads(headReads++);
            for (let i = 0; i < invocations; i++) {
              const at = i * rowWords;
              out[at + p.pcWord] = record.pc;
              out[at + p.countWord] = record.count ?? 0;
              out[at + p.keysAt] = record.key ?? 0;
              if (record.request !== undefined) {
                out[at + p.requestAt] = record.request[0];
                out[at + p.requestAt + 1] = record.request[1];
                out[at + p.requestAt + 2] = record.request[2];
              }
            }
            return undefined;
          }
          if (/^(create|fenceSync|getUniformLocation)/.test(key)) return {};
          return undefined;
        };
      },
    },
  ) as WebGL2RenderingContext;
  return { gl, calls, textures };
}

const build = (source: string, entry: string, layout?: { width: number; layerRows: number }) =>
  buildGlCompute(bothTake(source).result.module, entry, layout);

const PLAIN = `"use typeshade";
declare const out: storage<array<f32>, "read_write">;
@compute([4]) export function main(gid: builtin<"global_invocation_id">) {
  out[gid.x] = 1.;
}
`;

const ATOMIC = `"use typeshade";
declare const count: storage<atomic<u32>, "read_write">;
declare const slots: storage<array<u32>, "read_write">;
@compute([4, 1, 1]) export function append(li: builtin<"local_invocation_index">): void {
  const first = atomicAdd(count, 1);
  slots[first] = li;
}
`;

const imageSource = (access: 'read' | 'write') => `"use typeshade";
declare const img: texture_storage_2d<"rgba32float", "${access}">;
declare const out: storage<array<f32>, "read_write">;
@compute([4]) export function main(gid: builtin<"global_invocation_id">) {
  ${
    access === 'write'
      ? 'textureStore(img, vec2i(i32(gid.x), 0), vec4f(1.)); out[gid.x] = 1.;'
      : 'out[gid.x] = textureLoad(img, vec2i(i32(gid.x), 0)).x;'
  }
}
`;

const WORKGROUP = `"use typeshade";
declare const out: storage<array<u32>, "read_write">;
let shared: workgroup<array<u32, 4>>;
@compute([4, 1, 1]) export function main(li: builtin<"local_invocation_index">, gid: builtin<"global_invocation_id">) {
  shared[li] = li;
  workgroupBarrier();
  out[gid.x] = shared[(li + 1) % 4];
}
`;

const run = (c: Completing, p: GlComputeProgram, memory: Record<string, Uint32Array>, groups = 1) =>
  runGlCompute(c.gl, p, { workgroups: [groups, 1, 1], memory });

const passEvents = (c: Completing): string[] => {
  const rgbaInteger = (c.gl as unknown as Record<string, number>).RGBA_INTEGER;
  const events: string[] = [];
  for (const call of c.calls) {
    if (call[0] === 'bufferData' && call[2] instanceof Uint32Array && call[2].length >= 8)
      events.push(`flags ${String(call[2][7])}`);
    if (call[0] === 'texSubImage3D' && call[9] === rgbaInteger && call[11] instanceof Uint32Array)
      events.push('control texels');
  }
  return events;
};

describe('the WebGL2 compute executor refuses a dispatch the context cannot hold', () => {
  it('refuses a root of more words than a write log key can name', async () => {
    const p = build(PLAIN, 'main');
    const c = completingGl(p, 4, () => ({ pc: p.done }));
    const oversized = { length: (1 << 28) + 1 } as unknown as Uint32Array;
    await expect(run(c, p, { out: oversized })).rejects.toThrow(
      "typeshade/webgl2: 'out' holds 268435457 words, more than the 268435456 a write log key can name",
    );
    expect(c.calls.some((call) => call[0] === 'texImage3D')).toBe(false);
  });

  it('refuses a pass program that reads more textures than a vertex stage binds', async () => {
    const p = build(PLAIN, 'main');
    const reads = p.roots.length + 2;
    const c = completingGl(p, 4, () => ({ pc: p.done }), reads - 1);
    await expect(run(c, p, { out: new Uint32Array(4) })).rejects.toThrow(
      `typeshade/webgl2: the pass program reads ${String(reads)} textures, more than the ${String(reads - 1)} a vertex stage of this context binds`,
    );
    expect(c.calls.some((call) => call[0] === 'texImage3D')).toBe(false);
  });

  it('runs a pass program that reads exactly as many textures as a vertex stage binds', async () => {
    const p = build(PLAIN, 'main');
    const c = completingGl(p, 4, () => ({ pc: p.done }), p.roots.length + 2);
    await expect(run(c, p, { out: new Uint32Array(4) })).resolves.toMatchObject({ passes: 1 });
  });
});

describe('the control texels of a pass', () => {
  it('uploads none while every invocation runs and none waits on an atomic result', async () => {
    const p = build(PLAIN, 'main');
    const c = completingGl(p, 4, () => ({ pc: p.done }));
    await run(c, p, { out: new Uint32Array(4) });
    expect(passEvents(c)).toEqual([`flags ${String(GL_FIRST_PASS | GL_ALL_RUN)}`]);
  });

  it('uploads them for the pass after an atomic result, and clears the all-run flag', async () => {
    const p = build(ATOMIC, 'append');
    const atomicAt = Number(Object.keys(p.cuts).find((k) => p.cuts[Number(k)] === 'atomic'));
    const c = completingGl(p, 4, (read) =>
      read === 0 ? { pc: atomicAt, request: [0, 1, 0] } : { pc: p.done },
    );
    await run(c, p, { count: new Uint32Array(1), slots: new Uint32Array(8) });
    expect(passEvents(c)).toEqual([
      `flags ${String(GL_FIRST_PASS | GL_ALL_RUN)}`,
      'control texels',
      'flags 0',
    ]);
  });
});

describe('a storage texture of a dispatch', () => {
  const texture = {} as WebGLTexture;
  const input = { img: { texture, width: 4, height: 1 } };
  const dispatch = async (access: 'read' | 'write', logRoot?: string) => {
    const p = build(imageSource(access), 'main');
    const key =
      logRoot === undefined ? 0 : (p.roots.findIndex((r) => r.name === logRoot) << 28) >>> 0;
    const c = completingGl(p, 4, () =>
      logRoot === undefined ? { pc: p.done } : { pc: p.done, count: 1, key },
    );
    await runGlCompute(c.gl, p, {
      workgroups: [1, 1, 1],
      memory: { out: new Uint32Array(4) },
      storageTextures: input,
    });
    return { p, c };
  };
  const attachments = (c: Completing) =>
    c.calls.filter((call) => /^framebufferTexture/.test(String(call[0])) && call.includes(texture));
  const readBacksOf = (c: Completing, root: number) =>
    c.calls.filter(
      (call) =>
        call[0] === 'framebufferTextureLayer' &&
        call[1] === (c.gl as unknown as Record<string, number>).READ_FRAMEBUFFER &&
        call[3] === c.textures[root],
    );

  it('is drawn back into when the entry may write it', async () => {
    const { c } = await dispatch('write');
    expect(attachments(c)).toHaveLength(2);
  });

  it('is not drawn back into when the entry only reads it', async () => {
    const { c } = await dispatch('read');
    expect(attachments(c)).toHaveLength(0);
  });

  it('is left out of the read-back of the roots that were written', async () => {
    const { p, c } = await dispatch('write', 'img');
    expect(
      readBacksOf(
        c,
        p.roots.findIndex((r) => r.name === 'img'),
      ),
    ).toHaveLength(0);
  });

  it('leaves a written storage buffer in the read-back of the roots that were written', async () => {
    const { p, c } = await dispatch('write', 'out');
    expect(
      readBacksOf(
        c,
        p.roots.findIndex((r) => r.name === 'out'),
      ),
    ).toHaveLength(1);
  });
});

describe('where the invocations start', () => {
  it('starts every record at the resume point the program initialises', async () => {
    const p = build(PLAIN, 'main');
    const starts = { ...p, init: [[p.pcWord, [p.done]]] as GlComputeProgram['init'] };
    const c = completingGl(starts, 4, () => ({ pc: p.done }));
    await expect(run(c, starts, { out: new Uint32Array(4) })).resolves.toMatchObject({
      passes: 0,
    });
  });

  it('starts at the first resume point when the program initialises none', async () => {
    const p = build(PLAIN, 'main');
    const starts = { ...p, init: [] as GlComputeProgram['init'], done: 1 };
    const c = completingGl(starts, 4, () => ({ pc: 1 }));
    await expect(run(c, starts, { out: new Uint32Array(4) })).resolves.toMatchObject({
      passes: 1,
    });
  });

  it('gives a workgroup root one copy of its words for each workgroup', async () => {
    const layout = { width: 4, layerRows: 64 };
    const p = build(WORKGROUP, 'main', layout);
    const root = p.roots.findIndex((r) => r.space === 'workgroup');
    const rowsOf = async (groups: number) => {
      const c = completingGl(p, 4 * groups, () => ({ pc: p.done }));
      await run(c, p, { out: new Uint32Array(4 * groups) }, groups);
      const uploads = c.calls.filter((call) => call[0] === 'texImage3D');
      return uploads[root]![5];
    };
    const fixed = p.roots[root]!.fixed;
    expect(await rowsOf(1)).toBe(Math.ceil(fixed / layout.width));
    expect(await rowsOf(3)).toBe(Math.ceil((fixed * 3) / layout.width));
  });
});
