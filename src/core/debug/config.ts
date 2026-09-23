// ═══ Shader DSL: one launch configuration, three carriers (docs/debugging.md §4) ═══
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
import { stageOf, workgroupShapeOf } from '../ir/nodes.js'
import { eachExpr, eachStmtExpr } from '../ir/visit.js'
import type { ShaderType } from '../ir/types.js'
import { typeKey } from '../ir/types.js'
import type { CpuPrecision } from '../oracle.js'
import type { DebugBreakpoint, DebugSession } from './session.js'
import { startDebugSession } from './session.js'
import { coerceValue, isUnsized, shapeError, zeroValueOf } from './value.js'

/** One invocation's inputs, keyed the way the shader declares them.
 *
 *  Builtin inputs are named by their WGSL id (`vertex_index`, `position`,
 *  `global_invocation_id`) at the top level. Everything else, a `@location(n)` vertex
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
 *  `num_workgroups` is the exception: it is a property of the DISPATCH, not of any one
 *  invocation, so nothing here can derive it. {@link dispatch} supplies it.
 *
 *  Exported from `typeshade/debug`.
 */
export interface DebugInvocation {
  /** Builtin inputs by WGSL id. A `vecN` builtin is a flat array, a scalar one a number. */
  readonly [builtin: string]: CpuValue | DebugInputs | readonly number[] | undefined
  /** Non-builtin stage inputs, by parameter name or entry-IO struct field name. */
  readonly inputs?: DebugInputs
  /** How many workgroups the dispatch has, as `[x, y, z]`. Default `[1, 1, 1]`.
   *
   *  This is what `num_workgroups` reads, and it is a separate field rather than a builtin id
   *  because it is not a property of the invocation being debugged: `global_invocation_id`
   *  says which invocation, and no amount of arithmetic on it says how many there are.
   *
   *  `[1, 1, 1]` and not zeros, which is the default every other omitted input gets: a
   *  dispatch of zero workgroups runs nothing, so zero is never the answer a session wants,
   *  and a kernel guarded by `gid.x < num_workgroups.x * 8u` would take the empty branch on
   *  every invocation and look like a shader that does nothing. Supplying `num_workgroups`
   *  directly overrides this; supplying one that contradicts it is an error, the same rule the
   *  derived ids follow. */
  readonly dispatch?: readonly [number, number, number]
}

/** `@location(n)` stage inputs by name: a vertex attribute, an interpolated varying.
 *
 *  Exported from `typeshade/debug`.
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
 *  Exported from `typeshade/debug`.
 */
export interface DebugLaunchConfig {
  /** The debug type an IDE dispatches on. Always `'typeshade'`; ignored by the engine. */
  readonly type?: 'typeshade'
  /** `'launch'`, since attaching to a running shader is not a thing that exists. Ignored. */
  readonly request?: 'launch'
  /** The configuration's display name in the IDE. Ignored here. */
  readonly name?: string
  /** The `.shade.ts` file. Optional: the engine is handed a compiled module, so it ignores
   *  this, and `entry` is the only key it requires. An adapter reads it to know what to
   *  compile.
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
  /** What the arithmetic means. Default `'f32'`; see {@link DebugSessionOptions.precision}. */
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
 *  Exported from `typeshade/debug`.
 */
export class DebugConfigError extends Error {
  /** One sentence per problem, in the order they were found. */
  readonly problems: readonly string[]
  constructor(problems: readonly string[]) {
    super(`typeshade/debug: ${problems.join('; ')}`)
    this.name = 'DebugConfigError'
    this.problems = problems
  }
}

/** The WGSL compute builtins this resolver derives from `global_invocation_id`. */
const DERIVED = ['workgroup_id', 'local_invocation_id', 'local_invocation_index'] as const

/** Every key {@link DebugLaunchConfig} has. Kept beside the interface on purpose: a field
 *  added there without a line here is refused at runtime, which is a loud failure rather than
 *  a quiet one, and `config.test.ts` checks the two against each other. */
const CONFIG_KEYS: ReadonlySet<string> = new Set([
  'type',
  'request',
  'name',
  'program',
  'entry',
  'stopOnEntry',
  'precision',
  'derivatives',
  'invocation',
  'bindings',
  'breakpoints',
])

/** Start a stepped run from a launch configuration.
 *
 *  This is the one call an adapter makes. It resolves the invocation into the entry's
 *  positional arguments, checks every binding against its declared type, applies the
 *  configuration's precision and derivative policy, and hands back a session already stopped
 *  on the entry's first statement (or on the first breakpoint, with `stopOnEntry: false`).
 *
 *  One case comes back already FINISHED rather than stopped: a module with no source spans,
 *  which is every module authored through the `fn()` EDSL. A run stops only where there is a
 *  line to show, so there is nothing to stop at. The configuration is still resolved and its
 *  problems still reported; what a caller does not get is a pause.
 *
 *  Every problem it can see is reported together, before the shader runs a single statement,
 *  as a {@link DebugConfigError} listing them: a misspelled builtin alongside a uniform of the
 *  wrong shape, rather than one error per attempt.
 *
 *  Exported from `typeshade/debug`.
 *
 *  @param m - the module to run, as `compile()` produced it.
 *  @param config - the run to start.
 *  @returns the session, already stopped on its first statement, or already finished when the
 *    module carries no spans.
 *  @throws {@link DebugConfigError} when the configuration does not fit the module.
 *
 *  @example
 *  ```ts
 *  import { compile } from 'typeshade'
 *  import { startDebugSessionFromConfig } from 'typeshade/debug'
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
  // A misspelled top-level key used to be ignored in silence, so `stopOnentry: false` or
  // `breakPoints: [...]` read as the default and the session behaved in a way the file did not
  // describe. The schema refuses one too; this is the half that runs.
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) {
      problems.push(
        `"${key}" is not a launch configuration key; it takes ` +
          `${[...CONFIG_KEYS].sort().join(', ')}`,
      )
    }
  }
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
      "derivatives: 'quad' is not implemented; docs/debugging.md decision 4 defers the 2x2 " +
        "quad evaluation, so 'zero' is the only mode that exists today",
    )
  }

  const args = resolveInvocation(decl, config.invocation ?? {}, structs, problems)
  const bindings = resolveBindings(m, config.bindings ?? {}, structs, problems, decl)
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
 *  Exported from `typeshade/debug`.
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
  // Neither is a builtin id, so neither belongs in the scan below. `inputs` carries the
  // `@location` values; `dispatch` says how many workgroups there are, which is a property of
  // the dispatch rather than of this invocation.
  delete (supplied as Record<string, unknown>).inputs
  const dispatch = invocation.dispatch
  delete (supplied as Record<string, unknown>).dispatch
  if (dispatch !== undefined) {
    const bad =
      !Array.isArray(dispatch) || dispatch.length !== 3 || dispatch.some((n) => !Number.isFinite(n))
        ? 'must be three finite numbers, [x, y, z]'
        : dispatch.some((n) => n <= 0)
          ? 'must be positive; a dispatch of zero workgroups runs nothing'
          : undefined
    if (bad) problems.push(`"dispatch" ${bad}`)
  }

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
  deriveComputeIds(decl, declared, resolved, dispatch, problems)

  const inputs = invocation.inputs ?? {}
  const spellings = declaredInputs(decl, structs)
  for (const name of Object.keys(inputs)) {
    if (!Object.hasOwn(inputs, name)) continue
    const slot = spellings.get(name)
    if (!slot) {
      const list = [...spellings.keys()].sort().join(', ')
      problems.push(
        `"${name}" is not an input this entry declares; ${decl.name} takes ${list || 'none'}`,
      )
      continue
    }
    if (slot.ambiguous) {
      problems.push(
        `"${name}" is declared by more than one parameter of ${decl.name} ` +
          `(${slot.ambiguous.join(', ')}); name it as one of ` +
          `${slot.ambiguous.map((o) => `"${o}.${name}"`).join(' or ')}`,
      )
      continue
    }
    const given = inputs[name]
    if (given === undefined) continue
    const bad = shapeError(given, slot.type, structs)
    if (bad) problems.push(`input "${name}": ${bad}`)
    else resolved.set(slot.key, coerceValue(given, slot.type, structs))
  }

  return decl.params.map((p) => {
    if (p.builtin) return resolved.get(p.builtin) ?? builtinDefault(p.builtin, p.type, structs)
    if (p.type.kind === 'struct') {
      const sd = structs.get(p.type.name)
      if (!sd) return zeroValueOf(p.type, structs)
      const out: Record<string, CpuValue> = {}
      for (const f of sd.fields) {
        const hit = f.builtin
          ? resolved.get(f.builtin)
          : resolved.get(inputKey(`${p.name}.${f.name}`))
        out[f.name] =
          hit ??
          (f.builtin ? builtinDefault(f.builtin, f.type, structs) : zeroValueOf(f.type, structs))
      }
      return out
    }
    return resolved.get(inputKey(p.name)) ?? zeroValueOf(p.type, structs)
  })
}

/** What an omitted builtin reads as, which is the zero of its type except where zero is a
 *  value no invocation could have had.
 *
 *  Two of those, both fragment inputs, and both from `docs/debugging.md` §4.2:
 *
 *  - `position` is `[0, 0, 0, 1]`. Its `w` is the perspective divisor, and the zero of a
 *    `vec4` puts a 0 there, so the default fragment run divided by zero and every
 *    perspective-divided value came back `NaN`. A reader would blame the shader.
 *  - `front_facing` is `true`. `false` is a back-facing fragment, which for a single-sided
 *    draw is the case that never runs, so a default run would be debugging the branch the GPU
 *    does not take.
 *
 *  Keyed by builtin id rather than by stage, so a struct field carrying `@builtin("position")`
 *  gets the same value as a loose parameter does. Everything else is the zero of its type,
 *  including the four builtins §4.2's table does not name.
 */
function builtinDefault(
  id: string,
  type: ShaderType,
  structs: ReadonlyMap<string, StructDecl>,
): CpuValue {
  if (id === 'position' && type.kind === 'vec' && type.n === 4) return [0, 0, 0, 1]
  if (id === 'front_facing' && type.kind === 'scalar' && type.scalar === 'bool') return true
  return zeroValueOf(type, structs)
}

/** The compute builtins that are not supplied directly: the three derived from
 *  `global_invocation_id` and the entry's workgroup size, and `num_workgroups`, which comes
 *  from `dispatch` because nothing about one invocation implies how many there are.
 *
 *  A value the caller gave always wins. A value the caller gave that CONTRADICTS what would
 *  have been derived is a problem rather than a silent pick, because a wrong invocation id
 *  makes a whole session lie. A default cannot contradict anything, so an omitted `dispatch`
 *  never argues with a supplied `num_workgroups`.
 */
function deriveComputeIds(
  decl: FuncDecl,
  declared: ReadonlyMap<string, ShaderType>,
  resolved: Map<string, CpuValue>,
  dispatch: readonly number[] | undefined,
  problems: string[],
): void {
  if (stageOf(decl) !== 'compute') return

  // `num_workgroups` first, since it does not need `global_invocation_id` and must be seeded
  // even for a kernel that reads only it.
  if (declared.has('num_workgroups')) {
    const fromDispatch = [...(dispatch ?? [1, 1, 1])]
    const given = resolved.get('num_workgroups')
    if (given === undefined) resolved.set('num_workgroups', fromDispatch as CpuValue)
    else if (dispatch !== undefined && !sameValue(given, fromDispatch as CpuValue)) {
      problems.push(
        `"num_workgroups" is ${JSON.stringify(given)}, but dispatch is ` +
          `${JSON.stringify(fromDispatch)}; supply one or the other, not a pair that disagrees`,
      )
    }
  }

  const gid = resolved.get('global_invocation_id')
  if (gid === undefined) return
  // The front end accepts `@builtin("global_invocation_id") gid: u32` as well as a `vec3u`, and
  // a scalar has no `.map`. Guarding here rather than letting it throw is the difference
  // between a problem naming the declaration and a raw TypeError out of the resolver.
  if (!Array.isArray(gid)) {
    problems.push(
      `"global_invocation_id" is declared ` +
        `${typeKey(declared.get('global_invocation_id')!)} on ${decl.name}, so the compute ids ` +
        `cannot be derived from it; declare it as a vec3u or supply each id explicitly`,
    )
    return
  }
  const ids = gid as number[]

  const size = workgroupShapeOf(decl) ?? [64, 1, 1]
  // A hand-built `@workgroup_size(0)` has no invocations, and dividing by it gives NaN ids
  // that no one would read as wrong. Naming it is the only honest answer: a workgroup of no
  // invocations has no invocation to debug.
  if (size.some((n) => n <= 0)) {
    problems.push(
      `${decl.name} is @compute([${size.join(', ')}]), which has no invocations to derive an id from`,
    )
    return
  }
  const local = ids.map((v, i) => ((v % size[i]!) + size[i]!) % size[i]!)
  const group = ids.map((v, i) => Math.floor(v / size[i]!))
  // WGSL's own formula, `x + y*wx + z*wx*wy`.
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
          `${JSON.stringify(ids)} with @compute([${size.join(', ')}]) derives ` +
          `${JSON.stringify(derivation[id])}; supply one or the other, not a pair that disagrees`,
      )
    }
  }
}

const sameValue = (a: CpuValue, b: CpuValue): boolean =>
  Array.isArray(a) && Array.isArray(b)
    ? a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
    : Object.is(a, b)

/** Namespaced so a `@location` input named `position` cannot collide with the builtin.
 *
 *  `@` because it cannot appear in a WGSL builtin id, which is what makes the namespace real.
 *  It was a literal NUL byte until a review pointed out that one NUL makes `grep` and
 *  `ripgrep` treat the whole file as binary and skip it silently. */
const inputKey = (name: string): string => `@in:${name}`

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
): ReadonlyMap<string, InputSlot> {
  // Every slot gets a QUALIFIED spelling, `param.field`, which is always unambiguous. The bare
  // field name is offered as well, and only when exactly one parameter declares it: two entry
  // structs each with a `v` used to share the bare key, so one supplied `v` was checked
  // against whichever type won the map and then written into BOTH parameters.
  const slots: { owner: string; field: string; type: ShaderType }[] = []
  for (const p of decl.params) {
    if (p.builtin) continue
    if (p.type.kind === 'struct') {
      for (const f of structs.get(p.type.name)?.fields ?? []) {
        if (!f.builtin) slots.push({ owner: p.name, field: f.name, type: f.type })
      }
      continue
    }
    slots.push({ owner: p.name, field: p.name, type: p.type })
  }
  const owners = new Map<string, string[]>()
  for (const s of slots) owners.set(s.field, [...(owners.get(s.field) ?? []), s.owner])

  const out = new Map<string, InputSlot>()
  for (const s of slots) {
    const key = inputKey(`${s.owner}.${s.field}`)
    out.set(`${s.owner}.${s.field}`, { key, type: s.type })
    const sharing = owners.get(s.field)!
    if (sharing.length === 1) out.set(s.field, { key, type: s.type })
    else out.set(s.field, { key, type: s.type, ambiguous: sharing })
  }
  return out
}

/** One writable input position, and the spellings that reach it. `ambiguous` is set when the
 *  bare field name is declared by more than one parameter, which makes that spelling a
 *  question rather than an answer. */
interface InputSlot {
  readonly key: string
  readonly type: ShaderType
  readonly ambiguous?: readonly string[]
}

/** The module's bindings by declared name, checked against their declared types.
 *
 *  An omitted binding reads as the zero of its type. A runtime-sized array has no zero, since
 *  its length is the host's buffer, so omitting one is an error naming it rather than an empty
 *  array whose every read would be `undefined`. A texture or sampler binding cannot be
 *  supplied at all: a CPU run has no texture memory, and `docs/debugging.md` §4.4 specifies
 *  the shapes for when the language surface grows them.
 *
 *  **Only what `entry` reaches is judged.** A module is a compilation unit, not a run: a
 *  fullscreen vertex entry in a file that also declares a sampled texture never touches that
 *  texture, and refusing to debug it would be refusing over a fact about a sibling. So the
 *  unsupported-type and no-zero problems are raised for a binding the entry or one of its
 *  transitive callees actually reads, and a binding it does not read is left out of the
 *  result entirely. `startDebugSession` has always run such an entry; this is the layer above
 *  catching up with it.
 *
 *  Exported from `typeshade/debug`.
 *
 *  @param m - the module whose bindings are being filled.
 *  @param given - the values, by declared name.
 *  @param structs - the module's struct declarations.
 *  @param problems - collected rather than thrown, as in {@link resolveInvocation}.
 *  @param entry - the entry being debugged, so only the bindings it reaches are judged. Omit
 *    to judge every binding the module declares, which is what a caller with no entry in hand
 *    wants.
 *  @returns a value for every binding the entry reaches.
 */
export function resolveBindings(
  m: ModuleDecl,
  given: Readonly<Record<string, CpuValue>>,
  structs: ReadonlyMap<string, StructDecl>,
  problems: string[],
  entry?: FuncDecl,
): Record<string, CpuValue> {
  const declared = new Map(m.bindings.map((b) => [b.name, b.type]))
  const reached = entry ? bindingsReachedBy(m, entry, new Set(declared.keys())) : undefined
  for (const name of Object.keys(given)) {
    if (!Object.hasOwn(given, name)) continue
    if (!declared.has(name)) {
      const list = [...declared.keys()].sort().join(', ')
      problems.push(
        `"${name}" is not a binding this module declares; it declares ${list || 'none'}`,
      )
    }
  }
  const out: Record<string, CpuValue> = {}
  for (const [name, type] of declared) {
    if (reached && !reached.has(name)) continue
    if (
      type.kind === 'texture' ||
      type.kind === 'sampler' ||
      type.kind === 'depth-texture' ||
      type.kind === 'sampler-comparison'
    ) {
      problems.push(
        `binding "${name}" is a ${typeKey(type)}, which a CPU run cannot supply: texture and ` +
          'sampler values are unsupported in this milestone (docs/debugging.md §4.4)',
      )
      continue
    }
    const value = Object.hasOwn(given, name) ? given[name] : undefined
    if (value === undefined) {
      if (isUnsized(type)) {
        problems.push(
          `binding "${name}" is ${typeKey(type)}, whose length only the host's buffer knows, ` +
            'so it has no zero to stand in; supply a value for it',
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

/** Which of `names` the entry reads, following the calls it makes.
 *
 *  Since #18 a binding read lowers to a `varref` like any other name, so a name that is both
 *  declared as a binding and referenced somewhere reachable is a read of it. A local can
 *  shadow the name, which would make this over-report: over-reporting costs a zero value
 *  nobody looks at, while under-reporting would drop a binding the run then cannot resolve, so
 *  the conservative direction is the safe one here as elsewhere.
 */
function bindingsReachedBy(
  m: ModuleDecl,
  entry: FuncDecl,
  names: ReadonlySet<string>,
): Set<string> {
  const byName = new Map(m.funcs.map((f) => [f.name, f]))
  const hit = new Set<string>()
  const seen = new Set<string>()
  const walk = (fn: FuncDecl): void => {
    if (seen.has(fn.name)) return
    seen.add(fn.name)
    for (const stmt of fn.body) {
      eachStmtExpr(stmt, (e) => {
        eachExpr(e, (x) => {
          if ((x.op === 'varref' || x.op === 'param') && names.has(x.name)) hit.add(x.name)
          if (x.op === 'call') {
            const callee = x.declRef ?? byName.get(x.fn)
            if (callee) walk(callee)
          }
        })
      })
    }
  }
  walk(entry)
  return hit
}

/** {@link DebugLaunchConfig} as JSON Schema, for an IDE extension to contribute as its
 *  `launch.json` shape without restating it.
 *
 *  It is a value rather than a file on disk on purpose: a contributed schema that is a copy
 *  drifts from the resolver the first time either moves, and `config.test.ts` holds this one
 *  to the resolver by checking that its property set and the interface's agree.
 *
 *  Exported from `typeshade/debug`.
 */
export const DEBUG_LAUNCH_SCHEMA: Readonly<Record<string, unknown>> = Object.freeze({
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  required: ['entry'],
  // An unknown key is a typo, and `launch.json` is hand-written, so the editor should say so
  // rather than accept it silently. The resolver reports the same, which is what keeps the
  // file a user edits and the object the engine takes from drifting apart.
  additionalProperties: false,
  properties: {
    type: { type: 'string', const: 'typeshade', description: 'The debug type.' },
    request: { type: 'string', const: 'launch', description: 'Always a launch.' },
    name: { type: 'string', description: "This configuration's display name." },
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
      description: 'This invocation\'s inputs: builtins by WGSL id, the rest under "inputs".',
      properties: {
        inputs: { type: 'object', description: '@location inputs by name.' },
        dispatch: {
          type: 'array',
          minItems: 3,
          maxItems: 3,
          items: { type: 'number', exclusiveMinimum: 0 },
          default: [1, 1, 1],
          description: 'Workgroups in the dispatch, [x, y, z]. What num_workgroups reads.',
        },
      },
      // Not `false` here: every other key is a WGSL builtin id, and the set of those is the
      // language's, not this schema's. The resolver checks a key against the entry's own
      // declarations, which is the check that can actually be right.
      additionalProperties: true,
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
