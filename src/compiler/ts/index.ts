// === TypeShade TypeScript source compiler (public surface) ===
//
// Phase 1: "use typeshade" directive detection + compileTsSource entry.
// Phase 2: TypeScript type node -> TypeShade ShaderType mapping.

export {
  compileTsSource,
  isTypeshadeSource,
  type CompileTsSourceOptions,
  type CompileTsSourceResult,
  type TsCompilerDiagnostic,
} from './source-file.js'

export {
  USE_TYPESHADE,
  isUseTypeshadeDirective,
  findUseTypeshadeDirective,
  hasUseTypeshadeDirective,
} from './directive.js'

export {
  mapTsTypeToShaderType,
  lookupTypeName,
  SUPPORTED_TYPE_NAMES,
} from './type-map.js'
