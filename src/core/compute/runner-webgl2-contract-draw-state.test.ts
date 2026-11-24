import { describe, it, expect } from 'vitest';
import { glStub, runnerOn, kernelOf } from './runner-webgl2-contract-fixtures.js';

describe('createComputeRunner webgl2 tier: draw state', () => {
  it('sets the data texture to NEAREST filtering and CLAMP_TO_EDGE wrapping', async () => {
    const s = glStub();
    const r = await runnerOn(s);
    await r.run(new Float32Array([1, 2, 3]));
    const params = s.named('texParameteri').map((c) => c.args.slice(1));
    const nearest = s.constant('NEAREST');
    const clamp = s.constant('CLAMP_TO_EDGE');
    expect(params.slice(0, 4)).toEqual([
      [s.constant('TEXTURE_MIN_FILTER'), nearest],
      [s.constant('TEXTURE_MAG_FILTER'), nearest],
      [s.constant('TEXTURE_WRAP_S'), clamp],
      [s.constant('TEXTURE_WRAP_T'), clamp],
    ]);
  });

  it('sets the output texture to NEAREST filtering', async () => {
    const s = glStub();
    const r = await runnerOn(s);
    await r.run(new Float32Array([1, 2, 3]));
    const params = s.named('texParameteri').map((c) => c.args.slice(1));
    expect(params.slice(4, 6)).toEqual([
      [s.constant('TEXTURE_MIN_FILTER'), s.constant('NEAREST')],
      [s.constant('TEXTURE_MAG_FILTER'), s.constant('NEAREST')],
    ]);
  });

  it('disables BLEND and clears the integer target with clearBufferuiv before the draw', async () => {
    const s = glStub({ blend: true });
    const r = await runnerOn(s);
    await r.run(new Float32Array([1, 2, 3]));
    const draw = s.indexOf('drawArrays');
    const disable = s.calls.findIndex(
      (c) => c.name === 'disable' && c.args[0] === s.constant('BLEND'),
    );
    const clear = s.indexOf('clearBufferuiv');
    expect(disable).toBeGreaterThan(-1);
    expect(disable).toBeLessThan(draw);
    expect(clear).toBeGreaterThan(-1);
    expect(clear).toBeLessThan(draw);
    expect(s.named('clearBufferuiv')[0]!.args).toEqual([
      s.constant('COLOR'),
      0,
      new Uint32Array([0, 0, 0, 0]),
    ]);
    expect(s.indexOf('clearColor')).toBe(-1);
  });

  it('passes the invocation count and the grid width in the dispatch uniform', async () => {
    const s = glStub();
    const r = await runnerOn(s);
    await r.run(new Float32Array([1, 2, 3, 4, 5]));
    await r.run(new Float32Array(3000));
    const uniforms = s.named('uniform4uiv').map((c) => c.args[1]);
    expect(uniforms).toEqual([new Uint32Array([5, 5, 0, 0]), new Uint32Array([3000, 2048, 0, 0])]);
  });

  it('binds the data texture to unit 0 for the sampler', async () => {
    const s = glStub();
    const r = await runnerOn(s);
    await r.run(new Float32Array([1, 2, 3]));
    expect(s.named('uniform1i').map((c) => c.args[1])).toEqual([0]);
  });

  it('looks the uniforms up under their GLSL spellings', async () => {
    const s = glStub();
    await runnerOn(s, kernelOf({ inputName: 'input' }));
    const names = s.named('getUniformLocation').map((c) => c.args[1]);
    expect(names).toEqual(['input_', 'u_dispatch']);
  });
});
