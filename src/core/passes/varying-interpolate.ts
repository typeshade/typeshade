// ═══ `@interpolate(flat)` on every integer varying (§53) ═══
//
// WGSL: "the integral user-defined vertex outputs must have a `@interpolate(flat)`
// attribute", and the same of the fragment inputs they feed. There is no smooth
// interpolation of an integer to do, so the attribute is not a hint — it is required.
// Measured on Tint:
//
//   struct VsOut { @builtin(position) pos: vec4<f32>, @location(0) id: u32, }
//   → integral user-defined vertex outputs must have a '@interpolate(flat)' attribute
//
// and the module with the attribute is accepted, module and pipeline both. The compiler
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

import type { FuncDecl, ModuleDecl, StructField } from '../ir/nodes.js'
import { stageOf } from '../ir/nodes.js'
import type { ShaderType } from '../ir/types.js'

/** Whether a varying of this type must carry `@interpolate(flat)`: an integer scalar, or a
 *  vector of them. `bool` is not one — it is refused at a `@location` outright — and `f32`
 *  and its vectors interpolate, which is the whole point of a varying. */
function isIntegerVarying(t: ShaderType): boolean {
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

/** The `attr` string with `@interpolate(flat)` appended, keeping whatever was there. */
function withFlat(field: StructField): StructField {
  const attr = field.attr ?? `@location(${String(field.location ?? 0)})`
  return { ...field, interpolate: 'flat', attr: `${attr} @interpolate(flat)` }
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
      // A field with no `@location` is a `@builtin`, which carries its own interpolation
      // rule and takes no attribute. One that already names an interpolation — the author
      // wrote `@interpolate(flat)`, or the EDSL set it — is left exactly as it is.
      if (f.location === undefined || f.interpolate !== undefined) return f
      if (!isIntegerVarying(f.type)) return f
      touched = true
      return withFlat(f)
    })
    if (!touched) return s
    changed = true
    return { ...s, fields }
  })
  if (!changed) return m
  return { ...m, structs }
}
