// === workgroupBarrier() and storageBarrier() (roadmap 0.2 item 5, #82, §25) ===
//
// A barrier is a statement with no value: every invocation of the workgroup runs the
// statements before it, then every one runs on. WGSL requires it in uniform control flow, in a
// compute stage. This surface keeps the same two rules and states them at the call: a barrier
// stands in a compute entry or a helper (a vertex or fragment entry has no workgroup), and
// never inside an `if` or `switch` body, where a branch on a value the invocations do not share
// is how a workgroup waits forever. A `for` with §17's constant bound is uniform and allowed,
// which is the shape a reduction needs.

import ts from 'typescript'
import type { Expr } from '../../../core/ir/nodes.js'
import { voidT } from '../../../core/ir/types.js'
import type { TsCompilerDiagnostic } from '../source-file.js'
import type { LoweringScope } from '../context.js'
import { TS_CODES, type TsCode } from '../codes.js'
import { makeDiagnostic } from '../diagnostic.js'

function pushDiag(
  diagnostics: TsCompilerDiagnostic[],
  sourceFile: ts.SourceFile,
  node: ts.Node,
  message: string,
  code: TsCode,
): void {
  diagnostics.push(makeDiagnostic(sourceFile, node, message, code))
}

/** `workgroupBarrier()` / `storageBarrier()` as a statement: the placement rules, then the
 *  `call` node the writers spell bare and the CPU dispatch synchronizes at. */
export function lowerBarrierStatement(
  name: string,
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  if (node.arguments.length !== 0) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `${name} expects 0 arguments, got ${node.arguments.length}.`,
      TS_CODES.ARITY_MISMATCH,
    )
    return undefined
  }
  const stage = scope.currentStage()
  if (stage === 'vertex' || stage === 'fragment') {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `${name}() belongs in a compute entry or a function it calls; a ${stage} entry has no workgroup to wait for.`,
      TS_CODES.BARRIER_PLACEMENT,
    )
    return undefined
  }
  if (scope.inBranch()) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `${name}() must be reached by every invocation of the workgroup: move it out of the if or ` +
        `switch. A barrier inside a branch on a value the invocations do not share is how a ` +
        `workgroup waits forever; a for loop with a constant bound is fine.`,
      TS_CODES.BARRIER_PLACEMENT,
    )
    return undefined
  }
  return { op: 'call', type: voidT, fn: name, args: [] }
}
