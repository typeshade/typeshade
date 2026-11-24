import ts from 'typescript';

export interface SyntaxItem {
  readonly kind: ts.SyntaxKind;
  readonly depth: number;
  readonly text: string | undefined;
  readonly line: number;
  readonly start: number;
}

const isJSDocNode = (node: ts.Node): boolean =>
  node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode;

export function syntaxStream(path: string, text: string): SyntaxItem[] {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const items: SyntaxItem[] = [];
  const visit = (node: ts.Node, depth: number): void => {
    if (isJSDocNode(node)) return;
    const children = node.getChildren(source);
    const start = node.getStart(source);
    items.push({
      kind: node.kind,
      depth,
      text: children.length === 0 ? text.slice(start, node.getEnd()) : undefined,
      line: source.getLineAndCharacterOfPosition(start).line + 1,
      start,
    });
    for (const child of children) visit(child, depth + 1);
  };
  visit(source, 0);
  return items;
}

export interface SyntaxDifference {
  readonly base: SyntaxItem | undefined;
  readonly head: SyntaxItem | undefined;
}

export function firstSyntaxDifference(
  base: readonly SyntaxItem[],
  head: readonly SyntaxItem[],
): SyntaxDifference | undefined {
  const length = Math.max(base.length, head.length);
  for (let at = 0; at < length; at += 1) {
    const before = base[at];
    const after = head[at];
    const same =
      before !== undefined &&
      after !== undefined &&
      before.kind === after.kind &&
      before.depth === after.depth &&
      before.text === after.text;
    if (!same) return { base: before, head: after };
  }
  return undefined;
}

export function leafStarts(path: string, text: string): number[] {
  return syntaxStream(path, text)
    .filter((item) => item.text !== undefined)
    .map((item) => item.start);
}

export function leavesBefore(starts: readonly number[], pos: number): number {
  let low = 0;
  let high = starts.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (starts[middle]! < pos) low = middle + 1;
    else high = middle;
  }
  return low;
}
