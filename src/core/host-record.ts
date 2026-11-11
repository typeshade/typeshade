// ═══ A call on a resource: recorded, not awaited (change 0138, R2) ═══
//
// A call of a kernel function or a `@compute` entry whose arguments include a resource (a
// `Buffer`, a `Uniform`, an exported binding of either) does not block. It is checked, its
// resources are recorded with the values the call sees (Amendment A5, default 3), and it joins the
// order of calls through `kernelQueue.record`, which submits it when the microtask checkpoint
// ends or at the next use of the order (A5, Q4). The call returns nothing: the host awaits only
// `read()`. A failure is thrown at the next `read()` or call, with the line of the call (default 7).
//
// The first part of milestone 3 takes a call that returns nothing, and every array it writes a
// resource (a `Buffer` or a `Resident`). Each other value is copied at the call. The call runs on
// the default owner's tiers, as a `Resident` of `array()` does.
//
// Like the rest of `typeshade/runtime` it imports no compiler.

import { resourceOf, type RecordedBuffer } from '../runtime/resource.js';
import { copyOf, kernelQueue, residentState, type ResidentArrayState } from './resident.js';
import { callSite, failedAt, noteFailure } from './submission.js';

/** Whether `v` is a resource a call on a resource takes (change 0138, R2). */
export function isResource(v: unknown): boolean {
  return resourceOf(v) !== undefined;
}

/** What a recorded call takes for one argument: the value it runs with, and the write of the
 *  values the call sees into a storage array's device copy. */
export interface RecordedArgument {
  readonly value: unknown;
  readonly upload?: () => void;
  readonly buffer?: RecordedBuffer;
}

/**
 * The argument a recorded call runs with in place of `v` (change 0138, R2): a storage array's
 * hidden handle, with the write of the values the call sees; a uniform's value, read now; a
 * `Resident`, a texture and a sampler as they are; any other value copied now, so that a change the host makes
 * after the call does not reach it (Amendment A5, default 3).
 *
 * @param at - the parameter or the binding, as an error names it: `age(): parameter "xs"`.
 * @param array - the element layout of the array with no size that the parameter or binding is,
 *   when it is one; a storage array is refused anywhere else.
 * @param writes - the call writes the argument: it must be a `Buffer` or a `Resident`.
 * @param copy - whether a value that is no resource is copied: a texture and a sampler are not.
 * @throws `TypeError` naming `at`.
 */
export function recordArgument(
  at: string,
  v: unknown,
  array: { readonly st: number; readonly e: unknown } | undefined,
  writes: boolean,
  copy = true,
): RecordedArgument {
  const r = resourceOf(v);
  if (r?.kind === 'buffer') {
    if (array === undefined)
      throw new TypeError(
        `${at} takes no storage array, and got ${r.name}. A Buffer is an argument where the function or the entry takes an array with no size of its class.`,
      );
    const recorded = r.record(writes);
    if (
      recorded.layout.st !== array.st ||
      JSON.stringify(recorded.layout.e) !== JSON.stringify(array.e)
    )
      throw new TypeError(
        `${at} takes an array whose elements are laid out otherwise than ${r.name}'s; pass a Buffer of the class the parameter names.`,
      );
    return { value: recorded.handle, upload: recorded.upload, buffer: recorded };
  }
  if (writes && residentState(v) === undefined)
    throw new TypeError(
      `${at} is written by the call, which takes a resource, so it does not block and nothing waits to read it back: pass a Buffer, or array(xs), and await its read() (change 0138, R2).`,
    );
  if (r?.kind === 'uniform') return { value: r.value() };
  // A `Resident` is in the order of calls already, and a texture or a sampler is bound as it is.
  if (residentState(v) !== undefined || !copy) return { value: v };
  return { value: copyOf(v, at) };
}

/**
 * Join a recorded call to the order of calls (change 0138, R2). `run` runs the call once it is
 * submitted, after `uploads` write the values it saw; `written` are the device copies it writes,
 * which keep its error for their `read()`. A failure is kept for the next `read()` or call with
 * the line `site` of the call.
 */
export function joinRecorded(
  call: string,
  site: string | undefined,
  uploads: readonly (() => void)[],
  written: readonly ResidentArrayState[],
  run: () => Promise<unknown>,
): void {
  const done = kernelQueue.record(async () => {
    for (const upload of uploads) upload();
    return run();
  });
  done.then(
    () => written.forEach((s) => (s.error = undefined)),
    (e: unknown) => {
      const made = failedAt(e, call, site);
      written.forEach((s) => (s.error = made));
      noteFailure(made);
    },
  );
}

export { callSite };
