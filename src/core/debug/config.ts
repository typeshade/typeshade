// ═══ Shader DSL — one launch configuration, three carriers (docs/debugging.md §4) ═══
//
// The same object describes a debug run whether it arrives as a `launch.json` entry in an
// IDE, a form in the Playground, or an argument to a headless test. It is defined here, with
// the resolver beside it, so the extension's `launch.json` contribution and the Playground's
// form cannot drift from each other or from the engine: both hand this module the object and
// take back a started session.
//
// THE INVOCATION IS KEYED BY WGSL BUILTIN ID, not by three per-stage shapes. The grammar
// (`docs/use-typeshade-surface.md` §3) already makes a stage input an explicit parameter
// carrying `@builtin(...)` or `@location(n)`, and `reflect()` reports them that way. Keying
// the configuration the same way means the resolver validates it against the entry's own
// declarations rather than against a hand-written table per stage, so an unknown key is an
// error naming the builtins the entry actually declares, and a new builtin needs no change
// here.

import type { CpuValue } from '../cpu-runtime.js'
import type { FuncDecl, ModuleDecl, StructDecl } from '../ir/nodes.js'
import { stageOf, workgroupSizeOf } from '../ir/nodes.js'
import type { ShaderType } from '../ir/types.js'
import { typeKey } from '../ir/types.js'
import type { CpuPrecision } from '../oracle.js'
import type { DebugBreakpoint, DebugSession } from './session.js'
import { startDebugSession } from './session.js'
import { coerceValue, isUnsized, shapeError, zeroValueOf } from './value.js'

/** One invocation's inputs, keyed the way the shader declares them.
 *
 *  Builtin inputs are named by their WGSL id — `vertex_index`, `position`,
 *  `global_invocation_id` — at the top level. Everything else, a `@location(n)` vertex
 *  attribute or an interpolated varying, goes in `inputs` under the parameter's or the struct
 *  field's own name.
 *
 *  Anything omitted reads as the zero of its type, which is what the Playground's "Run on the
 *  CPU" does today, so an invocation names only the inputs it cares about.
 *
 *  For a `@compute` entry, supplying `global_invocation_id` alone is the common case, so
 *  `workgroup_id`, `local_invocation_id` and `local_invocation_index` are **derived** from it
 *  and the entry's declared workgroup size rather than left at zero. Supplying one of them
 *  explicitly overrides the derivation; supplying one that contradicts it is an error rather
 *  than a silent pick, because a wrong invocation id makes a whole debugging session lie.
 *
 *  Exported from `@xgis/shader-dsl/debug`.
 */
export interface DebugInvocation {
  /** Builtin inputs by WGSL id. A `vecN` builtin is a flat array, a scalar one a number. */
  readonly [builtin: string]: CpuValue | DebugInputs | undefined
  /** Non-builtin stage inputs, by parameter name or entry-IO struct field name. */
  readonly inputs?: DebugInputs
}

/** `@location(n)` stage inputs by name — a vertex attribute, an interpolated varying.
 *
 *  Exported from `@xgis/shader-dsl/debug`.
 */
export interface DebugInputs {
  readonly [name: string]: CpuValue
}

/** A debug run, as an IDE's `launch.json` entry, a Playground form, or a test's argument.
 *
 *  `entry` is the only required field. Everything else has a default, and the default is the
 *  zero of its type.
 *
 *  The first four fields are the launch envelope an IDE fills in and the engine ignores; they
 *  are declared so that one schema describes the whole file a user edits, rather than the
 *  engine's half of it. {@link DEBUG_LAUNCH_SCHEMA} is the same shape as JSON Schema, for an
 *  extension to contribute verbatim.
 *
 *  Exported from `@xgis/shader-dsl/debug`.
 */
export interface DebugLaunchConfig {
  /** The debug type an IDE dispatches on. Always `'typeshade'`; ignored by the engine. */
  readonly type?: 'typeshade'
  /** `'launch'` — attaching to a running shader is not a thing that exists. Ignored here. */
  readonly request?: 'launch'
  /** The configuration's display name in the IDE. Ignored here. */
  readonly name?: string
  /** The `.shade.ts` file. The engine is handed a compiled module, so it ignores this; an
   *  adapter reads it to know what to compile.
   *
   *  An adapter should also hand it back to the compiler as `CompileOptions.fileName`. That is
   *  what makes the module's spans name this file, and a {@link DebugBreakpoint} carrying a
   *  path is matched against those spans: compiled without it, every span says
   *  `typeshade-input.ts` and a file-qualified breakpoint arms nothing. */
  readonly program?: string
  /** The entry point to invoke, by name. Required. */
  readonly entry: string
  /** Stop before the entry's first statement. Default `true`; `false` runs to the first
   *  breakpoint instead. */
  readonly stopOnEntry?: boolean
  /** What the arithmetic means. Default `'f32'` — see {@link DebugSessionOptions.precision}. */
  readonly precision?: CpuPrecision
  /** What a screen-space derivative reads as. `'zero'` accepts the stub value and marks it
   *  as a stand-in ({@link DebugSession.stubbedIntrinsics}); `'quad'` is the 2×2 evaluation
   *  `docs/debugging.md` decision 4 defers, and asking for it is an error naming that
   *  decision rather than a silent fallback to zero. Omitted, a derivative throws. */
  readonly derivatives?: 'zero' | 'quad'
  /** This invocation's inputs. */
  readonly invocation?: DebugInvocation
  /** Uniform and storage values by declared name, in the CPU value model: a number for a
   *  scalar, a flat array for a vector or matrix (column-major), an object keyed by field
   *  name for a struct, an array for an array. An omitted binding reads as its zero, except a
   *  runtime-sized array, which has none. */
  readonly bindings?: Readonly<Record<string, CpuValue>>
  /** Breakpoints to arm before the run starts. */
  readonly breakpoints?: readonly DebugBreakpoint[]
}

/** Everything wrong with a configuration, as sentences, before anything runs.
 *
 *  Exported from `@xgis/shader-dsl/debug`.
 */
export class DebugConfigError extends Error {
  /** One sentence per problem, in the order they were found. */
  readonly problems: readonly string[]
  constructor(problems: readonly string[]) {
    super(`shader-dsl/debug: ${problems.join('; ')}`)
    this.name = 'DebugConfigError'
    this.problems = problems
  }
}

/** The WGSL compute builtins this resolver derives from `global_invocation_id`. */
const DERIVED = ['workgroup_id', 'local_invocation_id', 'local_invocation_index'] as const

/** Start a stepped run from a launch configuration.
 *
 *  This is the one call an adapter makes. It resolves the invocation into the entry's
 *  positional arguments, checks every binding against its declared type, applies the
 *  configuration's precision and derivative policy, and hands back a session already stopped
 *  on the entry's first statement (or on the first breakpoint, with `stopOnEntry: false`).
 *
 *  Every problem it can see is reported together, before the shader runs a single statement,
 *  as a {@link DebugConfigError} listing them: a misspelled builtin alongside a uniform of the
 *  wrong shape, rather than one error per attempt.
 *
 *  Exported from `@xgis/shader-dsl/debug`.
 *
 *  @param m - the module to run, as `compile()` produced it.
 *  @param config - the run to start.
 *  @returns the session, already stopped.
 *  @throws {@link DebugConfigError} when the configuration does not fit the module.
 *
 *  @example
 *  ```ts
 *  import { compile } from '@xgis/shader-dsl'
 *  import { startDebugSessionFromConfig } from '@xgis/shader-dsl/debug'
 *
 *  const { module } = compile(src)
 *  const s = startDebugSessionFromConfig(module, {
 *    entry: 'fs',
 *    invocation: { position: [100.5, 50.5, 0, 1], inputs: { uv: [0.5, 0.25] } },
 *    bindings: { camera: { pos: [0, 0, 5] } },
 *  })
 *  ```
 *
 *  @see {@link startDebugSession} for the lower-level call this wraps.
 *  @see {@link DEBUG_LAUNCH_SCHEMA} for the same shape as JSON Schema.
 */
export function startDebugSessionFromConfig(
  m: ModuleDecl,
  config: DebugLaunchConfig,
): DebugSession {
  const problems: string[] = []
  const structs = new Map(m.structs.map((s) => [s.name, s]))
  const decl = m.funcs.find((f) => f.name === config.entry)
  if (!decl) {
    const names = m.funcs.map((f) => f.name).join(', ')
    throw new DebugConfigError([
      `no function "${config.entry}" in module; it declares ${names || 'none'}`,
    ])
  }
  if (config.derivatives === 'quad') {
    problems.push(
      "derivatives: 'quad' is not implemented — docs/debugging.md decision 4 defers the 2×2 " +
        "quad evaluation, so 'zero' is the only mode that exists today",
    )
  }

  const args = resolveInvocation(decl, config.invocation ?? {}, structs, problems)
  const bindings = resolveBindings(m, config.bindings ?? {}, structs, problems)
  if (problems.length > 0) throw new DebugConfigError(problems)

  return startDebugSession(m, config.entry, args, {
    precision: config.precision,
    gpuStubs: config.derivatives === 'zero',
    bindings,
    breakpoints: config.breakpoints,
    stopOnEntry: config.stopOnEntry,
  })
}

/** The entry's parameters, positionally, from an invocation keyed by builtin id and name.
 *
 *  Exported from `@xgis/shader-dsl/debug`.
 *
 *  @param decl - the entry point.
 *  @param invocation - the inputs, as {@link DebugInvocation} describes them.
 *  @param structs - the module's struct declarations, for a struct-typed parameter.
 *  @param problems - collected here rather than thrown, so a caller can report every fault at
 *    once; pass a fresh array and check it.
 *  @returns one {@link CpuValue} per declared parameter, in declaration order.
 */
export function resolveInvocation(
  decl: FuncDecl,
  invocation: DebugInvocation,
  structs: ReadonlyMap<string, StructDecl>,
  problems: string[],
): CpuValue[] {
  const declared = declaredBuiltins(decl, structs)
  const supplied = { ...invocation }
  delete (supplied as Record<string, unknown>).inputs

  // A misspelled builtin is the failure this catches: `globalInvocationId` would otherwise
  // sit in the object doing nothing while the shader read zeros.
  for (const key of Object.keys(supplied)) {
    if (!declared.has(key)) {
      const list = [...declared.keys()].sort().join(', ')
      problems.push(
        `"${key}" is not a builtin this entry declares; ${decl.name} declares ${list || 'none'}` +
          ` (a @location input goes under "inputs")`,
      )
    }
  }

  const resolved = new Map<string, CpuValue>()
  for (const [id, type] of declared) {
    const given = supplied[id] as CpuValue | undefined
    if (given === undefined) continue
    const bad = shapeError(given, type, structs)
    if (bad) problems.push(`builtin "${id}": ${bad}`)
    else resolved.set(id, coerceValue(given, type, structs))
  }
  deriveComputeIds(decl, declared, resolved, problems, structs)

  const inputs = invocation.inputs ?? {}
  const inputNames = declaredInputs(decl, structs)
  for (const name of Object.keys(inputs)) {
    if (!inputNames.has(name)) {
      const list = [...inputNames.keys()].sort().join(', ')
      problems.push(
        `"${name}" is not an input this entry declares; ${decl.name} takes ${list || 'none'}`,
      )
    }
  }
  for (const [name, type] of inputNames) {
    const given = inputs[name]
    if (given === undefined) continue
    const bad = shapeError(given, type, structs)
    if (bad) problems.push(`input "${name}": ${bad}`)
    else resolved.set(inputKey(name), coerceValue(given, type, structs))
  }

  return decl.params.map((p) => {
    if (p.builtin) return resolved.get(p.builtin) ?? zeroValueOf(p.type, structs)
    if (p.type.kind === 'struct') {
      const sd = structs.get(p.type.name)
      if (!sd) return zeroValueOf(p.type, structs)
      const out: Record<string, CpuValue> = {}
      for (const f of sd.fields) {
        const hit = f.builtin ? resolved.get(f.builtin) : resolved.get(inputKey(f.name))
        out[f.name] = hit ?? zeroValueOf(f.type, structs)
      }
      return out
    }
    return resolved.get(inputKey(p.name)) ?? zeroValueOf(p.type, structs)
  })
}

/** `local_invocation_id`, `workgroup_id` and `local_invocation_index` from
 *  `global_invocation_id` and the entry's declared workgroup size — unless the caller gave
 *  one, in which case the given value wins and a contradiction is reported. */
function deriveComputeIds(
  decl: FuncDecl,
  declared: ReadonlyMap<string, ShaderType>,
  resolved: Map<string, CpuValue>,
  problems: string[],
  structs: ReadonlyMap<string, StructDecl>,
): void {
  if (stageOf(decl) !== 'compute') return
  const gid = resolved.get('global_invocation_id') as number[] | undefined
  if (gid === undefined) return
  // The backend carries the x axis only (`WORKGROUP_SHAPE` rejects a y or z other than 1), so
  // the other two extents are 1 and the derivation is exact rather than approximate.
  const size = [workgroupSizeOf(decl) ?? 64, 1, 1]
  const local = gid.map((v, i) => ((v % size[i]!) + size[i]!) % size[i]!)
  const group = gid.map((v, i) => Math.floor(v / size[i]!))
  const index = local[0]! + local[1]! * size[0]! + local[2]! * size[0]! * size[1]!
  const derivation: Record<(typeof DERIVED)[number], CpuValue> = {
    workgroup_id: group,
    local_invocation_id: local,
    local_invocation_index: index,
  }
  for (const id of DERIVED) {
    if (!declared.has(id)) continue
    const given = resolved.get(id)
    if (given === undefined) {
      resolved.set(id, derivation[id])
      continue
    }
    if (!sameValue(given, derivation[id])) {
      problems.push(
        `"${id}" is ${JSON.stringify(given)}, but global_invocation_id ` +
          `${JSON.stringify(gid)} with @compute([${size.join(', ')}]) derives ` +
          `${JSON.stringify(derivation[id])}; supply one or the other, not a pair that disagrees`,
      )
    }
  }
  void structs
}

const sameValue = (a: CpuValue, b: CpuValue): boolean =>
  Array.isArray(a) && Array.isArray(b)
    ? a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
    : Object.is(a, b)

/** Namespaced so a `@location` input named `position` cannot collide with the builtin. */
const inputKey = (name: string): string => ` in:${name}`

/** Every `@builtin(...)` this entry reads, by WGSL id, with the type it is declared at. */
function declaredBuiltins(
  decl: FuncDecl,
  structs: ReadonlyMap<string, StructDecl>,
): ReadonlyMap<string, ShaderType> {
  const out = new Map<string, ShaderType>()
  for (const p of decl.params) {
    if (p.builtin) {
      out.set(p.builtin, p.type)
      continue
    }
    if (p.type.kind === 'struct') {
      for (const f of structs.get(p.type.name)?.fields ?? []) {
        if (f.builtin) out.set(f.builtin, f.type)
      }
    }
  }
  return out
}

/** Every non-builtin stage input, by the name an invocation spells it under. */
function declaredInputs(
  decl: FuncDecl,
  structs: ReadonlyMap<string, StructDecl>,
): ReadonlyMap<string, ShaderType> {
  const out = new Map<string, ShaderType>()
  for (const p of decl.params) {
    if (p.builtin) continue
    if (p.type.kind === 'struct') {
      for (const f of structs.get(p.type.name)?.fields ?? []) {
        if (!f.builtin) out.set(f.name, f.type)
      }
      continue
    }
    out.set(p.name, p.type)
  }
  return out
}

/** The module's bindings by declared name, checked against their declared types.
 *
 *  An omitted binding reads as the zero of its type. A runtime-sized array has no zero — its
 *  length is the host's buffer — so omitting one is an error naming it rather than an empty
 *  array whose every read would be `undefined`. A texture or sampler binding is refused
 *  outright: a CPU run has no texture memory, and `docs/debugging.md` §4.4 specifies the
 *  shapes for when the language surface grows them.
 *
 *  Exported from `@xgis/shader-dsl/debug`.
 *
 *  @param m - the module whose bindings are being filled.
 *  @param given - the values, by declared name.
 *  @param structs - the module's struct declarations.
 *  @param problems - collected rather than thrown, as in {@link resolveInvocation}.
 *  @returns every binding the module declares, with a value.
 */
export function resolveBindings(
  m: ModuleDecl,
  given: Readonly<Record<string, CpuValue>>,
  structs: ReadonlyMap<string, StructDecl>,
  problems: string[],
): Record<string, CpuValue> {
  const declared = new Map(m.bindings.map((b) => [b.name, b.type]))
  for (const name of Object.keys(given)) {
    if (!declared.has(name)) {
      const list = [...declared.keys()].sort().join(', ')
      problems.push(
        `"${name}" is not a binding this module declares; it declares ${list || 'none'}`,
      )
    }
  }
  const out: Record<string, CpuValue> = {}
  for (const [name, type] of declared) {
    if (type.kind === 'texture' || type.kind === 'sampler') {
      problems.push(
        `binding "${name}" is a ${typeKey(type)}, which a CPU run cannot supply — texture and ` +
          'sampler values are unsupported in this milestone (docs/debugging.md §4.4)',
      )
      continue
    }
    const value = given[name]
    if (value === undefined) {
      if (isUnsized(type)) {
        problems.push(
          `binding "${name}" is ${typeKey(type)}, whose length only the host's buffer knows, ` +
            'so it has no zero to stand in — supply a value for it',
        )
        continue
      }
      out[name] = zeroValueOf(type, structs)
      continue
    }
    const bad = shapeError(value, type, structs)
    if (bad) problems.push(`binding "${name}": ${bad}`)
    else out[name] = coerceValue(value, type, structs)
  }
  return out
}

/** {@link DebugLaunchConfig} as JSON Schema, for an IDE extension to contribute as its
 *  `launch.json` shape without restating it.
 *
 *  It is a value rather than a file on disk on purpose: a contributed schema that is a copy
 *  drifts from the resolver the first time either moves, and `config.test.ts` holds this one
 *  to the resolver by checking that its property set and the interface's agree.
 *
 *  Exported from `@xgis/shader-dsl/debug`.
 */
export const DEBUG_LAUNCH_SCHEMA: Readonly<Record<string, unknown>> = Object.freeze({
  type: 'object',
  required: ['entry'],
  properties: {
    type: { type: 'string', const: 'typeshade', description: 'The debug type.' },
    request: { type: 'string', const: 'launch', description: 'Always a launch.' },
    name: { type: 'string', description: 'This configuration’s display name.' },
    program: { type: 'string', description: 'The .shade.ts file to debug.' },
    entry: { type: 'string', description: 'The entry point to invoke, by name.' },
    stopOnEntry: {
      type: 'boolean',
      default: true,
      description: 'Stop before the first statement instead of running to a breakpoint.',
    },
    precision: {
      type: 'string',
      enum: ['f32', 'f64'],
      default: 'f32',
      description: 'f32 is what the GPU computes; f64 is the algebra reference.',
    },
    derivatives: {
      type: 'string',
      enum: ['zero'],
      description: 'How dpdx/dpdy/fwidth read. Omitted, a derivative throws.',
    },
    invocation: {
      type: 'object',
      description: 'This invocation’s inputs: builtins by WGSL id, the rest under "inputs".',
      properties: {
        inputs: { type: 'object', description: '@location inputs by name.' },
      },
    },
    bindings: {
      type: 'object',
      description: 'Uniform and storage values by declared name.',
    },
    breakpoints: {
      type: 'array',
      description: 'Breakpoints to arm before the run starts.',
      items: {
        type: 'object',
        required: ['line'],
        properties: {
          file: { type: 'string' },
          line: { type: 'number', description: 'Zero-based.' },
        },
      },
    },
  },
})
