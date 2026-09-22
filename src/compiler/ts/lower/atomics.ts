// === Atomics in "use typeshade" (roadmap 0.2 item 4) ===
//
// `atomic<u32>` and `atomic<i32>` are LOCATIONS in storage memory, not values: WGSL forbids
// reading, assigning or computing with one, and the only things that take one are the atomic
// builtins, which take it by pointer (`atomicAdd(&xs[i], 1u)`). This surface spells the
// location as the plain expression (`atomicAdd(xs[i], 1)`), and the WGSL writer adds the `&`.
// Three rules follow, and this file owns all three:
//
//   1. an atomic type may be declared only inside a storage binding (a binding, an array
//      element, a struct field), never as a local, a parameter or a return type;
//   2. an expression of atomic type may stand only as the first argument of an atomic builtin,
//      never read, assigned or passed elsewhere;
//   3. an atomic builtin takes such a location, rooted in a `let` (read_write) storage binding,
//      and a value of the atomic's own integer type where it takes one.

import ts from 'typescript'
import type { Expr } from '../../../core/ir/nodes.js'
import type { ShaderType } from '../../../core/ir/types.js'
import { casResultT, i32T, typeKey, u32T, voidT } from '../../../core/ir/types.js'
import { ATOMIC_INTRINSICS } from '../../../core/intrinsics.js'
import type { TsCompilerDiagnostic } from '../source-file.js'
import type { LoweringScope } from '../context.js'
import { TS_CODES, type TsCode } from '../codes.js'
import { makeDiagnostic } from '../diagnostic.js'
import { retargetIntLitCtx } from '../lit-coerce.js'
import { lowerExpression } from './expression.js'
import { rootedIn } from './expression-prop.js'

function pushDiag(
  diagnostics: TsCompilerDiagnostic[],
  sourceFile: ts.SourceFile,
  node: ts.Node,
  message: string,
  code: TsCode,
): void {
  diagnostics.push(makeDiagnostic(sourceFile, node, message, code))
}

/** The atomic type inside `t`, through arrays, or `undefined`. A struct is not looked into:
 *  the callers that have no struct table (the binding collector) ask about the declared
 *  shape, and a struct's fields are checked where the struct is declared. */
export function atomicWithin(t: ShaderType): Extract<ShaderType, { kind: 'atomic' }> | undefined {
  if (t.kind === 'atomic') return t
  if (t.kind === 'array') return atomicWithin(t.elem)
  return undefined
}

/** Rule 1. Refuse an atomic type declared as `where` (a local, a parameter, a return type),
 *  pushing the diagnostic on `node`. Returns `true` when it refused. */
export function refuseAtomicDeclaration(
  t: ShaderType | undefined,
  node: ts.Node,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  where: string,
): boolean {
  if (t === undefined) return false
  const atomic = atomicWithin(t)
  if (atomic === undefined) return false
  pushDiag(
    diagnostics,
    sourceFile,
    node,
    `${typeKey(atomic)} lives in storage or workgroup memory only: declare it inside a storage ` +
      `binding (declare let counters: storage<array<${typeKey(atomic)}>>) or a workgroup ` +
      `variable (let tile: workgroup<array<${typeKey(atomic)}, 64>>), not as ${where}.`,
    TS_CODES.UNSUPPORTED,
  )
  return true
}

/** Rule 2. Refuse an expression of atomic type anywhere but as an atomic builtin's location,
 *  pushing the diagnostic on `node`. Returns `true` when it refused. The lowering of a
 *  builtin's first argument runs with the scope's atomic-operand flag raised, which is the one
 *  place such an expression may appear. */
export function refuseBareAtomic(
  t: ShaderType,
  node: ts.Node,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): boolean {
  if (t.kind !== 'atomic' || scope.inAtomicOperand()) return false
  const text = node.getText(sourceFile)
  pushDiag(
    diagnostics,
    sourceFile,
    node,
    `"${text}" is an ${typeKey(t)}: read it with atomicLoad(${text}) and write it with ` +
      `atomicStore(${text}, v) or atomicAdd(${text}, v). An atomic is never read or assigned directly.`,
    TS_CODES.TYPE_MISMATCH,
  )
  return true
}

const locationRoot = (e: Expr): Expr =>
  e.op === 'index' || e.op === 'member' ? locationRoot(e.base) : e

/** Rule 3. `atomicAdd(xs[i], v)` and its family: the location, the access it needs, the value's
 *  type, and the call node the CPU backends and the WGSL writer take as a location. */
export function lowerAtomicCall(
  name: string,
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const sig = ATOMIC_INTRINSICS[name]
  if (sig === undefined) return undefined
  if (node.arguments.length !== sig.arity) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `${name} expects ${sig.arity} argument${sig.arity === 1 ? '' : 's'}, got ${node.arguments.length}.`,
      TS_CODES.ARITY_MISMATCH,
    )
    return undefined
  }
  const locNode = node.arguments[0]!
  scope.enterAtomicOperand()
  let loc: Expr | undefined
  try {
    loc = lowerExpression(locNode, sourceFile, scope, diagnostics)
  } finally {
    scope.exitAtomicOperand()
  }
  if (!loc) return undefined
  if (loc.type.kind !== 'atomic') {
    pushDiag(
      diagnostics,
      sourceFile,
      locNode,
      `${name} takes an atomic<u32> or atomic<i32> location (an element of a ` +
        `storage<array<atomic<u32>>>, a field of a storage struct, or a storage<atomic<u32>> ` +
        `binding), got ${typeKey(loc.type)}.`,
      TS_CODES.TYPE_MISMATCH,
    )
    return undefined
  }
  // Every atomic builtin, `atomicLoad` included, takes `ptr<storage, atomic<T>, read_write>`:
  // a `declare const` binding has read access only, and Tint refuses the call on it.
  const root = locationRoot(loc)
  const binding =
    root.op === 'varref' || root.op === 'param' ? scope.resolveIr(root.name) : undefined
  if (binding !== undefined && !binding.mutable) {
    pushDiag(
      diagnostics,
      sourceFile,
      locNode,
      `${name} needs read_write access to "${binding.name}", which is declared const; ` +
        `declare it with let.`,
      TS_CODES.CONST_ASSIGN,
    )
    return undefined
  }
  if (!rootedIn(loc, scope, ['storage', 'workgroup'])) {
    pushDiag(
      diagnostics,
      sourceFile,
      locNode,
      `${name}: "${locNode.getText(sourceFile)}" is not in a storage binding or a workgroup ` +
        `variable, the two places an atomic lives.`,
      TS_CODES.TYPE_MISMATCH,
    )
    return undefined
  }
  const elemT = loc.type.elem === 'u32' ? u32T : i32T
  const args: Expr[] = [loc]
  // The compare-and-exchange takes TWO values after the location — the value to compare
  // against and the one to store — and both are the atomic's own integer type.
  if (sig.arity === 3) {
    for (const [i, what] of [
      [1, 'compare'],
      [2, 'value'],
    ] as const) {
      const argNode = node.arguments[i]
      if (!argNode) {
        pushDiag(
          diagnostics,
          sourceFile,
          node,
          `${name} takes the location, the value to compare against and the value to store; ` +
            `got ${String(node.arguments.length)} argument(s).`,
          TS_CODES.ARITY_MISMATCH,
        )
        return undefined
      }
      let v = lowerExpression(argNode, sourceFile, scope, diagnostics)
      if (!v) return undefined
      v = retargetIntLitCtx(v, argNode, elemT)
      if (typeKey(v.type) !== typeKey(elemT)) {
        pushDiag(
          diagnostics,
          sourceFile,
          argNode,
          `${name} ${what} must be ${typeKey(elemT)} to match the ${typeKey(loc.type)}, got ` +
            `${typeKey(v.type)}.`,
          TS_CODES.TYPE_MISMATCH,
        )
        return undefined
      }
      args.push(v)
    }
    return { op: 'call', type: casResultT(loc.type.elem), fn: name, args }
  }
  if (sig.arity === 2) {
    const valueNode = node.arguments[1]!
    let value = lowerExpression(valueNode, sourceFile, scope, diagnostics)
    if (!value) return undefined
    // `atomicAdd(xs[i], 1)`: the bare integer literal takes the atomic's own integer type, as it
    // does in every other integer position (#8 A3).
    value = retargetIntLitCtx(value, valueNode, elemT)
    if (typeKey(value.type) !== typeKey(elemT)) {
      pushDiag(
        diagnostics,
        sourceFile,
        valueNode,
        `${name} value must be ${typeKey(elemT)} to match the ${typeKey(loc.type)}, got ${typeKey(value.type)}.`,
        TS_CODES.TYPE_MISMATCH,
      )
      return undefined
    }
    args.push(value)
  }
  return { op: 'call', type: sig.returns === 'void' ? voidT : elemT, fn: name, args }
}
