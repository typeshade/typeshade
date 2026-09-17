// ═══ Shader DSL: shader-typed values, in and out (docs/debugging.md §4.3) ═══
//
// The CPU value model is deliberately untyped at runtime: a vector is a `number[]`, a matrix
// is a flat `number[]`, a struct is a plain object, so member mutation aliases the way the
// GPU's does. That is right for evaluating and wrong for two jobs a debugger has at its
// edges: taking a value a human wrote and proving it fits the declared type, and showing a
// value back in the types the author thinks in.
//
// Both live here, and both take the declared `ShaderType` rather than guessing from the
// value: `[0, 0, 0]` is a `vec3` or a three-element array depending only on what was
// declared, and a debugger that guessed would be right most of the time, which is the worst
// kind of wrong for a reference tool.

import type { CpuValue, CpuStruct } from '../cpu-runtime.js'
import type { ShaderType } from '../ir/types.js'
import type { CpuPrecision } from '../oracle.js'
import { typeKey } from '../ir/types.js'
import type { StructDecl } from '../ir/nodes.js'

/** The zero of `type`, all the way down.
 *
 *  `zeroOf` in `cpu-runtime.ts` is the evaluator's version and stops where the evaluator can:
 *  a struct starts as `{}` because its fields arrive by assignment, and an array is not a
 *  shape it has to make. A debug session has the opposite need, since an omitted uniform must
 *  read as something an author can inspect, so this one descends through struct fields and sized
 *  arrays.
 *
 *  A runtime-sized array (`storage<array<f32>>`) has no zero: its length is the host's
 *  buffer, which a CPU run does not have. {@link resolveBindings} names such a binding rather
 *  than standing in an empty array whose every read would be `undefined`.
 */
export function zeroValueOf(type: ShaderType, structs: ReadonlyMap<string, StructDecl>): CpuValue {
  switch (type.kind) {
    case 'scalar':
      return type.scalar === 'bool' ? false : 0
    case 'f64':
      return 0
    case 'vec':
    case 'vec64':
      return new Array<number>(type.n).fill(0)
    case 'mat':
      return new Array<number>(type.n * type.n).fill(0)
    case 'struct': {
      const decl = structs.get(type.name)
      if (!decl) return {}
      const out: CpuStruct = {}
      for (const f of decl.fields) out[f.name] = zeroValueOf(f.type, structs)
      return out
    }
    case 'array': {
      if (type.size === undefined) return []
      // `CpuValue` spells an array as `number[]`, so a nested one (`array<vec2, N>`) needs the
      // same cast `oracle.ts`'s own `construct` case makes: the runtime shape is an array of
      // whatever the element evaluates to, and the type does not say so.
      return Array.from({ length: type.size }, () =>
        zeroValueOf(type.elem, structs),
      ) as unknown as CpuValue
    }
    default:
      return 0
  }
}

/** Whether `type` has no zero a debug session can invent: a runtime-sized array, whose
 *  length only the host's buffer knows. */
export const isUnsized = (type: ShaderType): boolean =>
  type.kind === 'array' && type.size === undefined

/** What a value failed to be, as a sentence naming both shapes. `undefined` when it fits. */
export function shapeError(
  value: unknown,
  type: ShaderType,
  structs: ReadonlyMap<string, StructDecl>,
): string | undefined {
  const key = typeKey(type)
  const got = describe(value)
  switch (type.kind) {
    case 'scalar':
      if (type.scalar === 'bool') {
        return typeof value === 'boolean' ? undefined : `expected ${key} (a boolean), got ${got}`
      }
      return typeof value === 'number' ? undefined : `expected ${key} (a number), got ${got}`
    case 'f64':
      return typeof value === 'number' ? undefined : `expected ${key} (a number), got ${got}`
    case 'vec':
    case 'vec64':
      return numericArray(value, type.n, `${key} (${type.n} numbers)`, got)
    case 'mat':
      return numericArray(
        value,
        type.n * type.n,
        `${key} (${type.n * type.n} numbers, column-major)`,
        got,
      )
    case 'struct': {
      if (typeof value !== 'object' || value === null || Array.isArray(value))
        return `expected ${key} (an object keyed by field name), got ${got}`
      const decl = structs.get(type.name)
      if (!decl) return undefined
      const known = new Set(decl.fields.map((f) => f.name))
      for (const k of Object.keys(value)) {
        if (!known.has(k))
          // `type.name`, not `typeKey(type)`: the author wrote `Camera`, and `struct:Camera` is
          // an internal spelling that means nothing to the person reading the message.
          return `${type.name} has no field "${k}"; its fields are ${decl.fields.map((f) => f.name).join(', ')}`
      }
      for (const f of decl.fields) {
        const v = (value as CpuStruct)[f.name]
        if (v === undefined) continue // absent fields are zero-filled, not an error
        const inner = shapeError(v, f.type, structs)
        if (inner) return `field "${f.name}": ${inner}`
      }
      return undefined
    }
    case 'array': {
      if (!Array.isArray(value)) return `expected ${key} (an array), got ${got}`
      if (type.size !== undefined && value.length !== type.size)
        return `expected ${key} (${type.size} elements), got an array of ${value.length}`
      for (let i = 0; i < value.length; i++) {
        const inner = shapeError(value[i], type.elem, structs)
        if (inner) return `element ${i}: ${inner}`
      }
      return undefined
    }
    default:
      return undefined
  }
}

/** A value that fits `type`, with any absent struct field filled in with its zero. Call it
 *  only after {@link shapeError} has returned `undefined` for the same pair.
 *
 *  An ARRAY IS RETURNED AS IT WAS GIVEN, identity included, and that is load-bearing rather
 *  than an optimisation: a storage binding is the caller's own buffer, and a debug run writes
 *  its results into it: `out[gid.x] = sum` has to land where the host can read it back, the
 *  same way `CpuModule.setBinding` binds the array itself. Copying here would make every
 *  storage write vanish into a temporary, which is a failure nothing downstream could see.
 *  So an array of structs is filled IN PLACE, element by element, rather than rebuilt: the
 *  array object the caller passed is still the array the run writes into, and each element is
 *  replaced by a complete one. The claim this comment used to make, that `shapeError` had
 *  already checked each element, was wrong in the direction that matters: `shapeError` permits
 *  a missing struct field precisely because this function is supposed to fill it, so
 *  `[{ pos: [1,2,3] }]` against `array<Light, 1>` was accepted and every unsupplied field
 *  reached the evaluator as `undefined`, which reads out of the run as `undefined` rather than
 *  as anything a type could explain. */
export function coerceValue(
  value: CpuValue,
  type: ShaderType,
  structs: ReadonlyMap<string, StructDecl>,
): CpuValue {
  if (type.kind === 'struct') {
    const decl = structs.get(type.name)
    if (!decl) return value
    const given = value as CpuStruct
    const out: CpuStruct = {}
    for (const f of decl.fields) {
      out[f.name] =
        given[f.name] === undefined
          ? zeroValueOf(f.type, structs)
          : coerceValue(given[f.name]!, f.type, structs)
    }
    return out
  }
  if (type.kind === 'array' && Array.isArray(value)) {
    // In place, for the identity reason above. Only where an element can actually need
    // filling, so an array of scalars or vectors is left untouched rather than walked.
    if (elementNeedsFilling(type.elem, structs)) {
      const arr = value as CpuValue[]
      for (let i = 0; i < arr.length; i++) arr[i] = coerceValue(arr[i]!, type.elem, structs)
    }
    return value
  }
  return value
}

/** Whether an element of this type can carry an absent field that {@link coerceValue} fills.
 *  A scalar, vector or matrix cannot, and walking a large storage array of them for nothing is
 *  the cost this avoids. */
function elementNeedsFilling(t: ShaderType, structs: ReadonlyMap<string, StructDecl>): boolean {
  if (t.kind === 'struct') return structs.has(t.name)
  if (t.kind === 'array') return elementNeedsFilling(t.elem, structs)
  return false
}

const describe = (v: unknown): string => {
  if (v === null) return 'null'
  if (Array.isArray(v)) return `an array of ${v.length}`
  if (typeof v === 'object') return 'an object'
  return `${typeof v} ${JSON.stringify(v)}`
}

function numericArray(value: unknown, n: number, want: string, got: string): string | undefined {
  if (!Array.isArray(value)) return `expected ${want}, got ${got}`
  if (value.length !== n) return `expected ${want}, got an array of ${value.length}`
  const bad = value.findIndex((x) => typeof x !== 'number')
  return bad === -1 ? undefined : `expected ${want}, but element ${bad} is ${describe(value[bad])}`
}

/** Render a {@link CpuValue} the way the author spelled its type.
 *
 *  A debugger's variables view is where the CPU value model stops being an implementation
 *  detail: `[0.5, 0.5, 1]` is a JavaScript array, and what the author wrote is a `vec3`. With
 *  the declared type in hand this renders `vec3(0.5, 0.5, 1)`, a `mat4` as its four columns,
 *  and a struct by field name. Without one it falls back to the value's own shape, which is
 *  what a caller holding an untyped local has.
 *
 *  **f32 values print as the shortest decimal that round-trips.** The f32 nearest `0.8` is
 *  `0.800000011920929` as a double, and showing that is technically exact and practically
 *  unreadable, since every f32 printer, WGSL's own included, writes `0.8`. So an `f32` value
 *  is rendered at the shortest precision whose `Math.fround` is the same f32. An `f64` value
 *  keeps its full precision, because there the extra digits are the answer rather than noise.
 *
 *  **Except under `precision: 'f64'`,** which is why this takes the session's precision. That
 *  mode is the algebra oracle (§1.3): its numbers are doubles that happen to sit in `f32`-typed
 *  slots, and shortening one to the nearest f32 would print `16777216` for a value the session
 *  computed as `16777217`. Rounding a number for display is only honest when the number really
 *  is an f32.
 *
 *  Exported from `typeshade/debug`.
 *
 *  @param value - the value to render.
 *  @param type - its declared type; omit when the caller has none.
 *  @param structs - the module's struct declarations, so a struct's FIELDS render at their own
 *    declared types rather than falling back to their JavaScript shapes. Omit and a struct
 *    still renders by field name, one level less precisely.
 *  @param precision - the session's precision. Defaults to `'f32'`, which is
 *    {@link DebugSessionOptions.precision}'s own default; pass `'f64'` so an f32-typed value
 *    keeps every digit the f64 run produced.
 *  @returns a one-line rendering in the authoring surface's own spelling.
 *
 *  @example
 *  ```ts
 *  formatCpuValue([0.800000011920929, 0, 0, 1], vec4fT) // 'vec4(0.8, 0, 0, 1)'
 *  ```
 */
export function formatCpuValue(
  value: CpuValue,
  type?: ShaderType,
  structs?: ReadonlyMap<string, StructDecl>,
  precision: CpuPrecision = 'f32',
): string {
  if (type === undefined) return formatUntyped(value)
  const elem = (v: number, e: string): string =>
    e === 'f32' && precision === 'f32' ? f32Text(v) : numText(v)
  switch (type.kind) {
    case 'scalar':
      if (type.scalar === 'bool') return String(value)
      return type.scalar === 'f32' ? elem(value as number, 'f32') : numText(value as number)
    case 'f64':
      return numText(value as number)
    case 'vec':
      return `vec${type.n}(${(value as number[]).map((v) => elem(v, type.elem)).join(', ')})`
    case 'vec64':
      return `vec${type.n}<f64>(${(value as number[]).map(numText).join(', ')})`
    case 'mat': {
      const m = value as number[]
      const cols: string[] = []
      for (let c = 0; c < type.n; c++) {
        const col = m.slice(c * type.n, c * type.n + type.n)
        cols.push(`col${c}(${col.map((v) => elem(v, type.elem)).join(', ')})`)
      }
      // `col0(...)col1(...)`, because the bare `(...)(...)` this used to print gave a reader
      // no way to know that the groups are COLUMNS rather than rows, and the difference is a
      // transpose. The `<f64>` says which element type, since an f64 matrix is stored the same
      // way and rendered identically otherwise.
      const of = type.elem === 'f64' ? '<f64>' : ''
      return `mat${type.n}x${type.n}${of}${cols.join('')}`
    }
    case 'struct': {
      const o = value as CpuStruct
      const fields = structs?.get(type.name)?.fields
      // Declared order when the declaration is in hand, so two values of one struct render
      // comparably and a field the value happens to lack is visibly missing rather than
      // silently skipped. The value's own key order is the fallback.
      const keys = fields ? fields.map((f) => f.name) : Object.keys(o)
      const body = keys
        .map((k) => {
          const ft = fields?.find((f) => f.name === k)?.type
          const v = o[k]
          if (v === undefined) return `${k}: <missing>`
          return `${k}: ${ft ? formatCpuValue(v, ft, structs, precision) : formatUntyped(v)}`
        })
        .join(', ')
      return `${type.name} { ${body} }`
    }
    case 'array': {
      const xs = value as CpuValue[]
      return `[${xs.map((v) => formatCpuValue(v, type.elem, structs, precision)).join(', ')}]`
    }
    default:
      return formatUntyped(value)
  }
}

function formatUntyped(value: CpuValue): string {
  if (typeof value === 'number') return numText(value)
  if (typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return `[${value.map((v) => formatUntyped(v as CpuValue)).join(', ')}]`
  if (value === undefined || value === null) return String(value)
  const o = value as CpuStruct
  return `{ ${Object.keys(o)
    .map((k) => `${k}: ${formatUntyped(o[k]!)}`)
    .join(', ')} }`
}

function numText(v: number): string {
  if (Number.isNaN(v)) return 'NaN'
  if (v === Infinity) return 'inf'
  if (v === -Infinity) return '-inf'
  if (Object.is(v, -0)) return '-0'
  return String(v)
}

/** The shortest decimal that rounds to the same f32.
 *
 *  A value that UNDERFLOWS to zero keeps its sign: `-1e-50` is `-0` as an f32, and printing it
 *  as `0` would hide the one thing left of it. `Math.fround` preserves the sign, but
 *  `toPrecision` on the result does not always, so the sign is put back explicitly. */
function f32Text(v: number): string {
  if (!Number.isFinite(v) || Object.is(v, -0)) return numText(v)
  const exact = Math.fround(v)
  if (exact === 0) return numText(Object.is(exact, -0) || v < 0 ? -0 : 0)
  for (let p = 1; p <= 9; p++) {
    const text = exact.toPrecision(p)
    if (Math.fround(Number(text)) === exact) return numText(Number(text))
  }
  return numText(exact)
}

/** A {@link formatCpuValue} with `m`'s struct declarations already bound.
 *
 *  What an adapter actually wants: it holds the module, and every value it renders comes from
 *  that module, so threading the struct table through each call is ceremony. A debug adapter
 *  builds one of these per session and calls it for every row of its variables view.
 *
 *  Exported from `typeshade/debug`.
 *
 *  @param m - the module whose values will be rendered.
 *  @returns a formatter taking a value and its declared type.
 *
 *  @example
 *  ```ts
 *  const show = createValueFormatter(module)
 *  for (const [name, v] of pause.frames[0]!.locals) {
 *    console.log(`${name} = ${show(v, pause.frames[0]!.localTypes.get(name))}`)
 *  }
 *  ```
 */
export function createValueFormatter(
  m: { readonly structs: readonly StructDecl[] },
  precision: CpuPrecision = 'f32',
): (value: CpuValue, type?: ShaderType) => string {
  const structs = new Map(m.structs.map((s) => [s.name, s]))
  return (value, type) => formatCpuValue(value, type, structs, precision)
}
