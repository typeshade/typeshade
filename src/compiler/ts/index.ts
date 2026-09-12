// === TypeShade TypeScript source compiler (public surface) ===

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

export {
  compileTsSources,
  type CompileTsSourcesResult,
  type TsSourceFileInput,
} from './module.js'

export {
  MATH_FN_ALIAS,
  MATH_CONST_ALIAS,
  resolveMathFn,
  resolveMathConst,
  isCanonicalMathFn,
} from './math-alias.js'
