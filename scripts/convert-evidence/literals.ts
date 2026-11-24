import ts from 'typescript';

export type Quote = "'" | '"' | '`';

export interface EvidenceLiteral {
  readonly file: string;
  readonly value: string;
  readonly line: number;
  readonly start: number;
  readonly end: number;
  readonly quote: Quote | undefined;
  readonly rowName: string;
  readonly covers: readonly string[];
}

function stringValue(node: ts.Expression): string | undefined {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isParenthesizedExpression(node)) return stringValue(node.expression);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = stringValue(node.left);
    const right = stringValue(node.right);
    return left === undefined || right === undefined ? undefined : left + right;
  }
  return undefined;
}

function siblingValue(row: ts.ObjectLiteralExpression, key: string): ts.Expression | undefined {
  for (const property of row.properties) {
    if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name)) {
      if (property.name.text === key) return property.initializer;
    }
  }
  return undefined;
}

function coversOf(row: ts.ObjectLiteralExpression): string[] {
  const covers = siblingValue(row, 'covers');
  if (covers === undefined || !ts.isArrayLiteralExpression(covers)) return [];
  return covers.elements.flatMap((element) => {
    const value = ts.isStringLiteralLike(element) ? element.text : undefined;
    return value === undefined ? [] : [value];
  });
}

function quoteOf(source: ts.SourceFile, node: ts.Expression): Quote | undefined {
  if (!ts.isStringLiteralLike(node)) return undefined;
  const first = node.getText(source)[0];
  return first === "'" || first === '"' || first === '`' ? first : undefined;
}

export function findEvidenceLiterals(file: string, text: string): EvidenceLiteral[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found: EvidenceLiteral[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'evidence' &&
      ts.isObjectLiteralExpression(node.parent)
    ) {
      const value = stringValue(node.initializer);
      if (value !== undefined) {
        const name = siblingValue(node.parent, 'name');
        found.push({
          file,
          value,
          line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
          start: node.initializer.getStart(source),
          end: node.initializer.getEnd(),
          quote: quoteOf(source, node.initializer),
          rowName: name !== undefined ? (stringValue(name) ?? '') : '',
          covers: coversOf(node.parent),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

export function encodeLiteral(value: string, quote: Quote): string {
  let body = value.replace(/\\/g, '\\\\');
  if (quote === '`') body = body.replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
  else body = body.replace(new RegExp(quote, 'g'), `\\${quote}`);
  return `${quote}${body}${quote}`;
}
