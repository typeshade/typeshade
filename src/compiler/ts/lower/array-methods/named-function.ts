import ts from 'typescript';
import type { FuncDecl } from '../../../../core/ir/nodes.js';
import type { TsCompilerDiagnostic } from '../../source-file.js';
import { type LoweringScope } from '../../context.js';
import { TS_CODES } from '../../codes.js';
import { namesInScope, unknownNameRemedy } from '../../unknown-names.js';
import { captureArguments, namesLocalFunction } from '../local-functions.js';
import { constructorCallbackMessage, isValueConstructor } from '../constructors.js';
import { misfit, type FunctionShape } from '../function-types.js';
import { push } from '../array-methods.js';

export function namedFunction(
  x: ts.Identifier,
  most: number,
  shapeOf: (n: number) => FunctionShape,
  shown: string,
  hint: string,
  fixed: boolean,
  recvText: string,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): FuncDecl | undefined {
  const decl = scope.resolveCallee(x.text);
  if (decl !== undefined && isValueConstructor(x.text) && !namesLocalFunction(x)) {
    return push(
      diagnostics,
      sourceFile,
      x,
      constructorCallbackMessage(x.text, `"${shown}"`),
      TS_CODES.TYPE_MISMATCH,
    );
  }
  if (decl === undefined) {
    if (scope.declarationRefused(x.text)) return undefined;
    const remedy = unknownNameRemedy(x.text, namesInScope(x, 'callee'));
    const message = scope.isGenericFunction(x.text)
      ? `"${x.text}" is generic, and which of its instances to hand to "${shown}" is written ` +
        `nowhere; write an arrow function that calls it here: "(…) => ${x.text}(…)".`
      : scope.resolve(x.text) !== undefined
        ? `"${x.text}" is a value, and "${shown}" takes a function: hand one over by its name, ` +
          `or write it here as an arrow function.`
        : remedy !== undefined
          ? `"${x.text}" is no function this file declares, and "${shown}" takes one. ${remedy}`
          : `"${x.text}" is no function this file declares, and "${shown}" takes one: hand over ` +
            `one the file declares, or write an arrow function that calls it here, ` +
            `"(…) => ${x.text}(…)".`;
    return push(diagnostics, sourceFile, x, message, TS_CODES.TYPE_MISMATCH);
  }
  if (decl.stage !== undefined) {
    return push(
      diagnostics,
      sourceFile,
      x,
      `"${x.text}" is a ${decl.stage} entry point, which the pipeline invokes and no call may; ` +
        `move its body into a function both can call.`,
      TS_CODES.UNSUPPORTED,
    );
  }
  if (captureArguments(decl, x.text, x, sourceFile, scope, diagnostics) === undefined) {
    return undefined;
  }
  if (!scope.calleeReady(decl, x, sourceFile, diagnostics)) return undefined;
  const own = decl.params.slice(scope.capturesOf(decl.name).length).map((p) => p.type);
  if (own.length > most) {
    return push(
      diagnostics,
      sourceFile,
      x,
      !fixed && own.length === most + 1
        ? `"${x.text}" takes the array as well, and "${recvText}" has no size before the host ` +
            `binds it: a function cannot take an array with none. Read "${recvText}" by its ` +
            `name inside it instead.`
        : `"${x.text}" takes ${String(own.length)} argument(s), and "${shown}" passes at most ` +
            `${String(most)}.`,
      TS_CODES.TYPE_MISMATCH,
    );
  }
  const why = misfit(own, decl.ret, shapeOf(own.length));
  if (why !== undefined) {
    return push(
      diagnostics,
      sourceFile,
      x,
      `"${x.text}" ${why}, so it cannot be "${hint}" of "${shown}".`,
      TS_CODES.TYPE_MISMATCH,
    );
  }
  return decl;
}
