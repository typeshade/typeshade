// The ids of the builtins the IR carries (change 0029, Rule 9.5).
//
// A `call` node names its callee. The name is a builtin's id when the call is the builtin, and a
// module function's name when the call carries a `declRef` (a call made through the declaration).
// A module may declare a function under a builtin's name, since a function the file declares wins
// over every builtin function of its name, so the name alone does not say which call it is: the
// analyses over the front end's IR ask `declRef` first, and this set second.
//
// Not exported from the package (`src/index.ts` does not reach this file): it is what the passes
// ask, where `isKnownIntrinsic` (public) leaves out the ids a pre-emit pass rewrites away.

import { INTRINSICS, PORTABLE_INTRINSICS, PRE_EMIT_INTRINSICS } from './intrinsics.js';

/** Every id a builtin call can carry: a registry entry, an identity-spelled builtin, and one a
 *  pre-emit pass rewrites away (`f64`). */
export const BUILTIN_IDS: ReadonlySet<string> = new Set([
  ...Object.keys(INTRINSICS),
  ...PORTABLE_INTRINSICS,
  ...PRE_EMIT_INTRINSICS,
]);

/** Whether `name` is the id of a builtin the IR carries. A call by this name that carries no
 *  `declRef` is that builtin, whatever function the module also declares under the name; one that
 *  does is a call of the module's own function.
 *
 *  @param name The `call` id to test.
 */
export const isBuiltinId = (name: string): boolean => BUILTIN_IDS.has(name);
