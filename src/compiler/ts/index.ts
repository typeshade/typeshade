// === TypeShade TypeScript source compiler (public surface) ===
//
// Phase 1: "use typeshade" directive detection + compileTsSource entry.
// Phase 2: TypeScript type node -> TypeShade ShaderType mapping.
// Phase 3: Expression lowering (literals, identifiers, arithmetic, compare).
// Phase 4: Statement lowering (const/let, return, if).

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
