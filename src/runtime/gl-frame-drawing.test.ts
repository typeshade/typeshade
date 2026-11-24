import { describe, expect, it } from 'vitest';
import { GlRuntimeImpl } from './gl.js';
import { recordingGl } from './gl-compute-host-harness.js';

const bindsFramebuffer = (calls: readonly string[]): boolean =>
  calls.some((c) => c.startsWith('bindFramebuffer('));

describe('a frame of the WebGL2 runtime draws on the context of its own runtime', () => {
  it('records a pass of rt.frame() and runs it on submit, on the runtime context only', async () => {
    const mine = recordingGl();
    const other = recordingGl();
    const rt = new GlRuntimeImpl(mine.gl, false);
    new GlRuntimeImpl(other.gl, false);
    const target = rt.texture({ size: [2, 2], format: 'rgba8unorm' });
    mine.calls.length = 0;
    other.calls.length = 0;
    const frame = rt.frame();
    frame.pass({ color: [target] }, () => {});
    await frame.submit();
    expect(bindsFramebuffer(mine.calls)).toBe(true);
    expect(other.calls).toEqual([]);
  });

  it('runs a pass recorded inside runFrame on the runtime context only', async () => {
    const mine = recordingGl();
    const other = recordingGl();
    const rt = new GlRuntimeImpl(mine.gl, false);
    new GlRuntimeImpl(other.gl, false);
    const target = rt.texture({ size: [2, 2], format: 'rgba8unorm' });
    mine.calls.length = 0;
    other.calls.length = 0;
    await rt.runFrame((f) => f.pass({ color: [target] }, () => {}));
    expect(bindsFramebuffer(mine.calls)).toBe(true);
    expect(other.calls).toEqual([]);
  });
});
