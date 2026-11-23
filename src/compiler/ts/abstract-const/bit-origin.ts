// Why: the refusal of a `/` over an integer that has no declared type says what makes the integer
// (issue 1300). A bit operator makes it in `let a = (-7 | 0)`. Inference makes it in
// `let a = ii` and `let n = xs.length`, which have no bit operator to name.
import ts from 'typescript';
import { returnsOf, skipParenNodes, writtenBitTree, writtenNumber } from './written-syntax.js';

const BIT_OPERATORS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.BarToken,
  ts.SyntaxKind.AmpersandToken,
  ts.SyntaxKind.CaretToken,
  ts.SyntaxKind.LessThanLessThanToken,
  ts.SyntaxKind.GreaterThanGreaterThanToken,
]);

const SHIFTS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.LessThanLessThanToken,
  ts.SyntaxKind.GreaterThanGreaterThanToken,
]);

const ARITHMETIC: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.MinusToken,
  ts.SyntaxKind.AsteriskToken,
  ts.SyntaxKind.PercentToken,
]);

function declarationOf(id: ts.Identifier): ts.Declaration | undefined {
  for (let n: ts.Node | undefined = id.parent; n !== undefined; n = n.parent) {
    if (ts.isFunctionLike(n)) {
      const p = n.parameters.find((q) => ts.isIdentifier(q.name) && q.name.text === id.text);
      if (p !== undefined) return p;
    }
    if (ts.isBlock(n) || ts.isSourceFile(n)) {
      for (const st of n.statements) {
        if (st.pos >= id.pos) break;
        if (!ts.isVariableStatement(st)) continue;
        const d = st.declarationList.declarations.find(
          (q) => ts.isIdentifier(q.name) && q.name.text === id.text,
        );
        if (d !== undefined) return d;
      }
    }
  }
  return undefined;
}

function functionNamed(
  sourceFile: ts.SourceFile,
  name: string,
): ts.FunctionDeclaration | undefined {
  return sourceFile.statements.find(
    (s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === name,
  );
}

type NoWrittenResult = (fn: ts.SignatureDeclaration, sourceFile: ts.SourceFile) => boolean;

function integerByBitOperator(
  node: ts.Expression,
  noWrittenResult: NoWrittenResult,
  depth = 0,
): boolean {
  const n = skipParenNodes(node);
  if (depth > 16) return false;
  if (writtenBitTree(n)) return true;
  if (ts.isPrefixUnaryExpression(n)) {
    return (
      n.operator === ts.SyntaxKind.TildeToken ||
      (n.operator === ts.SyntaxKind.MinusToken &&
        integerByBitOperator(n.operand, noWrittenResult, depth + 1))
    );
  }
  const bit = (e: ts.Expression): boolean => integerByBitOperator(e, noWrittenResult, depth + 1);
  const part = (e: ts.Expression): boolean => writtenNumber(e) !== undefined || bit(e);
  if (ts.isBinaryExpression(n)) {
    const k = n.operatorToken.kind;
    if (SHIFTS.has(k)) return part(n.left);
    if (BIT_OPERATORS.has(k)) return part(n.left) && part(n.right);
    return ARITHMETIC.has(k) && part(n.left) && part(n.right) && (bit(n.left) || bit(n.right));
  }
  if (ts.isIdentifier(n)) {
    const d = declarationOf(n);
    return (
      d !== undefined &&
      ts.isVariableDeclaration(d) &&
      d.initializer !== undefined &&
      integerByBitOperator(d.initializer, noWrittenResult, depth + 1)
    );
  }
  if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
    const fn = functionNamed(n.getSourceFile(), n.expression.text);
    return (
      fn?.body !== undefined &&
      noWrittenResult(fn, n.getSourceFile()) &&
      returnsOf(fn.body).some((e) => integerByBitOperator(e, noWrittenResult, depth + 1))
    );
  }
  return false;
}

export function divisionOrigin(
  division: { readonly node: ts.BinaryExpression; readonly subject: string },
  noWrittenResult: NoWrittenResult,
): string {
  const flat = (e: ts.Expression): string => skipParenNodes(e).getText().replace(/\s+/g, ' ');
  const operands = [division.node.left, division.node.right];
  const named = operands.filter((e) => flat(e) === division.subject);
  const bit = (named.length > 0 ? named : operands).some((e) =>
    integerByBitOperator(e, noWrittenResult),
  );
  return bit ? 'by its bit operator' : 'by inference';
}
