// ═══ The default device of a block: `using _ = device.use()` (change 0138, Amendment A1) ═══
//
// Rule 11.8 states it.
//
// A device is opened only by `createDevice()`. `device.use()` makes it the default device until
// the handle it returns is disposed, which `using` does at the end of the block; uses nest, and
// the innermost one is the default. At milestone 1 of proposal 0138, `texture()` makes its
// texture on the default device; the calls of a node follow it from milestone 3 (R3).
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
