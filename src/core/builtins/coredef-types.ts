// The shape of `coredef.ts`, the overload table `scripts/bake-coredef.ts` bakes from Tint's
// `core.def` (0017).

/** One overload: a builtin function, a value constructor, a conversion or an operator. */
export interface CoreDefRow {
  readonly kind: 'fn' | 'ctor' | 'conv' | 'op';
  readonly name: string;
  /** The `@stage(...)` list, empty when the overload is legal in every stage. */
  readonly stages: readonly string[];
  /** The type parameters and the constraint each ranges over: `num`, a matcher, a type, or
   *  `''` for any type. */
  readonly implicit: Readonly<Record<string, string>>;
  readonly params: readonly { readonly name: string; readonly type: string }[];
  /** `''` for an overload that returns nothing. */
  readonly ret: string;
  /** The key a claim names: kind, name, constraints, parameter types and result. */
  readonly signature: string;
}

export interface CoreDefTable {
  readonly source: string;
  readonly sha256: string;
  readonly baked: string;
  readonly generator: string;
  /** Every type matcher, `match fiu32_f16: f32 | i32 | u32 | f16`, by name. */
  readonly matchers: Readonly<Record<string, readonly string[]>>;
  readonly rows: readonly CoreDefRow[];
}
