// ═══ Shader DSL — single source of truth for IO structs & bound resources ═══
//
// Before this layer, a vertex/uniform layout was declared in up to FOUR places that
// had to agree by hand: the StructDecl (fields + @location/@builtin attrs), the
// binding decl ({group,binding,name,space,type}), the bindingRef node, and every
// stringly member access (the since-removed `node.field('name', type)` — #763 H5).
// Drift between them is a whole class of bug (the polygon slot-drift family,
// OPACITY). The SoT helpers declare a layout ONCE and DERIVE the rest, so the
// pieces cannot disagree and the type checker covers field names + types.

import {
  Node,
  ReadonlyNode,
  structT,
  bindingRef,
  construct,
  member,
  arrayT,
  Var,
  constRef,
  type ShaderType,
  type StructDecl,
  type ConstDecl,
  type KeyOf,
  type ScalarKey,
  type BindingDecl,
  type AddressSpace,
} from './ir/index.js'
import { dslError } from './diagnostics/error.js'

/** The handle {@link constDecl} returns: a module-level constant and its typed reference,
 *  declared together so the name is written once.
 *
 *  Exported from `@xgis/shader-dsl`.
 */
export interface ConstHandle<T extends ShaderType> {
  /** The constant's declaration, for `module({ consts })` or `module({ uses })`. */
  readonly decl: ConstDecl
  /** The typed reference to read the constant through at call sites. */
  readonly node: ReadonlyNode<KeyOf<T>>
}
/** Declare a module-level scalar constant together with its typed reference in one call. WGSL
 *  emits `values.wgsl` as the literal, in the same spelling a hand-written `ConstDecl` uses
 *  (for example `PI = 3.14159265`). The CPU oracle, the same module run in double precision on
 *  the CPU, evaluates `values.cpu` at full JS double precision, so a WGSL literal you
 *  deliberately shorten does not lower the precision of the parity check.
 *
 *  Returns a {@link ConstHandle}. Its `.decl` goes into `module({ consts })` or, more usually,
 *  into `module({ uses })`, which collects the `.decl` of any handle passed to it. Its `.node`
 *  is the typed reference to use at call sites, so a renamed or misspelled constant is a `tsc`
 *  error everywhere it is used. For a constant of vector, matrix or array type (a `vec4<f32>`
 *  colour, an `array<vec4<f32>, N>` palette) use {@link constExpr}, which takes one
 *  constant-foldable literal node in place of the WGSL/CPU value pair.
 *
 *  Exported from `@xgis/shader-dsl`.
 *
 *  @param name - the emitted constant name.
 *  @param type - the constant's scalar type.
 *  @param values - `wgsl`, the literal WGSL emits, and `cpu`, the value the CPU oracle uses.
 *  @returns the {@link ConstHandle}, `.decl` and `.node`.
 *
 *  @example
 *  ```ts
 *  const TAU = constDecl('TAU', f32T, { wgsl: 6.2831853, cpu: Math.PI * 2 })
 *  const g = fn('g', { t: f32T }, ({ t }) => t.mul(TAU.node))
 *  const m = module({ consts: [TAU.decl], funcs: [g] })
 *  ```
 *
 *  @see {@link constExpr} for a vector, matrix or array constant.
 */
export function constDecl<T extends ShaderType>(
  name: string,
  type: T,
  values: { readonly wgsl: number; readonly cpu: number },
): ConstHandle<T> {
  return {
    decl: { name, type, wgslValue: values.wgsl, cpuValue: values.cpu },
    node: constRef(name, type),
  }
}

/** One struct field or entry-point parameter carrying a stage attribute. It is the return
 *  type of {@link builtin} and {@link location}, and the value type of both an {@link ioStruct}
 *  field map and an {@link fn} entry-point parameter record, so a stage-attributed parameter
 *  and an IO-struct field are written the same way.
 *
 *  `attr` is the attribute as WGSL text. `location`, `builtin` and `interpolate` are the
 *  structured form the backends read, for capability checks, for the vertex-attribute table
 *  {@link reflect} produces, and for the GLSL `flat` qualifier. A field carries either a
 *  builtin attribute or a location attribute, never both. Build one with `builtin(name, type)`
 *  or `location(n, type, interpolate?)`.
 *
 *  Exported from `@xgis/shader-dsl`.
 */
export interface FieldSpec<T extends ShaderType = ShaderType> {
  /** The field's shader type. */
  readonly type: T
  /** The attribute as WGSL text. The structured fields below are what the backends read. */
  readonly attr: string
  /** The `@location(n)` slot, when the field is location-attributed. */
  readonly location?: number
  /** The `@builtin(name)` id, when the field is builtin-attributed. */
  readonly builtin?: string
  /** The `@interpolate(mode)` mode, when one was given. */
  readonly interpolate?: string
}

/** Every `@builtin(<name>)` id WGSL defines. The builtin vocabulary is WGSL's, and each
 *  backend spells the id for its target: a fragment-input `position` reads as `gl_FragCoord`
 *  on GLSL. {@link builtin} takes its `name` from this union, so a misspelled name or a GLSL
 *  spelling (`'vertex_idx'`, `'frag_coord'`, `'point_size'`) is a `tsc` error at the
 *  authoring line. Ids that need a feature (`subgroup_*`, `clip_distances`) and ids with no
 *  GLSL mapping (`sample_index`, the compute family on WebGL2) are included: the type says
 *  which names are WGSL builtins, and whether a target supports one is checked at emit.
 *
 *  Exported from `@xgis/shader-dsl`.
 */
export type WgslBuiltinName =
  | 'vertex_index'
  | 'instance_index'
  | 'position'
  | 'front_facing'
  | 'frag_depth'
  | 'sample_index'
  | 'sample_mask'
  | 'local_invocation_id'
  | 'local_invocation_index'
  | 'global_invocation_id'
  | 'workgroup_id'
  | 'num_workgroups'
  | 'subgroup_invocation_id'
  | 'subgroup_size'
  | 'clip_distances'

/** Attribute a field or an entry-point parameter with a `@builtin(<name>)`, the value the
 *  pipeline supplies to the shader. The same helper serves an
 *  {@link ioStruct} field map and an {@link fn} param record.
 *
 *  The vocabulary is WGSL's, passed through verbatim, and `name` is typed as the closed
 *  {@link WgslBuiltinName} union: `'position'`, `'vertex_index'`, `'instance_index'`,
 *  `'front_facing'`, `'frag_depth'`, `'sample_index'`, `'sample_mask'`, the compute family
 *  (`'global_invocation_id'`, `'local_invocation_id'`, `'local_invocation_index'`,
 *  `'workgroup_id'`, `'num_workgroups'`), the subgroup pair and `'clip_distances'`. A typo or
 *  a GLSL spelling is therefore a tsc error at the authoring line, where a WGSL writer would
 *  otherwise pass the name through and the failure would land in the GPU compiler with no way
 *  back to the source.
 *
 *  The GLSL backend spells each id in that target's terms, so these are the `gl_*` globals the
 *  ids replace:
 *
 *  | id | GLSL ES 3.00 |
 *  | --- | --- |
 *  | `position` on a vertex output | `gl_Position` |
 *  | `position` on a fragment input | `gl_FragCoord` |
 *  | `vertex_index` | `uint(gl_VertexID)` |
 *  | `instance_index` | `uint(gl_InstanceID)` |
 *  | `front_facing` | `gl_FrontFacing` |
 *  | `frag_depth` | `gl_FragDepth` |
 *
 *  The two `position` rows are one id because WGSL has one: a vertex stage writes clip space,
 *  a fragment stage reads window space. Mind the y origin when a fragment reads it, since GL
 *  window space runs bottom-up and WGSL framebuffer space runs top-down.
 *
 *  `vertex_index` and `instance_index` are `u32` here and `int` in GLSL, which is why the
 *  GLSL read is wrapped in `uint(...)`.
 *
 *  Exported from `@xgis/shader-dsl`.
 *
 *  @param name - the WGSL builtin id.
 *  @param type - the field's type, which must match what the builtin supplies.
 *  @returns a {@link FieldSpec} for an `ioStruct` field map or an `fn` param record.
 *
 *  @example
 *  ```ts
 *  import { fn, ioStruct, builtin, location, u32T, vec4fT, vec2fT } from '@xgis/shader-dsl'
 *
 *  const VsOut = ioStruct('VsOut', { pos: builtin('position', vec4fT), uv: location(0, vec2fT) })
 *
 *  // The same helper attributes an entry point's parameter.
 *  const vs = fn('vs_main', { vid: builtin('vertex_index', u32T) }, ({ vid }) => vsOutFor(vid), {
 *    stage: 'vertex',
 *  })
 *  ```
 *
 *  @see {@link location} for the other field attribute.
 *  @see {@link WgslBuiltinName} for the full vocabulary.
 */
export const builtin = <T extends ShaderType>(name: WgslBuiltinName, type: T): FieldSpec<T> => ({
  type,
  attr: `@builtin(${name})`,
  builtin: name,
})

/** Attribute a field or an entry-point parameter with `@location(<n>)`, a slot the
 *  pipeline or the previous stage supplies, with an optional `@interpolate(<mode>)`. The same
 *  helper serves an {@link ioStruct} field map and an {@link fn} parameter record.
 *
 *  Exported from `@xgis/shader-dsl`.
 *
 *  @param n - the location slot.
 *  @param type - the field's type.
 *  @param interpolate - the interpolation mode, such as `'flat'` for an integer varying.
 *  @returns a {@link FieldSpec} for an `ioStruct` field map or an `fn` parameter record.
 *
 *  @example
 *  ```ts
 *  const VsOut = ioStruct('VsOut', { pos: builtin('position', vec4fT), id: location(0, u32T, 'flat') })
 *  ```
 *
 *  @see {@link builtin} for the other field attribute.
 */
export const location = <T extends ShaderType>(
  n: number,
  type: T,
  interpolate?: string,
): FieldSpec<T> => ({
  type,
  attr: `@location(${n})${interpolate ? ` @interpolate(${interpolate})` : ''}`,
  location: n,
  ...(interpolate !== undefined ? { interpolate } : {}),
})

/** The handle {@link ioStruct} returns: a struct that crosses a stage boundary (a vertex
 *  output, a fragment input, a compute IO record), whose fields carry `@builtin` or
 *  `@location` attributes. It bundles the `StructDecl` for `module({ structs })`, the struct's
 *  `ShaderType`, a typed field-read proxy for any node of this shape, and a one-expression
 *  constructor. Use {@link PlainStruct} for a struct that never crosses a stage boundary (a
 *  storage-buffer element, a nested struct); its fields carry no attribute, which is the only
 *  difference between the two.
 *
 *  Exported from `@xgis/shader-dsl`.
 */
export interface IoStruct<F extends Record<string, FieldSpec>, N extends string = string> {
  /** The struct declaration, for `module({ structs })`. */
  readonly decl: StructDecl
  /** The struct's `ShaderType`, carrying the name as a literal so every value built from this
   *  handle has the exact `struct:${N}` key {@link typeKey} produces. */
  readonly type: { readonly kind: 'struct'; readonly name: N }
  /** Typed field access on a value of this struct: `VsOut.of(node).uv` is the same member
   *  read as `member(node, 'uv', <its type>)`, with the field name and type checked. The
   *  view's write capability follows the base: a mutable base (a `Var`) gives `Node` fields,
   *  which accept `.assign(...)`; a read-only base (a parameter, a `Let`) gives `ReadonlyNode`
   *  fields. `.$` is the raw struct value. A field spread in conditionally
   *  (`...(cond ? { pick } : {})`) is typed as present, so optional output fields stay plain. */
  of(node: Node): { readonly [K in keyof F]-?: Node<KeyOf<NonNullable<F[K]>['type']>> } & {
    readonly $: ReadonlyNode<`struct:${N}`>
  }
  of(node: ReadonlyNode): {
    readonly [K in keyof F]-?: ReadonlyNode<KeyOf<NonNullable<F[K]>['type']>>
  } & {
    readonly $: ReadonlyNode<`struct:${N}`>
  }
  /** Declare a `var` of this struct and return its typed field proxy in one step:
   *  `const o = VsOut.var()`. Assign fields with `o.uv.assign(...)` and return or forward the
   *  raw value with `o.$`. `name` pins the emitted WGSL identifier. */
  var(name?: string): { readonly [K in keyof F]-?: Node<KeyOf<NonNullable<F[K]>['type']>> } & {
    readonly $: ReadonlyNode<`struct:${N}`>
  }
  /** Build a value of this struct in one expression, keyed by field name. Values are placed
   *  in field-declaration order, and a missing or wrong field is a `tsc` error. */
  construct(values: {
    readonly [K in keyof F]: ReadonlyNode<KeyOf<NonNullable<F[K]>['type']>>
  }): Node<`struct:${N}`>
}

/** Declare a struct that crosses a stage boundary, a vertex output, a fragment input, a
 *  compute IO record, from one field map. Every field is a {@link builtin} or {@link location}
 *  spec, so the attributes live with the field they belong to and the struct is declared once.
 *
 *  The returned handle carries everything the rest of the module needs:
 *
 *  - `.type` is the struct's {@link ShaderType}. Use it as a parameter type, `{ vo: VsOut.type }`,
 *    or pass the handle itself in an {@link fn} param record and the body receives the typed
 *    field proxy.
 *  - `.decl` is the `StructDecl` for `module({ structs })`, or pass the handle in `uses`.
 *  - `.of(node)` reads fields off a value of this struct: `VsOut.of(p.vo).uv` is typed, and a
 *    misspelled field is a tsc error. The view follows its base, so a read-only base yields
 *    read-only fields.
 *  - `.var(name)` declares a `var` of the struct and returns assignable fields:
 *    `o.pos.assign(...)`. The proxy reads as the raw node in value positions, and `.$` is that
 *    raw struct value where an explicit one is wanted.
 *  - `.construct({ ... })` builds the value in one expression, keyed by field name, with a
 *    missing or extra field a tsc error. It is the form to prefer when nothing needs mutating.
 *
 *  Exported from `@xgis/shader-dsl`.
 *
 *  @param name - the emitted struct name.
 *  @param fields - the field map, each value a `builtin(...)` or `location(...)` spec.
 *  @returns the {@link IoStruct} handle described above.
 *
 *  @example
 *  ```ts
 *  import { ioStruct, builtin, location, vec4fT, vec2fT, f32T } from '@xgis/shader-dsl'
 *
 *  const VsOut = ioStruct('VsOut', {
 *    pos: builtin('position', vec4fT),
 *    uv: location(0, vec2fT),
 *    vis: location(1, f32T),
 *  })
 *
 *  const pin = VsOut.of(p.vo) // pin.uv, pin.vis are typed reads
 *  return VsOut.construct({ pos: clip, uv, vis })
 *  ```
 *
 *  @see {@link structDecl} for a struct that never crosses a stage boundary.
 *  @see {@link uniformStruct} for a struct that comes with its binding.
 */
export function ioStruct<F extends Record<string, FieldSpec>, N extends string>(
  name: N,
  fields: F,
): IoStruct<F, N> {
  const decl: StructDecl = {
    name,
    fields: Object.entries(fields).map(([n, spec]) => ({
      name: n,
      type: spec.type,
      attr: spec.attr,
      location: spec.location,
      builtin: spec.builtin,
      interpolate: spec.interpolate,
    })),
  }
  return {
    decl,
    type: structT(name),
    of(node: ReadonlyNode) {
      return new Proxy({} as Record<string, Node>, {
        get: (_t, prop) => {
          // Symbols are protocol probes (NODE_BRAND #763 D1, Symbol.toPrimitive,
          // inspection) — never authored fields. Answer undefined, don't throw.
          if (typeof prop !== 'string') return undefined
          if (prop === 'then' || prop === 'toJSON') return undefined // protocol probes (#763 X13)
          // `$` = the raw struct-value Node (#740 R6): lets a field proxy be
          // FORWARDED — fn call factories unwrap it, so `helper(p.input)` works
          // when p.input arrived as a typed handle param. Not a WGSL identifier,
          // so it can never shadow a real field.
          if (prop === '$') return node
          // Duck-type as the raw node for value positions (#763 X14): `return o`
          // / `Return(o)` read `.expr`/`.type` — they used to die at LOAD with a
          // misleading "no field 'expr'". A declared field of that name wins.
          if ((prop === 'expr' || prop === 'type') && !(prop in fields)) return node[prop]
          const spec = fields[prop as string]
          if (spec === undefined)
            throw new Error(`sot: ioStruct '${name}' has no field '${String(prop)}'`)
          return member(node, prop as string, spec.type)
        },
        // The empty proxy TARGET has no keys, so without this trap `'$' in proxy`
        // is false and the call-factory unwrap misses — the proxy then gets
        // misparsed as a named-args bag ("has no field 'input'" at module load).
        has: (_t, prop) => prop === '$' || (typeof prop === 'string' && prop in fields),
      }) as { readonly [K in keyof F]-?: Node<KeyOf<NonNullable<F[K]>['type']>> } & {
        readonly $: ReadonlyNode<`struct:${N}`>
      }
    },
    var(varName?: string) {
      return this.of(varName !== undefined ? Var(varName, this.type) : Var(this.type))
    },
    construct(values: Record<string, ReadonlyNode>) {
      return construct(
        structT(name),
        decl.fields.map((f) => values[f.name]),
      )
    },
  }
}

/** The handle {@link structDecl} returns: a struct declared for something other than a
 *  stage's IO boundary, such as a storage-buffer element type (paired with
 *  {@link storageBuffer}) or a struct nested inside another struct. Fields are plain
 *  `ShaderType`s with no `@location` or `@builtin` attribute; {@link IoStruct} is the twin
 *  that carries those. It has the same shape as `IoStruct` (`.decl`, `.type`, `.of`, `.var`,
 *  `.construct`) plus a positional `.get(node, field)` reader.
 *
 *  Exported from `@xgis/shader-dsl`.
 */
export interface PlainStruct<F extends Record<string, ShaderType>, N extends string = string> {
  /** The struct declaration, for `module({ structs })`. */
  readonly decl: StructDecl
  /** The struct's `ShaderType`, carrying the name as a literal so every value built from this
   *  handle has the exact `struct:${N}` key {@link typeKey} produces. */
  readonly type: { readonly kind: 'struct'; readonly name: N }
  /** Typed field access on a struct value you hold as a raw node: `Seg.of(someNode).p0`.
   *  A storage-buffer element does not need it, because `buf.at(i)` already returns this
   *  proxy. The view's write capability follows the base: a mutable base gives `Node` fields,
   *  a read-only base gives `ReadonlyNode` fields. `.$` is the raw struct value, which can be
   *  passed on to a function that takes the struct. */
  of(node: Node): { readonly [K in keyof F]: Node<KeyOf<F[K]>> } & {
    readonly $: ReadonlyNode<`struct:${N}`>
  }
  of(node: ReadonlyNode): { readonly [K in keyof F]: ReadonlyNode<KeyOf<F[K]>> } & {
    readonly $: ReadonlyNode<`struct:${N}`>
  }
  /** Positional field access: `Seg.get(node, 'p0')` is the same read as `Seg.of(node).p0`,
   *  with a wrong field name a `tsc` error. It suits a call site that reads many fields
   *  through one shorthand (`const g = Seg.get`). It is a read accessor and returns
   *  `ReadonlyNode`. */
  get<K extends keyof F & string>(node: ReadonlyNode, field: K): ReadonlyNode<KeyOf<F[K]>>
  /** Declare a `var` of this struct and return its typed, mutable field proxy, as
   *  `IoStruct.var` does. */
  var(name?: string): { readonly [K in keyof F]: Node<KeyOf<F[K]>> } & {
    readonly $: ReadonlyNode<`struct:${N}`>
  }
  /** Build a value of this struct in one expression, keyed by field name and placed in
   *  declaration order, as `IoStruct.construct` does. */
  construct(values: { readonly [K in keyof F]: ReadonlyNode<KeyOf<F[K]>> }): Node<`struct:${N}`>
}

/** Declare a plain struct: one that never crosses a stage boundary. That is a storage-buffer
 *  element type, or a struct nested inside another struct. Fields are plain shader types with
 *  no `@location` or `@builtin` attribute, which is the whole difference from
 *  {@link ioStruct}.
 *
 *  The returned handle carries:
 *
 *  - `.decl` for `module({ structs })`, or pass the handle in `uses`.
 *  - `.type` for the struct's shader type, which is what a parameter, a nested field or a
 *    {@link storageBuffer} element takes.
 *  - `.of(node).field` for typed field reads off a value you hold as a raw node, and
 *    `.get(node, 'field')` for the positional spelling of the same read, which suits a call
 *    site that reads many fields through one shorthand.
 *  - `.var(name)` for a mutable `var` of the struct, and `.construct({ ... })` for the
 *    one-expression build, exactly as {@link ioStruct} has them.
 *
 *  As a storage-buffer element type it is the argument {@link storageBuffer} takes, and
 *  `buf.at(i)` then returns this struct's field proxy directly, with no `.of` step.
 *
 *  Exported from `@xgis/shader-dsl`.
 *
 *  @param name - the emitted struct name.
 *  @param fields - the field map, each value a plain shader type.
 *  @returns the {@link PlainStruct} handle described above.
 *
 *  @example
 *  ```ts
 *  import { structDecl, storageBuffer, u32T, vec2fT } from '@xgis/shader-dsl'
 *
 *  const ShapeSegment = structDecl('ShapeSegment', { kind: u32T, p0: vec2fT, p1: vec2fT })
 *  const segments = storageBuffer('segments', ShapeSegment, { group: 0, binding: 9, access: 'read' })
 *
 *  segments.at(i).p0 // Node<'vec2<f32>'>
 *  ShapeSegment.get(someNode, 'kind') // the same read, positionally
 *  ```
 *
 *  @see {@link ioStruct} for a struct with stage attributes.
 *  @see {@link storageBuffer} for the binding whose element this is.
 */
export function structDecl<F extends Record<string, ShaderType>, N extends string>(
  name: N,
  fields: F,
): PlainStruct<F, N> {
  const decl: StructDecl = {
    name,
    fields: Object.entries(fields).map(([n, type]) => ({ name: n, type })),
  }
  const type = structT(name)
  return {
    decl,
    type,
    get<K extends keyof F & string>(node: ReadonlyNode, field: K): ReadonlyNode<KeyOf<F[K]>> {
      return member(node, field, fields[field])
    },
    var(varName?: string) {
      return this.of(varName !== undefined ? Var(varName, this.type) : Var(this.type))
    },
    construct(values: Record<string, ReadonlyNode>) {
      return construct(
        structT(name),
        decl.fields.map((f) => values[f.name]),
      )
    },
    of(node: ReadonlyNode) {
      return new Proxy({} as Record<string, Node>, {
        get: (_t, prop) => {
          if (typeof prop !== 'string') return undefined // symbol probes (#763 D1) — never fields
          if (prop === 'then' || prop === 'toJSON') return undefined // protocol probes (#763 X13)
          if (prop === '$') return node // raw struct-value Node (#740 R6, forwardable)
          if ((prop === 'expr' || prop === 'type') && !(prop in fields)) return node[prop] // #763 X14
          const t = fields[prop as string]
          if (t === undefined)
            throw new Error(`sot: structDecl '${name}' has no field '${String(prop)}'`)
          return member(node, prop as string, t)
        },
        // `'$' in proxy` must be true for the call-factory unwrap (empty target).
        has: (_t, prop) => prop === '$' || (typeof prop === 'string' && prop in fields),
      }) as { readonly [K in keyof F]: Node<KeyOf<F[K]>> } & {
        readonly $: ReadonlyNode<`struct:${N}`>
      }
    },
  }
}

/** A fixed-size `array<Element, N>` uniform field whose element is a struct handle:
 *  `patterns: arrayOf(PatternSlot, 3)`. The field proxy exposes a typed `.at(i)` that returns
 *  the element's field proxy, `U.field.patterns.at(k).id`. The declared WGSL type is
 *  `array<T, N>`.
 *
 *  Exported from `@xgis/shader-dsl`.
 */
export interface HandleArray<H extends StructHandle> {
  /** The element's struct handle. */
  readonly element: H
  /** The array length. */
  readonly count: number
}
/** A fixed-size array uniform field with a plain element type: `dash_array: arrayOf(vec4fT, 2)`.
 *  The field proxy exposes `.at(i)`, which returns the typed element read.
 *
 *  Exported from `@xgis/shader-dsl`.
 */
export interface TypeArray<T extends ShaderType> {
  /** The element's shader type. */
  readonly elemType: T
  /** The array length. */
  readonly count: number
}
type UniformFieldSpec = ShaderType | HandleArray<StructHandle> | TypeArray<ShaderType>

/** Declare a fixed-length array field inside a {@link uniformStruct} field map. The array is
 *  always `array<T, N>` with a declared `count`. A runtime-length `array<T>` is a top-level
 *  {@link storageBuffer} binding, which takes no count. Which overload applies is decided by
 *  the shape of `element`: a struct handle (from {@link structDecl} or {@link ioStruct},
 *  recognised by its `.of` method) returns a {@link HandleArray} whose field `.at(i)` gives the
 *  typed field proxy; a bare `ShaderType` returns a {@link TypeArray} whose field `.at(i)`
 *  gives the element read directly.
 *
 *  Exported from `@xgis/shader-dsl`.
 *
 *  @param element - the element: a struct handle, or a shader type.
 *  @param count - the array length.
 *  @returns a {@link HandleArray} for a struct handle, a {@link TypeArray} for a shader type.
 *
 *  @example
 *  ```ts
 *  import { uniformStruct, arrayOf, vec4fT } from '@xgis/shader-dsl'
 *
 *  const U = uniformStruct('Uniforms', { group: 0, binding: 0, as: 'u' }, {
 *    dash_array: arrayOf(vec4fT, 2),
 *  })
 *  const d0 = U.field.dash_array.at(0) // ReadonlyNode<'vec4<f32>'>
 *  ```
 */
export function arrayOf<H extends StructHandle>(element: H, count: number): HandleArray<H>
export function arrayOf<T extends ShaderType>(element: T, count: number): TypeArray<T>
export function arrayOf(
  element: StructHandle | ShaderType,
  count: number,
): HandleArray<StructHandle> | TypeArray<ShaderType> {
  return typeof element === 'object' && 'of' in element
    ? { element: element as StructHandle, count }
    : { elemType: element as ShaderType, count }
}

const isHandleArray = (v: UniformFieldSpec): v is HandleArray<StructHandle> =>
  typeof v === 'object' && 'element' in v && 'count' in v
const isTypeArray = (v: UniformFieldSpec): v is TypeArray<ShaderType> =>
  typeof v === 'object' && 'elemType' in v && 'count' in v

/** Uniform fields are READ-ONLY in WGSL — the field proxy hands out `ReadonlyNode`
 *  (#763 G2): `U.field.opacity.assign(…)` is a tsc error, not a naga rejection.
 *  Handle-array fields get the element handle's read view (the `.of` read overload). */
type UniformFieldNode<V> =
  V extends HandleArray<infer H>
    ? { at(i: ReadonlyNode<ScalarKey> | number): ReturnType<H['of']> }
    : V extends TypeArray<infer T>
      ? { at(i: ReadonlyNode<ScalarKey> | number): ReadonlyNode<KeyOf<T>> }
      : V extends ShaderType
        ? ReadonlyNode<KeyOf<V>>
        : never

/** The handle {@link uniformStruct} returns: a struct and its binding declared together.
 *  `.struct` (also spelled `.decl`) is for `module({ structs })`, `.binding` for
 *  `module({ bindings })`, and `.field` gives typed, read-only field access; uniforms are
 *  read-only in WGSL, so `.field.x.assign(...)` is a `tsc` error. `F` may include a fixed-size
 *  {@link arrayOf} field (a struct-element array or a plain-type array), the one field shape
 *  {@link PlainStruct} cannot express.
 *
 *  The type is exported so that other code can accept it as a generic constraint and build on
 *  the struct's shape `F` without re-declaring it: a host can derive a CPU-side std140 buffer
 *  writer from `u.struct`, and a helper can return
 *  `UniformStruct<{ time: ...; resolution: ... } & F>` to compose a base uniform layout with a
 *  caller's extra fields under one type-checked struct.
 *
 *  Exported from `@xgis/shader-dsl`.
 */
export interface UniformStruct<F extends Record<string, UniformFieldSpec>> {
  /** The struct declaration, for `module({ structs })`. */
  readonly struct: StructDecl
  /** The same declaration as `struct`, under the name every other handle in this module
   *  uses, so `structs: [U.decl, VsOut.decl]` reads uniformly. */
  readonly decl: StructDecl
  /** The struct's `ShaderType`. */
  readonly type: ShaderType
  /** The binding declaration, for `module({ bindings })`. */
  readonly binding: BindingDecl
  /** The raw binding access node, for a hand-built `member(...)` read. */
  readonly node: Node
  /** Typed, read-only field access. A field declared with {@link arrayOf} exposes `.at(i)`. */
  readonly field: { readonly [K in keyof F]: UniformFieldNode<F[K]> }
}

/** Declare a uniform-buffer struct together with its binding, from one field map. The struct,
 *  the binding and every field read then come from the same declaration, so a slot or a field
 *  type cannot drift between them.
 *
 *  The returned handle carries:
 *
 *  - `.struct` (also spelled `.decl`) for `module({ structs })` and `.binding` for
 *    `module({ bindings })`. Passing the handle in `uses` contributes both.
 *  - `.field.<name>` for typed field access, which chains straight into the value surface:
 *    `U.field.raster_params.x`, `U.field.mvp.mul(v)`. A field declared with {@link arrayOf}
 *    exposes `.at(i)` instead. Uniforms are read-only, so `U.field.opacity.assign(...)` is a
 *    tsc error.
 *  - `.node` for the raw binding access node, which is what a hand-built `member(...)` read
 *    needs and is rarely wanted otherwise.
 *  - `.type` for the struct's shader type.
 *
 *  Byte offsets are std140 and come from `reflect(m).uniforms`, so a host never counts them by
 *  hand.
 *
 *  Exported from `@xgis/shader-dsl`.
 *
 *  @param typeName - the emitted struct name.
 *  @param at - the `group` and `binding` slot, and `as`, the emitted variable name every field
 *    read is spelled through.
 *  @param fields - the field map: a shader type, or an {@link arrayOf} array field.
 *  @returns the {@link UniformStruct} handle described above.
 *
 *  @example
 *  ```ts
 *  import { uniformStruct, mat4x4fT, vec4fT } from '@xgis/shader-dsl'
 *
 *  const U = uniformStruct('Uniforms', { group: 0, binding: 0, as: 'u' }, {
 *    mvp: mat4x4fT,
 *    raster_params: vec4fT,
 *  })
 *
 *  const opacity = U.field.raster_params.x
 *  const m = module({ uses: [U], funcs: [vs, fs] })
 *  ```
 *
 *  @see {@link reflect} for the std140 byte offsets a host writes against.
 *  @see {@link hostUniform} when the host owns the uniform.
 */
export function uniformStruct<F extends Record<string, UniformFieldSpec>>(
  typeName: string,
  at: { group: number; binding: number; as: string },
  fields: F,
): UniformStruct<F> {
  const fieldType = (v: UniformFieldSpec): ShaderType =>
    isHandleArray(v)
      ? arrayT(v.element.type, v.count)
      : isTypeArray(v)
        ? arrayT(v.elemType, v.count)
        : v
  const struct: StructDecl = {
    name: typeName,
    fields: Object.entries(fields).map(([n, v]) => ({ name: n, type: fieldType(v) })),
  }
  const type = structT(typeName)
  const node = bindingRef(at.as, type)
  return {
    struct,
    decl: struct,
    type,
    binding: { group: at.group, binding: at.binding, name: at.as, space: 'uniform', type },
    node,
    field: new Proxy({} as Record<string, unknown>, {
      get: (_t, prop) => {
        if (typeof prop !== 'string') return undefined // symbol probes (#763 D1) — never fields
        if (prop === 'then' || prop === 'toJSON') return undefined // protocol probes (#763 X13) — await/JSON.stringify must not throw
        const v = fields[prop as string]
        if (v === undefined)
          throw new Error(`sot: uniformStruct '${typeName}' has no field '${String(prop)}'`)
        if (isHandleArray(v)) {
          const arrNode = member(node, prop as string, arrayT(v.element.type, v.count))
          return {
            at: (i: ReadonlyNode<ScalarKey> | number) =>
              v.element.of(arrNode.at(i, v.element.type)),
          }
        }
        if (isTypeArray(v)) {
          const arrNode = member(node, prop as string, arrayT(v.elemType, v.count))
          return { at: (i: ReadonlyNode<ScalarKey> | number) => arrNode.at(i, v.elemType) }
        }
        return member(node, prop as string, v)
      },
      // `in`/spread feature-detection must see the declared fields (#763 X13 —
      // the sibling proxies got this trap in R6; this one was the gap).
      has: (_t, prop) => typeof prop === 'string' && prop in fields,
    }) as { readonly [K in keyof F]: UniformFieldNode<F[K]> },
  }
}

/** A single-binding handle: a `BindingDecl` for `module({ bindings })` plus a typed access
 *  node. A texture, a sampler or a host-owned uniform has no fields to proxy, so this is all
 *  the handle carries. Both {@link resource} (textures, samplers, any module-owned non-struct
 *  binding) and {@link hostUniform} (a scalar, vector or matrix uniform the host supplies)
 *  return it, which is why it is generic over the resource type: `node` keeps the specific `T`
 *  (`Node<'texture_2d<f32>'>`, `Node<'sampler'>`, `Node<'vec4<f32>'>`), so type-specific
 *  operations (`textureSample`, `.mul`) stay type-checked at the call site.
 *
 *  Exported from `@xgis/shader-dsl`.
 */
export interface Resource<T extends ShaderType = ShaderType> {
  /** The binding declaration, for `module({ bindings })`. */
  readonly binding: BindingDecl
  /** The typed access node, keyed by the declared type `T`. */
  readonly node: Node<KeyOf<T>>
}

/** Declare a bound resource that is not a struct: a texture or a sampler. The binding
 *  declaration and the access node come from this one call.
 *
 *  `.node` keeps the specific key of the type you passed: `Node<'texture_2d<f32>'>`,
 *  `Node<'sampler'>`, `Node<'texture_2d_array<u32>'>`. That is what makes the texture calls
 *  type-checked at the authoring line: {@link textureSample}
 *  takes a sampled 2D texture and a sampler in that order, so swapping them is a tsc error,
 *  an integer texture is rejected where filtering has no meaning, and an array texture
 *  requires its layer argument.
 *
 *  `.binding` goes in `module({ bindings })`, or pass the handle in `uses`. The address space
 *  defaults to `'uniform'`, the texture and sampler convention.
 *
 *  Exported from `@xgis/shader-dsl`.
 *
 *  @param name - the emitted binding name, which is also the name a host binds by.
 *  @param type - the resource's type, such as `texture2dfT`, `texture2dArrayfT` or `samplerT`.
 *  @param at - the `group` and `binding` slot, and optionally the address `space`.
 *  @returns the {@link Resource} handle, `.binding` and `.node`.
 *
 *  @example
 *  ```ts
 *  import { resource, textureSample, texture2dfT, samplerT } from '@xgis/shader-dsl'
 *
 *  const tex = resource('tex', texture2dfT, { group: 0, binding: 1 })
 *  const smp = resource('tex_sampler', samplerT, { group: 0, binding: 2 })
 *  const c = textureSample(tex.node, smp.node, uv)
 *  ```
 *
 *  @see {@link textureSample} and {@link textureLoad} for reading one.
 *  @see {@link storageBuffer} for a bound array.
 */
export function resource<T extends ShaderType>(
  name: string,
  type: T,
  at: { group: number; binding: number; space?: AddressSpace },
): Resource<T> {
  return {
    binding: { group: at.group, binding: at.binding, name, space: at.space ?? 'uniform', type },
    node: bindingRef(name, type),
  }
}

/** Declare a host-owned uniform: one scalar, vector or matrix value the host supplies,
 *  spelled the way the host's target spells it.
 *
 *  On WGSL this is an ordinary `@group(N) @binding(M) var<uniform>` declaration. The one
 *  difference from {@link resource} is that {@link reflect} marks it `owner: 'host'`, which
 *  tells a consumer that the host's bind-group layout is the authority and it must not
 *  allocate one itself.
 *
 *  On GLSL ES 3.00 it emits a loose `uniform <type> <name>;` in the default block, which is
 *  what a GLSL host prelude provides, where a module-owned uniform gets a std140 block. The
 *  declaration is a real binding, so {@link reflect} describes it and `minify()` keeps it
 *  consistent with the module's reads.
 *
 *  Scalars, vectors and matrices only. A host-owned struct is {@link hostBlock}, which makes
 *  the same choice one level up: it can flatten to exactly these loose declarations, or stay
 *  a std140 block. When the host's prelude already declares the symbol and the module must
 *  not declare it again, use {@link externVar}, which emits nothing.
 *
 *  Exported from `@xgis/shader-dsl`.
 *
 *  @param name - the uniform's name, as the host spells it.
 *  @param type - its shader type: a scalar, vector or matrix.
 *  @param at - the WGSL `group` and `binding` slot. GLSL does not use it, and it is still
 *    required because the same declaration has to work on both targets.
 *  @param opts - `precision`, a GLSL-only qualifier for this declaration.
 *  @returns the {@link Resource} handle, `.binding` and `.node`.
 *  @throws SD0016 when `type` is a struct or an array.
 *
 *  @example
 *  ```ts
 *  import { hostUniform, vec2fT } from '@xgis/shader-dsl'
 *
 *  const viewport = hostUniform('u_viewport_px', vec2fT, { group: 0, binding: 1 }, {
 *    precision: 'highp', // GLSL only; ignored on WGSL
 *  })
 *  ```
 *
 *  @see {@link hostBlock} for a host-owned struct.
 *  @see {@link externVar} for a symbol the host prelude already declares.
 */
export function hostUniform<T extends ShaderType>(
  name: string,
  type: T,
  at: { group: number; binding: number },
  opts?: { precision?: 'highp' | 'mediump' | 'lowp' },
): Resource<T> {
  if (type.kind === 'struct' || type.kind === 'array')
    throw dslError('SD0016', `hostUniform '${name}': ${type.kind} — use hostBlock for a struct`)
  return {
    binding: {
      group: at.group,
      binding: at.binding,
      name,
      space: 'uniform',
      type,
      owner: 'host',
      ...(opts?.precision ? { precision: opts.precision } : {}),
    },
    node: bindingRef(name, type),
  }
}

/** Declare a host-owned uniform block: a whole struct of values the host supplies, from one
 *  declaration that works on both targets.
 *
 *  On WGSL a host-owned bind group is one unit: the host hands the module `@group(0)` and its
 *  layout is the authority. That is why a block is its own declaration and cannot be written
 *  as several {@link hostUniform} calls, which would describe a different program.
 *
 *  On WGSL it is an ordinary `@group(N) @binding(M) var<uniform>` block, which the shader
 *  still declares in order to read it, and {@link reflect} marks every entry `owner: 'host'`
 *  so a consumer knows not to build a layout for it.
 *
 *  On GLSL ES 3.00 the spelling is the caller's choice, because a GLSL host prelude provides
 *  one or the other and only the matching one links:
 *
 *  - `glsl: 'std140-block'` (the default) emits
 *    `layout(std140) uniform CameraUniforms { ... } u_camera;`.
 *  - `glsl: 'loose'` emits one `uniform mat4 u_matrix;` per member and rewrites every
 *    `u_camera.u_matrix` read to the bare `u_matrix`. The rewrite happens on the module's
 *    node graph before emit, so it cannot touch an unrelated substring, it survives
 *    `minify()`, and {@link reflect} still describes what was emitted.
 *
 *  A loose block's members must be scalars, vectors or matrices, because the default block
 *  has no spelling for a nested struct; this call checks it and throws SD0016. Their names
 *  must also be unique across every loose block in the module, since flattening puts them all
 *  in one namespace; a collision throws {@link UnsupportedFeatureError} at GLSL emit.
 *
 *  Exported from `@xgis/shader-dsl`.
 *
 *  @param typeName - the struct's type name, as the host spells it.
 *  @param at - the WGSL `group` and `binding` slot, and `as`, the block variable's name.
 *  @param fields - the members, in the host's declaration order.
 *  @param opts - `glsl` picks the GLSL spelling; `precision` is a GLSL-only qualifier applied
 *    to each member of a `'loose'` block (a std140 block takes the stage default).
 *  @returns the {@link UniformStruct} handle; `camera.field.u_matrix` is typed against the
 *    declared shape.
 *  @throws SD0016 when `glsl: 'loose'` is asked for a member the default block cannot spell.
 *
 *  @example
 *  ```ts
 *  import { hostBlock, mat4x4fT, vec2fT } from '@xgis/shader-dsl'
 *
 *  const camera = hostBlock('CameraUniforms', { group: 0, binding: 0, as: 'u_camera' }, {
 *    u_matrix: mat4x4fT,
 *    u_viewport_px: vec2fT,
 *  }, { glsl: 'loose' })
 *
 *  camera.field.u_matrix // typed against the declared shape
 *  ```
 *
 *  @see {@link hostUniform} for a single host-owned value.
 */
export function hostBlock<F extends Record<string, UniformFieldSpec>>(
  typeName: string,
  at: { group: number; binding: number; as: string },
  fields: F,
  opts?: { glsl?: 'std140-block' | 'loose'; precision?: 'highp' | 'mediump' | 'lowp' },
): UniformStruct<F> {
  const base = uniformStruct(typeName, at, fields)
  const glsl = opts?.glsl ?? 'std140-block'
  if (glsl === 'loose')
    for (const f of base.struct.fields)
      if (f.type.kind !== 'scalar' && f.type.kind !== 'vec' && f.type.kind !== 'mat')
        throw dslError(
          'SD0016',
          `hostBlock '${typeName}' member '${f.name}': ${f.type.kind} cannot be a loose uniform`,
        )
  return {
    ...base,
    binding: {
      ...base.binding,
      owner: 'host',
      glsl,
      ...(opts?.precision ? { precision: opts.precision } : {}),
    },
  }
}

/** The handle {@link storageBuffer} returns: a bound runtime-length `array<Element>` storage
 *  buffer. `.at(i)` is the element accessor. For a struct element (a {@link structDecl} or
 *  {@link ioStruct} handle) it returns the typed field proxy, `buf.at(i).p0`, with no `.of()`
 *  and no element-type argument; for a scalar element (`f32T`) it returns the element node.
 *
 *  Exported from `@xgis/shader-dsl`.
 */
export interface StorageBuffer<A> {
  /** The binding declaration, for `module({ bindings })`. */
  readonly binding: BindingDecl
  /** The raw binding access node for the whole array. */
  readonly node: Node
  /** The element struct's declaration, when the element was a struct handle, so that
   *  `module({ uses: [buf] })` registers the element struct too. */
  readonly elementDecl?: StructDecl
  /** Read element `i`: the typed field proxy for a struct element, the element node for a
   *  scalar or vector element. */
  at(i: ReadonlyNode<ScalarKey> | number): A
}

/** A struct ELEMENT handle (structDecl / ioStruct) — has a `.type` and a typed `.of(node)` proxy. */
type StructHandle = {
  readonly type: ShaderType
  readonly decl?: StructDecl
  of(node: ReadonlyNode): object
}

/** A storage buffer binding declared from its ELEMENT (a struct handle or a scalar type) in one place;
 *  derives the binding decl (space 'storage' + access), the access node, AND `.at(i)` element access. */
/** Re-map a read view's fields to their mutable twins — the element view of a
 *  `read_write` storage buffer. Homomorphic, so field optionality/readonly are kept;
 *  the raw `$` node stays ReadonlyNode (writes go through fields, not the whole value). */
type MutableView<V> = {
  [K in keyof V]: K extends '$' ? V[K] : V[K] extends ReadonlyNode<infer T> ? Node<T> : V[K]
}

// The element view's WRITE capability follows the declared ACCESS (#763 G2):
// `access: 'read'` hands out read views (`buf.at(i).p0.assign(…)` is a tsc error —
// it used to compile and die at the driver); `read_write` hands out mutable views.
/** Declare a bound `array<Element>` storage buffer from its element alone. The element is a
 *  struct handle ({@link structDecl} or {@link ioStruct}) or a scalar or vector shader type.
 *  The handle derives the binding declaration, the access node, and a typed `.at(i)`. The
 *  array is runtime-length, sized by whatever buffer the host binds, so it takes no count.
 *
 *  `.at(i)` returns the element's typed field proxy for a struct element, so `buf.at(i).p0` is
 *  a typed read with no `.of()` and no element-type argument. For a scalar element it returns
 *  the element node directly. `.binding` goes in `module({ bindings })`, or pass the handle in
 *  `uses`, which registers the element struct too.
 *
 *  `access` decides the element view's write capability at the type level: `'read'` hands out
 *  read-only fields, so `buf.at(i).p0.assign(...)` is a tsc error, and `'read_write'` hands
 *  out mutable ones.
 *
 *  WebGL2 has no storage buffers, so on GLSL ES 3.00 the array is emitted as a data texture
 *  and each read becomes a `texelFetch`. Nothing changes at the authoring site. This path
 *  only reads: a `read_write` binding throws {@link UnsupportedFeatureError} at GLSL emit, so
 *  a write is never silently dropped. A compute kernel's output takes the compute-to-fragment
 *  path; declare the kernel `portable: true`.
 *
 *  The host has one obligation the DSL cannot check for it: give that data texture the
 *  internal format matching the element. `array<u32>` becomes a `usampler2D` and wants
 *  R32UI, `array<i32>` an `isampler2D` and wants R32I, and the float case wants R32F. A
 *  texture whose format disagrees with its sampler type is merely incomplete, which raises
 *  nothing: `texelFetch` on it returns zero. Read the element off `reflect(m)`, whose
 *  per-binding `textureElem` reports it.
 *
 *  Carrying integers through an R32F texture and recovering them with `floatBitsToUint` is
 *  unsafe even though it usually works. GLSL ES 3.00 permits an implementation to flush any
 *  denormal to zero, and small integers are denormal f32 bit patterns (`1u` is 1.4e-45), so
 *  that route can legally lose values.
 *
 *  Exported from `@xgis/shader-dsl`.
 *
 *  @param name - the emitted binding name, which is also the name a host binds by.
 *  @param element - the array's element: a struct handle, or a scalar or vector type.
 *  @param at - the `group` and `binding` slot, and `access`, `'read'` or `'read_write'`.
 *  @returns the {@link StorageBuffer} handle described above.
 *
 *  @example
 *  ```ts
 *  import { storageBuffer, structDecl, u32T, vec2fT } from '@xgis/shader-dsl'
 *
 *  const ShapeSegment = structDecl('ShapeSegment', { kind: u32T, p0: vec2fT, p1: vec2fT })
 *  const segments = storageBuffer('segments', ShapeSegment, { group: 0, binding: 9, access: 'read' })
 *  const seg = segments.at(i)
 *  seg.p0 // Node<'vec2<f32>'>
 *
 *  const featIds = storageBuffer('feat_ids', u32T, { group: 0, binding: 0, access: 'read' })
 *  featIds.at(i) // Node<'u32'>: an SSBO read on WGSL, a texelFetch on GLSL
 *  ```
 *
 *  @see {@link reflect} for the element and dimension a host needs to create the texture.
 *  @see {@link arrayOf} for a fixed-length array field inside a uniform struct.
 */
export function storageBuffer<H extends StructHandle>(
  name: string,
  element: H,
  at: { group: number; binding: number; access: 'read' },
): StorageBuffer<ReturnType<H['of']>>
export function storageBuffer<H extends StructHandle>(
  name: string,
  element: H,
  at: { group: number; binding: number; access: 'read_write' },
): StorageBuffer<MutableView<ReturnType<H['of']>>>
export function storageBuffer<T extends ShaderType>(
  name: string,
  element: T,
  at: { group: number; binding: number; access: 'read' },
): StorageBuffer<ReadonlyNode<KeyOf<T>>>
export function storageBuffer<T extends ShaderType>(
  name: string,
  element: T,
  at: { group: number; binding: number; access: 'read_write' },
): StorageBuffer<Node<KeyOf<T>>>
export function storageBuffer(
  name: string,
  element: StructHandle | ShaderType,
  at: { group: number; binding: number; access: 'read' | 'read_write' },
): StorageBuffer<unknown> {
  const handle = typeof element === 'object' && 'of' in element ? element : undefined
  const elemType = handle ? handle.type : (element as ShaderType)
  const arr = arrayT(elemType)
  const node = bindingRef(name, arr)
  return {
    binding: {
      group: at.group,
      binding: at.binding,
      name,
      space: 'storage',
      access: at.access,
      type: arr,
    },
    node,
    ...(handle?.decl !== undefined ? { elementDecl: handle.decl } : {}),
    at: (i) => (handle ? handle.of(node.at(i, elemType)) : node.at(i, elemType)),
  }
}
