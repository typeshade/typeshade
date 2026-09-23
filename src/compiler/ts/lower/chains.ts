// === A chain of calls on one object (Rule 8.10) ===
//
// `v.setX(1.).setY(2.)`: a method whose every `return` is `return this` hands back its own
// object, so TypeScript runs the next call on the same one. A struct is a value here, and what
// such a method returns is a copy of it: a chain that went on from the copy would change the
// copy and drop it. So where a chain is the whole of a statement (the statement itself, a
// declaration's initializer, a `return`), each call but the last runs as a statement of its own
// on the object the chain starts from, in source order, and the last runs in the statement, on
// that object too. A `new` at the root is put in a temporary first: that temporary is the object
// `new V().setX(1.)` builds and the chain changes.
//
// A chain inside a larger expression keeps the copy. A call that only reads it is right as it
// is, `v.setX(1.).len()`, and one that would change it is refused where the receiver is
// lowered, with the fix (class-methods.ts).

import ts from 'typescript'
import type { Expr, Stmt } from '../../../core/ir/nodes.js'
import type { TsCompilerDiagnostic } from '../source-file.js'
import type { LoweringScope } from '../context.js'
import { lowerExpression } from './expression.js'
import { lowerCall } from './expression-call.js'
import { lowerMutatingCall } from './class-methods.js'
import { memberFunctionOf } from './class-access.js'

const unparen = (e: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(e) ? unparen(e.expression) : e

/** The object `e` reaches a member of: `o` in `o.m(...)` and in `o.x`. */
function receiverOf(e: ts.Expression): ts.Expression | undefined {
  const x = unparen(e)
  if (ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression)) {
    return x.expression.expression
  }
  if (ts.isPropertyAccessExpression(x)) return x.expression
  return undefined
}

/** A method call `o.m(...)` on a value, not on `super`. */
function isMemberCall(e: ts.Expression): e is ts.CallExpression {
  const x = unparen(e)
  return (
    ts.isCallExpression(x) &&
    ts.isPropertyAccessExpression(x.expression) &&
    x.expression.expression.kind !== ts.SyntaxKind.SuperKeyword
  )
}

/** Whether `e` names a place a chain can run on: a name, `this`, or a field or element of one,
 *  with no call anywhere in it. */
function isPlace(e: ts.Expression): boolean {
  const x = unparen(e)
  if (ts.isIdentifier(x) || x.kind === ts.SyntaxKind.ThisKeyword) return true
  if (ts.isPropertyAccessExpression(x)) return isPlace(x.expression)
  if (ts.isElementAccessExpression(x))
    return isPlace(x.expression) && !hasCall(x.argumentExpression)
  return false
}

function hasCall(e: ts.Node): boolean {
  if (ts.isCallExpression(e) || ts.isNewExpression(e)) return true
  return ts.forEachChild(e, hasCall) ?? false
}

/** A statement's own call of a method, lowered the way a call statement is: through the
 *  reference a method that changes its object takes, or as a call whose value is dropped. */
function lowerCallStatement(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt | undefined {
  const mutating = lowerMutatingCall(call, sourceFile, scope, diagnostics)
  if (mutating !== 'not-a-mutating-call') return mutating
  const lowered = lowerCall(call, sourceFile, scope, diagnostics)
  if (lowered === undefined || lowered.op !== 'call') return undefined
  return { s: 'call', expr: lowered }
}

/** The statements a chain that is the whole of `expr` runs ahead of the statement it stands
 *  in, having registered each call it ran as standing for the chain's object; `'not-a-chain'`
 *  when `expr` is none, which the statement lowers as it always has; undefined having said why
 *  a part of it does not lower.
 *
 *  It is a chain when a method that returns `this` is called and something is then reached on
 *  what it returned, or when a `new` at the root is followed by a call that changes the object
 *  it built. */
export function lowerChainPrelude(
  expr: ts.Expression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt[] | undefined | 'not-a-chain' {
  // The calls the chain runs before its last access, innermost first, and its root.
  const calls: ts.CallExpression[] = []
  let root = receiverOf(expr)
  if (root === undefined) return 'not-a-chain'
  while (isMemberCall(root)) {
    calls.unshift(unparen(root) as ts.CallExpression)
    root = receiverOf(root)!
  }
  root = unparen(root)
  const isNew = ts.isNewExpression(root)
  // Nothing run before the last access and nothing built to hold: an ordinary member access.
  if (calls.length === 0 && !isNew) return 'not-a-chain'
  if (!isNew && !isPlace(root)) return 'not-a-chain'
  // Read without reporting: what does not lower is the ordinary path's to say.
  const peek = lowerExpression(root, sourceFile, scope, [])
  if (peek === undefined || peek.type.kind !== 'struct') return 'not-a-chain'
  const struct = peek.type.name
  for (const call of calls) {
    const name = (call.expression as ts.PropertyAccessExpression).name.text
    const found = memberFunctionOf(struct, name, 'method', scope)
    if (found?.cf.returnsThis !== true || found.cf.kind !== 'method') return 'not-a-chain'
  }
  if (calls.length === 0) {
    // `new V().setX(1.)`: the one call changes the object `new` built, which has to be held.
    if (!isNew || !isMemberCall(expr)) return 'not-a-chain'
    const name = ((unparen(expr) as ts.CallExpression).expression as ts.PropertyAccessExpression)
      .name.text
    if (memberFunctionOf(struct, name, 'method', scope)?.cf.mutates !== true) return 'not-a-chain'
  }
  const prelude: Stmt[] = []
  let make: () => Expr
  if (isNew) {
    const built = lowerExpression(root, sourceFile, scope, diagnostics)
    if (built === undefined) return undefined
    const name = scope.defineTemp('_chain', built.type, true)
    prelude.push({ s: 'var', name, type: built.type, init: built })
    make = (): Expr => ({ op: 'varref', type: built.type, name })
    scope.setChainAlias(root, make)
  } else {
    const at = root
    make = (): Expr => lowerExpression(at, sourceFile, scope, [])!
  }
  for (const call of calls) {
    const stmt = lowerCallStatement(call, sourceFile, scope, diagnostics)
    if (stmt === undefined) return undefined
    prelude.push(stmt)
    scope.setChainAlias(call, make)
  }
  return prelude
}
