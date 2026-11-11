// The call of a function whose callers decide its result (Rule 8.19, change 0134 item 1): the
// call takes the copy its own use decided, its read records what that use asks
// (`use-inference.ts`), it carries the origin a `/` over it is refused by, and the hover learns
// which copy it calls.
//
// Implements: Rule 8.19 (docs/language-design.md; traced in reqs/).

import ts from 'typescript';
import type { Expr, FuncDecl } from '../../../core/ir/nodes.js';
import { markCarriedRead } from '../abstract-const.js';
import { recordCopyCall } from '../symbols.js';
import { callerDecidedCall, carriedOf, markInferredRead } from '../use-inference.js';

/** The IR call of `decl` with `args`, lowered from `node`: of `decl` itself, or of the copy the
 *  call's use asks for when the callers of `decl` decide its result. */
export function userCallExpr(
  decl: FuncDecl,
  args: readonly Expr[],
  node: ts.Node,
  sourceFile: ts.SourceFile,
): Expr {
  const site = callerDecidedCall(decl, node, sourceFile);
  const target = site?.target ?? decl;
  if (site !== undefined) {
    const named = calleeNameOf(node);
    if (named !== undefined)
      recordCopyCall(
        sourceFile,
        named,
        target.ret,
        target.params.map((p) => p.type),
      );
  }
  return markInferredRead(
    markCarriedRead(
      { op: 'call', type: target.ret, fn: target.name, args: [...args], declRef: target },
      node,
      carriedOf(undefined, site?.value),
    ),
    node,
    site?.value,
  );
}

/** The name a hover rests on for the call `node`: `g` of `g()`, `m` of `o.m()` and of a getter's
 *  read `o.m`. */
function calleeNameOf(node: ts.Node): ts.Node | undefined {
  const callee = ts.isCallExpression(node) ? node.expression : node;
  if (ts.isPropertyAccessExpression(callee)) return callee.name;
  if (ts.isIdentifier(callee)) return callee;
  return undefined;
}
