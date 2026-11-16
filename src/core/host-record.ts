// ═══ A call on a resource: recorded, not awaited (change 0138, R2) ═══
//
// A call of a kernel function or a `@compute` entry whose arguments include a resource (a
// `Buffer` of structs or of scalars, a `Uniform`, an exported binding of either; Amendment A10,
// Q-I) does not block. It is checked, its resources are recorded with the values the call sees
// (Amendment A5, default 3), and it joins the order of calls through `kernelQueue.record`, which
// submits it when the microtask checkpoint ends or at the next use of the order (A5, Q4). A call
// that returns nothing returns nothing, and one that returns a value returns `Buffer`s at once
// (A10, Q-C): the host awaits only `read()`. A failure is thrown at the next `read()` or call, with
// the line of the call (default 7); a `Buffer` the failed call wrote throws it at each later call
// that takes it and at its `read()`, until `set(data)` or `resize()` gives it new values (the
// owner's decision of 2026-11-11).
//
// A call that takes a resource and writes a plain array waits: it returns a promise, fills the
// plain array when it is done, and gives its result as plain data (R2 as amended by Amendments
// A10 and A11, Q7).
//
// Every check runs before any `Buffer` is changed: a call refused at the call site leaves each
// `Buffer` as it was. Only then are the values the call sees copied out (`commit`). The call runs
// on the device of its resources, and with none of its own (an exported binding) on the device in
// use, or the default owner when none is in use (R3). Its owner is settled at the call, before any
// argument is taken: a storage array is taken in that owner's device copy.
//
// Like the rest of `typeshade/runtime` it imports no compiler.

import { copyOf, kernelQueue, residentState, type ResidentArrayState } from './resident.js';
import { resourceOwner, type CallOwner } from './owner.js';
import { callSite, failedAt, noteFailure } from './submission.js';
import type { Layout } from './host-entry.js';

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
export const resources: { of: ResourceOf; structs?: StructResults } = { of: () => undefined };

/** What makes the result `Buffer<S>` of an `array<S, N>` (change 0138, Amendment A12, Q6 and
 *  Q7): a `Buffer` of the region laid out by `layout`, whose `read()` gives instances of `proto`,
 *  made at the call on `owner`. `state` is the copy the call writes, `upload` gives it the
 *  region's values when the call runs, and `fill` writes the result's values into it after.
 *  `typeshade/runtime` sets it, as it sets {@link resources.of}. */
export type StructResults = (
  layout: Layout & { readonly k: 'a' },
  proto: object,
  name: string,
  length: number,
  owner: CallOwner,
) => {
  readonly value: unknown;
  readonly state: ResidentArrayState;
  readonly upload: (() => void) | undefined;
  fill(values: readonly unknown[]): void;
};

const resourceOf = (v: unknown): ReturnType<ResourceOf> => resources.of(v);

/** Whether `v` is a resource a call on a resource takes (change 0138, R2): a `Buffer` of structs,
 *  a `Uniform`, an exported binding, or a `Buffer` of scalars (Amendment A10, Q-I). */
export function isResource(v: unknown): boolean {
  return resourceOf(v) !== undefined || residentState(v) !== undefined;
}

/** Whether `v` is a `Buffer` of structs, a `Uniform` or an exported binding: a resource of the
 *  region, which today's `fuse()` does not record (change 0138, Amendment A10, slice 1). */
export function isRegionResource(v: unknown): boolean {
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
  /** A plain array the call writes: the call waits, and fills it when it has run (Amendment A11,
   *  Q7). */
  readonly waits?: true;
}

/**
 * The argument a recorded call runs with in place of `v` (change 0138, R2): a storage array's
 * hidden handle, with nothing copied out yet ({@link commitArguments}); a uniform's value, read
 * now; a
 * `Buffer` of scalars, a texture and a sampler as they are; any other value copied now, so that a change the host makes
 * after the call does not reach it (Amendment A5, default 3).
 *
 * @param at - the parameter or the binding, as an error names it: `age(): parameter "xs"`.
 * @param array - the element layout of the array with no size that the parameter or binding is,
 *   when it is one; a storage array is refused anywhere else.
 * @param writes - the call writes the argument: a `Buffer`, or a plain array that makes the call
 *   wait (Amendment A11, Q7).
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
      JSON.stringify(recorded.layout.e, noMembers) !== JSON.stringify(array.e, noMembers)
    ) {
      recorded.done();
      throw new TypeError(
        `${at} takes an array whose elements are laid out otherwise than ${r.name}'s; pass a Buffer of the class the parameter names.`,
      );
    }
    return { value: recorded.handle, buffer: recorded };
  }
  // A `Buffer` of scalars that a failed call wrote throws its error at each later call that takes
  // it, until `set(data)` or `resize()` (A7, decision b; one set of rules, Amendment A10, Q-I).
  const failed = residentState(v)?.error;
  if (failed !== undefined) throw failed;
  if (writes && residentState(v) === undefined) {
    // A plain array the call writes is filled in place when the call has run: the call waits
    // (Amendment A10, A7's deferred question 4; Amendment A11, Q7).
    if (array !== undefined) return { value: v, waits: true };
    throw new TypeError(
      `${at} is written by the call, which takes a resource, so it does not block and nothing waits to read it back: pass a Buffer, or array(xs), and await its read() (change 0138, R2).`,
    );
  }
  if (r?.kind === 'uniform') return { value: r.value() };
  // A `Buffer` of scalars is in the order of calls already, and a texture or a sampler is bound
  // as it is.
  if (residentState(v) !== undefined || !copy) return { value: v };
  return { value: copyOf(v, at) };
}

/** A key's members in a layout are the host's to decode, not the device's (Amendment A12, Q4): a
 *  `Buffer<S>` whose `S` holds a key is laid out as the parameter's `array<S>`. */
function noMembers(key: string, value: unknown): unknown {
  return key === 'm' ? undefined : value;
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
 * which keep its error for their `read()` and leave the host's accessors until then (Amendment A11,
 * Q1). A failure is kept for the next `read()` or call with the line `site` of the call. With
 * `waits`, the call waits (Amendment A11, Q7): its promise gives what `run` gives and rejects with
 * its failure, which no later call throws again.
 */
export function joinRecorded<T>(
  call: string,
  site: string | undefined,
  uploads: readonly (() => void)[],
  written: readonly ResidentArrayState[],
  run: () => Promise<T>,
  waits = false,
): Promise<T> {
  for (const s of written) s.markWritten();
  const done = kernelQueue.record(async () => {
    for (const upload of uploads) upload();
    return run();
  });
  const settled = done.then(
    (v) => {
      written.forEach((s) => (s.error = undefined));
      return v;
    },
    (e: unknown) => {
      const made = failedAt(e, call, site);
      for (const s of written) {
        s.error = made;
        // The failed call leaves the window (A7, decision b): the host's accessors read the host
        // copy again, what it held before the writing calls, and `read()` throws the error.
        s.ahead = false;
        // A `Buffer`'s device copy holds nothing to read back: it leaves the window.
        (s as { failed?(): void }).failed?.();
      }
      if (!waits) noteFailure(made);
      throw made;
    },
  );
  // A call that does not wait keeps its failure for the next `read()` or call.
  if (!waits) settled.catch(() => undefined);
  return settled;
}

export { callSite };
