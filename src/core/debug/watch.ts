// ═══ Shader DSL: what is this expression, here, now (docs/debugging.md §4.5) ═══
//
// A DAP `evaluate` request and a Playground watch box ask the same question, so the answer
// belongs here rather than in either adapter, for the same reason the launch configuration does.
//
// §4.5 chose to REUSE THE FRONT END rather than build a second expression parser, and this is
// that: the watch text is spliced into a synthesised `"use typeshade"` source whose one
// function takes the paused frame's names as parameters, typed as the frame recorded them, and
// whose body is `const … = (<the watch>)`. The real compiler lowers it, and what comes back is
// an ordinary `Expr` with an ordinary `ShaderType`, evaluated by the interpreter that is
// already running the session.
//
// Three things fall out of reusing the compiler, and each is the point:
//
//  - A type error in a watch is the SAME diagnostic the editor shows for that text. Nothing
//    here decides what `a.xyz * 2` means; the front end does.
//  - A watch can call the module's own helpers, because the snippet redeclares them.
//  - `const …` rather than `return …` is what removes the need to know the answer's type in
//    advance. A `"use typeshade"` function must declare its return type, and a watch box has
//    no idea what it is about to produce; a `void` function whose body is one `let` sidesteps
//    that entirely, and the lowered statement's `expr.type` IS the answer's type.
//
// WHAT THE SNIPPET CANNOT SEE. Only what can be spelled as a parameter: the scope is built
// from types that have a `"use typeshade"` spelling, and a name whose type has none is left
// out, so watching it is a compile error naming it rather than a wrong number. A texture, a
// sampler and a runtime-sized storage array are the cases today. It also sees only what the
// frame has a NAME for, never a value mid-expression, which would need the per-expression
// spans §3.3 defers.
//
// And it can ask exactly what the language can ask, which is narrower than what the
// INTERPRETER can do. `dpdx` has a stub in the op library and no spelling in the source
// language, so a watch naming it fails at compile with "Unknown function" rather than reaching
// that stub. That is the right way round: a watch that could reach past the language would be
// answering a question the shader could not have asked.

import type { CpuValue } from '../cpu-runtime.js'
import type { Expr, ModuleDecl, StructDecl } from '../ir/nodes.js'
import { eachExpr } from '../ir/visit.js'
import type { ShaderType } from '../ir/types.js'
import { typeKey } from '../ir/types.js'
import { compileTsSource } from '../../compiler/ts/source-file.js'

/** The watch text did not compile, or referred to something the snippet could not be given.
 *
 *  Exported from `typeshade/debug`.
 */
export class DebugWatchError extends Error {
  /** One sentence per problem, as the front end worded it. The front end's own diagnostics,
   *  unedited: a watch's type error should read exactly as it reads in the editor. */
  readonly problems: readonly string[]
  constructor(expression: string, problems: readonly string[]) {
    super(`typeshade/debug: cannot evaluate watch "${expression}": ${problems.join('; ')}`)
    this.name = 'DebugWatchError'
    this.problems = problems
  }
}

/** A compiled watch: the lowered expression and the type the compiler gave it.
 *
 *  Exported from `typeshade/debug`.
 */
export interface CompiledWatch {
  /** The lowered expression, over the scope's names. Its `call` nodes name their callee, so
   *  the interpreter resolves them against the running module rather than the snippet's
   *  stubs. */
  readonly expr: Expr
  /** What the compiler decided the expression's type is, which is what a watch box needs in
   *  order to render the value as `vec3f(…)` rather than as three loose numbers. */
  readonly type: ShaderType
  /** The scope names the expression actually reads, so a caller can bind only those. */
  readonly reads: readonly string[]
}

/** The source-language spelling of a type, or `undefined` when it has none.
 *
 *  Deliberately narrower than `ShaderType`: it answers "can a watch be handed a VALUE of this
 *  type", which is a question about the CPU run, not about the source grammar. Since #54 (A7) a
 *  texture and a sampler do have source spellings, so the grammar is no longer what rules them
 *  out; what rules them out is that a CPU run has no value to bind to one. Declining them keeps
 *  a watch honest: `textureSample` reaches its stub and fails by name rather than answering a
 *  question about memory this run does not have. A runtime-sized array is declined for the
 *  neighbouring reason given below.
 */
function sourceTypeName(t: ShaderType): string | undefined {
  switch (t.kind) {
    case 'scalar':
      return t.scalar
    case 'f64':
      return 'f64'
    case 'vec':
      return `vec${t.n}${t.elem === 'f32' ? 'f' : t.elem === 'i32' ? 'i' : 'u'}`
    case 'vec64':
      return `vec${t.n}f64`
    case 'mat':
      // Every matCxR has a source spelling since #149, so a watch can name any of them; the
      // f64 matrices have no author-facing column type and stay out.
      return t.elem === 'f32' ? `mat${t.cols}x${t.rows}` : undefined
    case 'struct':
      return t.name
    case 'array': {
      // A runtime-sized array has no parameter spelling, which is the honest answer: its
      // length is a property of the buffer the host bound, not of the type.
      if (t.size === undefined) return undefined
      const elem = sourceTypeName(t.elem)
      return elem === undefined ? undefined : `array<${elem}, ${t.size}>`
    }
    default:
      return undefined
  }
}

/** A literal of `t` worth zero, for the body of a redeclared helper that is never run.
 *
 *  Only the shapes the source language can actually spell as a literal today. A helper whose
 *  return type is not one of them is left out of the snippet entirely, so a watch that calls it
 *  fails with the front end's own "Unknown function" rather than with a snippet that does not
 *  compile for a reason the author did not cause.
 */
function zeroLiteral(t: ShaderType): string | undefined {
  switch (t.kind) {
    case 'scalar':
      return t.scalar === 'bool' ? 'false' : t.scalar === 'f32' ? '0.' : '0'
    case 'f64':
      return '0.'
    case 'vec': {
      // Integer vectors are spellable since #30 (A6 A3, "an integer literal takes the type its
      // context declares"): `vec3u(0, 0, 0)` used to fail because a bare `0` was an f32 literal
      // and the constructor wanted `u32` elements. It now takes the element type from the
      // constructor it sits in, so the only thing this still has to get right is which zero to
      // write. A helper returning `vec3u` was being dropped from the snippet before, which a
      // watch calling it saw as the front end's "Unknown function".
      const zero = t.elem === 'f32' ? '0.' : '0'
      return `${sourceTypeName(t)!}(${Array(t.n).fill(zero).join(', ')})`
    }
    default:
      return undefined
  }
}

/** Every struct name reachable from a type, so its declaration is emitted with it. */
function structsIn(t: ShaderType, into: Set<string>): void {
  if (t.kind === 'struct') into.add(t.name)
  else if (t.kind === 'array') structsIn(t.elem, into)
}

/** `class Name { field: type }` for every struct the scope or a redeclared helper mentions. */
function declareStructs(structs: readonly StructDecl[], needed: ReadonlySet<string>): string[] {
  const out: string[] = []
  for (const s of structs) {
    if (!needed.has(s.name)) continue
    const fields: string[] = []
    for (const f of s.fields) {
      const spelling = sourceTypeName(f.type)
      // A struct with one unspellable field is emitted without it. The field is then unknown
      // to the snippet, so watching it is a compile error naming the field, which is what a
      // watch box should say, rather than the struct silently not existing at all.
      if (spelling !== undefined) fields.push(`  ${f.name}: ${spelling}`)
    }
    out.push(`class ${s.name} {\n${fields.join('\n')}\n}`)
  }
  return out
}

/** The module's own helpers, redeclared with a body that is never executed.
 *
 *  The body exists only so the snippet compiles: a call in a watch must resolve to a visible
 *  callee with the right signature, and the source language has no ambient declaration form:
 *  `declare function` is rejected outright with "needs a body (no ambient declarations)". At
 *  evaluation the interpreter resolves a call by NAME against the running module, so the stub
 *  is never entered.
 */
function declareHelpers(m: ModuleDecl, structs: Set<string>): string[] {
  const out: string[] = []
  for (const f of m.funcs) {
    if (f.stage !== undefined) continue // an entry point is invoked by the GPU, not by a watch
    if (f.ret === undefined) continue
    const ret = sourceTypeName(f.ret)
    const zero = zeroLiteral(f.ret)
    if (ret === undefined || zero === undefined) continue
    const params: string[] = []
    let spellable = true
    for (const p of f.params) {
      const spelling = sourceTypeName(p.type)
      if (spelling === undefined) spellable = false
      else {
        params.push(`${p.name}: ${spelling}`)
        structsIn(p.type, structs)
      }
    }
    if (!spellable) continue
    structsIn(f.ret, structs)
    out.push(`function ${f.name}(${params.join(', ')}): ${ret} { return ${zero} }`)
  }
  return out
}

const FN = '__typeshade_watch__'
const VALUE = '__typeshade_watch_value__'

/** Compile one watch expression against the names a paused frame can see.
 *
 *  `scope` is every name the expression may use and the type the session recorded for it: a
 *  frame's parameters and locals, and the module's bindings. A name whose type has no
 *  source-language spelling is skipped; see the module header.
 *
 *  Exported from `typeshade/debug`.
 *
 *  @param m - the module being debugged, for its structs and helpers.
 *  @param scope - name to declared type, for everything in scope at the pause.
 *  @param expression - the watch text, exactly as the user typed it.
 *  @returns the lowered expression, its type, and the names it reads.
 *  @throws {@link DebugWatchError} when the text does not compile in that scope.
 *
 *  @example
 *  ```ts
 *  const w = compileWatch(module, frame.localTypes, 'length(p.xy) * 2.')
 *  console.log(w.type) // { kind: 'scalar', scalar: 'f32' }
 *  ```
 */
export function compileWatch(
  m: ModuleDecl,
  scope: ReadonlyMap<string, ShaderType>,
  expression: string,
): CompiledWatch {
  const trimmed = expression.trim()
  if (trimmed === '') throw new DebugWatchError(expression, ['the expression is empty'])

  const structs = new Set<string>()
  const params: string[] = []
  const bound: string[] = []
  for (const [name, type] of scope) {
    const spelling = sourceTypeName(type)
    if (spelling === undefined) continue
    params.push(`${name}: ${spelling}`)
    bound.push(name)
    structsIn(type, structs)
  }
  const helpers = declareHelpers(m, structs)

  const source = [
    '"use typeshade"',
    ...declareStructs(m.structs, structs),
    ...helpers,
    `export function ${FN}(${params.join(', ')}): void {`,
    // Parenthesised so the text cannot escape into the DECLARATION LIST. Without the
    // parentheses `a, c: f32 = 1.` is a second declarator rather than part of the expression:
    // it compiles cleanly, the statement this reads back is still `const … = a`, and the watch
    // silently answers `a` for a text that asked something else. With them it is a syntax
    // error, which is the right answer to a text that is not one expression.
    `  const ${VALUE} = (${trimmed})`,
    '}',
  ].join('\n')

  // `checkReservedNames: false` because the two names this file wraps the expression in,
  // `__typeshade_watch__` and its value local, deliberately begin with two underscores — the
  // one shape no author name can take, and one WGSL reserves for that reason (#103). Nothing
  // here is emitted: the watch runs on the CPU oracle.
  const r = compileTsSource(source, {
    fileName: `watch:${trimmed}`,
    emit: false,
    checkReservedNames: false,
  })
  const errors = r.diagnostics.filter((d) => d.category === 'error').map((d) => d.message)
  if (errors.length > 0) throw new DebugWatchError(expression, errors)

  const fn = r.funcs.find((f) => f.name === FN)
  const stmt = fn?.body[0]
  if (!fn || stmt?.s !== 'let' || stmt.name !== VALUE) {
    // Unreachable through the front end as it stands: a source with no error diagnostic always
    // lowers this one function to this one statement. Named rather than asserted so that a
    // future lowering change is reported here instead of throwing on `undefined`.
    throw new DebugWatchError(expression, ['the compiler did not lower the watch to a value'])
  }
  const reads = new Set<string>()
  collectReads(stmt.expr, reads)
  return { expr: stmt.expr, type: stmt.expr.type, reads: bound.filter((n) => reads.has(n)) }
}

/** Every name the expression reads, so a caller binds what it uses and nothing else.
 *
 *  The walk is `eachExpr` (`core/ir/visit.ts`), the IR's own, rather than a private copy of it.
 *  It used to be a private copy, and the copy is what made `c ? a : b` fail: it had no `select`
 *  arm, so the names inside a conditional were never collected, the watch compiled, and it then
 *  died at evaluation with `unbound c` because `reads` is what decides which frame values get
 *  bound. `matchExpr` was missing for the same reason and happens to be unreachable here, since
 *  the source front end never builds one; unreachable today is not a property worth relying on.
 *
 *  A hand-maintained second walk over a union that grows cannot be kept right by care, because
 *  its `default` arm makes every omission compile. `eachExpr` is the walk every pass already
 *  uses and is exhaustive by construction, so a new `Expr` shape reaches this the day it lands.
 */
function collectReads(e: Expr, into: Set<string>): void {
  eachExpr(e, (x) => {
    if (x.op === 'varref' || x.op === 'param') into.add(x.name)
  })
}

/** A watch's answer.
 *
 *  Exported from `typeshade/debug`.
 */
export interface DebugWatchValue {
  /** The value, in the CPU value model: a number, a flat array, an object by field name. */
  readonly value: CpuValue
  /** The type the compiler gave the expression, for rendering it. */
  readonly type: ShaderType
  /** Whether the answer is a stand-in rather than a result: the expression read a name the
   *  frame had marked, or called a helper that reached a GPU stub. The same meaning as
   *  `DebugStackFrame.stubbedLocals`, applied to a value that has no name, and the only thing
   *  distinguishing `d * 1000.` from `clean * 1000.` when a stub made both of them zero. */
  readonly stubbed: boolean
}

/** A cache key for one compiled watch: the text, plus the SHAPE of the scope it was compiled
 *  against: the names and their types, never the values.
 *
 *  That is what makes stepping with a watch box open cost one compile rather than one per
 *  step: the same text over the same names at the same types lowers to the same expression
 *  whatever the numbers are. It changes when the frame does, which is exactly when the
 *  lowering could differ.
 *
 *  @internal
 */
export function watchCacheKey(scope: ReadonlyMap<string, ShaderType>, expression: string): string {
  const shape = [...scope]
    .map(([n, t]) => `${n}:${typeKey(t)}`)
    .sort()
    .join(',')
  return `${shape} ${expression.trim()}`
}
