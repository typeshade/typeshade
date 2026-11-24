import { describe, it, expect } from 'vitest';
import { createComputeRunner } from '../../compute.js';
import { glStub, runnerOn, attempt, kernelOf } from './runner-webgl2-contract-fixtures.js';

describe('createComputeRunner webgl2 tier: lifetime', () => {
  it('emits and links once at construction, not per run', async () => {
    const s = glStub();
    const r = await runnerOn(s);
    expect(s.named('shaderSource').length).toBe(2);
    await r.run(new Float32Array([1]));
    await r.run(new Float32Array([1, 2]));
    expect(s.named('shaderSource').length).toBe(2);
    expect(s.named('linkProgram').length).toBe(1);
  });

  it('resolves webgl2 by default when only a context is present, and reports the skipped webgpu', async () => {
    const s = glStub();
    const r = await createComputeRunner(kernelOf(), { gl: s.gl });
    expect(r.backend).toBe('webgl2');
    expect(r.rejected.map((x) => x.backend)).toEqual(['webgpu']);
  });

  it('returns a promise from run on the cpu and webgl2 tiers', async () => {
    const s = glStub();
    const gl = await runnerOn(s);
    const cpu = await createComputeRunner(kernelOf(), { prefer: ['cpu'] });
    expect(gl.run(new Float32Array([1]))).toBeInstanceOf(Promise);
    expect(cpu.run(new Float32Array([1]))).toBeInstanceOf(Promise);
  });

  it('releases the program and the data texture once, however often dispose is called', async () => {
    const s = glStub();
    const r = await runnerOn(s);
    r.dispose();
    r.dispose();
    expect(s.named('deleteProgram').length).toBe(1);
    expect(s.named('deleteTexture').length).toBe(1);
  });

  it('refuses to run after dispose', async () => {
    const s = glStub();
    const r = await runnerOn(s);
    r.dispose();
    const error = await attempt(async () => r.run(new Float32Array([1])));
    expect(String(error)).toMatch(/runner has been disposed/);
  });
});
