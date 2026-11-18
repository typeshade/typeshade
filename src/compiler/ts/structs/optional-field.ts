import type ts from 'typescript';
import type { ShaderType } from '../../../core/ir/types.js';
import type { TsCompilerDiagnostic } from '../source-file.js';
import { authorTypeText } from '../context.js';
import { optionalDeclaredType } from '../optional.js';

export function optionalFieldType(
  mapped: ShaderType | undefined,
  questionToken: ts.QuestionToken | undefined,
  field: string,
  owner: string,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): ShaderType | undefined {
  return optionalDeclaredType(
    mapped,
    questionToken,
    `"${field}?" on "${owner}"`,
    sourceFile,
    diagnostics,
    authorTypeText,
  );
}
