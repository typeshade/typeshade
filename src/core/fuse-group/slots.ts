import type { GroupCall } from './types.js';

export function assignSlots(calls: readonly GroupCall[]): {
  readonly slots: readonly (readonly (number | undefined)[])[];
  readonly arrays: readonly object[];
} {
  const arrays: object[] = [];
  const slots = calls.map((c) =>
    c.arrays.map((a) => {
      if (a === undefined) return undefined;
      const at = arrays.indexOf(a);
      return at >= 0 ? at : arrays.push(a) - 1;
    }),
  );
  return { slots, arrays };
}
