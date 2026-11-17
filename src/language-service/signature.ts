// === Signature help: TypeScript's own signature items (§4, §5) ===
//
// The ambient GPU types are named type aliases (`f32`, `vec4`, ...), and TypeScript's own type
// printer already prints a named alias by its name rather than expanding its branded
// structure, so `ts.displayPartsToString` over `getSignatureHelpItems`'s parts already renders
// labels with TypeShade type names with no extra work — this file is the thin, testable seam
// design doc §5's "signature help" row names, not a re-implementation.

import ts from 'typescript';
import { STAGE_CALLEES } from '../compiler/ts/stage-call.js';
import type { TypeshadeSignatureHelp } from './types.js';

/** The call around `start`, the innermost one whose arguments hold it, with the symbol of
 *  the name it calls. */
function callAround(
  languageService: ts.LanguageService,
  uri: string,
  start: number,
):
  | { call: ts.CallExpression; symbol: ts.Symbol | undefined; sourceFile: ts.SourceFile }
  | undefined {
  const program = languageService.getProgram();
  const sourceFile = program?.getSourceFile(uri);
  if (program === undefined || sourceFile === undefined) return undefined;
  let call: ts.CallExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (start < node.getFullStart() || start > node.getEnd()) return;
    if (ts.isCallExpression(node) && node.arguments.pos <= start) call = node;
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (call === undefined) return undefined;
  let callee: ts.Node = call.expression;
  if (ts.isPropertyAccessExpression(callee)) callee = callee.name;
  return { call, symbol: program.getTypeChecker().getSymbolAtLocation(callee), sourceFile };
}

/**
 * Whether the call around `start` is a stage call, `vertex(…)`, `fragment(…)`, `compute(…)` or
 * `workgroup_size(…)` written as a call and not as an attribute, of the name the ambient
 * library declares. The compiler refuses it (`TS8028`, Rule 6.7, change 0140), so no signature
 * is offered for it: the only one the library declares is the attribute's. A function of the
 * file with such a name is the file's, and its signature is shown.
 */
function isStageCall(languageService: ts.LanguageService, uri: string, start: number): boolean {
  const found = callAround(languageService, uri, start);
  if (found === undefined) return false;
  const { call, symbol, sourceFile } = found;
  return (
    ts.isIdentifier(call.expression) &&
    (STAGE_CALLEES as readonly string[]).includes(call.expression.text) &&
    !ts.isDecorator(call.parent) &&
    !(symbol?.declarations ?? []).some((d) => d.getSourceFile() === sourceFile)
  );
}

/** Signature help for the call expression at `offset` in `uri`, or `undefined` when `offset`
 * is not inside a call. */
export function getSignatureHelp(
  languageService: ts.LanguageService,
  uri: string,
  offset: number,
): TypeshadeSignatureHelp | undefined {
  const items = languageService.getSignatureHelpItems(uri, offset, undefined);
  if (!items) return undefined;
  if (isStageCall(languageService, uri, items.applicableSpan.start)) return undefined;
  return {
    signatures: items.items.map((item) => {
      const labels = item.parameters.map((p) => ts.displayPartsToString(p.displayParts));
      return {
        label:
          ts.displayPartsToString(item.prefixDisplayParts) +
          labels.join(ts.displayPartsToString(item.separatorDisplayParts)) +
          ts.displayPartsToString(item.suffixDisplayParts),
        documentation: ts.displayPartsToString(item.documentation) || undefined,
        parameters: item.parameters.map((p, i) => ({
          label: labels[i]!,
          documentation: ts.displayPartsToString(p.documentation) || undefined,
        })),
      };
    }),
    activeSignature: items.selectedItemIndex,
    activeParameter: items.argumentIndex,
  };
}
