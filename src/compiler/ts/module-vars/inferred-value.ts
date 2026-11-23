import ts from 'typescript';
import type { TsCompilerDiagnostic } from '../source-file.js';
import { TS_CODES } from '../codes.js';
import { makeDiagnostic } from '../diagnostic.js';
import { decidedType, inferenceConflict, type InferredValue } from '../use-inference.js';
import type { VarSite } from '../module-vars.js';

export function inferredModuleValue(
  decl: VarSite,
  name: string,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): InferredValue {
  const conflict = inferenceConflict(sourceFile, decl);
  if (conflict !== undefined) {
    diagnostics.push(makeDiagnostic(sourceFile, decl.name, conflict, TS_CODES.TYPE_MISMATCH));
  }
  const type = decidedType(sourceFile, decl);
  const shown = ts.isIdentifier(decl.name) ? decl.name.text : name;
  return {
    decl,
    key: decl,
    name: shown,
    written: decl.initializer!.getText(sourceFile).replace(/\s+/g, ' '),
    ...(type !== undefined ? { type } : {}),
  };
}
