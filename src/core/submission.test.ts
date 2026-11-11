// On WebGL2 a submission flushes, and a `read()` waits on a fence (change 0138, Amendment A5,
// default 6; `readFence` in `gl-fence.ts`). A recording context stands in for WebGL2: it
// logs each `flush`, `fenceSync`, `clientWaitSync` and `deleteSync`, and signals its fence at the
// second poll. The browser evidence is the `resource` arm of `gate:differential`, which counts the
// same calls on a real WebGL2 context.
//
// Verifies: Rule 11.8 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { kernelQueue, makeResident, residentState } from './resident.js';
import { usedGl } from './submission.js';

function recording(): { gl: WebGL2RenderingContext; log: string[] } {
  const log: string[] = [];
  let polls = 0;
  const gl = {
    SYNC_GPU_COMMANDS_COMPLETE: 1,
    ALREADY_SIGNALED: 2,
    TIMEOUT_EXPIRED: 3,
    CONDITION_SATISFIED: 4,
    WAIT_FAILED: 5,
    flush: () => log.push('flush'),
    fenceSync: () => (log.push('fenceSync'), {}),
    clientWaitSync: () => (log.push('clientWaitSync'), ++polls >= 2 ? 2 : 3),
    deleteSync: () => log.push('deleteSync'),
  } as unknown as WebGL2RenderingContext;
  return { gl, log };
}

describe('a submission on WebGL2 (A5, default 6)', () => {
  it('flushes each context its calls used, once, when it ends', async () => {
    const { gl, log } = recording();
    void kernelQueue.record(async () => usedGl(gl));
    void kernelQueue.record(async () => usedGl(gl));
    expect(log).toEqual([]);
    await kernelQueue.idle();
    expect(log).toEqual(['flush']);
    // A submission with no WebGL2 call flushes nothing.
    void kernelQueue.record(async () => undefined);
    await kernelQueue.idle();
    expect(log).toEqual(['flush']);
  });

  it('a read() of what a call wrote on WebGL2 waits on a fence, polled until it is signalled', async () => {
    const { gl, log } = recording();
    const r = makeResident('array()', [new Float32Array([1, 2])]);
    residentState(r)!.fence = gl;
    expect(Array.from((await r.read()) as Float32Array)).toEqual([1, 2]);
    expect(log).toEqual(['fenceSync', 'flush', 'clientWaitSync', 'clientWaitSync', 'deleteSync']);
    // The fence is waited on once: a second read places none.
    await r.read();
    expect(log.length).toBe(5);
  });
});

describe('a lost WebGL2 context at read() (S4 of the review of #1238)', () => {
  it('gives the values the host holds, since the call read them back already', async () => {
    for (const lost of [
      { fenceSync: () => null, clientWaitSync: () => 5, isContextLost: () => false },
      { fenceSync: () => ({}), clientWaitSync: () => 5, isContextLost: () => true },
      { fenceSync: () => ({}), clientWaitSync: () => 5, isContextLost: () => false },
    ]) {
      const gl = {
        SYNC_GPU_COMMANDS_COMPLETE: 1,
        ALREADY_SIGNALED: 2,
        TIMEOUT_EXPIRED: 3,
        CONDITION_SATISFIED: 4,
        WAIT_FAILED: 5,
        flush: () => undefined,
        deleteSync: () => undefined,
        ...lost,
      } as unknown as WebGL2RenderingContext;
      const r = makeResident('array()', [new Float32Array([1, 2])]);
      residentState(r)!.fence = gl;
      expect(Array.from((await r.read()) as Float32Array)).toEqual([1, 2]);
    }
  });
});
