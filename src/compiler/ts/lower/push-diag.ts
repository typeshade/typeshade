import type ts from 'typescript';
import type { TsCode } from '../codes.js';
import { makeDiagnostic } from '../diagnostic.js';
import type { TsCompilerDiagnostic } from '../source-file.js';

export function pushDiag(
  diagnostics: TsCompilerDiagnostic[],
  sourceFile: ts.SourceFile,
  node: ts.Node,
  message: string,
  code: TsCode,
): void {
  diagnostics.push(makeDiagnostic(sourceFile, node, message, code));
}
