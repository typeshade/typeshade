// The device's limits, as the program runtime reports them (change 0051, part 2, Rule 11.11).
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
