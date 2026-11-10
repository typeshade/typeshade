// The ids of the calls that only the CPU engines carry (changes 0042 and X-GIS #2426).
//
// `__fround` is the rounding step of the `'f32'` precision pass. The others are the internal
// operations of the libm's source (`src/compiler/ts/internal-ops.ts`). No shader language has
// one, so the emit walk (`src/core/emit.ts`) throws on a call of one that the module does not
// declare as its own function. That is a compiler-internal invariant, not an author's
// diagnostic: no author's program can carry one.

/** The ids no shader writer spells. */
export const CPU_ONLY_IDS: ReadonlySet<string> = new Set([
  '__fround',
  '__f64Hi',
  '__f64Lo',
  '__f64FromWords',
  '__f64ToI32',
]);
