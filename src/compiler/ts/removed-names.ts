// The author-facing names that change 0112 removed, each with the one spelling that replaces it.
//
// Implements: change 0112 (changes/0112-one-spelling.md, sections 1 to 3).
//
// A name here is no longer authorable: the ambient library does not declare it, the front end does
// not resolve it, and a call or a read of it is refused in one sentence that names the ECMAScript
// spelling, as the retired `perInvocation<T>` was (Rule 12.1). The compiler's own lowering still
// uses the internal ids of the same names (`arrayLength(&x)` for `.length`, `pow` for `**`), so
// nothing here touches the emit.
//
// A file's own declaration of one of these names stays the file's (Rule 9.5): the front end asks
// this table only after it has looked for a declaration.

/** A removed free function, and the spelling to write instead (the text after "write "). */
export const REMOVED_CALLS: Readonly<Record<string, string>> = {
  arrayLength: 'xs.length',
  log10: 'Math.log10',
  log1p: 'Math.log1p',
  expm1: 'Math.expm1',
  cbrt: 'Math.cbrt',
  hypot: 'Math.hypot',
  sum: 'xs.reduce((a, b) => a + b)',
  none: '!xs.some(p)',
  pow: 'a ** b',
};

/** A removed free constant, and the `Math` member to read instead. `TAU` stays: neither
 *  ECMAScript nor WGSL has it. */
export const REMOVED_CONSTANTS: Readonly<Record<string, string>> = {
  PI: 'Math.PI',
  E: 'Math.E',
  LN2: 'Math.LN2',
  LN10: 'Math.LN10',
  LOG2E: 'Math.LOG2E',
  LOG10E: 'Math.LOG10E',
};

/** The array-fold overloads of `any` and `all`, and the `Array` method that replaces each. The
 *  bool and bool-vector forms stay: they are WGSL's own. */
export const REMOVED_FOLDS: Readonly<Record<'any' | 'all', string>> = {
  any: 'xs.some(p)',
  all: 'xs.every(p)',
};

const has = (table: Readonly<Record<string, string>>, name: string): boolean =>
  Object.prototype.hasOwnProperty.call(table, name);

/** Whether `name` is a free function change 0112 removed (`any` and `all` are not: only their fold
 *  overloads are). */
export const isRemovedCall = (name: string): boolean => has(REMOVED_CALLS, name);

/** Whether `name` is a free constant change 0112 removed. */
export const isRemovedConstant = (name: string): boolean => has(REMOVED_CONSTANTS, name);

/** The sentence for a call of a removed function: "X was removed: write Y." */
export function removedCallSentence(name: string): string | undefined {
  return has(REMOVED_CALLS, name)
    ? `${name} was removed: write ${REMOVED_CALLS[name]}.`
    : undefined;
}

/** The sentence for a read of a removed constant: "X was removed: write Y." */
export function removedConstantSentence(name: string): string | undefined {
  return has(REMOVED_CONSTANTS, name)
    ? `${name} was removed: write ${REMOVED_CONSTANTS[name]}.`
    : undefined;
}

/** The arity sentence for `any` or `all` called with `count` arguments (`TS8019`): the builtin
 *  takes one, and a second argument is the removed array fold, so the sentence carries the fix. */
export function removedFoldSentence(name: 'any' | 'all', count: number): string {
  const fold = count > 1 ? `; the array fold was removed: write ${REMOVED_FOLDS[name]}` : '';
  return `${name} expects 1 argument, got ${String(count)}${fold}.`;
}
