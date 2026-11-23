import type ts from 'typescript';
import type { ShaderType } from '../../../../core/ir/types.js';
import type { TsCompilerDiagnostic } from '../../source-file.js';
import { authorTypeText } from '../../context.js';
import { TS_CODES } from '../../codes.js';
import { push } from '../array-methods.js';

export function searchElementRefusal(
  elem: ShaderType,
  shown: string,
  recvText: string,
  at: ts.Node,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): undefined {
  return push(
    diagnostics,
    sourceFile,
    at,
    `"${shown}" compares each element with "===", which ECMAScript reads as the same object ` +
      `for a ${authorTypeText(elem)}. It looks for an f32, i32, u32 or bool here: for any other ` +
      `element write "${recvText}.findIndex((x) => …)".`,
    TS_CODES.UNSUPPORTED,
  );
}

export function sharedFillRefusal(
  elem: ShaderType,
  shown: string,
  recvText: string,
  at: ts.Node,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): undefined {
  return push(
    diagnostics,
    sourceFile,
    at,
    `"${shown}" of a ${authorTypeText(elem)} would make every element of "${recvText}" one ` +
      `object, as ECMAScript's "fill" does, and one object shared on an existing array is not ` +
      `implemented: this is not supported yet (language design Rule 2, change 0142, stage 3). Write a loop that stores a new object in ` +
      `each element, "for (let i = 0; i < ${recvText}.length; i++) { ${recvText}[i] = { … }; }".`,
    TS_CODES.UNSUPPORTED,
  );
}
