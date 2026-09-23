// ═══ `@interpolate(flat)` on every integer varying (§53) ═══
//
// WGSL requires every integral user-defined IO to carry `@interpolate(flat)`, on the vertex
// outputs and on the fragment inputs they feed. There is no smooth interpolation of an integer
// to do, so the attribute is not a hint — it is required. Measured on Chromium 141
// (`chromium_headless_shell-1194`) and 153 (`chromium_headless_shell-1243`, what CI installs),
// identically on both, with the broken-shader instrument check passing first:
//
//   struct VsOut { @builtin(position) pos: vec4<f32>, @location(0) id: u32, }
//   → integral user-defined vertex outputs must have a '@interpolate(flat)' attribute
//
// and the module with the attribute is accepted. The compiler
// emitted the first form with zero diagnostics, so a program carrying an integer varying —
// a picking id, a material index — died at the driver.
//
// WGSL-ONLY, and that is not an omission. The GLSL writer has always added `flat` to an
// integer varying on BOTH sides of the link, from the field's own type
// (`backends/glsl.ts`), and the qualifier is a different token in a different place. The two
// writers derive one fact independently and the compile gate links the pair, which is what
// keeps them honest; putting it in the IR for one target would leave the other reading a
// field it does not use.
//
// WHICH fields. A `@location` is a varying only between the vertex OUT and the fragment IN.
// A vertex INPUT is a vertex attribute — a buffer's bytes, not an interpolated value — and
// `@interpolate` on one is an error, so a struct reached only as a vertex parameter is left
// alone. A fragment OUTPUT is a draw buffer, likewise untouched.

import type { FuncDecl, ModuleDecl } from '../ir/nodes.js'
import { stageOf } from '../ir/nodes.js'
import type { ShaderType } from '../ir/types.js'

/** Whether a varying of this type must carry `@interpolate(flat)`: an integer scalar, or a
 *  vector of them. `bool` is not one — it is refused at a `@location` outright — and `f32`
 *  and its vectors interpolate, which is the whole point of a varying.
 *
 *  THE ONE AUTHORITY, read by all three places the fact matters: this pass, which writes the
 *  WGSL attribute; the GLSL writer, which writes `flat` from the same predicate; and the
 *  interstage rule, which has to compare what the two stages will EMIT, not what the author
 *  wrote. A third copy is what made that rule refuse a legal pair — a vertex field spelling
 *  `@interpolate("flat")` beside a fragment field spelling nothing, where both emit `flat`.
 *  Each writer still owns its own spelling; only the predicate is shared. */
export function isIntegerVarying(t: ShaderType): boolean {
  if (t.kind === 'scalar') return t.scalar === 'i32' || t.scalar === 'u32'
  if (t.kind === 'vec') return t.elem === 'i32' || t.elem === 'u32'
  return false
}

/** Every struct name reachable as a VARYING of `f` — its return when it is a vertex entry,
 *  its parameters when it is a fragment one. */
function varyingStructs(f: FuncDecl, out: Set<string>): void {
  const stage = stageOf(f)
  if (stage === 'vertex') {
    if (f.ret.kind === 'struct') out.add(f.ret.name)
    return
  }
  if (stage !== 'fragment') return
  for (const p of f.params) if (p.type.kind === 'struct') out.add(p.type.name)
}

/** The `attr` string with `@interpolate(flat)` appended, keeping whatever was there. Written
 *  for a struct field and for a bare entry parameter alike: the two carry the same three
 *  fields, and WGSL spells the attribute the same way in both places. */
function withFlat<T extends { type: ShaderType; attr?: string; location?: number }>(field: T): T {
  const attr = field.attr ?? `@location(${String(field.location ?? 0)})`
  return { ...field, interpolate: 'flat', attr: `${attr} @interpolate(flat)` }
}

/** Whether this field or parameter is an integer varying with no interpolation of its own —
 *  the one shape the attribute is derived for. A `@builtin` carries its own rule and takes no
 *  attribute; one the author already spelled is left exactly as written. */
function needsFlat(f: {
  type: ShaderType
  location?: number
  interpolate?: string
  builtin?: string
}): boolean {
  if (f.location === undefined || f.interpolate !== undefined) return false
  return isIntegerVarying(f.type)
}

/** Give every integer varying the `@interpolate(flat)` WGSL requires of it. Identity for a
 *  module whose varyings are all floats, which is most of them. */
export function flatIntegerVaryings(m: ModuleDecl): ModuleDecl {
  const varying = new Set<string>()
  for (const f of m.funcs) varyingStructs(f, varying)
  if (varying.size === 0) return m
  let changed = false
  const structs = m.structs.map((s) => {
    if (!varying.has(s.name)) return s
    let touched = false
    const fields = s.fields.map((f) => {
      if (!needsFlat(f)) return f
      touched = true
      return withFlat(f)
    })
    if (!touched) return s
    changed = true
    return { ...s, fields }
  })
  // A fragment entry may also take the varying as a BARE PARAMETER, with no struct anywhere:
  // `fn fs(@location(0) id: u32)`. That spelling reaches no struct, so rewriting the structs
  // alone left it bare — and Tint answers `integral user-defined fragment inputs must have a
  // '@interpolate(flat)' attribute` while the GLSL writer, which derives the qualifier from
  // the field's own type wherever it finds one, emitted `flat in uint id;` and linked. The
  // same one source, two programs. A VERTEX entry's `@location` parameters are vertex
  // ATTRIBUTES, not varyings — nothing interpolates them — so they are left alone.
  const funcs = m.funcs.map((f) => {
    if (stageOf(f) !== 'fragment') return f
    let touched = false
    const params = f.params.map((p) => {
      if (!needsFlat(p)) return p
      touched = true
      return withFlat(p)
    })
    if (!touched) return f
    changed = true
    return { ...f, params }
  })
  if (!changed) return m
  return { ...m, structs, funcs }
}

/** The interpolation a varying is EMITTED with: what the author wrote, or `flat` when the type
 *  leaves no choice. What {@link flatIntegerVaryings} is about to write, answered before it
 *  runs, so a rule that compares the two stages compares the emitted text rather than the
 *  authored text. `undefined` means the target's own default (`smooth` / perspective). */
export function emittedInterpolation(field: {
  readonly type: ShaderType
  readonly interpolate?: string
  readonly location?: number
}): string | undefined {
  if (field.interpolate !== undefined) return field.interpolate
  if (field.location !== undefined && isIntegerVarying(field.type)) return 'flat'
  return undefined
}

/** The sampling WGSL fills in when an `@interpolate` names only a type (wgsl.txt:13260-13264):
 *  `flat` defaults to `first`, and the two interpolating types to `center`. */
const DEFAULT_SAMPLING: Readonly<Record<string, string>> = {
  flat: 'first',
  perspective: 'center',
  linear: 'center',
}

/** An interpolation in the ONE form two of them can be compared in: type and sampling, both
 *  spelled, with WGSL's own defaults filled in. `undefined` — no attribute at all — is
 *  `perspective, center`, which is what WGSL gives a varying that declares none.
 *
 *  Needed because the same interpolation has several spellings and a rule that compares the
 *  text refuses pairs both targets accept: `@interpolate(flat)` against `@interpolate(flat,
 *  first)`, or `@interpolate(perspective, center)` against no attribute at all. */
export function canonicalInterpolation(spelling: string | undefined): string {
  if (spelling === undefined) return 'perspective, center'
  const [type = '', sampling] = spelling.split(',').map((x) => x.trim())
  return sampling === undefined
    ? `${type}, ${DEFAULT_SAMPLING[type] ?? 'center'}`
    : `${type}, ${sampling}`
}
