// ═══ The default device of a block: `using _ = device.use()` (change 0138, Amendment A1) ═══
//
// Rule 11.8 states it.
//
// A device is opened only by `createDevice()`. `device.use()` makes it the device in use (the
// default device of Amendment A2) until the handle it returns is disposed, which `using` does at
// the end of the block; uses nest, and the innermost one is the device in use. `texture()`,
// `zeros()`, `array()` and `uniform()` make what they make on the device in use, and a kernel call
// or an entry call with no owned resource runs on it (change 0138, R3; `callDefault` in
// `core/owner.ts`). A `Uniform` takes no part in the choice of a call's device (Amendment A8).
// The stack is one for each instance of this module, not one for each async task: while a task
// awaits inside a block, a resource or a call with no owned resource that another task makes
// takes the same innermost device.
// Caution: do not await inside a block while other tasks may make resources or calls.
// `Device.use()` (`runtime/device.ts`) pushes and ends a use; Amendment A2 declares it.

/** What `use()` holds: the device, and whether its handle was disposed. */
export interface Use<D> {
  readonly device: D;
  done: boolean;
}

const uses: Use<unknown>[] = [];

/** Make `device` the default until the returned use ends. */
export function pushUse<D>(device: D): Use<D> {
  const use: Use<D> = { device, done: false };
  uses.push(use);
  return use;
}

/** End `use`: it stops being a default, wherever it is in the nesting. A second end does
 *  nothing. */
export function endUse(use: Use<unknown>): void {
  if (use.done) return;
  use.done = true;
  const i = uses.lastIndexOf(use);
  if (i >= 0) uses.splice(i, 1);
}

/** The innermost device in use, or undefined. */
export function defaultDevice(): unknown {
  return uses[uses.length - 1]?.device;
}
