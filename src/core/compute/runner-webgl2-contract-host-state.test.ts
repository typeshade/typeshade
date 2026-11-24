import { describe, it, expect } from 'vitest';
import { glStub, runnerOn, attempt, INCOMPLETE } from './runner-webgl2-contract-fixtures.js';

describe('createComputeRunner webgl2 tier: host state on every exit', () => {
  const host = { kind: 'host-program' };
  const hostTex = { kind: 'host-texture' };
  const hostViewport = [10, 20, 300, 200];

  it('restores the viewport after a dispatch', async () => {
    const s = glStub({ viewport: hostViewport });
    const r = await runnerOn(s);
    await r.run(new Float32Array(3000));
    expect(s.named('viewport')[0]!.args).toEqual([0, 0, 2048, 2]);
    expect(s.viewport()).toEqual(hostViewport);
  });

  it('unbinds the framebuffer after a dispatch', async () => {
    const s = glStub();
    const r = await runnerOn(s);
    await r.run(new Float32Array([1]));
    const binds = s.named('bindFramebuffer');
    expect(binds.at(-1)!.args[1]).toBeNull();
  });

  it('restores BLEND, program, texture and viewport when the framebuffer is incomplete', async () => {
    const s = glStub({
      blend: true,
      program: host,
      tex0: hostTex,
      viewport: hostViewport,
      framebufferStatus: INCOMPLETE,
    });
    const r = await runnerOn(s);
    const error = await attempt(async () => r.run(new Float32Array([1, 2])));
    expect(String(error)).toMatch(/R32UI framebuffer incomplete \(0x8cd6\)/);
    expect(s.blendEnabled()).toBe(true);
    expect(s.currentProgram()).toBe(host);
    expect(s.bindingOn(s.constant('TEXTURE0'))).toBe(hostTex);
    expect(s.viewport()).toEqual(hostViewport);
    expect(s.named('deleteFramebuffer').length).toBe(1);
    expect(s.named('deleteTexture').length).toBe(1);
  });

  it('restores the host state and frees the output texture when createFramebuffer fails', async () => {
    const s = glStub({ blend: true, program: host, tex0: hostTex, failFramebuffer: true });
    const r = await runnerOn(s);
    const error = await attempt(async () => r.run(new Float32Array([1, 2])));
    expect(String(error)).toMatch(/gl\.createFramebuffer failed/);
    expect(s.blendEnabled()).toBe(true);
    expect(s.currentProgram()).toBe(host);
    expect(s.bindingOn(s.constant('TEXTURE0'))).toBe(hostTex);
    expect(s.named('deleteTexture').length).toBe(1);
  });

  it('restores the host state when the output texture cannot be created', async () => {
    const s = glStub({ blend: true, program: host, tex0: hostTex, failTextureAt: 2 });
    const r = await runnerOn(s);
    const error = await attempt(async () => r.run(new Float32Array([1, 2])));
    expect(String(error)).toMatch(/gl\.createTexture \(out\) failed/);
    expect(s.blendEnabled()).toBe(true);
    expect(s.currentProgram()).toBe(host);
    expect(s.bindingOn(s.constant('TEXTURE0'))).toBe(hostTex);
  });

  it('restores the host texture binding after the last delete', async () => {
    const s = glStub({ tex0: hostTex });
    const r = await runnerOn(s);
    await r.run(new Float32Array([1, 2]));
    const lastDelete = s.lastIndexOf('deleteTexture');
    const restore = s.calls
      .map(
        (c: { name: string; args: readonly unknown[] }) =>
          c.name === 'bindTexture' && c.args[1] === hostTex,
      )
      .lastIndexOf(true);
    expect(lastDelete).toBeGreaterThan(-1);
    expect(restore).toBeGreaterThan(lastDelete);
  });

  it('takes the texture snapshot before the data upload binds its own texture', async () => {
    const s = glStub({ tex0: hostTex, activeUnit: 0x84c3 });
    const r = await runnerOn(s);
    await r.run(new Float32Array([1, 2]));
    const snapshot = s.calls.findIndex(
      (c) => c.name === 'getParameter' && c.args[0] === s.constant('TEXTURE_BINDING_2D'),
    );
    const firstBind = s.indexOf('bindTexture');
    expect(snapshot).toBeGreaterThan(-1);
    expect(snapshot).toBeLessThan(firstBind);
  });
});
