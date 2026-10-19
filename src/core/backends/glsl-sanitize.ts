// ═══ Shader DSL — GLSL ES 3.00 identifier spelling of the locals ═══
//
// WGSL and GLSL have DIFFERENT reserved-word sets, so a perfectly legal DSL identifier (an entry
// param named `input`, `in`, an `out` local) is a GLSL compile error ("Illegal use of reserved
// word"). The names a declaration takes on GLSL are the spelling plan's (Proposal 0070,
// `spelling-plan.ts`): every module-scope name, struct field and entry parameter, spelled by the
// late pass `spellModule` before this file runs. What is left is a LOCAL or a helper parameter,
// which this file renames to a fresh name, per function, consistently across the declaration AND
// every reference. This pass is GLSL-LOCAL (only lowerForGlsl calls it), so WGSL emit stays
// byte-identical.
//
// Struct fields are spelled by the plan too, and the plan keys them by the authored string in one
// table. So a field has one spelling in every struct, and the vertex `out` and the fragment `in`
// of one varying keep the same name, which GLSL links by name. A field of a struct the host names
// (a struct of a host-owned binding) keeps its authored name, because the host's default-block
// uniforms are looked up by it. The std140 host offsets come from the field's index, not its name
// (`reflect().uniforms[].fields[i]`), so a renamed field keeps its host offset.
//
// Split out of glsl.ts (which exceeded the 500-LOC ratchet) — emit is unchanged;
// emitGlslModule imports sanitizeReservedIdents from here.
//
// Implements: Rule 3.4 (docs/language-design.md; traced in reqs/).

import type { ModuleDecl } from '../ir/index.js';
import { GLSL_ES300_RESERVED, GLSL_WRITER_RESERVED } from '../reserved-words.js';
import { sanitizeVariableNames } from '../passes/variable-names.js';
import { plannedNames, unspellable, type TargetSpellings } from '../spelling-plan.js';

// What ANGLE refuses as an identifier at shader version 300, kept in one place beside WGSL's
// own set (`GLSL_ES300_RESERVED`, issue #103). The six spellings of `GLSL_WRITER_RESERVED` are
// renamed too: `buffer`, `shared`, `packed`, `texture`, `sampler` and `main` (the entry point this
// writer gives every stage). The gate in glsl.test.ts ties this set to what `glslType()` can
// declare (X-GIS #1703).
const GLSL_RESERVED: ReadonlySet<string> = new Set([
  ...GLSL_ES300_RESERVED,
  ...GLSL_WRITER_RESERVED,
]);

/** Whether GLSL ES 3.00, or this writer, keeps `name` from a shader's own identifiers. */
export const isGlslReserved = (name: string): boolean => GLSL_RESERVED.has(name);

/** Rename every local and helper parameter whose name GLSL cannot spell (and every reference to
 *  it), per function, returning a new module. `plan` is the GLSL spelling plan of the module, so
 *  the fresh names avoid every name the plan gives a declaration. Identity for a module with no
 *  such local. Module-scope names, struct fields and entry parameters are the plan's, and are
 *  spelled before this runs (`spellModule`). */
export function sanitizeReservedIdents(m: ModuleDecl, plan: TargetSpellings): ModuleDecl {
  return sanitizeVariableNames(m, (name) => unspellable('glsl', name), plannedNames(plan));
}
