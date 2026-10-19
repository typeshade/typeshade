// The device's limits, as the call layer and the program runtime report them (change 0051,
// Rule 11.11 and Rule 11.8). A core module, so `typeshade/fuse` and `typeshade/emit` reach it.
// A `GPUSupportedLimits` keeps its attributes as accessors on its prototype (WebIDL), so an
// object spread copies none of them. `for…in` lists inherited enumerable properties, so it does.

/** Copy every numeric limit of a WebGPU `limits` object into a new frozen record keyed by
 *  WebGPU's names. The copy is taken once: a device's limits do not change after it is made. */
export function copyLimits(source: object | undefined): Readonly<Record<string, number>> {
  const copy: Record<string, number> = {};
  if (source !== undefined) {
    for (const name in source) {
      const value: unknown = (source as Record<string, unknown>)[name];
      if (typeof value === 'number') copy[name] = value;
    }
  }
  return Object.freeze(copy);
}

/** The limits WebGPU holds to a multiple of 4 (change 0051, R1). */
const MULTIPLE_OF_FOUR = new Set([
  'maxStorageBufferBindingSize',
  'maxVertexBufferArrayStride',
  'maxImmediateSize',
]);

/** A limit whose request must not fall below the adapter's value: the offset alignments. A
 *  name that starts with `min` is one (change 0051, requesting step 6). */
export function isMinimumLimit(name: string): boolean {
  return name.startsWith('min');
}

/** Refuse a value `createRuntime({ limits })` names that WebGPU cannot take (change 0051, R1).
 *  Throws a `TypeError` that names the limit and the value. `who` is the call that names the
 *  limits: `configure({ limits })` for the call layer (change 0051, C1). */
export function checkLimitValues(
  limits: Readonly<Record<string, number>>,
  who = 'createRuntime({ limits })',
): void {
  for (const name of Object.keys(limits)) {
    const value = limits[name]!;
    if (!Number.isInteger(value) || value < 0)
      throw new TypeError(
        `${who}: ${name} takes a whole number of 0 or more; got ${String(value)}.`,
      );
    if (isMinimumLimit(name) && name.endsWith('Alignment')) {
      let power = 1;
      while (power < value) power *= 2;
      if (value === 0 || power !== value || value >= 2 ** 32)
        throw new TypeError(`${who}: ${name} takes a power of 2 below 2^32; got ${value}.`);
    } else if (MULTIPLE_OF_FOUR.has(name) && value % 4 !== 0) {
      throw new TypeError(`${who}: ${name} takes a multiple of 4; got ${value}.`);
    }
  }
}
