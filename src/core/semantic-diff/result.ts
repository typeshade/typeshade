import type { EmitPlugin } from '../emit.js';

/** An axis of difference {@link semanticDiff} can be told to disregard.
 *
 *  - `'names'`: the spelling of every internal identifier, meaning helper function names,
 *    struct names that are not bound as resources, module const names, and function-scoped
 *    parameters and locals. These are the same identifiers a renaming pass such as
 *    `mangleModule` may rewrite. Names a host binds by are compared either way: entry
 *    points and their parameters, binding names, binding struct names, struct field
 *    names, override names, and intrinsic call ids.
 *  - `'declOrder'`: the position of a declaration or statement within its list. */
export type SemanticAspect = 'names' | 'declOrder';

/** Options for {@link semanticDiff}. */
export interface SemanticDiffOptions {
  /** Axes to disregard. Defaults to `['names', 'declOrder']`. Pass `[]` to compare
   *  identifier spelling and declaration order too. */
  readonly ignore?: readonly SemanticAspect[];
  /** Plugins declared as intentionally applied to `b`. Pass the same plugin array your
   *  production emit call uses, for example `[inline(), ...obfuscate()]`. Each plugin's
   *  `transformIR` is applied to `a` in order, and every diff line the applied transform
   *  accounts for moves out of the four buckets into
   *  {@link ClassifiedSemanticDiff.explained}, attributed to that plugin. Differences
   *  no declared transform explains stay in the buckets, so a regression cannot hide
   *  behind a declaration. Text-stage plugins (`minify`, `aliasTypes`, `prune`)
   *  contribute nothing here, because the comparison never sees emitted text. */
  readonly transforms?: readonly EmitPlugin[];
}

/** The four buckets of difference. Each entry is a fact line prefixed `-` (present in
 *  `a`, absent from `b`) or `+` (the reverse). When all four are empty the modules agree
 *  on everything this comparison inspects; {@link isSemanticallyEqual} performs that test. */
export interface SemanticDiff {
  /** Entry-point signatures and the vertex attribute layout. */
  readonly interface: readonly string[];
  /** Bind groups, std140/std430 struct layouts, and required capabilities. */
  readonly resources: readonly string[];
  /** Module consts, pipeline overrides, and the multiset of numeric literals in
   *  function bodies. A literal's value is reported here and nowhere else, because the
   *  control-flow skeleton leaves it out, so changing a constant and changing the shape
   *  of the code around it land in different buckets. */
  readonly constants: readonly string[];
  /** Per-statement control-flow skeleton, one line per statement, addressed by path. */
  readonly controlFlow: readonly string[];
}

/** One of the four fact buckets of a {@link SemanticDiff}. */
export type SemanticDiffBucket = keyof SemanticDiff;

/** One diff line that a declared transform explains: applying `transform` to the
 *  reference side made `line` disappear from `bucket`. The line keeps its `-` or `+`
 *  prefix. A `-` line is a fact of `a` the transform rewrote away; a `+` line is a fact
 *  of `b` the transformed reference now also has. `transform` is the plugin's
 *  `identity ?? name`, the same spelling {@link emitIdentity} reports. */
export interface ExplainedDiffEntry {
  readonly transform: string;
  readonly bucket: SemanticDiffBucket;
  readonly line: string;
}

/** A {@link SemanticDiff} whose differences were classified against a declared
 *  transform pipeline ({@link SemanticDiffOptions.transforms}). The four buckets hold
 *  only what no declared transform accounts for, which is the part a parity check
 *  should fail on. `explained` holds every difference a declared transform proved
 *  intentional, with enough detail to review the classification. */
export interface ClassifiedSemanticDiff extends SemanticDiff {
  readonly explained: readonly ExplainedDiffEntry[];
}

/** True when every bucket of `d` is empty. `explained` entries do not count, so on a
 *  {@link ClassifiedSemanticDiff} this reads "equal modulo the declared transforms". */
export const isSemanticallyEqual = (d: SemanticDiff): boolean =>
  d.interface.length === 0 &&
  d.resources.length === 0 &&
  d.constants.length === 0 &&
  d.controlFlow.length === 0;
