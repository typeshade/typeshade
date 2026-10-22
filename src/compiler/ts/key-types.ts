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

/** What a `Record<K, V>` holds beside its array: the key type `K` its index is a value of. */
export interface RecordKeys {
  readonly key: ShaderType;
  readonly keys: KeySet;
  /** Numeric members index by value, rather than by a string member's assigned id. */
  readonly numeric?: true;
}

const RECORDS = new WeakMap<ShaderType, RecordKeys>();

/** `Record<K, V>` with `K` a key type or a dense numeric domain (change 0081, section 2): an `array<V, N>`, `N` the number
 *  of keys, indexed by the key's id. It is no struct, since WGSL cannot pick a field by a value,
 *  and every field of a `Record` has the one type `V`. */
export function recordT(key: ShaderType, elem: ShaderType, values?: readonly number[]): ShaderType {
  const keys = values === undefined ? keysOf(key)! : values.map(String);
  const t: ShaderType = { kind: 'array', elem, size: keys.length };
  RECORDS.set(t, { key, keys, ...(values === undefined ? {} : { numeric: true }) });
  return t;
}

/** The key type of a `Record`, or undefined when `t` is no `Record`. */
export const recordOf = (t: ShaderType | undefined): RecordKeys | undefined =>
  t === undefined ? undefined : RECORDS.get(t);

// A collection's IR key stays its scalar (change 0080). Only the front end needs the key type
// object; the host face serializes its members for the boundary conversion (change 0081).
const COLLECTION_KEYS = new WeakMap<ShaderType, ShaderType>();
export function collectionKeyT(t: ShaderType, key: ShaderType): ShaderType {
  COLLECTION_KEYS.set(t, key);
  return t;
}
export const collectionKeyOf = (t: ShaderType): ShaderType | undefined => COLLECTION_KEYS.get(t);

// Integer unions and enums still compute as i32. Retain their closed domain lazily, solely
// for checking a numeric Record index; no arithmetic or IR type changes (decision 2).
const NUMERIC_DOMAINS = new WeakMap<ShaderType, () => readonly number[] | undefined>();
export function numericDomainT(
  t: ShaderType,
  domain: () => readonly number[] | undefined,
): ShaderType {
  const own = { ...t };
  NUMERIC_DOMAINS.set(own, domain);
  return own;
}
export const numericDomainOf = (t: ShaderType): readonly number[] | undefined =>
  NUMERIC_DOMAINS.get(t)?.();

/** A Record's domain as an author reads it. Numeric members keep their numeric spelling. */
export const recordKeyText = (rec: RecordKeys): string =>
  rec.numeric === true ? rec.keys.join(' | ') : keyTypeText(rec.keys);
