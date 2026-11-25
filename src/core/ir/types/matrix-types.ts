import type { ShaderType } from './shader-type.js';

/** A native `mat4x4<f32>`, the model-view-projection or view matrix type of a typical
 *  per-frame uniform (`mvp: mat4x4fT`). Every `matCxR<f32>` is spellable — build one with
 *  {@link matT} — and this is the one with a named constant because it is the one a renderer
 *  reaches for. (It was once the ONLY float matrix, on the recorded ground that "a 2×2 or 3×3
 *  float matrix lays out differently under the WGSL and GLSL std140 rules". Measured on real
 *  ANGLE and Tint, that is half right: a 2×2 does diverge and a 3×3 does not, and what
 *  actually decides is the ROW count — see the `mat` arm of {@link ShaderType} and
 *  `wgslLayout`.)
 *
 *  Exported from `typeshade/core/ir`.
 */
export const mat4x4fT = {
  kind: 'mat',
  cols: 4,
  rows: 4,
  elem: 'f32',
} as const satisfies ShaderType;
/** Any `matCxR<f32>` or `matCxR<f64>`: `cols` columns of `rows` components each, column-major
 *  as both targets are. The named constants above are the shapes with a spelling of their own;
 *  this is how the front end and a host build the other six.
 *
 *  Exported from `typeshade/core/ir`.
 *
 *  @param cols Number of columns — the `C` of `matCxR`.
 *  @param rows Number of rows — the `R` of `matCxR`, and the component count of one column.
 *  @param elem `'f32'` for a native matrix, `'f64'` for the emulated-double one (square only).
 *
 *  @example
 *  ```ts
 *  import { typeKey } from 'typeshade'
 *  import { matT } from 'typeshade/core/ir'
 *
 *  typeKey(matT(2, 3)) // 'mat2x3<f32>'
 *  ```
 */
export const matT = (
  cols: 2 | 3 | 4,
  rows: 2 | 3 | 4,
  elem: 'f32' | 'f64' = 'f32',
): Extract<ShaderType, { kind: 'mat' }> => ({ kind: 'mat', cols, rows, elem });
