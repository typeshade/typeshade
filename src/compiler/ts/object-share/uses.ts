import ts from 'typescript';
import {
  ARRAY_MUTATORS,
  bare,
  fileFunction,
  methodWritesThis,
  writeTargets,
} from '../object-reference.js';
import { accessorMayWrite, takesThePlace } from '../object-reference/written.js';
import { Reader, isPropertyName, within } from '../source-types.js';

export type Fn = ts.FunctionLikeDeclaration;

export type Step = string | number | undefined;

export function stepsOf(place: ts.Expression): (string | number | undefined)[] {
  const steps: (string | number | undefined)[] = [];
  let at = bare(place);
  while (ts.isPropertyAccessExpression(at) || ts.isElementAccessExpression(at)) {
    if (ts.isPropertyAccessExpression(at)) steps.unshift(at.name.text);
    else {
      const index = bare(at.argumentExpression);
      steps.unshift(ts.isNumericLiteral(index) ? Number(index.text) : undefined);
    }
    at = bare(at.expression);
  }
  return steps;
}

export function usesOfDeclared(
  decl: ts.VariableDeclaration,
  region: ts.Node,
  sourceFile: ts.SourceFile,
): ts.Identifier[] {
  const out: ts.Identifier[] = [];
  const reader = new Reader(sourceFile);
  const name = (decl.name as ts.Identifier).text;
  const walk = (n: ts.Node): void => {
    if (
      ts.isIdentifier(n) &&
      n.text === name &&
      !isPropertyName(n) &&
      reader.declOf(name, n) === decl
    )
      out.push(n);
    ts.forEachChild(n, walk);
  };
  walk(region);
  return out;
}

export function objectWrittenAround(decl: ts.Node, sourceFile: ts.SourceFile): boolean {
  let owner: ts.Node = decl;
  while (owner.parent !== undefined && !ts.isFunctionLike(owner)) owner = owner.parent;
  const reader = new Reader(sourceFile);
  const loops: ts.Node[] = [];
  for (let at = decl.parent; at !== undefined && at !== owner; at = at.parent)
    if (ts.isIterationStatement(at, false)) loops.push(at);
  const intoObject = (t: ts.Expression): boolean => {
    for (let at = bare(t); ts.isPropertyAccessExpression(at) || ts.isElementAccessExpression(at);) {
      at = bare(at.expression);
      if (reader.isObject(at)) return true;
    }
    return false;
  };
  let found = false;
  const visit = (n: ts.Node, inner: boolean): void => {
    const within1 = inner || (n !== owner && ts.isFunctionLike(n));
    if (within1 || n.getStart(sourceFile) >= decl.end || loops.some((l) => within(n, l))) {
      if (writeTargets(n).some(intoObject)) found = true;
      if (accessorReceiver(n, sourceFile) !== undefined) found = true;
      if (ts.isCallExpression(n)) {
        if (ts.isPropertyAccessExpression(n.expression)) {
          const method = n.expression.name.text;
          if (ARRAY_MUTATORS.has(method) || methodWritesThis(method, sourceFile)) found = true;
        }
        const callee = fileFunction(n, sourceFile);
        n.arguments.forEach((a, i) => {
          const q = callee?.parameters[i];
          if (q !== undefined && takesThePlace(q, sourceFile) && reader.isObject(a)) found = true;
        });
      }
    }
    ts.forEachChild(n, (c) => visit(c, within1));
  };
  visit(owner, false);
  return found;
}

export function accessorReceiver(n: ts.Node, sourceFile: ts.SourceFile): ts.Expression | undefined {
  if (!ts.isPropertyAccessExpression(n)) return undefined;
  if (ts.isCallExpression(n.parent) && n.parent.expression === n) return undefined;
  return accessorMayWrite(n.name.text, sourceFile) ? n.expression : undefined;
}

export function eachRunBy(
  call: ts.Node,
  reader: Reader,
  visit: (n: ts.Node) => void,
  seen: Set<ts.Node> = new Set(),
): void {
  if (!ts.isCallExpression(call)) return;
  const local = reader.localFunction(call);
  if (local === undefined || local.body === undefined || seen.has(local)) return;
  seen.add(local);
  const walk = (n: ts.Node): void => {
    visit(n);
    eachRunBy(n, reader, visit, seen);
    ts.forEachChild(n, walk);
  };
  walk(local.body);
}

export const ASSIGNS = new Set([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
]);

export function wholeWrite(id: ts.Identifier): 'assign' | 'compound' | undefined {
  let at: ts.Node = id.parent;
  while (ts.isParenthesizedExpression(at) || ts.isArrayLiteralExpression(at)) at = at.parent;
  const targets = writeTargets(at);
  if (!targets.some((t) => bare(t) === id)) return undefined;
  return ts.isBinaryExpression(at) && ASSIGNS.has(at.operatorToken.kind) ? 'assign' : 'compound';
}

export const ownerOf = (n: ts.Node): ts.Node | undefined => {
  let at = n.parent;
  while (at !== undefined && !ts.isFunctionLike(at)) at = at.parent;
  return at;
};
