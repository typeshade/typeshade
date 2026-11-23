// Implements: Rule 8.23 (docs/language-design.md; traced in reqs/).
import ts from 'typescript';
import { isNewObject } from '../../new-object.js';
import { bare } from '../../object-reference.js';
import { declarationOf } from '../closures.js';
import { shortText } from '../array-constructor/form.js';
import type { LoweringScope } from '../../context.js';
import type { TsCompilerDiagnostic } from '../../source-file.js';
import { TS_CODES } from '../../codes.js';
import { makeDiagnostic } from '../../diagnostic.js';

interface MadeAt {
  readonly sourceFile: ts.SourceFile;
  readonly scope: LoweringScope;
  readonly diagnostics: TsCompilerDiagnostic[];
}

const say = (at: MadeAt, node: ts.Node, message: string): void => {
  at.diagnostics.push(makeDiagnostic(at.sourceFile, node, message, TS_CODES.UNSUPPORTED));
};

interface Stored {
  readonly node: ts.Expression;
  readonly value: ts.Expression;
  readonly push: boolean;
}

function storesInto(decl: ts.VariableDeclaration, body: ts.Block): Stored[] {
  const name = (decl.name as ts.Identifier).text;
  const out: Stored[] = [];
  const names = (e: ts.Expression): boolean =>
    ts.isIdentifier(e) && e.text === name && declarationOf(e) === decl;
  const visit = (n: ts.Node): void => {
    if (ts.isFunctionLike(n)) return;
    if (
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isElementAccessExpression(bare(n.left)) &&
      names(bare((bare(n.left) as ts.ElementAccessExpression).expression))
    )
      out.push({ node: n, value: n.right, push: false });
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === 'push' &&
      names(bare(n.expression.expression)) &&
      n.arguments.length === 1
    )
      out.push({ node: n, value: n.arguments[0]!, push: true });
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(body, visit);
  return out;
}

function loopAround(n: ts.Node, body: ts.Block): ts.Node {
  for (let at = n.parent; at !== body && !ts.isFunctionLike(at); at = at.parent)
    if (ts.isIterationStatement(at, false)) return at;
  return body;
}

function usesOf(d: ts.VariableDeclaration, body: ts.Block): ts.Identifier[] {
  const name = (d.name as ts.Identifier).text;
  const out: ts.Identifier[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && n !== d.name && n.text === name && declarationOf(n) === d)
      out.push(n);
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(body, visit);
  return out;
}

const reassigned = (id: ts.Identifier): boolean => {
  const p = id.parent;
  return (
    (ts.isBinaryExpression(p) &&
      p.left === id &&
      p.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      p.operatorToken.kind <= ts.SyntaxKind.LastAssignment) ||
    ts.isPrefixUnaryExpression(p) ||
    ts.isPostfixUnaryExpression(p)
  );
};

function builtObject(value: ts.Expression, at: MadeAt): ts.VariableDeclaration | undefined {
  const v = bare(value);
  if (!ts.isIdentifier(v)) return undefined;
  const d = declarationOf(v);
  return d !== undefined &&
    ts.isVariableDeclaration(d) &&
    ts.isIdentifier(d.name) &&
    d.initializer !== undefined &&
    isNewObject(d.initializer, at.sourceFile)
    ? d
    : undefined;
}

function ownEachTime(s: Stored, all: readonly Stored[], body: ts.Block, at: MadeAt): boolean {
  if (isNewObject(s.value, at.sourceFile)) return true;
  const d = builtObject(s.value, at);
  if (d === undefined || loopAround(d, body) !== loopAround(s.node, body)) return false;
  const uses = usesOf(d, body);
  return (
    !uses.some(reassigned) &&
    all.filter((o) => bare(o.value) !== bare(s.value) && builtObject(o.value, at) === d).length ===
      0
  );
}

function oneBeforeLoops(pushes: readonly Stored[], body: ts.Block, at: MadeAt): boolean {
  const d = builtObject(pushes[0]!.value, at);
  if (d === undefined || d.parent.parent.parent !== body) return false;
  if ((d.parent.flags & ts.NodeFlags.Const) === 0) return false;
  if (pushes.some((s) => builtObject(s.value, at) !== d)) return false;
  const pushed = new Set(pushes.map((o) => bare(o.value)));
  return usesOf(d, body).every((u) => pushed.has(u));
}

export type Pushed = 'own' | 'one';

export function refuseSharedStores(
  decl: ts.VariableDeclaration,
  body: ts.Block,
  fn: string,
  at: MadeAt,
): Pushed | undefined {
  const name = (decl.name as ts.Identifier).text;
  const all = storesInto(decl, body);
  const pushes = all.filter((s) => s.push);
  for (const s of all.filter((x) => !x.push)) {
    if (ownEachTime(s, all, body, at)) continue;
    say(
      at,
      s.node,
      `"${shortText(s.node)}" stores "${shortText(s.value)}" into "${name}", the array "${fn}" ` +
        `makes and returns, and the compiler cannot tell whether another element holds the ` +
        `same object. An object in two elements of it is not supported yet: store an object ` +
        `literal, a new instance, or a const built in the same iteration.`,
    );
    return undefined;
  }
  if (pushes.every((s) => ownEachTime(s, all, body, at))) return 'own';
  if (oneBeforeLoops(pushes, body, at)) return 'one';
  const shown = pushes.find((s) => !ownEachTime(s, all, body, at))!;
  say(
    at,
    shown.node,
    `"${shortText(shown.node)}" pushes "${shortText(shown.value)}" onto "${name}", the array ` +
      `"${fn}" grows and returns, and the compiler cannot tell which of its pushes push one ` +
      `object. That is not supported yet: push a new object each time, or push only one const ` +
      `object declared before the loop and never changed.`,
  );
  return undefined;
}
