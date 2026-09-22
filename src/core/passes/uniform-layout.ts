// ═══ The WGSL uniform layout rule: an array element is aligned to 16 bytes (§51) ═══
//
// WGSL's uniform address space requires every array element to start on a 16-byte boundary;
// `array<f32, 4>` inside a `var<uniform>` is a shader-creation error unless the implementation
// offers the optional `uniform_buffer_standard_layout` language feature, which relaxes exactly
// that rule. Measured on Chromium 141 (`chromium_headless_shell-1194`), which does not:
//
//   'uniform' storage requires that array elements are aligned to 16 bytes, but array element
//   of type 'f32' has a stride of 4 bytes. Consider using a vector or struct as the element
//   type instead.
//
// Chromium 153 — what `gate:compile` launches with no `TYPESHADE_CHROMIUM`, and what CI
// installs — DOES list that feature and accepts the unpadded module. So the reason to pad is
// not "every driver refuses it". It is the two things true on both: the emit and `reflect()`
// describe the same bytes, and the module runs where the relaxation is absent.
//
// TWO attributes fix two different things, and both were measured before either was chosen:
//
//   @size(16) inside a wrapper struct   the element STRIDE. `@align(16) @size(64)` on the
//                                       MEMBER of a bare array is refused with the text above,
//                                       because that rule is on the element and no member
//                                       attribute reaches it.
//   @align(16) on the member            the array's OFFSET. A struct's alignment comes from
//                                       its members and `@size` does not raise it, so with the
//                                       stride alone the array lands at offset 4 — which is
//                                       also the offset `reflect()` does not report, and which
//                                       Chromium 141 states outright: `the offset of a struct
//                                       member of type 'array<_Pad16_f32, 3>' in address space
//                                       'uniform' must be a multiple of 16 bytes, but 'xs' is
//                                       currently at offset 4`.
//
// so a padded member reads
//
//   struct _Pad16_f32 { @size(16) v: f32, }
//   struct U { k: f32, @align(16) xs: array<_Pad16_f32, 3>, }
//   …  U.xs[1].v
//
// which is the memory `reflect()` already reports for that struct (its std140 arm rounds a
// uniform array's stride and alignment to 16), so the emit and the reflection describe the
// same bytes. Checked by hand against Tint's own layout note on nine struct shapes.
//
// WGSL-ONLY, and therefore a step of that backend's lowering alone. GLSL ES 3.00 needs
// nothing: a std140 block gives `float[4]` a 16-byte stride natively, which is why the very
// program Tint refuses links on WebGL2 — and the `.v` this pass introduces is not text an
// ANGLE translator would accept.
//
// BEFORE the optimizer, not after. This is a lowering: it changes a struct's member types and
// the reads that reach through them, and an optimizer that has not seen it hoists the
// unlowered form — LICM lifted `U.weights` out of a loop as `let _licm0 = U.weights;`, leaving
// no `member` node to rewrite, so `_licm0[i]` came out typed as the wrapper.

import type { BindingDecl, Expr, ModuleDecl, Stmt, StructDecl } from '../ir/nodes.js'
import { arrayT, structT, typeKey, type ShaderType } from '../ir/types.js'
import { eachStmtExpr, mapChildren, mapStmtExpr } from '../ir/visit.js'
import { UnsupportedFeatureError } from '../backend.js'
import { typeLayout } from '../reflect.js'

/** The boundary WGSL's uniform address space puts an array element — and therefore the array
 *  itself — on. */
const UNIFORM_ARRAY_ALIGN = 16

/** The one field a wrapper holds. Named `v`, which is what the rewritten reads append. */
const WRAPPED_FIELD = 'v'

const roundUp = (x: number, a: number): number => Math.ceil(x / a) * a

/** The size and alignment a type has AS EMITTED — that is, after this pass has padded
 *  whatever it is going to pad inside it. Recursive and memoized per struct, because the two
 *  answers depend on each other: whether `array<Item, 2>` needs a wrapper depends on how big
 *  `Item` is once ITS own array member is padded, and reading `Item` unpadded there produced
 *  `@size(16)` over a 48-byte type — Tint's `'@size' must be at least as big as the type's
 *  size (48)`.
 *
 *  A type this pass does not lay out (a runtime-sized array, a texture, an atomic) returns
 *  `undefined`, which leaves the array holding it alone. The front end refuses those shapes in
 *  a uniform; a pass that guessed here would pad bytes `reflect()` does not report.
 *
 *  `decide` is called for every array whose element needs a wrapper, in the order the fields
 *  are emitted, so the caller records the padding as the layout is computed rather than
 *  walking twice and risking two answers. */
function makeLayout(
  structs: ReadonlyMap<string, StructDecl>,
  decide: (elem: ShaderType, wrapperSize: number) => void,
): (t: ShaderType) => { size: number; align: number } | undefined {
  const memo = new Map<string, { size: number; align: number } | undefined>()
  const layout = (
    t: ShaderType,
    seen: ReadonlySet<string>,
  ): { size: number; align: number } | undefined => {
    switch (t.kind) {
      // The leaves are `reflect.ts`'s, not a second copy: a matCxR's column stride is
      // AlignOf(vecR), which is 8 for a two-row matrix and 16 otherwise, and writing that
      // number here again is what #149's measurement of the nine shapes would have drifted
      // against. `'std430'` is WGSL's own layout; the uniform address space's extra
      // element rule is what THIS pass adds on top of it.
      case 'scalar':
      case 'f64':
      case 'vec':
      case 'mat':
      case 'atomic':
        return typeLayout(t, 'std430', new Map())
      case 'struct': {
        if (seen.has(t.name)) return undefined
        if (memo.has(t.name)) return memo.get(t.name)
        const decl = structs.get(t.name)
        if (decl === undefined) return undefined
        const next = new Set(seen).add(t.name)
        let cursor = 0
        let align = 1
        let ok = true
        for (const f of decl.fields) {
          const fl = layout(f.type, next)
          if (fl === undefined) {
            ok = false
            break
          }
          // The field's OWN `@size` and `@align`, where this pass has already written them.
          // Reading the type alone made the walk answer differently on a module it had
          // already padded — a wrapper's `@size(16)` over an `f32` read back as 4 — so a
          // second application wrapped the wrapper. The pass is a lowering and runs once in
          // the pipeline, but `lowerForBackend` is public and a caller may run it twice; a
          // pass whose second application is not the identity is a trap either way.
          const size = f.size ?? fl.size
          const fieldAlign = f.align ?? fl.align
          cursor = roundUp(cursor, fieldAlign) + size
          if (fieldAlign > align) align = fieldAlign
        }
        const out = ok ? { size: roundUp(cursor, align), align } : undefined
        memo.set(t.name, out)
        return out
      }
      case 'array': {
        if (t.size === undefined) return undefined
        const el = layout(t.elem, seen)
        if (el === undefined) return undefined
        // A struct's alignment is the MAXIMUM of its members', not 16: the 16-byte round-up
        // belongs to the address space, not to the type. Reading it as 16 is what let
        // `array<{a: f32, b: f32}, 3>` through with a stride of 8, which Tint refuses.
        const natural = roundUp(el.size, el.align)
        const stride = roundUp(natural, UNIFORM_ARRAY_ALIGN)
        // An ARRAY in this address space is 16-aligned whatever its element is:
        // `RequiredAlignOf(array<E, N>)` is `roundUp(16, AlignOf(E))`, which is 16 for every
        // E. The stride and the alignment are two rules, and only the stride depends on the
        // element — reading the element's alignment here put `array<P, 3>` (P four floats,
        // stride 16 already) at offset 4 with no `@align`, which Tint answers with `the
        // offset of a struct member of type 'array<P, 3>' in address space 'uniform' must be
        // a multiple of 16 bytes, but 'xs' is currently at offset 4`.
        if (stride === natural) return { size: natural * t.size, align: UNIFORM_ARRAY_ALIGN }
        decide(t.elem, stride)
        // The wrapper gives the ELEMENT its stride; the MEMBER holding the array carries
        // `@align(16)`, which is also what raises the enclosing struct's own alignment.
        return { size: stride * t.size, align: UNIFORM_ARRAY_ALIGN }
      }
      default:
        return undefined
    }
  }
  return (t) => layout(t, new Set())
}

/** A name for the wrapper struct of one element type: `_Pad16_f32`, `_Pad16_vec2_f32_`. The
 *  type key is the authority, so two fields of one element type share a wrapper and the name
 *  is stable across runs (goldens). */
const wrapperName = (elem: ShaderType): string =>
  `_Pad16_${typeKey(elem).replace(/[^A-Za-z0-9]/g, '_')}`

/** A buffer binding in the uniform address space — the one place the 16-byte array rule
 *  applies. A texture or sampler carries `space: 'uniform'` too (it has no address space of
 *  its own) and holds no struct, so the type check is what separates them. */
const isBufferBinding = (b: BindingDecl): boolean =>
  b.type.kind === 'struct' ||
  b.type.kind === 'array' ||
  b.type.kind === 'scalar' ||
  b.type.kind === 'vec' ||
  b.type.kind === 'mat'

/** Every struct name reachable from `t`, through arrays and nested structs. */
function reachableStructs(
  t: ShaderType,
  structs: ReadonlyMap<string, StructDecl>,
  out: Set<string>,
): void {
  if (t.kind === 'array') return reachableStructs(t.elem, structs, out)
  if (t.kind !== 'struct' || out.has(t.name)) return
  out.add(t.name)
  for (const f of structs.get(t.name)?.fields ?? []) reachableStructs(f.type, structs, out)
}

/** Pad every uniform-reachable array whose element stride WGSL's uniform rule would round up,
 *  and rewrite the reads that reach through it. Identity for a module with no such array,
 *  which is every module in the corpus but the ones that carry the shape on purpose. */
export function padUniformArrays(m: ModuleDecl): ModuleDecl {
  const structs = new Map(m.structs.map((s) => [s.name, s]))
  const inUniform = new Set<string>()
  const inStorage = new Set<string>()
  for (const b of m.bindings) {
    if (!isBufferBinding(b)) continue
    reachableStructs(b.type, structs, b.space === 'storage' ? inStorage : inUniform)
  }
  const bareUniformArrays = m.bindings.filter(
    (b) => b.space !== 'storage' && isBufferBinding(b) && b.type.kind === 'array',
  )
  if (inUniform.size === 0 && bareUniformArrays.length === 0) return m

  // (struct name, field name) → the AUTHORED array type, before padding.
  const padded = new Map<string, Extract<ShaderType, { kind: 'array' }>>()
  const wrappers = new Map<string, StructDecl>()
  const wrapperSizes = new Map<string, number>()
  const layoutOf = makeLayout(structs, (elem, size) => {
    wrapperSizes.set(typeKey(elem), size)
  })
  // The element's OWN size and alignment, as emitted — to tell an array whose element is
  // already 16-aligned (no `@align` needed) from one that is not (a scalar, a `vec2`, a
  // struct that maxes out under 16). The wrapper recorder plays no part, so it is a no-op.
  const elemLayoutOf = makeLayout(structs, () => undefined)
  // A uniform whose WHOLE type is a list has no member to carry the `@align(16)`, and no
  // struct for `reflect()` to describe either — `reflect().uniforms` is empty for one. Refused
  // rather than emitted, since what would be emitted is the very stride Tint rejects.
  for (const b of bareUniformArrays) {
    if (b.type.kind !== 'array' || b.type.size === undefined) continue
    wrapperSizes.delete(typeKey(b.type.elem))
    layoutOf(b.type)
    if (wrapperSizes.get(typeKey(b.type.elem)) === undefined) continue
    throw new UnsupportedFeatureError(
      `wgsl: uniform '${b.name}' is a ${typeKey(b.type)}. WGSL aligns every array element in ` +
        `a uniform to 16 bytes, and a bare list has no member to carry that. Wrap it in a ` +
        `struct — interface ${b.name}Data { items: ${typeKey(b.type)} } — or use a list of ` +
        `vec4.`,
    )
  }
  wrapperSizes.clear()

  const nextStructs = m.structs.map((s) => {
    if (!inUniform.has(s.name)) return s
    let changed = false
    const fields = s.fields.map((f) => {
      if (f.type.kind !== 'array' || f.type.size === undefined) return f
      const arrayElem = f.type.elem
      // A list of lists, checked BEFORE the layout walk. The inner list's elements are in the
      // uniform address space too, and a wrapper around the outer one leaves their stride
      // untouched — there is nothing here that can emit the bytes `reflect()` reports for
      // that shape. Recorded in §51.
      if (arrayElem.kind === 'array') {
        throw new UnsupportedFeatureError(
          `wgsl: '${s.name}.${f.name}' is a ${typeKey(f.type)} in a uniform. WGSL aligns every ` +
            `array element to 16 bytes, and a list of lists would need that at both levels. ` +
            `Use a list of a struct, or of a vec4.`,
        )
      }
      // The layout walk decides, and records the wrapper size for this element type as it
      // goes; an element whose stride is already a multiple of 16 records nothing.
      wrapperSizes.delete(typeKey(arrayElem))
      layoutOf(f.type)
      const size = wrapperSizes.get(typeKey(arrayElem))
      // No wrapper needed — the element's stride is already a multiple of 16 — but the MEMBER
      // may still need `@align(16)`: the array's required alignment in this address space is
      // `roundUp(16, AlignOf(elem))`, so an element whose OWN alignment is under 16 leaves the
      // array under-aligned unless the member says so, and a scalar before it lands the array
      // at offset 4. Two rules, one of which the wrapper does not carry. But an element already
      // 16-aligned (a `vec4`, a matCxR with four rows, a struct that reaches 16 on its own)
      // aligns the array to 16 with no attribute at all — `roundUp(16, 16)` is 16 — so writing
      // one there is noise the emit does not need, and `array<vec4, N>` stays byte-identical.
      if (size === undefined) {
        const el = elemLayoutOf(arrayElem)
        const needsAlign = el !== undefined && el.align < UNIFORM_ARRAY_ALIGN
        if (!needsAlign || f.align === UNIFORM_ARRAY_ALIGN) return f
        changed = true
        return { ...f, align: UNIFORM_ARRAY_ALIGN }
      }
      // A struct laid out for BOTH address spaces cannot be padded: std430 gives the same
      // array its natural stride, so padding it here would move every byte a host packs for
      // the storage binding, while `reflect()` keeps reporting the unpadded offsets. Refused
      // rather than silently corrupted — the uniform half could never have compiled anyway,
      // since it is the very stride Tint rejects.
      if (inStorage.has(s.name)) {
        throw new UnsupportedFeatureError(
          `wgsl: struct '${s.name}' is bound as a uniform AND as storage, and its field ` +
            `'${f.name}' is a ${typeKey(f.type)}, which the two address spaces lay out ` +
            `differently (a uniform rounds the element stride to 16 bytes, storage does not). ` +
            `Declare one struct per address space.`,
        )
      }
      const name = wrapperName(arrayElem)
      // The generated name is `_`-prefixed, which the `"use typeshade"` front end refuses as
      // a struct name outright — but a hand-built `ModuleDecl` can carry one, and two structs
      // of a name is `redeclaration of '_Pad16_f32'` at Tint. Caught here, where the name is
      // chosen.
      if (structs.has(name)) {
        throw new UnsupportedFeatureError(
          `wgsl: this module declares a struct named '${name}', which is the name the uniform ` +
            `layout pass generates for the padded element of '${s.name}.${f.name}' (§51). ` +
            `Rename it; names beginning with '_Pad16_' are reserved for that padding.`,
        )
      }
      if (!wrappers.has(name)) {
        wrappers.set(name, { name, fields: [{ name: WRAPPED_FIELD, type: arrayElem, size }] })
      }
      changed = true
      padded.set(`${s.name}.${f.name}`, f.type)
      return {
        ...f,
        align: UNIFORM_ARRAY_ALIGN,
        type: arrayT(structT(name), f.type.size),
      }
    })
    return changed ? { ...s, fields } : s
  })
  // No wrapper anywhere: no read has to be rewritten, and no struct has to be added. The
  // ALIGNMENTS may still have moved, though — a uniform array whose element stride is already
  // 16 needs `@align(16)` on its member and nothing else — so the rebuilt structs are carried
  // out, and only a module where nothing at all changed returns `m` unchanged.
  if (wrappers.size === 0) {
    return nextStructs.every((s, i) => s === m.structs[i]) ? m : { ...m, structs: nextStructs }
  }

  /** The authored array type a `member` expression reads, when that member was padded. */
  const paddedMember = (e: Expr): Extract<ShaderType, { kind: 'array' }> | undefined => {
    if (e.op !== 'member' || e.base.type.kind !== 'struct') return undefined
    return padded.get(`${e.base.type.name}.${e.field}`)
  }

  const wrapperTypeOf = (arr: Extract<ShaderType, { kind: 'array' }>): ShaderType => ({
    kind: 'struct',
    name: wrapperName(arr.elem),
  })

  /** The member expression retyped to the padded array it now holds. */
  const retypedMember = (e: Expr, arr: Extract<ShaderType, { kind: 'array' }>): Expr => ({
    ...e,
    type: { kind: 'array', elem: wrapperTypeOf(arr), size: arr.size },
  })

  // A read through a padded field is one `.v` deeper than the author wrote. Two shapes, and
  // the second is why this walk is written by hand instead of with the bottom-up `mapExpr`:
  //
  //   U.xs[i]      → U.xs[i].v          the common one, an index straight through the member
  //   U.xs         → array<f32, N>(U.xs[0].v, …)
  //
  // The second is the array used as a VALUE — `const w = U.xs`, or `pick(U.xs)` — where the
  // padded type would otherwise leak into a local or an argument and be multiplied as an f32.
  // Rebuilding the authored array from its elements keeps the type the rest of the program
  // expects, and costs the loads the copy was already going to do.
  const rewrite = (e: Expr): Expr => {
    if (e.op === 'index') {
      const arr = paddedMember(e.base)
      if (arr !== undefined) {
        return {
          op: 'member',
          type: arr.elem,
          field: WRAPPED_FIELD,
          base: {
            ...e,
            type: wrapperTypeOf(arr),
            base: retypedMember(e.base, arr),
            idx: rewrite(e.idx),
          },
        }
      }
    }
    const arr = paddedMember(e)
    if (arr !== undefined && arr.size !== undefined) {
      const base = retypedMember(e, arr)
      return {
        op: 'construct',
        type: arr,
        args: Array.from({ length: arr.size }, (_, i) => ({
          op: 'member' as const,
          type: arr.elem,
          field: WRAPPED_FIELD,
          base: {
            op: 'index' as const,
            type: wrapperTypeOf(arr),
            base,
            idx: {
              op: 'lit' as const,
              type: { kind: 'scalar' as const, scalar: 'i32' as const },
              value: i,
            },
          },
        })),
      }
    }
    // Building a padded struct BY VALUE — `fn mk() -> U { return { k: 1., xs: [0., 1.] } }` —
    // hands the constructor an `array<f32, N>` for a member that now holds
    // `array<_Pad16_f32, N>`. Each authored element is wrapped so the argument has the type
    // the member does; Tint otherwise answers `type in structure constructor does not match
    // struct member type`.
    if (e.op === 'construct' && e.type.kind === 'struct') {
      const structName = e.type.name
      const decl = structs.get(structName)
      if (decl !== undefined && inUniform.has(structName)) {
        const args = e.args.map((a, i) => {
          const field = decl.fields[i]
          const fieldArr = field && padded.get(`${structName}.${field.name}`)
          if (fieldArr === undefined || fieldArr.size === undefined) return rewrite(a)
          const inner = rewrite(a)
          const wrapperT = wrapperTypeOf(fieldArr)
          return {
            op: 'construct' as const,
            type: { kind: 'array' as const, elem: wrapperT, size: fieldArr.size },
            args: Array.from({ length: fieldArr.size }, (_, j) => ({
              op: 'construct' as const,
              type: wrapperT,
              args: [
                {
                  op: 'index' as const,
                  type: fieldArr.elem,
                  base: inner,
                  idx: {
                    op: 'lit' as const,
                    type: { kind: 'scalar' as const, scalar: 'i32' as const },
                    value: j,
                  },
                },
              ],
            })),
          }
        })
        return { ...e, args }
      }
    }
    return mapChildren(e, rewrite)
  }

  // A WHOLE-array write to a padded member has no lowering: the read form materialises the
  // array into a constructor, and a constructor is not something to assign to. It can only
  // ever be a write to a LOCAL of a uniform struct's type, since a uniform itself is
  // read-only, so refusing it costs an author nothing they could have run.
  for (const f of m.funcs) refuseWholeArrayWrites(f.body, paddedMember)

  return {
    ...m,
    structs: [...wrappers.values(), ...nextStructs],
    funcs: m.funcs.map((f) => ({ ...f, body: f.body.map((s) => mapStmtExpr(s, rewrite)) })),
  }
}

/** Throws on `x.padded = …`, the one shape the read rewrite has no assignable form for. */
function refuseWholeArrayWrites(
  body: readonly Stmt[],
  paddedMember: (e: Expr) => Extract<ShaderType, { kind: 'array' }> | undefined,
): void {
  for (const s of body) {
    if ((s.s === 'assign' || s.s === 'assignOp') && paddedMember(s.target) !== undefined) {
      throw new UnsupportedFeatureError(
        `wgsl: '${s.target.op === 'member' ? s.target.field : '?'}' is a uniform-padded list ` +
          `(§51) and cannot be assigned whole. Write its elements one at a time.`,
      )
    }
    eachStmtExpr(
      s,
      () => undefined,
      (b) => refuseWholeArrayWrites([b], paddedMember),
    )
  }
}
