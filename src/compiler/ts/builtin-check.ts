// === `@builtin("...")` validation: name allow-list and stage/direction compatibility ===
//
// Shared by `structs.ts` (a class field's `@builtin(...)`) and `lower/function.ts` (a
// parameter's `@builtin(...)`, and a struct field reached through a parameter or return type),
// so the two front-end sites that parse a `@builtin(...)` decorator agree on one vocabulary and
// one set of stage rules — see design doc §5 and §10 step 5.

import ts from 'typescript'
import { WGSL_BUILTIN_NAMES, type WgslBuiltinName } from '../../core/sot.js'
import type { TsCompilerDiagnostic } from './source-file.js'
import { makeDiagnostic } from './diagnostic.js'
import { TS_CODES } from './codes.js'

/** The pipeline stage a `@builtin(...)` id is being checked against. */
export type BuiltinStage = 'vertex' | 'fragment' | 'compute'

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

/** The closest {@link WGSL_BUILTIN_NAMES} entry to `name` by edit distance, or `undefined` when
 *  nothing is close enough to be worth suggesting (a threshold that scales a little with the
 *  candidate's own length, so a short id like `"position"` does not suggest itself for an
 *  unrelated short typo). */
export function suggestBuiltinName(name: string): string | undefined {
  let best: string | undefined
  let bestDistance = Infinity
  for (const candidate of WGSL_BUILTIN_NAMES) {
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

/** Which stage(s) and direction(s) each builtin id is valid for, per design doc §10 step 5.
 *  `clip_distances` is deliberately absent: the task that introduced this table names every
 *  other id's stage/direction explicitly and leaves `clip_distances` unspecified, so it is left
 *  unconstrained here rather than guessed. */
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
  local_invocation_id: [{ stage: 'compute', direction: 'input' }],
  local_invocation_index: [{ stage: 'compute', direction: 'input' }],
  global_invocation_id: [{ stage: 'compute', direction: 'input' }],
  workgroup_id: [{ stage: 'compute', direction: 'input' }],
  num_workgroups: [{ stage: 'compute', direction: 'input' }],
  subgroup_invocation_id: [{ stage: 'compute', direction: 'input' }],
  subgroup_size: [{ stage: 'compute', direction: 'input' }],
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
