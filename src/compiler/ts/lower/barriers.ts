// === workgroupBarrier(), storageBarrier() and textureBarrier() (roadmap 0.2 item 5, #82, §25,
// and #152 for the third) ===
//
// A barrier is a statement with no value: every invocation of the workgroup runs the
// statements before it, then every one runs on. WGSL requires it in uniform control flow, in a
// compute stage.
//
// ONE of those two rules is stated here, at the call: a barrier stands in a compute entry or a
// helper, because a vertex or fragment entry has no workgroup, and that is a fact about the
// call's own stage. The UNIFORM CONTROL FLOW rule is not: it is a fact about every condition
// between the entry and the call, which no single call site can see, so §54's walk answers it
// on the assembled module. This file used to refuse every `if` and `switch` outright, which is
// stricter than the spec and than Tint — see the note at the return below for what was
// measured.
//
// `textureBarrier` (#152) is the same statement over the TEXTURE address space, and it takes
// the same two rules: measured on Tint, it is "'textureBarrier' must only be called from
// uniform control flow" inside a non-uniform `if` and "built-in cannot be used by vertex
// pipeline stage" outside a compute entry. The stage rule is stated here with the others; the
// uniform-control-flow one needs no arm of its own, because `textureBarrier` is one of
// `BARRIER_INTRINSICS` and §54's walk reads that set. It belongs to the
// `readonly_and_readwrite_storage_textures` WGSL language feature, which
// `reflect().requiredLanguageFeatures` reports for a host to check — Tint has that feature and
// compiles the call bare, so nothing else would say so.

import ts from 'typescript';
import type { Expr } from '../../../core/ir/nodes.js';
import { builtinResultType } from '../../../core/builtins/resolve.js';
import type { TsCompilerDiagnostic } from '../source-file.js';
import type { LoweringScope } from '../context.js';
import { TS_CODES, type TsCode } from '../codes.js';
import { makeDiagnostic } from '../diagnostic.js';
import { withSpan } from '../span.js';
import { rootedIn } from './expression-prop.js';

function pushDiag(
  diagnostics: TsCompilerDiagnostic[],
  sourceFile: ts.SourceFile,
  node: ts.Node,
  message: string,
  code: TsCode,
): void {
  diagnostics.push(makeDiagnostic(sourceFile, node, message, code));
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
    );
    return undefined;
  }
  const stage = scope.currentStage();
  if (stage === 'vertex' || stage === 'fragment') {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `${name}() belongs in a compute entry or a function it calls; a ${stage} entry has ` +
        `${name === 'textureBarrier' ? 'no workgroup whose texture writes it could order' : 'no workgroup to wait for'}.`,
      TS_CODES.BARRIER_PLACEMENT,
    );
    return undefined;
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
  // With the span the author wrote. Without it the §54 diagnostic fell back to the enclosing
  // declaration and underlined the entry's `@compute` decorator, pointing at the function
  // rather than at the barrier inside it.
  // No result: the row says so (0017), and a row that said otherwise would be a new builtin.
  const type = builtinResultType(name, []);
  if (type?.kind !== 'void') throw new Error(`${name}: core.def has no row that returns nothing`);
  const call: Expr = { op: 'call', type, fn: name, args: [] };
  return withSpan(call, sourceFile, node);
}

/** `workgroupUniformLoad(w)` (#152, wgsl.txt:26057): ONE value read out of workgroup memory,
 *  with a barrier on each side of the read, so every invocation of the workgroup sees the same
 *  one. It carries a barrier's placement rules for that reason, and this file's, not the
 *  generic math path's: measured on Tint, inside an `if` it is "'workgroupUniformLoad' must
 *  only be called from uniform control flow", and in a fragment entry the workgroup variable
 *  itself is "var with 'workgroup' address space cannot be used by fragment pipeline stage".
 *
 *  The argument is a place in WORKGROUP memory, not storage: `workgroupUniformLoad` of a
 *  storage pointer is "no matching call", measured. Any type that memory can hold is allowed,
 *  a vector and an array element included, and the result is that type. WGSL takes it by
 *  pointer and the registry adds the `&`, the way the atomics do. */
export function lowerWorkgroupUniformLoad(
  args: readonly Expr[],
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const name = 'workgroupUniformLoad';
  if (args.length !== 1) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `${name} expects 1 argument, got ${String(args.length)}.`,
      TS_CODES.ARITY_MISMATCH,
    );
    return undefined;
  }
  // NO stage check here, unlike the barriers above, and the absence is deliberate. The
  // argument has to be rooted in workgroup memory (below), and a workgroup VARIABLE read from a
  // render entry is already refused where it is read — `"w" is workgroup memory, which only a
  // compute entry has; a fragment entry cannot read or write it` — which fires while the
  // argument is lowered, before this function is reached. A stage arm here would be a second
  // sentence for the same mistake that no program can see, and a worse one: it would name the
  // builtin where the existing rule names the variable, which is what the author has to move.
  if (scope.inBranch()) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `${name}() must be reached by every invocation of the workgroup: move it out of the if ` +
        `or switch. It is a read between two barriers, so a branch on a value the invocations ` +
        `do not share is how a workgroup waits forever; a for loop with a constant bound is fine.`,
      TS_CODES.BARRIER_PLACEMENT,
    );
    return undefined;
  }
  const arg = args[0]!;
  if (!rootedIn(arg, scope, ['workgroup'])) {
    pushDiag(
      diagnostics,
      sourceFile,
      node.arguments[0] ?? node,
      `${name} reads WORKGROUP memory; this value is not in it. Declare the variable ` +
        `"let w: workgroup<T>" and read it as ${name}(w).`,
      TS_CODES.TYPE_MISMATCH,
    );
    return undefined;
  }
  return { op: 'call', type: arg.type, fn: name, args: [arg] };
}
