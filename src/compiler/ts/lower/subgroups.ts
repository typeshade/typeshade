// === The subgroup built-in functions (change 0117, surface §77) ===
//
// The 21 functions of WGSL's `subgroups` extension, typed from Tint's overload table through
// the overlay (0017): the rows say which scalars a fold takes (`fiu32_f16`, less the `f16`
// TypeShade lacks), that a vote takes a `bool`, that a ballot answers a `vec4<u32>`, and that
// a broadcast's or a shuffle's lane is a `u32`. The editor's declarations are generated from the
// same rows, so the two halves refuse the same call (Rule 12.7).
//
// Three rules the call site states, and two it leaves to a later walk:
//   - the arity, from the row, and the result type, from the first row that takes the arguments
//     (`builtinResultType`); an argument no row takes is refused in one sentence that names the
//     kinds the rows admit (Rule 12.1);
//   - the lane of `subgroupBroadcast` is a const-expression in WGSL, so it is written as a
//     number in the call; a lane computed at run time is `subgroupShuffle`'s;
//   - a bare integer literal in a lane position is a `u32`, as WGSL materialises it there.
//   - the stage (fragment or compute, never vertex) is `FRAGMENT_OR_COMPUTE_CALLS`'s over the
//     call graph, and the uniform control flow the call needs is §54's walk on the assembled
//     module, as a barrier's is.
//
// The call derives the `subgroups` capability (`passes/required-caps.ts`): WGSL refuses the
// call without `enable subgroups;`, so the use is the declaration, as it is for the subgroup
// built-in values (§50).

import ts from 'typescript';
import type { Expr } from '../../../core/ir/nodes.js';
import { u32T } from '../../../core/ir/types.js';
import { builtinResultType, supportedRows } from '../../../core/builtins/resolve.js';
import { scalarDomain, valueRowTypes } from '../../../core/builtins/row-types.js';
import { COREDEF } from '../../../core/builtins/coredef.js';
import { SUBGROUP_LANE_READS } from '../../../core/intrinsics.js';
import type { TsCompilerDiagnostic } from '../source-file.js';
import { authorTypeText } from '../context.js';
import { TS_CODES, type TsCode } from '../codes.js';
import { makeDiagnostic } from '../diagnostic.js';
import { isIntegerLiteralTree, retargetIntLitCtx } from '../lit-coerce.js';
import { withSpan } from '../span.js';

function pushDiag(
  diagnostics: TsCompilerDiagnostic[],
  sourceFile: ts.SourceFile,
  node: ts.Node,
  message: string,
  code: TsCode,
): void {
  diagnostics.push(makeDiagnostic(sourceFile, node, message, code));
}

/** The kinds the first argument of `name` may have, as the rows say: `an f32, i32 or u32, or a
 *  vector of them`, `a bool`. */
function takesSentence(name: string): string {
  const rows = supportedRows(name)
    .map((row) => ({ row, types: valueRowTypes(row) }))
    .filter((r) => r.types !== undefined);
  const scalars = new Set<string>();
  let vector = false;
  let scalar = false;
  for (const { row, types } of rows) {
    const head = types!.params[0];
    if (head === undefined) continue;
    const domain =
      head.s in row.implicit ? scalarDomain(row.implicit[head.s]!, COREDEF.matchers) : [head.s];
    for (const s of domain) scalars.add(s);
    if (head.k === 'vec') vector = true;
    else scalar = true;
  }
  const list = [...scalars];
  const named =
    list.length === 1
      ? `${list[0] === 'f32' || list[0] === 'i32' ? 'an' : 'a'} ${list[0]!}`
      : `${list[0] === 'f32' || list[0] === 'i32' ? 'an' : 'a'} ${list.slice(0, -1).join(', ')} or ${list.at(-1)!}`;
  return scalar && vector
    ? `${named}, or a vector of them`
    : vector
      ? `a vector of ${list.join(', ')}`
      : named;
}

/** `subgroupAdd(v)` and its family as a `call` the writers spell and the oracle evaluates. */
export function lowerSubgroupCall(
  name: string,
  args: Expr[],
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const rows = supportedRows(name);
  const arity = rows[0]?.params.length;
  if (arity === undefined) throw new Error(`${name}: core.def has no SUPPORTED row`);
  if (args.length !== arity) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `${name} expects ${String(arity)} argument(s), got ${String(args.length)}.`,
      TS_CODES.ARITY_MISMATCH,
    );
    return undefined;
  }
  // A lane is a `u32`: a bare integer literal there takes that kind (§10's rule for a builtin
  // whose later arguments are integers whatever the first one is).
  if (SUBGROUP_LANE_READS.has(name) && args.length === 2) {
    const laneNode = node.arguments[1]!;
    if (name === 'subgroupBroadcast' && !isIntegerLiteralTree(laneNode)) {
      pushDiag(
        diagnostics,
        sourceFile,
        laneNode,
        `subgroupBroadcast's lane is a number written in the call (a const-expression in ` +
          `WGSL). For a lane computed at run time write subgroupShuffle(e, id).`,
        TS_CODES.TYPE_MISMATCH,
      );
      return undefined;
    }
    args[1] = retargetIntLitCtx(args[1]!, laneNode, u32T);
  }
  const type = builtinResultType(
    name,
    args.map((a) => a.type),
  );
  if (type === undefined) {
    const lane = SUBGROUP_LANE_READS.has(name) && args.length === 2 ? args[1]! : undefined;
    const wrong =
      lane !== undefined && lane.type.kind === 'scalar' && lane.type.scalar === 'u32'
        ? args[0]!
        : (lane ?? args[0]!);
    const message =
      wrong === lane
        ? `${name}'s lane must be a u32; got ${authorTypeText(lane.type)}.`
        : `${name} takes ${takesSentence(name)}; got ${authorTypeText(wrong.type)}.`;
    pushDiag(
      diagnostics,
      sourceFile,
      node.arguments[wrong === lane ? 1 : 0] ?? node,
      message,
      TS_CODES.TYPE_MISMATCH,
    );
    return undefined;
  }
  const call: Expr = { op: 'call', type, fn: name, args };
  return withSpan(call, sourceFile, node);
}
