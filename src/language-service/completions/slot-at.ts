import ts from 'typescript';

function rightmostLeaf(node: ts.Node): ts.Node {
  for (;;) {
    let last: ts.Node | undefined;
    node.forEachChild((child) => {
      last = child;
    });
    if (last === undefined) return node;
    node = last;
  }
}

function isTriviaOnly(text: string, start: number, end: number): boolean {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    text,
    undefined,
    start,
    end - start,
  );
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    if (kind < ts.SyntaxKind.FirstTriviaToken || kind > ts.SyntaxKind.LastTriviaToken) return false;
  }
  return true;
}

function endsInMissingNodeBefore(node: ts.Node, sourceFile: ts.SourceFile, pos: number): boolean {
  const end = node.getEnd();
  if (end > pos) return false;
  const leaf = rightmostLeaf(node);
  if (leaf.getFullStart() !== leaf.getEnd() || leaf.getEnd() !== end) return false;
  return isTriviaOnly(sourceFile.text, end, pos);
}

export function slotAt(sourceFile: ts.SourceFile, pos: number): ts.Node {
  let node: ts.Node = sourceFile;
  for (;;) {
    let inside: ts.Node | undefined;
    let prev: ts.Node | undefined;
    let before: ts.Node | undefined;
    let last: ts.Node | undefined;
    node.forEachChild((child) => {
      const fullStart = child.getFullStart();
      const start = child.getStart(sourceFile);
      const end = child.getEnd();
      if (inside === undefined && start < pos && pos <= end) inside = child;
      if (start < pos && end <= pos) prev = child;
      if (before === undefined && fullStart <= pos && pos <= start) before = child;
      if (fullStart <= pos) last = child;
    });
    const next =
      inside ??
      (prev !== undefined && endsInMissingNodeBefore(prev, sourceFile, pos) ? prev : undefined) ??
      before ??
      (last !== undefined && last.getFullStart() === last.getEnd() ? last : undefined);
    if (next === undefined) return node;
    node = next;
  }
}
