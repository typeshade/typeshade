// === Public exports of the `./language-service` subpath (design doc §1, §9) ===

export type {
  TypeshadePosition,
  TypeshadeRange,
  TypeshadeTextSpan,
  TypeshadeLocation,
  TypeshadeTextEdit,
  TypeshadeSeverity,
  TypeshadeDiagnostic,
  TypeshadeCompletionKind,
  TypeshadeCompletionItem,
  TypeshadeHover,
  TypeshadeSymbolKind,
  TypeshadeDocumentSymbol,
  TypeshadeSignatureHelp,
  TypeshadeSemanticToken,
  TypeshadeSemanticTokenType,
  TypeshadeSemanticTokenModifier,
  TypeshadeCompiledOutput,
} from './types.js';

export {
  createTypeshadeLanguageService,
  AMBIENT_LIB_URI,
  type TypeshadeLanguageService,
  type TypeshadeLanguageServiceHost,
} from './service.js';

export { SHADE_DTS, WGSL_BUILTIN_NAMES, ATTRIBUTE_NAMES } from './ambient.js';
export {
  TYPE_DOCS,
  ATTRIBUTE_DOCS,
  BUILTIN_DOCS,
  FUNCTION_DOCS,
  CONSTANT_DOCS,
  MATH_MEMBER_DOCS,
} from './docs.js';
export { positionAt, offsetAt, rangeForSpan, spanForRange } from './positions.js';
