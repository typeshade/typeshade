// ═══ A call on a resource: recorded, not awaited (change 0138, R2) ═══
//
// A call of a kernel function or a `@compute` entry whose arguments include a resource (a
// `Buffer`, a `Uniform`, an exported binding of either) does not block. It is checked, its
// resources are recorded with the values the call sees (Amendment A5, default 3), and it joins the
// order of calls through `kernelQueue.record`, which submits it when the microtask checkpoint
// ends or at the next use of the order (A5, Q4). The call returns nothing: the host awaits only
// `read()`. A failure is thrown at the next `read()` or call, with the line of the call (default 7);
// a `Buffer` the failed call wrote throws it at each later call that takes it and at its `read()`,
// until `set(data)` or `resize()` gives it new values (the owner's decision of 2026-11-11).
//
// Every check runs before any `Buffer` is changed: a call refused at the call site leaves each
// `Buffer` as it was. Only then are the values the call sees copied out (`commit`).
//
// The first part of milestone 3 takes a call that returns nothing, and every array it writes a
// resource (a `Buffer` or a `Resident`). Each other value is copied at the call. The call runs on
// the device of its resources, and with none of its own (an exported binding) on the device in
// use, or the default owner when none is in use (R3). Its owner is settled at the call, before any
// argument is taken: a storage array is taken in that owner's device copy.
//
// Like the rest of `typeshade/runtime` it imports no compiler.

import { copyOf, kernelQueue, residentState, type ResidentArrayState } from './resident.js';
import { resourceOwner, type CallOwner } from './owner.js';
import { callSite, failedAt, noteFailure } from './submission.js';

/** What a call takes for a storage array: the hidden handle of its device copy, which the call
 *  layer runs as it runs a `Resident`. `commit` copies out the values the call sees, once every
 *  check of the call passed, and gives their write into the device copy; `done` ends the check. */
export interface RecordedBuffer {
  readonly handle: object;
  readonly layout: { readonly st: number; readonly e: unknown };
  readonly name: string;
  done(): void;
  commit(): (() => void) | undefined;
}

/** What a resource gives a call: a uniform's value now, or a storage array recorded for it on the
 *  call's owner. `owner` is the device the resource belongs to, or undefined for an exported
 *  binding, which belongs to no one device (change 0138, R3). */
export type ResourceOf = (v: unknown) =>
  | {
      readonly kind: 'uniform';
      readonly name: string;
      readonly owner: CallOwner | undefined;
      value(): unknown;
    }
  | {
      readonly kind: 'buffer';
      readonly name: string;
      readonly owner: CallOwner | undefined;
      prepare(writes: boolean, owner: CallOwner): RecordedBuffer;
    }
  | undefined;

/** The reader of resources, which `runtime/resource.ts` installs when it loads. The call layer
 *  imports no resource, so `typeshade/fuse`, which borrows it, reaches no program runtime (Rule
 *  11.11); where no resource module is loaded, no value is a resource. */
export const resources: { of: ResourceOf } = { of: () => undefined };

const resourceOf = (v: unknown): ReturnType<ResourceOf> => resources.of(v);

/** Whether `v` is a resource a call on a resource takes (change 0138, R2). */
export function isResource(v: unknown): boolean {
  return resourceOf(v) !== undefined;
}

/** The owner an argument of a call on a resource brings (change 0138, R3): the device a `Buffer`
 *  belongs to, the owner of a `Resident` or of a device's texture, or undefined for an exported
 *  binding, a `Uniform` and a plain value. `at` names the argument for a destroyed `Resident`. */
export function argumentOwner(v: unknown, at?: string): CallOwner | undefined {
  const r = resourceOf(v);
  return r !== undefined ? r.owner : resourceOwner(v, at);
}

/** What a recorded call takes for one argument: the value it runs with, and for a storage array
 *  what ends its check and copies out the values the call sees. */
export interface RecordedArgument {
  readonly value: unknown;
  readonly buffer?: RecordedBuffer;
}

/**
 * The argument a recorded call runs with in place of `v` (change 0138, R2): a storage array's
 * hidden handle, with nothing copied out yet ({@link commitArguments}); a uniform's value, read
 * now; a
 * `Resident`, a texture and a sampler as they are; any other value copied now, so that a change the host makes
 * after the call does not reach it (Amendment A5, default 3).
 *
 * @param at - the parameter or the binding, as an error names it: `age(): parameter "xs"`.
 * @param array - the element layout of the array with no size that the parameter or binding is,
 *   when it is one; a storage array is refused anywhere else.
 * @param writes - the call writes the argument: it must be a `Buffer` or a `Resident`.
 * @param copy - whether a value that is no resource is copied: a texture and a sampler are not.
 * @param owner - the owner the call runs on, whose device copy of a storage array it takes (R3).
 * @throws `TypeError` naming `at`.
 */
export function recordArgument(
  at: string,
  v: unknown,
  array: { readonly st: number; readonly e: unknown } | undefined,
  writes: boolean,
  copy: boolean,
  owner: CallOwner,
): RecordedArgument {
  const r = resourceOf(v);
  if (r?.kind === 'buffer') {
    if (array === undefined)
      throw new TypeError(
        `${at} takes no storage array, and got ${r.name}. A Buffer is an argument where the function or the entry takes an array with no size of its class.`,
      );
    const recorded = r.prepare(writes, owner);
    if (
      recorded.layout.st !== array.st ||
      JSON.stringify(recorded.layout.e) !== JSON.stringify(array.e)
    ) {
      recorded.done();
      throw new TypeError(
        `${at} takes an array whose elements are laid out otherwise than ${r.name}'s; pass a Buffer of the class the parameter names.`,
      );
    }
    return { value: recorded.handle, buffer: recorded };
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
 * Check a recorded call with `check`, then copy out the values each storage array of `taken` gives
 * the call. A refused call copies nothing out, so each `Buffer` stays as it was (the review of
 * #1236, B2). Gives the writes of those values into the device copies, for {@link joinRecorded}.
 *
 * @throws what `check` throws.
 */
export function commitArguments<T>(
  taken: readonly RecordedArgument[],
  check: () => T,
): { readonly checked: T; readonly uploads: (() => void)[] } {
  let checked: T;
  try {
    checked = check();
  } finally {
    for (const t of taken) t.buffer?.done();
  }
  const uploads: (() => void)[] = [];
  for (const t of taken) {
    const upload = t.buffer?.commit();
    if (upload !== undefined) uploads.push(upload);
  }
  return { checked, uploads };
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
      for (const s of written) {
        s.error = made;
        // A `Buffer`'s device copy holds nothing to read back: it leaves the window.
        (s as { failed?(): void }).failed?.();
      }
      noteFailure(made);
    },
  );
}

export { callSite };
