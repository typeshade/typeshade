import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CheckedCall, KernelFace } from './host-kernel.js';
import type { CallOwner } from './owner.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

function fakeGl(refuses: string[] = []): { gl: unknown; programs: () => number } {
  let programs = 0;
  const sources = new Map<unknown, string>();
  const gl = {
    createShader: () => ({}),
    shaderSource: (s: unknown, text: string) => void sources.set(s, text),
    compileShader: () => undefined,
    getShaderParameter: (s: unknown) => !refuses.includes(sources.get(s) ?? ''),
    getShaderInfoLog: (s: unknown) => `bad ${sources.get(s) ?? ''}`,
    createProgram: () => ({ id: programs++ }),
    attachShader: () => undefined,
    linkProgram: () => undefined,
    getProgramParameter: () => true,
  };
  return { gl, programs: () => programs };
}

async function tierFitOn(gl: unknown) {
  vi.resetModules();
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      getContext(): unknown {
        return gl;
      }
    },
  );
  const { tierFit } = await import('./host-kernel.js');
  const k = {
    name: 'f',
    params: [],
    gpu: {},
    gl: { loops: [{ glsl: 'one' }, { glsl: 'two' }] },
  } as unknown as KernelFace;
  const c = { hosts: [], ranges: [], held: undefined } as unknown as CheckedCall;
  return () => tierFit(k, c, {} as CallOwner, 'webgl2');
}

describe('the WebGL2 programs of a call', () => {
  it('are all compiled when the tier is settled, once for each loop', async () => {
    const { gl, programs } = fakeGl();
    const fit = await tierFitOn(gl);
    expect(await fit()).toMatchObject({ tier: 'webgl2' });
    expect(programs()).toBe(2);
    expect(await fit()).toMatchObject({ tier: 'webgl2' });
    expect(programs()).toBe(2);
  });

  it('refuse the tier with the message of WebGL2 when one of them is refused', async () => {
    const { gl } = fakeGl(['two']);
    const fit = await tierFitOn(gl);
    expect(await fit()).toEqual({ why: 'WebGL2 refused the program: bad two' });
  });
});
