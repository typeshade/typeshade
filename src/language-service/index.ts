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
// `tshc check` as a function, for a tool that reports on shader files: one check, so the
// command, the editor and an agent's tools cannot give two answers about one file (Rule 12.7).
export {
  checkDocuments,
  checkOpenDocument,
  type CheckDocument,
  type CheckOptions,
  type CheckDiagnostic,
  type CheckReport,
} from './check.js';
// The GLSL and HLSL names the compiler's refusals translate (#218), beside the ambient lib and
// the documentation tables they are checked against.
export {
  FOREIGN_NAMES,
  foreignNameRemedy,
  type ForeignName,
} from '../compiler/ts/foreign-names.js';
// A module's host face (change 0062, surface §64): the host view a type checker reads and the
// generated module a host runs, for a tool that runs host code without the Vite plugin, such as
// a playground in a browser. The function needs the TypeScript front end this subpath carries.
export {
  hostFace,
  type HostFace,
  type HostFaceOptions,
  type HostExport,
} from '../compiler/ts/host-face.js';
