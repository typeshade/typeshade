import ts from 'typescript';
import { isGpuBrandedType } from '../diagnostics.js';

export function completesVectorMembers(
  languageService: ts.LanguageService,
  uri: string,
  offset: number,
): boolean {
  const program = languageService.getProgram();
  const sourceFile = program?.getSourceFile(uri);
  if (program === undefined || sourceFile === undefined) return false;
  let receiver: ts.Expression | undefined;
  const visit = (node: ts.Node): void => {
    if (node.getFullStart() > offset || node.getEnd() < offset) return;
    if (ts.isPropertyAccessExpression(node) && node.expression.getEnd() < offset) {
      receiver = node.expression;
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return (
    receiver !== undefined && isGpuBrandedType(program.getTypeChecker().getTypeAtLocation(receiver))
  );
}
