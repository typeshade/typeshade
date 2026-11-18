import ts from 'typescript';
import { foreignNameReport } from '../../compiler/ts/semantic.js';
import { nodeAtPosition } from '../positions.js';
import type { TypeshadeDiagnostic } from '../types.js';
import { spanEnd, spanOfNode, within } from './spans.js';

export function foreignNameInRefusal(
  compilerFile: ts.SourceFile,
  diagnostic: TypeshadeDiagnostic,
  compilerErrors: readonly TypeshadeDiagnostic[],
): TypeshadeDiagnostic | undefined {
  if (diagnostic.severity !== 'error' || (diagnostic.code !== 2304 && diagnostic.code !== 2552)) {
    return undefined;
  }
  const id = nodeAtPosition(compilerFile, diagnostic.span.start);
  if (
    !ts.isIdentifier(id) ||
    id.getStart(compilerFile) !== diagnostic.span.start ||
    id.getEnd() !== spanEnd(diagnostic.span) ||
    !(
      compilerErrors.some((error) => within(diagnostic.span, error.span)) ||
      inRefusedGenericArguments(id, compilerFile, compilerErrors)
    )
  ) {
    return undefined;
  }
  const said = foreignNameReport(id);
  return said === undefined
    ? undefined
    : { ...diagnostic, message: said.message, code: said.code, source: 'typeshade' };
}

function inRefusedGenericArguments(
  id: ts.Identifier,
  compilerFile: ts.SourceFile,
  compilerErrors: readonly TypeshadeDiagnostic[],
): boolean {
  for (let at: ts.Node = id; ts.isTypeNode(at.parent); at = at.parent) {
    const generic = at.parent;
    if (
      ts.isTypeReferenceNode(generic) &&
      generic.typeArguments?.some((argument) => argument === at) === true
    ) {
      const name = spanOfNode(generic.typeName, compilerFile);
      if (
        compilerErrors.some(
          (error) => error.span.start === name.start && error.span.length === name.length,
        )
      ) {
        return true;
      }
    }
  }
  return false;
}
