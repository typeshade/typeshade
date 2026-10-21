/**
 * Key types (change 0081, Rule 4.1): a union of string literal types, `"r" | "g" | "b"`, is a closed set
 * of names, and a value of it is a `u32` id on every target. The ids follow the members sorted by
 * their UTF-16 code units (decision 1), so two spellings of one union agree.
 *
 * The IR has no type of its own for a key (change 0081, "IR. None new"): a key type is a
 * `u32` scalar object of its own, and this module remembers its members by that object's
 * identity. A declaration's type object flows by reference to every expression that reads it, so
 * the front end can ask {@link keysOf} where a string literal is written beside it. Every pass
 * after the front end, the writers and the CPU tier see a plain `u32`.
 */
import type { ShaderType } from '../../core/ir/types.js';

/** The members of a key type, in id order. */
export type KeySet = readonly string[];

const KEYS = new WeakMap<ShaderType, KeySet>();

/** UTF-16 code unit order, which `<` on two strings is in JavaScript. */
const byCodeUnits = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** A key type over `members`, deduplicated and sorted into id order. */
export function keyTypeT(members: readonly string[]): ShaderType {
  const t: ShaderType = { kind: 'scalar', scalar: 'u32' };
  KEYS.set(t, [...new Set(members)].sort(byCodeUnits));
  return t;
}

/** The members of `t` in id order, or undefined when `t` is no key type. */
export const keysOf = (t: ShaderType | undefined): KeySet | undefined =>
  t === undefined ? undefined : KEYS.get(t);

/** Whether two key sets are one type: the same members. */
export const sameKeys = (a: KeySet, b: KeySet): boolean =>
  a.length === b.length && a.every((k, i) => k === b[i]);

/** The union as an author reads it, `"b" | "g" | "r"`, in id order. */
export const keyTypeText = (keys: KeySet): string => keys.map((k) => JSON.stringify(k)).join(' | ');
