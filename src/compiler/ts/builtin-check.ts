// === `@builtin("...")` validation: name allow-list and stage/direction compatibility ===
//
// Shared by `structs.ts` (a class field's `@builtin(...)`) and `lower/function.ts` (a
// parameter's `@builtin(...)`, and a struct field reached through a parameter or return type),
// so the two front-end sites that parse a `@builtin(...)` decorator agree on one vocabulary and
// one set of stage rules — see design doc §5 and §10 step 5.

import ts from 'typescript'
import {
  WGSL_BUILTIN_NAMES,
  WGSL_BUILTIN_TYPES,
  type FixedTypeBuiltinName,
  type WgslBuiltinName,
} from '../../core/sot.js'
import { typeKey, type ShaderType } from '../../core/ir/types.js'
import type { TsCompilerDiagnostic } from './source-file.js'
import { makeDiagnostic } from './diagnostic.js'
import { TS_CODES } from './codes.js'
import { isIntegerVarying } from '../../core/passes/varying-interpolate.js'

/** The pipeline stage a `@builtin(...)` id is being checked against. */
export type BuiltinStage = 'vertex' | 'fragment' | 'compute'

/**
 * Every attribute (decorator) name `"use typeshade"` actually parses and acts on:
 * `@vertex`/`@fragment`/`@compute` on a top-level function (`lower/function.ts`'s `parseStage`)
 * and `@builtin`/`@location` on that function's parameters or a struct field (`builtinDecoratorArg`/
 * `numberDecorator` here and in `structs.ts`). This is the one place this list is spelled out;
 * `language-service/ambient.ts`'s `ATTRIBUTE_NAMES` re-exports it rather than retyping it, the
 * same way it already re-exports {@link WGSL_BUILTIN_NAMES} from `core/sot.ts` — the language
 * service depends on the compiler, never the reverse, so the canonical list lives here.
 */
export const ATTRIBUTE_NAMES: readonly string[] = [
  'vertex',
  'fragment',
  'compute',
  'builtin',
  'location',
  // The entry-IO attributes of §53. `@interpolate` and `@invariant` pass through to WGSL and
  // become qualifiers on GLSL ES 3.00; `@blend_src` derives the `dualSourceBlending`
  // capability and fails the module closed on GLSL, which has no second source.
  'interpolate',
  'invariant',
  'blend_src',
  // §54: `@diagnostic("off", "derivative_uniformity")` on an entry, which becomes a
  // module-scope `diagnostic(off, derivative_uniformity);`.
  'diagnostic',
]

/** The interpolation TYPES WGSL names, and the SAMPLINGS each admits. `flat` takes `first`
 *  or `either` and nothing else; `perspective` and `linear` take the three positions. A
 *  sampling is optional everywhere. */
const INTERPOLATE_TYPES: Readonly<Record<string, readonly string[]>> = {
  perspective: ['center', 'centroid', 'sample'],
  linear: ['center', 'centroid', 'sample'],
  flat: ['first', 'either'],
}

/** Reads and checks an `@interpolate("type")` or `@interpolate("type", "sampling")` on a
 *  field, returning the WGSL attribute text, or `undefined` when there is none (or when the
 *  arguments were wrong, which is reported). */
export function interpolateDecoratorArg(
  diagnostics: TsCompilerDiagnostic[],
  sourceFile: ts.SourceFile,
  decorators: readonly ts.Decorator[],
): string | undefined {
  for (const d of decorators) {
    if (!ts.isCallExpression(d.expression)) continue
    if (!ts.isIdentifier(d.expression.expression)) continue
    if (d.expression.expression.text !== 'interpolate') continue
    const raw = d.expression.arguments.map((a) =>
      ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a) ? a.text : undefined,
    )
    const [type, sampling] = raw
    if (type === undefined || raw.length > 2 || (raw.length === 2 && sampling === undefined)) {
      diagnostics.push(
        makeDiagnostic(
          sourceFile,
          d,
          `@interpolate takes a type, and optionally a sampling, as strings: ` +
            `@interpolate("flat") or @interpolate("linear", "centroid").`,
          TS_CODES.ATTRIBUTE_NAME,
        ),
      )
      return undefined
    }
    const samplings = INTERPOLATE_TYPES[type]
    if (samplings === undefined) {
      diagnostics.push(
        makeDiagnostic(
          sourceFile,
          d,
          `@interpolate type "${type}" is not one WGSL has: ` +
            `${Object.keys(INTERPOLATE_TYPES).join(', ')}.`,
          TS_CODES.ATTRIBUTE_NAME,
        ),
      )
      return undefined
    }
    if (sampling !== undefined && !samplings.includes(sampling)) {
      diagnostics.push(
        makeDiagnostic(
          sourceFile,
          d,
          `@interpolate("${type}") takes the sampling ${samplings.join(' or ')}, ` +
            `not "${sampling}".`,
          TS_CODES.ATTRIBUTE_NAME,
        ),
      )
      return undefined
    }
    return sampling === undefined ? `@interpolate(${type})` : `@interpolate(${type}, ${sampling})`
  }
  return undefined
}

/** Whether `decorators` carries a bare `@invariant`. */
export function hasInvariantDecorator(decorators: readonly ts.Decorator[]): boolean {
  return decorators.some((d) => ts.isIdentifier(d.expression) && d.expression.text === 'invariant')
}

/**
 * Attribute names the compiler recognizes but always rejects with their own dedicated message
 * (`structs.ts`'s `"... on a class is not applied"` / `"@align on a field is not applied"`), so
 * {@link checkAttributeName} must not also call them "unknown" — that would read as two
 * contradictory diagnostics on the same decorator.
 */
const RECOGNIZED_BUT_UNAPPLIED_ATTRIBUTE_NAMES: readonly string[] = ['std140', 'align']

/** The decorator identifier `@name` or `@name(...)` reads off, or `undefined` for a decorator
 *  shape (anything but a bare identifier or an identifier call) this front end never produces. */
function attributeNameOf(decorator: ts.Decorator): string | undefined {
  if (ts.isIdentifier(decorator.expression)) return decorator.expression.text
  if (
    ts.isCallExpression(decorator.expression) &&
    ts.isIdentifier(decorator.expression.expression)
  ) {
    return decorator.expression.expression.text
  }
  return undefined
}

/** Whether a `@builtin(...)` id is supplied to the shader (`'input'`, a parameter or a field of
 *  a parameter's struct type) or produced by it (`'output'`, a return type or a field of a
 *  struct return type). */
export type BuiltinDirection = 'input' | 'output'

/** Finds a `@builtin("name")` decorator among `decorators` and returns its raw string and the
 *  string literal node itself, for a diagnostic span narrower than the whole declaration.
 *  Mirrors the decorator-call shape both `structs.ts` and `lower/function.ts` already parse. */
export function builtinDecoratorArg(
  decorators: readonly ts.Decorator[],
): { readonly name: string; readonly argNode: ts.StringLiteralLike } | undefined {
  for (const d of decorators) {
    if (!ts.isCallExpression(d.expression)) continue
    if (!ts.isIdentifier(d.expression.expression) || d.expression.expression.text !== 'builtin') {
      continue
    }
    const arg = d.expression.arguments[0]
    if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) {
      return { name: arg.text, argNode: arg }
    }
  }
  return undefined
}

function isWgslBuiltinName(name: string): name is WgslBuiltinName {
  return (WGSL_BUILTIN_NAMES as readonly string[]).includes(name)
}

/** Plain Levenshtein edit distance, for the "Did you mean ...?" suggestion below. `a` and `b`
 *  are short (builtin ids), so the classic O(len(a)*len(b)) table is not worth optimizing. */
function editDistance(a: string, b: string): number {
  const rows = a.length + 1
  const cols = b.length + 1
  const dp: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0))
  for (let i = 0; i < rows; i++) dp[i]![0] = i
  for (let j = 0; j < cols; j++) dp[0]![j] = j
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1, // deletion
        dp[i]![j - 1]! + 1, // insertion
        dp[i - 1]![j - 1]! + cost, // substitution
      )
    }
  }
  return dp[rows - 1]![cols - 1]!
}

/** The closest entry in `candidates` to `name` by edit distance, or `undefined` when nothing is
 *  close enough to be worth suggesting (a threshold that scales a little with the candidate's
 *  own length, so a short id like `"position"` does not suggest itself for an unrelated short
 *  typo). Shared by {@link suggestBuiltinName} (`WGSL_BUILTIN_NAMES`) and
 *  {@link checkAttributeName} (`ATTRIBUTE_NAMES`) so both "Did you mean ...?" hints use one rule. */
function closestName(name: string, candidates: readonly string[]): string | undefined {
  let best: string | undefined
  let bestDistance = Infinity
  for (const candidate of candidates) {
    const distance = editDistance(name, candidate)
    if (distance < bestDistance) {
      bestDistance = distance
      best = candidate
    }
  }
  if (best === undefined) return undefined
  const threshold = Math.max(3, Math.ceil(best.length / 3))
  return bestDistance <= threshold ? best : undefined
}

/** The closest {@link WGSL_BUILTIN_NAMES} entry to `name` by edit distance, or `undefined` when
 *  nothing is close enough to be worth suggesting. */
export function suggestBuiltinName(name: string): string | undefined {
  return closestName(name, WGSL_BUILTIN_NAMES)
}

/** The closest {@link ATTRIBUTE_NAMES} entry to `name` by edit distance, or `undefined` when
 *  nothing is close enough to be worth suggesting. */
export function suggestAttributeName(name: string): string | undefined {
  return closestName(name, ATTRIBUTE_NAMES)
}

/** Validates a `@builtin("...")` name against {@link WGSL_BUILTIN_NAMES}, pushing a `BUILTIN_NAME`
 *  error with a "Did you mean ...?" suggestion (by edit distance) when one is close. Returns
 *  whether `name` was valid, so a caller can skip the stage check below on an already-invalid
 *  name instead of compounding the error. */
export function checkBuiltinName(
  diagnostics: TsCompilerDiagnostic[],
  sourceFile: ts.SourceFile,
  node: ts.Node,
  name: string,
): boolean {
  if (isWgslBuiltinName(name)) return true
  const suggestion = suggestBuiltinName(name)
  const hint = suggestion
    ? ` Did you mean "${suggestion}"?`
    : ` Supported names: ${WGSL_BUILTIN_NAMES.join(', ')}.`
  diagnostics.push(
    makeDiagnostic(sourceFile, node, `Unknown builtin "${name}".${hint}`, TS_CODES.BUILTIN_NAME),
  )
  return false
}

/** Which stage(s) and direction(s) each builtin id is valid for, per design doc §10 step 5,
 *  and — for the extension-gated ids — per the WGSL built-in value table (§50). Every id in
 *  {@link WGSL_BUILTIN_NAMES} has a row now: `clip_distances` used to be absent and therefore
 *  unconstrained, which let `@builtin("clip_distances")` sit on a fragment INPUT with zero
 *  diagnostics and die at Tint. */
const BUILTIN_STAGE_RULES: Readonly<
  Record<string, readonly { readonly stage: BuiltinStage; readonly direction: BuiltinDirection }[]>
> = {
  vertex_index: [{ stage: 'vertex', direction: 'input' }],
  instance_index: [{ stage: 'vertex', direction: 'input' }],
  position: [
    { stage: 'vertex', direction: 'output' },
    { stage: 'fragment', direction: 'input' },
  ],
  front_facing: [{ stage: 'fragment', direction: 'input' }],
  sample_index: [{ stage: 'fragment', direction: 'input' }],
  sample_mask: [
    { stage: 'fragment', direction: 'input' },
    { stage: 'fragment', direction: 'output' },
  ],
  frag_depth: [{ stage: 'fragment', direction: 'output' }],
  // WGSL: a vertex OUTPUT only, and an `array<f32, N ≤ 8>` — see checkBuiltinType.
  clip_distances: [{ stage: 'vertex', direction: 'output' }],
  primitive_index: [{ stage: 'fragment', direction: 'input' }],
  local_invocation_id: [{ stage: 'compute', direction: 'input' }],
  local_invocation_index: [{ stage: 'compute', direction: 'input' }],
  global_invocation_id: [{ stage: 'compute', direction: 'input' }],
  workgroup_id: [{ stage: 'compute', direction: 'input' }],
  num_workgroups: [{ stage: 'compute', direction: 'input' }],
  // The subgroup pair is a FRAGMENT input as well as a compute one, per WGSL's built-in
  // value table; it read as compute-only here, which refused a legal fragment program.
  subgroup_invocation_id: [
    { stage: 'compute', direction: 'input' },
    { stage: 'fragment', direction: 'input' },
  ],
  subgroup_size: [
    { stage: 'compute', direction: 'input' },
    { stage: 'fragment', direction: 'input' },
  ],
}

/** The longest `array<f32, N>` WGSL's built-in value table lets `@builtin(clip_distances)` be. */
const MAX_CLIP_DISTANCES = 8

/** Validates the type of a `@location(n)` field or parameter (§53). WGSL: "the type of a
 *  user-defined IO must be a numeric scalar or numeric vector" — a `bool` at a location was
 *  emitted and Tint answered `cannot apply '@location' to declaration of type 'bool'`, while
 *  the GLSL writer produced `out bool ok;`, which a WebGL2 driver reads as something else
 *  again. A struct, an array or a matrix at a location is refused for the same reason. */
export function checkLocationType(
  diagnostics: TsCompilerDiagnostic[],
  sourceFile: ts.SourceFile,
  node: ts.Node,
  name: string,
  type: ShaderType,
  interpolate?: string,
): void {
  // An INTEGRAL varying has one interpolation and it is `flat` — there is nothing to
  // interpolate between two integers. WGSL says so outright (Tint: `interpolation type must
  // be 'flat' for integral user-defined IO types`), and the attribute is derived from the
  // type for a field that spells none (§53) — so the only way to reach an integer varying
  // that is not flat is to write another one, which is refused here. It mattered: the GLSL
  // writer answers the same question from the type and emitted `flat out uint id;` whatever
  // the attribute said, so the one source described two programs again.
  if (interpolate !== undefined && isIntegerVarying(type) && !/^flat\b/.test(interpolate)) {
    diagnostics.push(
      makeDiagnostic(
        sourceFile,
        node,
        `"${name}" is "${typeKey(type)}" at a @location, so its interpolation is "flat"; ` +
          `@interpolate(${interpolate}) is not one an integer has. Drop the attribute — it is ` +
          `derived from the type — or send an f32.`,
        TS_CODES.TYPE_MISMATCH,
      ),
    )
    return
  }
  // An emulated double at a `@location` is NOT this rule's to answer. §39 measured what the
  // two targets do with one — a scalar `f64` vertex attribute is kept, because its `vec2<f32>`
  // pair fits the one slot it has, and every other position is refused with a message naming
  // the remedy — and `refuseF64EntryIo` in `lower/function.ts` carries that decision. Answering
  // here too would refuse the shape §39 keeps, and word the rest wrong.
  if (type.kind === 'f64' || type.kind === 'vec64') return
  const ok =
    (type.kind === 'scalar' && type.scalar !== 'bool') ||
    (type.kind === 'vec' && type.elem !== 'bool')
  if (ok) return
  diagnostics.push(
    makeDiagnostic(
      sourceFile,
      node,
      `"${name}" is at a @location and is "${typeKey(type)}"; a value passed between stages ` +
        `is a numeric scalar or a numeric vector. ` +
        (typeKey(type) === 'bool' || (type.kind === 'vec' && type.elem === 'bool')
          ? 'Send a u32 and compare it.'
          : 'Send its components as separate locations.'),
      TS_CODES.TYPE_MISMATCH,
    ),
  )
}

/** Validates the TYPE declared for a `@builtin(...)` id against what WGSL fixes for it.
 *
 *  Two shapes of rule. Every id with a SINGLE type is checked against {@link WGSL_BUILTIN_TYPES},
 *  which `core/sot.ts` already writes down — `@builtin("vertex_index") i: f32` used to emit
 *  and die at the driver (§53). `clip_distances` is the one id whose type an AUTHOR picks,
 *  `array<f32, N ≤ 8>`, so it has a rule of its own below rather than a row. A name with no
 *  rule of either kind is left alone, so an unknown id (already reported by
 *  {@link checkBuiltinName}) adds no second diagnostic. */
export function checkBuiltinType(
  diagnostics: TsCompilerDiagnostic[],
  sourceFile: ts.SourceFile,
  node: ts.Node,
  name: string,
  type: ShaderType,
): void {
  // Every id but `clip_distances` has ONE type, which `core/sot.ts` already writes down — so
  // a declaration that disagrees is checked against that table rather than guessed at (§53).
  // `@builtin("vertex_index") i: f32` used to emit and die at the driver.
  const fixed = WGSL_BUILTIN_TYPES[name as FixedTypeBuiltinName] as ShaderType | undefined
  if (fixed !== undefined) {
    if (typeKey(fixed) !== typeKey(type)) {
      diagnostics.push(
        makeDiagnostic(
          sourceFile,
          node,
          `Builtin "${name}" is "${typeKey(fixed)}"; this declares it "${typeKey(type)}".`,
          TS_CODES.TYPE_MISMATCH,
        ),
      )
    }
    return
  }
  if (name !== 'clip_distances') return
  const shown = typeKey(type)
  const ok =
    type.kind === 'array' &&
    type.elem.kind === 'scalar' &&
    type.elem.scalar === 'f32' &&
    type.size !== undefined &&
    type.size >= 1 &&
    type.size <= MAX_CLIP_DISTANCES
  if (ok) return
  diagnostics.push(
    makeDiagnostic(
      sourceFile,
      node,
      `Builtin "clip_distances" is "${shown}"; WGSL gives it array<f32, N> with N from 1 to ` +
        `${String(MAX_CLIP_DISTANCES)}.`,
      TS_CODES.TYPE_MISMATCH,
    ),
  )
}

/** Validates a (already name-checked) `@builtin(...)` id against the entry stage and direction
 *  it is used in — a `BUILTIN_STAGE` error when it belongs to a different stage or the other
 *  direction (e.g. `frag_depth`, a fragment output, used as a vertex function's return). A name
 *  with no rule (`clip_distances`, or an already-unknown name) is left unconstrained. */
export function checkBuiltinStage(
  diagnostics: TsCompilerDiagnostic[],
  sourceFile: ts.SourceFile,
  node: ts.Node,
  name: string,
  stage: BuiltinStage,
  direction: BuiltinDirection,
): void {
  const rules = BUILTIN_STAGE_RULES[name]
  if (!rules || rules.length === 0) return
  if (rules.some((r) => r.stage === stage && r.direction === direction)) return
  const allowed = rules.map((r) => `${r.stage} ${r.direction}`).join(' or ')
  diagnostics.push(
    makeDiagnostic(
      sourceFile,
      node,
      `Builtin "${name}" is not a valid ${stage} ${direction}; it is a ${allowed}.`,
      TS_CODES.BUILTIN_STAGE,
    ),
  )
}

/**
 * Validates one decorator's identifier against {@link ATTRIBUTE_NAMES}, pushing an
 * `ATTRIBUTE_NAME` error with a "Did you mean ...?" suggestion when one is close — the same
 * treatment {@link checkBuiltinName} gives a `@builtin("...")` string, but for the decorator
 * name itself. Without this, a misspelled attribute (`@vertx`, `@framgent`, `@bogus`) is silent
 * from both the compiler and the language service: TypeScript never resolves a decorator on an
 * invalid target, so there is no TS2304, and nothing else names the typo — the function or
 * field just silently stops being an entry point or an I/O field. A name in
 * {@link RECOGNIZED_BUT_UNAPPLIED_ATTRIBUTE_NAMES} (`@std140`, `@align`) is left alone: those
 * already get their own "not applied" diagnostic elsewhere, and calling them "unknown" too
 * would contradict it. A decorator shape this front end never produces (its expression is
 * neither a bare identifier nor an identifier call) is left alone as well — nothing here can
 * name it usefully.
 */
export function checkAttributeName(
  diagnostics: TsCompilerDiagnostic[],
  sourceFile: ts.SourceFile,
  decorator: ts.Decorator,
): void {
  const name = attributeNameOf(decorator)
  if (name === undefined) return
  if (ATTRIBUTE_NAMES.includes(name)) return
  if (RECOGNIZED_BUT_UNAPPLIED_ATTRIBUTE_NAMES.includes(name)) return
  const suggestion = suggestAttributeName(name)
  const hint = suggestion
    ? ` Did you mean "@${suggestion}"?`
    : ` Supported attributes: ${ATTRIBUTE_NAMES.map((n) => `@${n}`).join(', ')}.`
  diagnostics.push(
    makeDiagnostic(
      sourceFile,
      decorator,
      `Unknown attribute "@${name}".${hint}`,
      TS_CODES.ATTRIBUTE_NAME,
    ),
  )
}
