import ts from 'typescript';

export function nodeAt(sourceFile: ts.SourceFile, pos: number): ts.Node | undefined {
  const holds = (n: ts.Node): boolean => n.getStart(sourceFile) <= pos && pos < n.getEnd();
  let found: ts.Node | undefined;
  let current: ts.Node | undefined = holds(sourceFile) ? sourceFile : undefined;
  // Why: children do not overlap and stand in source order, so a binary search on the ends finds the one child that holds `pos`.
  while (current !== undefined) {
    found = current;
    let next: ts.Node | undefined;
    ts.forEachChild(
      current,
      (child) => {
        if (child.pos > pos) return true;
        if (holds(child)) {
          next = child;
          return true;
        }
        return undefined;
      },
      (children) => {
        let lo = 0;
        let hi = children.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (children[mid]!.getEnd() <= pos) lo = mid + 1;
          else hi = mid;
        }
        const child = children[lo];
        if (child === undefined) return undefined;
        if (holds(child)) next = child;
        return child.pos > pos || next !== undefined ? true : undefined;
      },
    );
    current = next;
  }
  return found;
}
