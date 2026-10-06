// ═══ Shader DSL — GLSL ES 3.00 reserved-word identifier sanitisation ═══
//
// WGSL and GLSL have DIFFERENT reserved-word sets, so a perfectly legal DSL
// identifier (an entry param named `input`, `in`, an `out` local) is a GLSL
// compile error ("Illegal use of reserved word"). WGSL uses its own identifier
// restrictions; the GLSL backend must RENAME any variable
// whose name collides with a GLSL ES reserved word — consistently across the
// declaration AND every reference. This pass is GLSL-LOCAL (only emitGlslModule
// calls it), so WGSL emit stays byte-identical. Struct FIELD names are left alone
// (they are the std140 host-offset + cross-stage varying linkage contract, and are
// accessed as `.field`, not bare identifiers).
//
// Split out of glsl.ts (which exceeded the 500-LOC ratchet) — emit is unchanged;
// emitGlslModule imports sanitizeReservedIdents from here.
//
// Implements: Rule 3.4 (docs/language-design.md; traced in reqs/).

import type { ModuleDecl, Expr, Stmt } from '../ir/index.js';
import { mapChildren, mapStmtExpr } from '../ir/visit.js';
import { UnsupportedFeatureError } from '../backend.js';
import { GLSL_ES300_RESERVED } from '../reserved-words.js';
import { sanitizeVariableNames } from '../passes/variable-names.js';

// What ANGLE refuses as an identifier at shader version 300, kept in one place beside WGSL's
// own set (`GLSL_ES300_RESERVED`, issue #103) rather than as a second list here — this file's
// own history is a list that drifted from the spec: it had `half` and `fixed` but not `float`
// or `void`, and none of the image or 1D sampler names §3.6 reserves.
//
// Six spellings are renamed here that the language does NOT reserve at 300, because renaming
// costs nothing and emitting them does: `buffer` and `shared` are ES 3.10 keywords, `packed`
// is reserved in ES 1.00, `texture` and `sampler` are a built-in function and a type name a
// local of that name would shadow for the rest of the scope, and `main` is the name this
// writer gives every stage's entry point.
//
// The gate in glsl.test.ts ties this set to what `glslType()` can actually declare, so a new
// texture shape cannot reopen the gap it was written for (X-GIS #1703).
const GLSL_RESERVED: ReadonlySet<string> = new Set([
  ...GLSL_ES300_RESERVED,
  'buffer',
  'shared',
  'packed',
  'texture',
  'sampler',
  // Not reserved either, but the name of the entry point this writer emits in every stage: a
  // helper called `main` produced two `main` definitions in one translation unit.
  'main',
]);

/** Whether GLSL ES 3.00, or this writer, keeps `name` from a shader's own identifiers. */
export const isGlslReserved = (name: string): boolean => GLSL_RESERVED.has(name);

/** `float` → `float_`, and `float_1`, `float_2`, … if something already holds that name.
 *
 *  The suffix NUMBERS rather than repeating the underscore, which is what it used to do:
 *  measured on ANGLE, `float__` is "identifiers containing two consecutive underscores (__)
 *  are reserved as possible future keywords", so the escape from one reserved word walked
 *  straight into another rule of the same section. A reserved word never ends in `_`, so the
 *  first candidate cannot produce a double underscore either. */
function freeName(base: string, taken: (candidate: string) => boolean): string {
  const free = (c: string): boolean => !GLSL_RESERVED.has(c) && !taken(c);
  if (free(`${base}_`)) return `${base}_`;
  for (let i = 1; ; i++) {
    const candidate = `${base}_${String(i)}`;
    if (free(candidate)) return candidate;
  }
}

/** Rename any param/local-var identifier that collides with a GLSL reserved word
 *  (and every reference to it), per-function, returning a new module. Identity for
 *  a module with no collisions. Struct fields + binding names are untouched. */
export function sanitizeReservedIdents(m: ModuleDecl): ModuleDecl {
  m = sanitizeVariableNames(
    m,
    (name) =>
      GLSL_RESERVED.has(name) ||
      /[^A-Za-z0-9_]/u.test(name) ||
      name.startsWith('gl_') ||
      name.includes('__'),
  );
  const moduleScope = new Set<string>([
    ...m.consts.map((c) => c.name),
    ...m.bindings.map((b) => b.name),
    ...(m.overrides ?? []).map((o) => o.name),
    ...(m.vars ?? []).map((v) => v.name),
    ...m.structs.map((st) => st.name),
    ...m.funcs.map((f) => f.name),
  ]);
  const locallyClean = m;

  // X-GIS #763 P6 — module-level surfaces the per-fn pass could not cover. None of them can
  // be renamed the way a local can: a binding name is the host's reflection key, a struct and
  // its fields are the std140 offsets and the cross-stage varying contract, and an override
  // is named in text the host may set. So they fail the module loud rather than
  // reaching a driver as "Illegal use of reserved word" in generated text (issue #103). The
  // front end reports each of these on the declaration first, as a warning naming this target;
  // this arm is what keeps a module built another way — the `fn()` EDSL — from emitting them.
  const failClosed = (what: string, name: string): void => {
    if (!GLSL_RESERVED.has(name)) return;
    throw new UnsupportedFeatureError(
      `glsl-es300: ${what} is a GLSL ES 3.00 reserved word and cannot be renamed here; pick another name`,
    );
  };
  for (const b of m.bindings) {
    if (GLSL_RESERVED.has(b.name)) {
      throw new UnsupportedFeatureError(
        `glsl-es300: binding '${b.name}' is a GLSL reserved word — renaming would break reflection-driven binding; pick another name`,
      );
    }
  }
  for (const st of m.structs) {
    failClosed(`struct '${st.name}'`, st.name);
    for (const f of st.fields) failClosed(`field '${st.name}.${f.name}'`, f.name);
  }
  for (const c of m.consts) failClosed(`constant '${c.name}'`, c.name);
  for (const o of m.overrides ?? []) failClosed(`override '${o.name}'`, o.name);
  for (const v of m.vars ?? []) failClosed(`module variable '${v.name}'`, v.name);
  // (b) FN names: a helper named `texture`/`filter` emitted a reserved-word
  //     function declaration. Rename the declaration AND every call site.
  const fnRename = new Map<string, string>();
  const taken = new Set([...moduleScope, ...locallyClean.funcs.map((f) => f.name)]);
  for (const f of locallyClean.funcs) {
    if (!GLSL_RESERVED.has(f.name)) continue;
    const safe = freeName(f.name, (c) => taken.has(c));
    taken.add(safe);
    fnRename.set(f.name, safe);
  }
  if (fnRename.size === 0) return locallyClean;
  const rcE = (e: Expr): Expr =>
    mapChildren(e.op === 'call' && fnRename.has(e.fn) ? { ...e, fn: fnRename.get(e.fn)! } : e, rcE);
  const rcS = (s: Stmt): Stmt => mapStmtExpr(s, rcE);
  return {
    ...locallyClean,
    funcs: locallyClean.funcs.map((f) => ({
      ...f,
      name: fnRename.get(f.name) ?? f.name,
      body: f.body.map(rcS),
    })),
  };
}
