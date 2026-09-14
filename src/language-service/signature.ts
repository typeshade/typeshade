// === Signature help: TypeScript's own signature items, unchanged (design doc §4, §5) ===
//
// The ambient GPU types are named type aliases (`f32`, `vec4`, ...), and TypeScript's own type
// printer already prints a named alias by its name rather than expanding its branded
// structure, so `ts.displayPartsToString` over `getSignatureHelpItems`'s parts already renders
// labels with TypeShade type names with no extra work — this file is the thin, testable seam
// design doc §5's "signature help" row names, not a re-implementation.

import ts from 'typescript'
import type { TypeshadeSignatureHelp } from './types.js'

/** Signature help for the call expression at `offset` in `uri`, or `undefined` when `offset`
 * is not inside a call. */
export function getSignatureHelp(
  languageService: ts.LanguageService,
  uri: string,
  offset: number,
): TypeshadeSignatureHelp | undefined {
  const items = languageService.getSignatureHelpItems(uri, offset, undefined)
  if (!items) return undefined
  return {
    signatures: items.items.map((item) => ({
      label:
        ts.displayPartsToString(item.prefixDisplayParts) +
        item.parameters
          .map((p) => ts.displayPartsToString(p.displayParts))
          .join(ts.displayPartsToString(item.separatorDisplayParts)) +
        ts.displayPartsToString(item.suffixDisplayParts),
      documentation: ts.displayPartsToString(item.documentation) || undefined,
      parameters: item.parameters.map((p) => ({
        label: ts.displayPartsToString(p.displayParts),
        documentation: ts.displayPartsToString(p.documentation) || undefined,
      })),
    })),
    activeSignature: items.selectedItemIndex,
    activeParameter: items.argumentIndex,
  }
}
