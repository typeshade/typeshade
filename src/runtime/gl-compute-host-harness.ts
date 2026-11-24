import { vi } from 'vitest';
import { runGlCompute } from '../core/gl-compute.js';
import { GlRuntimeImpl } from './gl.js';

type Dispatch = Parameters<typeof runGlCompute>;
export const dispatched = vi.mocked(runGlCompute);
export const lastArgs = (): Dispatch[2] => dispatched.mock.calls.at(-1)![2];

export function recordingGl(): { gl: WebGL2RenderingContext; calls: string[] } {
  const calls: string[] = [];
  const names = new Map<number, string>();
  const values = new Map<string, number>();
  const valueOf = (name: string): number => {
    if (!values.has(name)) {
      values.set(name, 0x4000 + values.size);
      names.set(values.get(name)!, name);
    }
    return values.get(name)!;
  };
  const show = (v: unknown): string => (typeof v === 'number' ? (names.get(v) ?? String(v)) : '*');
  const answers: Record<string, () => unknown> = {
    getParameter: () => 0,
    getExtension: () => null,
    createTransformFeedback: () => ({}),
    createFramebuffer: () => ({}),
    createSampler: () => ({}),
    createTexture: () => ({}),
    getError: () => 0,
    checkFramebufferStatus: () => valueOf('FRAMEBUFFER_COMPLETE'),
  };
  const gl = new Proxy(
    {},
    {
      get: (_t, key) => {
        if (typeof key !== 'string') return undefined;
        if (/^[A-Z][A-Z0-9_]*$/.test(key)) return valueOf(key);
        return (...a: unknown[]) => {
          calls.push(`${key}(${a.map(show).join(',')})`);
          return answers[key]?.();
        };
      },
    },
  ) as unknown as WebGL2RenderingContext;
  return { gl, calls };
}

export const bits = (xs: readonly number[]): Uint32Array =>
  new Uint32Array(new Float32Array(xs).buffer.slice(0));

export type LoadedPack = Parameters<GlRuntimeImpl['load']>[0];

export async function setup(pack: LoadedPack) {
  const { gl, calls } = recordingGl();
  const rt = new GlRuntimeImpl(gl, false);
  const pipeline = await rt.load(pack).compute('main');
  return { gl, calls, rt, pipeline };
}
