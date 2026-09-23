import type { LintRule } from '../engine.js';
import { typeKey, type ShaderType } from '../../../ir/types.js';

/** The longest `array<f32, N>` WGSL's built-in value table lets `@builtin(clip_distances)` be. */
const MAX_CLIP_DISTANCES = 8;

/** Whether a declared type is what WGSL fixes for a `@builtin(<id>)`, or `undefined` when the
 *  id has no rule this walk knows. One id today: `clip_distances`, the one built-in value whose
 *  type an AUTHOR picks rather than reads off the spec table, and therefore the one an author
 *  can get wrong. Every other id has a single type, which the `builtin()` helper resolves from
 *  `WGSL_BUILTIN_TYPES` and cannot disagree with. */
function clipDistancesShape(type: ShaderType): boolean {
  return (
    type.kind === 'array' &&
    type.elem.kind === 'scalar' &&
    type.elem.scalar === 'f32' &&
    type.size !== undefined &&
    type.size >= 1 &&
    type.size <= MAX_CLIP_DISTANCES
  );
}

/** A `@builtin(...)` id declared with a type WGSL does not give it.
 *
 *  CORE, and on the IR rather than in the `"use typeshade"` front end alone, because the
 *  CAPABILITY is derived from the IR: `requiredCaps` reads `@builtin(clip_distances)` off any
 *  struct field, entry parameter or `retBuiltin` and emits `enable clip_distances;` for it
 *  (§50). The front end checks the two sites an author writes in a `.shade.ts` file, and that
 *  left two holes the derivation did not have — a struct that DECLARES the builtin and is
 *  never entry IO, and the `fn(..., { retAttr: builtin('clip_distances', …) })` return the
 *  EDSL can spell. Both emitted the directive with an `array<f32, 9>` behind it and no
 *  diagnostic; Tint answers at the driver. Checking it here covers every authoring surface at
 *  every emit, and the front end's own check stays, because it can point at the authoring
 *  line and this cannot. */
export const builtinValueType: LintRule = {
  id: 'builtin-value-type',
  description: 'a @builtin(...) id must carry the type WGSL gives it',
  severity: 'error',
  category: 'correctness',
  create: (ctx) => {
    const check = (builtin: string | undefined, type: ShaderType, where: string): void => {
      if (builtin !== 'clip_distances' || clipDistancesShape(type)) return;
      ctx.report(
        `@builtin(clip_distances) on ${where} is '${typeKey(type)}'; WGSL gives it ` +
          `array<f32, N> with N from 1 to ${String(MAX_CLIP_DISTANCES)}`,
        { code: 'SD0020' },
      );
    };
    return {
      Module(m) {
        for (const s of m.structs) {
          for (const f of s.fields) check(f.builtin, f.type, `${s.name}.${f.name}`);
        }
        for (const f of m.funcs) {
          for (const p of f.params) check(p.builtin, p.type, `${f.name}'s parameter '${p.name}'`);
          check(f.retBuiltin, f.ret, `${f.name}'s return`);
        }
      },
    };
  },
};
