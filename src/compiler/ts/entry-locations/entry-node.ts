import ts from 'typescript';
import { stageCallOf } from '../stage-call.js';

export function entryNode(
  sourceFile: ts.SourceFile,
  name: string,
): ts.FunctionLikeDeclaration | undefined {
  for (const st of sourceFile.statements) {
    if (ts.isFunctionDeclaration(st) && st.name?.text === name && st.body !== undefined) return st;
    const call = stageCallOf(st);
    if (call?.declaration.name.text === name) return call.fn;
  }
  return undefined;
}
