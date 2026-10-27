// Implements: Rule 8.23, the length of a pushed array on the CPU tier (docs/language-design.md; traced in reqs/).
// ═══ The count pushed onto each array a kernel function pushes onto (changes 0078 and 0094) ═══
//
// The CPU tier's `push` and `pushCount` (`cpu-runtime.ts`) keep the length of a pushed array here,
// a `u32`, by the array the call binds. A call that passes a held length starts it at the held
// length before the function runs and reads the new length after it (`core/host-kernel.ts`). The
// table is a module of its own, so that the call layer reads it without the op library.

const counts = new WeakMap<object, number>();

/** The length of pushed array `xs` in the function: the held length, if any, plus the count
 *  pushed onto it. */
export function pushedLength(xs: object): number {
  return counts.get(xs) ?? 0;
}

/** Set the length of pushed array `xs` to `n`, as a `u32`: a call that passes a held length sets
 *  it before the function runs, so each `push` appends after it, as ECMAScript's `push` appends
 *  after an array's `length`. */
export function startPushesAt(xs: object, n: number): void {
  counts.set(xs, n >>> 0);
}
