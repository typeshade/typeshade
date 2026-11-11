// ═══ A one-time warning for a deprecated host export (change 0138, Amendment A1) ═══
//
// Amendment A1 of proposal 0138 deprecated `resident()` (replaced by `array()`, and removed by
// Amendment A10, slice 1) and `configure()` (a device is opened only by `createDevice()`).
// `configure()` still works as before; its first call in a
// context prints one warning with the form that replaces it, and no later call prints again
// (Rule 11.8).
// Like the rest of `typeshade/runtime` it imports nothing.

const warned = new Set<string>();

/** Print `message` once for `name` in this context, through `console.warn`. */
export function warnDeprecated(name: string, message: string): void {
  if (warned.has(name)) return;
  warned.add(name);
  console.warn(`typeshade: ${name} is deprecated (change 0138). ${message}`);
}

/** Whether `name` has warned, for the tests. */
export function hasWarned(name: string): boolean {
  return warned.has(name);
}
