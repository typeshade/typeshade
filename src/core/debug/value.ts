// ═══ Shader DSL — shader-typed values, in and out (docs/debugging.md §4.3) ═══
//
// The CPU value model is deliberately untyped at runtime: a vector is a `number[]`, a matrix
// is a flat `number[]`, a struct is a plain object, so member mutation aliases the way the
// GPU's does. That is right for evaluating and wrong for two jobs a debugger has at its
// edges — taking a value a human wrote and proving it fits the declared type, and showing a
// value back in the types the author thinks in.
//
// Both live here, and both take the declared `ShaderType` rather than guessing from the
// value: `[0, 0, 0]` is a `vec3` or a three-element array depending only on what was
// declared, and a debugger that guessed would be right most of the time, which is the worst
// kind of wrong for a reference tool.

import type { CpuValue, CpuStruct } from '../cpu-runtime.js'
import type { ShaderType } from '../ir/types.js'
import { typeKey } from '../ir/types.js'
import type { StructDecl } from '../ir/nodes.js'

/** The zero of `type`, all the way down.
 *
 *  `zeroOf` in `cpu-runtime.ts` is the evaluator's version and stops where the evaluator can:
 *  a struct starts as `{}` because its fields arrive by assignment, and an array is not a
 *  shape it has to make. A debug session has the opposite need — an omitted uniform must read
 *  as something an author can inspect — so this one descends through struct fields and sized
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

/** Whether `type` has no zero a debug session can invent — a runtime-sized array, whose
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
          return `${key} has no field "${k}"; its fields are ${decl.fields.map((f) => f.name).join(', ')}`
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
 *  its results into it — `out[gid.x] = sum` has to land where the host can read it back, the
 *  same way `CpuModule.setBinding` binds the array itself. Copying here would make every
 *  storage write vanish into a temporary, which is a failure nothing downstream could see.
 *  The cost is that an array of structs keeps its elements exactly as given, with no
 *  zero-filling inside them; `shapeError` has already checked that each one fits. */
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
  return value
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
 *  unreadable — every f32 printer, WGSL's own included, writes `0.8`. So an `f32`-typed value
 *  is rendered at the shortest precision whose `Math.fround` is the same f32. An `f64` value
 *  keeps its full precision, because there the extra digits are the answer rather than noise.
 *
 *  Exported from `@xgis/shader-dsl/debug`.
 *
 *  @param value - the value to render.
 *  @param type - its declared type; omit when the caller has none.
 *  @param structs - the module's struct declarations, so a struct's FIELDS render at their own
 *    declared types rather than falling back to their JavaScript shapes. Omit and a struct
 *    still renders by field name, one level less precisely.
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
): string {
  if (type === undefined) return formatUntyped(value)
  switch (type.kind) {
    case 'scalar':
      if (type.scalar === 'bool') return String(value)
      return type.scalar === 'f32' ? f32Text(value as number) : numText(value as number)
    case 'f64':
      return numText(value as number)
    case 'vec':
      return `vec${type.n}(${(value as number[]).map((v) => elemText(v, type.elem)).join(', ')})`
    case 'vec64':
      return `vec${type.n}<f64>(${(value as number[]).map(numText).join(', ')})`
    case 'mat': {
      const m = value as number[]
      const cols: string[] = []
      for (let c = 0; c < type.n; c++) {
        const col = m.slice(c * type.n, c * type.n + type.n)
        cols.push(`(${col.map((v) => elemText(v, type.elem)).join(', ')})`)
      }
      return `mat${type.n}x${type.n}${cols.join('')}`
    }
    case 'struct': {
      const o = value as CpuStruct
      const fields = structs?.get(type.name)?.fields
      const body = Object.keys(o)
        .map((k) => {
          const ft = fields?.find((f) => f.name === k)?.type
          return `${k}: ${ft ? formatCpuValue(o[k]!, ft, structs) : formatUntyped(o[k]!)}`
        })
        .join(', ')
      return `${type.name} { ${body} }`
    }
    case 'array': {
      const xs = value as CpuValue[]
      return `[${xs.map((v) => formatCpuValue(v, type.elem, structs)).join(', ')}]`
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

const elemText = (v: number, elem: string): string => (elem === 'f32' ? f32Text(v) : numText(v))

function numText(v: number): string {
  if (Number.isNaN(v)) return 'NaN'
  if (v === Infinity) return 'inf'
  if (v === -Infinity) return '-inf'
  if (Object.is(v, -0)) return '-0'
  return String(v)
}

/** The shortest decimal that rounds to the same f32. */
function f32Text(v: number): string {
  if (!Number.isFinite(v) || Object.is(v, -0)) return numText(v)
  const exact = Math.fround(v)
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
 *  Exported from `@xgis/shader-dsl/debug`.
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
export function createValueFormatter(m: {
  readonly structs: readonly StructDecl[]
}): (value: CpuValue, type?: ShaderType) => string {
  const structs = new Map(m.structs.map((s) => [s.name, s]))
  return (value, type) => formatCpuValue(value, type, structs)
}
