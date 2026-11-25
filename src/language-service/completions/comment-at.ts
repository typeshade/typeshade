import ts from 'typescript';

export function isInCommentAt(text: string, triviaStart: number, pos: number): boolean {
  const ranges = [
    ...(ts.getLeadingCommentRanges(text, triviaStart) ?? []),
    ...(ts.getTrailingCommentRanges(text, triviaStart) ?? []),
  ];
  return ranges.some((r) => {
    if (pos <= r.pos) return false;
    if (r.kind === ts.SyntaxKind.SingleLineCommentTrivia) return pos <= r.end;
    const closed = text.startsWith('*/', r.end - 2);
    return closed ? pos < r.end : pos <= r.end;
  });
}

export function triviaStartAt(slot: ts.Node, sourceFile: ts.SourceFile, pos: number): number {
  let start = slot.getFullStart();
  let node = slot;
  for (;;) {
    let holder: ts.Node | undefined;
    for (const child of node.getChildren(sourceFile)) {
      if (ts.isJSDoc(child)) continue;
      if (child.getEnd() <= pos) start = child.getEnd();
      else if (child.getFullStart() <= pos) {
        holder = child;
        break;
      }
    }
    if (holder === undefined) return start;
    node = holder;
  }
}
