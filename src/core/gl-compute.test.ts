// The WebGL2 executor of change 0054 (`runGlCompute`) on a context that records its calls. The
// executor itself runs on WebGL2 in the GPU differential (`scripts/gl-compute-arm.ts`) and the
// compile gate; here, what it leaves on a context that outlives a dispatch which throws.

import { describe, expect, it } from 'vitest';
import { compile } from '../compiler/ts/compile.js';
import { buildGlCompute } from './passes/gl-compute.js';
import { runGlCompute } from './gl-compute.js';

/** A WebGL2 context that records every call and runs nothing: each object it makes is a fresh
 *  `{}`, each constant a number of its own, and `drawArrays` throws when `failDraw` is set. */
function recordingGl(failDraw: boolean): { gl: WebGL2RenderingContext; calls: unknown[][] } {
  const calls: unknown[][] = [];
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
          if (key === 'drawArrays' && failDraw) throw new Error('lost');
          if (key === 'getParameter') {
            const name = [...constants].find(([, v]) => v === args[0])?.[0] ?? '';
            return answers[name] ?? 0;
          }
          if (/^(getShaderParameter|getProgramParameter|isProgram)$/.test(key)) return true;
          if (/^(create|fenceSync|getUniformLocation)/.test(key)) return {};
          if (key === 'getUniformBlockIndex') return 0;
          return undefined;
        };
      },
    },
  ) as WebGL2RenderingContext;
  return { gl, calls };
}

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
