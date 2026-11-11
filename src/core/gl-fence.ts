// ═══ A WebGL2 fence, polled while the host yields to the page (change 0054; change 0138, A5) ═══
//
// A read back of the WebGL2 tier waits for the GPU on a fence (`gl-compute.ts`), and so does a
// `read()` of a resource that a recorded call wrote on WebGL2 (change 0138, Amendment A5, default
// 6). A module of its own, so a resource reaches no pass program to wait on a fence. Like the rest
// of `typeshade/runtime` it imports nothing.

/** Give the page one turn. A `MessageChannel` message runs on the next task with no delay;
 *  a nested `setTimeout(0)` waits at least 4 ms, which a pass with several read-backs pays each
 *  time. */
function yieldToPage(): Promise<void> {
  return new Promise((settle) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      settle();
    };
    channel.port2.postMessage(undefined);
  });
}

/** Settle once the GPU has run every command given to `gl` so far: a fence, polled while the host
 *  yields to the page. */
export async function gpuDone(gl: WebGL2RenderingContext): Promise<void> {
  const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)!;
  gl.flush();
  for (;;) {
    const state = gl.clientWaitSync(fence, 0, 0);
    if (state === gl.ALREADY_SIGNALED || state === gl.CONDITION_SATISFIED) break;
    if (state === gl.WAIT_FAILED) {
      gl.deleteSync(fence);
      throw new Error('typeshade/webgl2: a read-back fence failed (was the context lost?)');
    }
    await yieldToPage();
  }
  gl.deleteSync(fence);
}

/**
 * Wait on a fence for a `read()` of what a recorded call wrote on WebGL2 (change 0138, Amendment
 * A5, default 6). The WebGL2 tier reads each call's words back inside the call, so the values are
 * on the host already: a lost context (`isContextLost()`, a `null` fence, `WAIT_FAILED`) ends the
 * wait and is no error of the read (S4 of the review of #1238). The next call meets the lost
 * context itself.
 */
export async function readFence(gl: WebGL2RenderingContext): Promise<void> {
  if (gl.isContextLost?.() === true) return;
  const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  if (fence === null) return;
  gl.flush();
  try {
    for (;;) {
      const state = gl.clientWaitSync(fence, 0, 0);
      if (state === gl.ALREADY_SIGNALED || state === gl.CONDITION_SATISFIED) return;
      if (state === gl.WAIT_FAILED) return;
      await yieldToPage();
    }
  } finally {
    gl.deleteSync(fence);
  }
}
