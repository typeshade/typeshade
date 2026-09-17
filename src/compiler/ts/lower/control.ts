import ts from 'typescript'
import type { BinOp, Expr, Stmt } from '../../../core/ir/nodes.js'
import type { ShaderType } from '../../../core/ir/types.js'
import { isVec, isVec64, typeKey } from '../../../core/ir/types.js'
import type { TsCompilerDiagnostic } from '../source-file.js'
import type { LoweringScope } from '../context.js'
import { readOnlyPhrase } from '../context.js'
import { analyzeCountedFor, foldConstNumber, loopConditionError } from '../loop-bound.js'
import { mapTsTypeToShaderType } from '../type-map.js'
import { makeDiagnostic } from '../diagnostic.js'
import { withSpan } from '../span.js'
import { TS_CODES, type TsCode } from '../codes.js'
import { lowerExpression } from './expression.js'
import { lowerLValue, lowerStatement, lowerStatements } from './statement.js'

export function lowerFor(
  node: ts.ForStatement,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt | undefined {
  if (!node.condition) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      'for is missing an exit condition; infinite loops are not allowed.',
      TS_CODES.LOOP_INFINITE,
    )
    return undefined
  }
  if (!node.initializer || !ts.isVariableDeclarationList(node.initializer)) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      'for-init must be `let i: i32 = <const>`.',
      TS_CODES.LOOP_INDUCTION,
    )
    return undefined
  }
  if (!node.incrementor) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      'for-update is required (e.g. i++).',
      TS_CODES.LOOP_INDUCTION,
    )
    return undefined
  }
  scope.push()
  scope.enterLoop()
  try {
    const initStmt = lowerForInit(node.initializer, sourceFile, scope, diagnostics)
    if (!initStmt) return undefined
    // The `for` header's own two statements never pass through `lowerStatement`, so the
    // blanket stamp there does not reach them; give each the span of the clause it came from
    // rather than the whole loop's, so stepping a loop highlights `let i: i32 = 0` and `i++`.
    withSpan(initStmt, sourceFile, node.initializer)
    const cond = lowerExpression(node.condition, sourceFile, scope, diagnostics)
    if (!cond) return undefined
    if (typeKey(cond.type) !== 'bool') {
      pushDiag(
        diagnostics,
        sourceFile,
        node.condition,
        `for condition must be bool, got ${typeKey(cond.type)}.`,
        TS_CODES.TYPE_MISMATCH,
      )
      return undefined
    }
    const update = lowerUpdate(node.incrementor, sourceFile, scope, diagnostics)
    if (!update) return undefined
    withSpan(update, sourceFile, node.incrementor)
    const counted = analyzeCountedFor(initStmt, cond, update, scope)
    if (!counted.ok) {
      pushDiag(diagnostics, sourceFile, node, counted.message, counted.code)
      return undefined
    }
    return {
      s: 'for',
      init: initStmt,
      cond,
      update,
      body: lowerBody(node.statement, sourceFile, scope, diagnostics),
    }
  } finally {
    scope.exitLoop()
    scope.pop()
  }
}

function lowerForInit(
  list: ts.VariableDeclarationList,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt | undefined {
  const decl = list.declarations[0]
  if (!decl || list.declarations.length !== 1 || !ts.isIdentifier(decl.name)) {
    pushDiag(
      diagnostics,
      sourceFile,
      list,
      'for-init must declare exactly one identifier.',
      TS_CODES.LOOP_INDUCTION,
    )
    return undefined
  }
  if ((list.flags & ts.NodeFlags.Let) === 0) {
    pushDiag(
      diagnostics,
      sourceFile,
      list,
      'for-init must be `let` (mutable induction).',
      TS_CODES.LOOP_INDUCTION,
    )
    return undefined
  }
  const name = decl.name.text
  if (!decl.initializer) {
    pushDiag(
      diagnostics,
      sourceFile,
      decl,
      `for-init "${name}" requires an initializer.`,
      TS_CODES.LOOP_INDUCTION,
    )
    return undefined
  }
  const annotated = decl.type
    ? mapTsTypeToShaderType(decl.type, sourceFile, diagnostics)
    : undefined
  let init = lowerExpression(decl.initializer, sourceFile, scope, diagnostics)
  if (!init) return undefined
  if (annotated && init.op === 'lit' && typeof init.value === 'number') {
    init = { op: 'lit', type: annotated, value: init.value }
  }
  const type: ShaderType = annotated ?? init.type
  const k = typeKey(type)
  if (k !== 'i32' && k !== 'u32') {
    pushDiag(
      diagnostics,
      sourceFile,
      decl,
      `for induction must be i32 or u32, got ${k}.`,
      TS_CODES.LOOP_INDUCTION,
    )
    return undefined
  }
  scope.define({
    kind: 'local',
    name,
    type,
    mutable: true,
    constValue: init.op === 'lit' ? init.value : undefined,
  })
  scope.recordDeclaration(sourceFile, decl.name, { name, kind: 'local', type, mutable: true })
  return { s: 'var', name, type, init }
}

export function lowerWhile(
  node: ts.WhileStatement,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt | undefined {
  const cond = lowerExpression(node.expression, sourceFile, scope, diagnostics)
  if (!cond) return undefined
  const err = loopConditionError(cond, scope)
  if (err) {
    pushDiag(diagnostics, sourceFile, node, err.message, err.code)
    return undefined
  }
  scope.enterLoop()
  try {
    const body = lowerBody(node.statement, sourceFile, scope, diagnostics)
    const i32 = cond.op === 'compare' ? cond.a.type : cond.type
    const w = { op: 'varref' as const, type: i32, name: '_w' }
    return {
      s: 'for',
      init: { s: 'var', name: '_w', type: i32, init: { op: 'lit', type: i32, value: 0 } },
      cond,
      update: {
        s: 'assign',
        target: w,
        expr: { op: 'binop', type: i32, bop: '+', a: w, b: { op: 'lit', type: i32, value: 1 } },
      },
      body,
    }
  } finally {
    scope.exitLoop()
  }
}

export function lowerSwitch(
  node: ts.SwitchStatement,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt | undefined {
  const scrut = lowerExpression(node.expression, sourceFile, scope, diagnostics)
  if (!scrut) return undefined
  const k = typeKey(scrut.type)
  if (k !== 'i32' && k !== 'u32') {
    pushDiag(
      diagnostics,
      sourceFile,
      node.expression,
      `switch scrutinee must be i32 or u32, got ${k}.`,
      TS_CODES.TYPE_MISMATCH,
    )
    return undefined
  }
  const cases: { value: number; body: readonly Stmt[] }[] = []
  const seen = new Set<number>()
  let defaultBody: readonly Stmt[] | undefined
  // Inside the case bodies a `break` is the switch's own, not an enclosing loop's.
  scope.enterSwitch()
  try {
    for (const clause of node.caseBlock.clauses) {
      if (ts.isDefaultClause(clause)) {
        defaultBody = caseBody(clause.statements, sourceFile, scope, diagnostics)
        continue
      }
      if (clause.statements.length === 0) {
        pushDiag(
          diagnostics,
          sourceFile,
          clause,
          'switch case fall-through is not allowed.',
          TS_CODES.SWITCH_CASE,
        )
        continue
      }
      const value = caseValue(clause, k, sourceFile, scope, diagnostics)
      if (value === undefined) continue
      // Both compilers reject a repeated label, and this surface makes one easy to write
      // without seeing it: `case 1 + 1:` beside `case 2:`, or two module constants that fold
      // to the same number. Reported here rather than at the backend, where the message names
      // neither the label nor the file.
      if (seen.has(value)) {
        pushDiag(
          diagnostics,
          sourceFile,
          clause.expression,
          `Duplicate switch case ${String(value)}; each label may appear once.`,
          TS_CODES.SWITCH_CASE,
        )
        continue
      }
      seen.add(value)
      cases.push({ value, body: caseBody(clause.statements, sourceFile, scope, diagnostics) })
    }
  } finally {
    scope.exitSwitch()
  }
  return { s: 'switch', scrut, cases, defaultBody }
}

/** The compound assignments a `for` update may use: `+=`, `-=`, `*=` and `/=`. Multiplication
 *  and division are here because a loop that scales its induction variable is still counted.
 *
 *  `%=` is arithmetic too and is deliberately not here. A remainder step does not advance a
 *  counter: `i %= 3` is a fixed point after one application for every start, so the only
 *  `for` it could head is one that never exits, and taking it would mean a trip counter that
 *  has to model a sequence with no direction. The bitwise forms are out for the same reason
 *  with a different shape: a shift or a mask is not one of the sequences
 *  {@link analyzeCountedFor} can read a step out of. */
const FOR_UPDATE_OP: Readonly<Record<number, BinOp>> = {
  [ts.SyntaxKind.PlusEqualsToken]: '+',
  [ts.SyntaxKind.MinusEqualsToken]: '-',
  [ts.SyntaxKind.AsteriskEqualsToken]: '*',
  [ts.SyntaxKind.SlashEqualsToken]: '/',
}

/** The constant a `case` label selects on. A bare literal is the common form; `case -1:` is
 *  a PrefixUnaryExpression and `case MODE_B:` a module constant, and both fold to the same
 *  number the IR's `cases[].value` holds — the same fold `xs[N]` and a loop bound use, so
 *  the three places a constant has to be known at compile time agree on what counts as one.
 *
 *  `scrutKind` is the selector's own type, and the label has to fit it: the emitter spells
 *  every label with the selector's suffix, so `case -1:` on a u32 selector emitted `case -1u:`
 *  and Tint answered `no matching overload for 'operator - (u32)'`. That source was refused
 *  before this item accepted a negative label at all, so refusing it here takes nothing back. */
function caseValue(
  clause: ts.CaseClause,
  scrutKind: string,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): number | undefined {
  const expr = lowerExpression(clause.expression, sourceFile, scope, diagnostics)
  // `lowerExpression` already reported an unresolvable label (`case ZZZ:`), and a second
  // diagnostic saying it is not a constant adds nothing but noise.
  if (!expr) return undefined
  const value = foldConstNumber(expr, scope)
  if (value === undefined || !Number.isInteger(value)) {
    pushDiag(
      diagnostics,
      sourceFile,
      clause.expression,
      'switch case must be an integer constant: a literal or a module const.',
      TS_CODES.SWITCH_CASE,
    )
    return undefined
  }
  if (scrutKind === 'u32' && value < 0) {
    pushDiag(
      diagnostics,
      sourceFile,
      clause.expression,
      `switch case ${String(value)} does not fit a u32 selector.`,
      TS_CODES.SWITCH_CASE,
    )
    return undefined
  }
  return value
}

/** Lower one clause's statements, dropping a TRAILING `break`.
 *
 *  The IR switch does not fall through — WGSL's does not, and {@link emitStmt} writes the
 *  C-style `break;` GLSL needs itself — so the `break` TypeScript requires at the end of a
 *  case carries no information here, and keeping it would emit `break; break;` in GLSL and
 *  a dead `break;` in WGSL. Dropping only the last statement leaves an early
 *  `if (c) { break }` inside the case exactly where the author put it. */
function caseBody(
  statements: readonly ts.Statement[],
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt[] {
  const body = lowerStatements(statements, sourceFile, scope, diagnostics)
  if (body.length > 0 && body[body.length - 1]!.s === 'break') body.pop()
  return body
}

export function lowerUpdate(
  expr: ts.Expression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt | undefined {
  if (ts.isPrefixUnaryExpression(expr) || ts.isPostfixUnaryExpression(expr)) {
    const op = expr.operator
    if (op !== ts.SyntaxKind.PlusPlusToken && op !== ts.SyntaxKind.MinusMinusToken) {
      pushDiag(diagnostics, sourceFile, expr, 'Unsupported update operator.', TS_CODES.UNSUPPORTED)
      return undefined
    }
    const targetExpr = expr.operand
    // A member or element target (`v.x++`, `ps[i].a++`) goes through lowerLValue, which owns
    // the writability and single-component-swizzle rules; a bare identifier keeps its own
    // path so its wording is unchanged.
    const viaName = ts.isIdentifier(targetExpr)
    let target: Expr | undefined
    if (viaName && ts.isIdentifier(targetExpr)) {
      const binding = scope.resolve(targetExpr.text)
      // Two different failures, kept apart as origin/main split them: an UNKNOWN name reported
      // "it is declared with const", a statement about a declaration that does not exist.
      if (!binding) {
        pushDiag(
          diagnostics,
          sourceFile,
          expr,
          `Cannot assign to unknown name "${targetExpr.text}".`,
          TS_CODES.UNKNOWN_NAME,
        )
        return undefined
      }
      if (!binding.mutable) {
        pushDiag(
          diagnostics,
          sourceFile,
          expr,
          `Cannot assign to "${targetExpr.text}" — it is ${readOnlyPhrase(binding.kind)}.`,
          TS_CODES.CONST_ASSIGN,
        )
        return undefined
      }
      // withSpan, as origin/main's #32 gives every authored lvalue: the write position is
      // what a stepped run and a diagnostic point at, and this branch builds the target
      // itself rather than going through lowerLValue, which carries its own.
      target = withSpan(
        binding.kind === 'param'
          ? ({ op: 'param', type: binding.type, name: binding.name } as Expr)
          : ({ op: 'varref', type: binding.type, name: binding.name } as Expr),
        sourceFile,
        targetExpr,
      )
    } else {
      target = lowerLValue(targetExpr, sourceFile, scope, diagnostics)
    }
    if (!target) return undefined
    const token = op === ts.SyntaxKind.PlusPlusToken ? '++' : '--'
    if (!isSteppable(target.type)) {
      pushDiag(
        diagnostics,
        sourceFile,
        expr,
        isVec(target.type) || isVec64(target.type)
          ? `Cannot apply ${token} to ${typeKey(target.type)}: a vector has no literal to step by. Write the addition out${stepHint(target.type)}.`
          : `Cannot apply ${token} to ${typeKey(target.type)}: ${token} steps a numeric scalar (f32, i32, u32, f64).`,
        TS_CODES.ASSIGN_TARGET,
      )
      return undefined
    }
    const bop = op === ts.SyntaxKind.PlusPlusToken ? '+' : '-'
    const one: Expr = { op: 'lit', type: target.type, value: 1 }
    // A bare name keeps the assign-of-binop it has always lowered to, so its emitted text does
    // not move. A member or element target becomes an assignOp instead, so the lvalue is
    // written ONCE: `ps[i].a = (ps[i].a + 1.0)` repeats the storage load, and CSE hoisting
    // that repeated read into an immutable `let` is what made such an emit invalid. An
    // emulated-double target keeps the binop form, since the fp64 pass lowers an assignOp on
    // a vec64 target only when the value is a vec64 too (SD0041).
    if (viaName || isVec64(target.type)) {
      return {
        s: 'assign',
        target,
        expr: { op: 'binop', type: target.type, bop, a: target, b: one },
      }
    }
    return { s: 'assignOp', target, bop, expr: one }
  }
  if (ts.isBinaryExpression(expr)) {
    // All four of FOR_UPDATE_OP, not just `+=` (#8 A15). `i *= 2` and `i /= 2` are ordinary
    // counted loops — a 64-wide halving reaches its bound in six iterations — and the only
    // reason they were "Unsupported for-update" is that nothing lowered them.
    // analyzeCountedFor reads the step back out and refuses one that cannot advance.
    const bop = FOR_UPDATE_OP[expr.operatorToken.kind]
    if (bop !== undefined) {
      const left = expr.left
      if (!ts.isIdentifier(left)) return undefined
      const binding = scope.resolve(left.text)
      if (!binding) return undefined
      let rhs = lowerExpression(expr.right, sourceFile, scope, diagnostics)
      if (!rhs) return undefined
      // Any COMPILE-TIME-CONSTANT step is rebuilt as a literal of the induction variable's own
      // type, not just a bare one. Retyping only a `lit` left `i *= (1 + 1)` and `i += -2` as
      // f32 — `i *= 2.0` and `i += -2.0` into an i32 loop, which Tint and ANGLE both reject.
      // `foldConstNumber` is the fold the bound and the trip count already use, so the step the
      // emit carries and the step the counter reasons about are the same number by
      // construction. A non-constant step is left alone and refused downstream, where the
      // message can say a loop needs a constant step.
      if (isFoldableStepType(binding.type)) {
        const folded = foldConstNumber(rhs, scope)
        if (folded !== undefined) rhs = { op: 'lit', type: binding.type, value: folded }
      }
      // `i += 2` writes `i`, so the target carries the lvalue's span (#32) — for all four
      // operators, the same way main stamped the `+=`-only form this generalises.
      const target: Expr = withSpan(
        binding.kind === 'param'
          ? ({ op: 'param', type: binding.type, name: binding.name } as Expr)
          : ({ op: 'varref', type: binding.type, name: binding.name } as Expr),
        sourceFile,
        left,
      )
      return { s: 'assignOp', target, bop, expr: rhs }
    }
  }
  pushDiag(diagnostics, sourceFile, expr, 'Unsupported for-update.', TS_CODES.UNSUPPORTED)
  return undefined
}

/** The types a folded for-update step may be rebuilt as: a numeric scalar the target can
 *  spell a literal of. Narrower than {@link isSteppable}, which answers a different question
 *  and includes `f64`: an emulated double is not one literal but a `vec2<f32>` pair the fp64
 *  pass builds, so writing `{ op: 'lit', type: f64T }` here would hand the emit a node no
 *  backend spells. An f64 cannot head a counted `for` anyway (the induction variable must be
 *  i32 or u32), so nothing is lost by leaving it out. */
function isFoldableStepType(t: ShaderType): boolean {
  const k = typeKey(t)
  return k === 'f32' || k === 'i32' || k === 'u32'
}

/** The `e.g.` clause the `++` refusal on a vector carries, for the one vector kind whose
 *  written-out addition has a spelling that compiles: a native `f32` vector, where
 *  `v = v + vec3(1., 1., 1.)` is accepted. An `i32` or `u32` element rejects a bare literal
 *  one with TS8003 (`v + vec2i(1, 1)`; it takes an annotated `const one: i32 = 1` first),
 *  and an emulated-double vector has no literal spelling at all (a float literal is `f32`,
 *  so `vec3f64(1., 1., 1.)` is TS8003 too). Those kinds get no example rather than one that
 *  does not compile; each spelling here was checked by compiling it. */
function stepHint(t: ShaderType): string {
  if (!isVec(t) || t.elem !== 'f32') return ''
  return `, e.g. v = v + vec${t.n}(${Array.from({ length: t.n }, () => '1.').join(', ')})`
}

/** The types `++` and `--` can step: a numeric scalar, and nothing else. The step is one
 *  literal of the target's type, so a vector cannot be stepped at all (no vector literal has
 *  a spelling, and `v++` failed in the backend with SD0017 rather than emitting), and a bool,
 *  a struct, an array and a matrix have nothing to add `1` to: `p.q++` on a struct-typed
 *  field emitted `p.q = (p.q + 1.0)`, which Tint and ANGLE both reject and the CPU oracle
 *  evaluates to undefined. The identifier arm shares the check, which closes the same hole
 *  it has always had for a bare `q++`. */
function isSteppable(t: ShaderType): boolean {
  // A numeric SCALAR only, vectors included out. `++` builds its step as one literal of the
  // target's type, and no vector literal has a spelling: `v++` on a `vec3` and on a `vec3f64`
  // alike fails closed at emit with SD0017 ("vec constant with no valueExpr"), on `main` and on
  // this branch, for the bare name as well as for the member and element forms this item adds.
  // Measured against origin/main before narrowing this, so it refuses nothing that compiles —
  // it moves a backend failure to the source, where the message can name the fix.
  const k = typeKey(t)
  // f64 belongs here: an emulated double is a numeric scalar the fp64 pass lowers, and `s++`
  // on one emitted `s = df64_add(s, vec2<f32>(1.0, 0.0))` before this check existed. Leaving
  // it out made the check reject a program that compiled — the one thing it must not do.
  return k === 'f32' || k === 'i32' || k === 'u32' || k === 'f64'
}

function lowerBody(
  node: ts.Statement,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt[] {
  if (ts.isBlock(node)) return lowerStatements(node.statements, sourceFile, scope, diagnostics)
  const one = lowerStatement(node, sourceFile, scope, diagnostics)
  if (!one) return []
  return Array.isArray(one) ? one : [one]
}

function pushDiag(
  diagnostics: TsCompilerDiagnostic[],
  sourceFile: ts.SourceFile,
  node: ts.Node,
  message: string,
  code: TsCode,
): void {
  diagnostics.push(makeDiagnostic(sourceFile, node, message, code))
}
