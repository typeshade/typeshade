import ts from 'typescript';
import { normalizeLineEndings } from './units.js';

export interface FileComment {
  readonly text: string;
  readonly path: string;
  readonly line: number;
  readonly pos: number;
}

const isJSDocNode = (node: ts.Node): boolean =>
  node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode;

export function fileComments(source: ts.SourceFile, path: string): FileComment[] {
  const text = source.text;
  const seen = new Set<number>();
  const comments: FileComment[] = [];
  const take = (ranges: readonly ts.CommentRange[] | undefined): void => {
    for (const range of ranges ?? []) {
      if (seen.has(range.pos)) continue;
      seen.add(range.pos);
      comments.push({
        text: normalizeLineEndings(text.slice(range.pos, range.end)),
        path,
        line: source.getLineAndCharacterOfPosition(range.pos).line + 1,
        pos: range.pos,
      });
    }
  };
  const visit = (node: ts.Node): void => {
    if (isJSDocNode(node)) return;
    const children = node.getChildren(source);
    if (children.length === 0) {
      take(ts.getLeadingCommentRanges(text, node.getFullStart()));
      take(ts.getTrailingCommentRanges(text, node.getEnd()));
    }
    for (const child of children) visit(child);
  };
  visit(source);
  return comments;
}
