// ═══ Shader DSL — the std140 two-row matrix refusal, as one sentence ═══
//
// A leaf, names and text only, because two halves of the compiler say it and neither may drift:
//
//   - `typeLayout` in core/reflect.ts throws it when a std140 layout meets a two-row matrix;
//   - the `"use typeshade"` front end (compiler/ts/bindings.ts) refuses a uniform binding that
//     holds one at the declaration, as `TS8051 LAYOUT` (Rule 4.8), before any backend runs.
//
// Kept out of reflect.ts so the front end does not pull the layout engine (and through it the
// fp64 pass and the df64 helper library) into the language service.

/** Why a `mat{cols}x2` cannot sit in a std140 block, and the two shapes that can carry it.
 *  Measured (#149): WGSL's column stride is `AlignOf(vecR<f32>)`, 8 for two rows, while std140
 *  rounds every column to 16, so the two targets place the field, and every field after it,
 *  at different offsets. */
export function twoRowStd140Reason(cols: number): string {
  return (
    `mat${String(cols)}x2 in std140 is not supported — WGSL gives a two-row ` +
    `matrix a column stride of 8 and GLSL std140 rounds every column to 16, so the ` +
    `two targets would disagree on this field and every field after it; carry it as ` +
    `mat${String(cols)}x4 (measured: both targets stride 16) or as ${String(cols)} vec2 fields`
  )
}
