// === TypeShade TypeScript source compiler (public surface) ===
//
// Phase 1: directive detection
// Phase 2: type mapping
// Phase 3: expression lowering
// Phase 4: statement lowering (const/let, return, if, assign)
// Phase 5: function lowering + compileTsSource fills funcs

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

export { mapTsTypeToShaderType, lookupTypeName, SUPPORTED_TYPE_NAMES } from './type-map.js'

export { LoweringScope, type Binding, type BindingKind } from './context.js'

export { lowerExpression, exprType } from './lower/expression.js'

export { lowerStatements, lowerStatement } from './lower/statement.js'

export { lowerSourceFunctions, lowerFunctionDeclaration } from './lower/function.js'
