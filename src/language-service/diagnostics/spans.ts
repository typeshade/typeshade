import type ts from 'typescript';
import type { TypeshadeTextSpan } from '../types.js';

export const spanEnd = (span: TypeshadeTextSpan): number => span.start + span.length;

export const within = (inner: TypeshadeTextSpan, outer: TypeshadeTextSpan): boolean =>
  inner.start >= outer.start && spanEnd(inner) <= spanEnd(outer);

export const spanOfNode = (node: ts.Node, sourceFile: ts.SourceFile): TypeshadeTextSpan => {
  const start = node.getStart(sourceFile);
  return { start, length: node.getEnd() - start };
};
