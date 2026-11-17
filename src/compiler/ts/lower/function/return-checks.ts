import ts from 'typescript';
import type { Expr, FuncDecl, Stmt } from '../../../../core/ir/nodes.js';
import type { SourceSpan } from '../../../../core/ir/span.js';
import { authorTypeText } from '../../context.js';
import { type FunctionNode } from '../function-signature.js';
import { type CaptureBinding } from '../local-functions.js';

export function decidedResultMismatch(
  node: FunctionNode,
  shown: string | undefined,
  stub: FuncDecl,
  r: { readonly expr?: Expr; readonly span?: SourceSpan },
  captures: readonly CaptureBinding[] | undefined,
  sourceFile: ts.SourceFile,
): string {
  const written =
    (node as { name?: ts.Node }).name ??
    (ts.isVariableDeclaration(node.parent) ? node.parent.name : undefined);
  const name =
    shown ?? (written !== undefined && ts.isIdentifier(written) ? written.text : stub.name);
  const got = authorTypeText(r.expr!.type);
  const text =
    r.span === undefined ? '' : sourceFile.text.slice(r.span.start, r.span.start + r.span.length);
  const captured = (captures ?? [])
    .filter((c) => c.byName)
    .map((c) => c.binding.name)
    .find((n) => new RegExp(`(^|[^\\w$])${n.replace(/\$/g, '\\$')}($|[^\\w$])`).test(text));
  if (captured !== undefined) {
    return (
      `Function "${name}" returns ${authorTypeText(stub.ret)} where its calls use it and ${got} ` +
      `at a "return" that reads "${captured}", a variable of the function around it: every copy ` +
      `of "${name}" reads the one "${captured}", which has one type (Rule 8.19). Write the type ` +
      `of "${captured}", or the return type of "${name}".`
    );
  }
  return (
    `Function "${name}" returns ${authorTypeText(stub.ret)} where its calls use it and ${got} at ` +
    `a "return"; a function returns one type (Rule 8.19): make them agree, or write the return ` +
    `type.`
  );
}

export function newlineReturnRemedy(
  sourceFile: ts.SourceFile,
  span: SourceSpan | undefined,
): string {
  if (span === undefined) return '';
  let remedy = '';
  const visit = (node: ts.Node): void => {
    if (ts.isReturnStatement(node) && node.getStart(sourceFile) === span.start) {
      if (node.expression !== undefined || node.getText(sourceFile).endsWith(';')) return;
      const parent = node.parent;
      const siblings =
        ts.isBlock(parent) || ts.isCaseClause(parent) || ts.isDefaultClause(parent)
          ? parent.statements
          : undefined;
      if (siblings === undefined) return;
      const next = siblings[siblings.indexOf(node) + 1];
      if (
        next !== undefined &&
        ts.isExpressionStatement(next) &&
        /[\r\n\u2028\u2029]/.test(sourceFile.text.slice(node.end, next.getStart(sourceFile)))
      ) {
        remedy =
          ' The newline after "return" ends the return statement in TypeScript. Put the expression on the same line, or write "return (" before the newline and close it with ");".';
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return remedy;
}

export function collectReturns(stmts: readonly Stmt[]): { expr?: Expr; span?: SourceSpan }[] {
  const out: { expr?: Expr; span?: SourceSpan }[] = [];
  const walk = (list: readonly Stmt[]) => {
    for (const s of list) {
      if (s.s === 'return') out.push(s);
      else if (s.s === 'if') {
        for (const arm of s.arms) walk(arm.body);
        if (s.elseBody) walk(s.elseBody);
      } else if (s.s === 'for') walk(s.body);
      else if (s.s === 'switch') {
        for (const c of s.cases) walk(c.body);
        if (s.defaultBody) walk(s.defaultBody);
      }
    }
  };
  walk(stmts);
  return out;
}

export function skipParens(e: ts.Expression): ts.Expression {
  let x = e;
  while (ts.isParenthesizedExpression(x)) x = x.expression;
  return x;
}
