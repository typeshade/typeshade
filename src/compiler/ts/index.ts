// ═══ TypeShade TypeScript source compiler (public surface) ═══
//
// Phase 1 entry points. Later phases add type mapping, expression /
// statement / function lowering and re-export from this barrel.

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
