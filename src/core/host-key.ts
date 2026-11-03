// ═══ The key of a private field in a struct's host value (Rule 8.21, change 0109, Amendment 2) ═══
//
// A field that a private name `#x` declares is the field `x` of the struct (Rule 8.12), and the
// host value of the struct holds it under the key `#x`. `host-values.ts` converts a value by its
// host type, and `host-entry.ts` packs and reads one by its layout; both name the field of a
// struct by its host key, and the CPU tier's value by the field. This leaf holds what they share,
// apart from both, so that neither loads the other (Rule 11.11, `scripts/bundle-boundary.ts`).

/** The name of the field of a shader's struct that the host key `key` stands for: the key `#x` of
 *  a private name is the field `x` (Rule 8.12), and any other key is the field of its name. */
export const shaderField = (key: string): string => (key.charCodeAt(0) === 35 ? key.slice(1) : key);

/** Why a host object has no field under `key`. A private name is held by an instance built with
 *  `new` and by no plain object a host writes, so its sentence says to build one (change 0109,
 *  Amendment 2, as surface section 26 says of an object literal). */
export const missingField = (key: string): string =>
  key.charCodeAt(0) === 35
    ? `the field is missing. ${JSON.stringify(key)} is a private name, which an instance holds and a plain object does not. Build the value with new`
    : 'the field is missing';
