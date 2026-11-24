import ts from 'typescript';

export interface Segment {
  readonly index: number;
  readonly node: ts.Statement;
  readonly from: number;
  readonly to: number;
}

export interface SegmentedSource {
  readonly prefix: string;
  readonly segments: readonly Segment[];
  readonly tail: string;
}

const directiveOf = (statement: ts.Statement): boolean =>
  ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression);

export function segmentsOf(source: ts.SourceFile): SegmentedSource {
  const text = source.text;
  let from = text.startsWith('﻿') ? 1 : 0;
  if (text.startsWith('#!', from)) {
    const end = text.indexOf('\n', from);
    from = end < 0 ? text.length : end;
  }
  const prefix = text.slice(0, from);
  const segments: Segment[] = [];
  source.statements.forEach((node, index) => {
    const trailing = ts.getTrailingCommentRanges(text, node.end);
    const to = trailing?.length ? trailing[trailing.length - 1]!.end : node.end;
    segments.push({ index, node, from, to });
    from = to;
  });
  return { prefix, segments, tail: text.slice(from) };
}

export function directiveCount(source: ts.SourceFile): number {
  const at = source.statements.findIndex((statement) => !directiveOf(statement));
  return at < 0 ? source.statements.length : at;
}
