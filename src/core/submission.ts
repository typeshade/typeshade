// ═══ The submission of recorded calls, and the error of a failed one (change 0138, R2) ═══
//
// A call of a kernel function or a `@compute` entry whose arguments include a resource (a
// `Buffer`, a `Uniform`) does not block (change 0138, R2): it is recorded, and the runtime submits
// what was recorded when the current microtask checkpoint ends, or sooner when a `read()`, a call
// with plain data only, or any other use of the order of calls needs it (Amendment A5, Q4 and
// defaults 2, 4 and 9). The order itself is `kernelQueue` (`core/resident.ts`), which keeps the
// recorded calls apart until it submits them.
//
// A recorded call that fails has nobody waiting on it. Its error, with the line of the call
// recorded when the call was made, is thrown at the next `read()` or call (A5, default 7). A
// `Buffer` the call wrote keeps it until `set(data)` or `resize()` (the owner's decision of
// 2026-11-11).
//
// The end of a checkpoint cannot be seen from JavaScript: the submission comes in the next task,
// so calls that tasks before it record join it. The order of calls is kept (deviation D-f).
//
// Like the rest of `typeshade/runtime` it imports no compiler.

/** Run `f` after the current microtask checkpoint ends: in the next task. A promise's reaction
 *  runs before it, so calls made on either side of an `await` of a settled promise stay in one
 *  submission (A5, default 4). */
export const afterCheckpoint: (f: () => void) => void = (() => {
  const g = globalThis as {
    setImmediate?: (f: () => void) => unknown;
    MessageChannel?: new () => {
      port1: { onmessage: (() => void) | null; unref?: () => void };
      port2: { postMessage(v: unknown): void };
    };
  };
  if (typeof g.setImmediate === 'function') {
    const set = g.setImmediate;
    return (f) => void set(f);
  }
  if (typeof g.MessageChannel === 'function') {
    // A page has no setImmediate; a message is a task with no clamp, which a timer has.
    const channel = new g.MessageChannel();
    const waiting: (() => void)[] = [];
    channel.port1.onmessage = () => waiting.shift()?.();
    channel.port1.unref?.();
    return (f) => {
      waiting.push(f);
      channel.port2.postMessage(0);
    };
  }
  return (f) => void setTimeout(f, 0);
})();

/** The error of a recorded call that failed, not yet thrown at a `read()` or a call. */
let failed: unknown;

/**
 * The line of the host's call, read off the stack: the first frame below the generated
 * module's function that called `entry`, past `between` more frames of the runtime. Undefined
 * where the runtime gives no stack.
 */
export function callSite(entry: (...args: never) => unknown, between = 0): string | undefined {
  const holder: { stack?: string } = {};
  const capture = (
    Error as { captureStackTrace?: (o: object, f: (...args: never) => unknown) => void }
  ).captureStackTrace;
  if (capture !== undefined) capture(holder, entry);
  else holder.stack = new Error().stack;
  const frames = (holder.stack ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('at ') || /@/.test(l));
  // With captureStackTrace the first frame is the generated function of the module, and the host's
  // line is the one below it. Without it, the frames of the runtime come first.
  const host =
    capture !== undefined
      ? frames[1 + between]
      : frames.find((l) => !/[\\/](core|runtime)[\\/]|\.shade\./.test(l));
  return host?.replace(/^at /, '');
}

/** The error a recorded call `call` (`"step()"`) failed with, made again with the line it was
 *  called at, of the same kind (`TypeError`, `RangeError`, `Error`), and the original as its
 *  cause. */
export function failedAt(err: unknown, call: string, site: string | undefined): unknown {
  // The error of an earlier failed call, which a later call that took its `Buffer` threw again,
  // stays as it is: it names the line of the call that failed.
  if (!(err instanceof Error) || made.has(err)) return err;
  const Kind = (
    err instanceof TypeError ? TypeError : err instanceof RangeError ? RangeError : Error
  ) as ErrorConstructor;
  const where = site === undefined ? '' : ` at ${site}`;
  const error = new Kind(
    `${err.message}\n(${call} was called${where} and recorded; it failed when it was submitted, and this is the next read() or call: change 0138, R2.)`,
    { cause: err },
  );
  made.add(error);
  return error;
}

/** The errors {@link failedAt} made. */
const made = new WeakSet<object>();

/** Keep the error of a recorded call for the next `read()` or call. The first one waits; a later
 *  one is the cause of no thrown error, since the calls after a failed one ran apart from it. */
export function noteFailure(err: unknown): void {
  if (failed === undefined) failed = err;
}

/** Throw the error of a recorded call that failed at the next `read()` or call, wherever it is.
 *  This pending copy is thrown once; a `Buffer` the call wrote keeps the error too, and throws it
 *  at each later call that takes it and at its `read()` until `set(data)` or `resize()` (the
 *  owner's decision of 2026-11-11). */
export function throwFailure(): void {
  if (failed === undefined) return;
  const err = failed;
  failed = undefined;
  throw err;
}

/** Whether a recorded call failed and its error waits for the next `read()` or call. Not API: a
 *  test reads it. */
export function failurePending(): boolean {
  return failed !== undefined;
}
