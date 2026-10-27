// Implements: Rule 8.23, the shape of a held length (docs/language-design.md; traced in reqs/).
// The argument checks that ordinary calls and the synchronous fuse recorder share: the count of
// the arguments, and the shape of a held length (change 0094).
import type { KernelFace } from './host-kernel.js';

export function arityError(k: KernelFace, argc: number): TypeError | undefined {
  return argc === k.params.length
    ? undefined
    : new TypeError(
        `${k.name}() takes ${k.params.length} argument${k.params.length === 1 ? '' : 's'}; got ${argc}.`,
      );
}

/** An argument that holds an array with its length, `{ array, length, offset? }` (change 0094),
 *  not checked yet. */
export interface HeldArgument {
  readonly array: unknown;
  readonly length: unknown;
  readonly offset: unknown;
}

/**
 * The parts of `v` when it is a held length, `{ array, length, offset? }`: an object with the keys
 * `array` and `length`, and `offset` beside them or none (change 0094). Undefined for any other
 * value, an object with another key among them, which the call refuses as a wrong array.
 */
export function heldArgument(v: unknown): HeldArgument | undefined {
  if (typeof v !== 'object' || v === null || Array.isArray(v) || ArrayBuffer.isView(v))
    return undefined;
  const keys = Object.keys(v);
  if (!keys.includes('array') || !keys.includes('length')) return undefined;
  if (!keys.every((k) => k === 'array' || k === 'length' || k === 'offset')) return undefined;
  const o = v as { array: unknown; length: unknown; offset?: unknown };
  return { array: o.array, length: o.length, offset: o.offset };
}
