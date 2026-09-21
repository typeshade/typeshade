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
  // NOT `scope.inBranch()` any more (§54). That rule refused EVERY `if` and `switch`, which
  // is stricter than both the spec and Tint: a barrier under `if (k > 0.5)` on a uniform
  // buffer value is accepted, measured on Chromium 141 and 153 alike, because every
  // invocation of the workgroup takes the same side of it. What the two refuse is a branch on
  // a value the invocations do NOT share — measured, `if (id.x > 4u)` on
  // `local_invocation_id` is `'workgroupBarrier' must only be called from uniform control
  // flow`. The uniformity walk answers exactly that question, on the assembled module where
  // it can follow a condition through the locals it came from, and it reports a barrier
  // whenever the control flow is not PROVABLY uniform — so a shape this compiler cannot read
  // keeps the refusal it had, and the relaxation only ever admits what has been proven.
  return { op: 'call', type: voidT, fn: name, args: [] }
}
