// ═══ TypeShade — public API barrel ═══
//
// The primary authoring experience is a normal TypeScript file beginning with
// `"use typeshade"`. The compiler lowers that source into the same shared IR
// used by the established low-level EDSL and backend pipeline.

// TypeShade source compiler — the author-facing `"use typeshade"` surface.
export { compile, type TsCompilerDiagnostic } from './compiler/ts/compile.js'
export {
  compileTsSource,
  isTypeshadeSource,
  type CompileTsSourceOptions,
  type CompileTsSourceResult,
} from './compiler/ts/source-file.js'
export {
  USE_TYPESHADE,
  hasUseTypeshadeDirective,
  isUseTypeshadeDirective,
  findUseTypeshadeDirective,
} from './compiler/ts/directive.js'

// IR authoring layer (types, nodes, node wrapper, builder/assemblers).
export * from './core/ir/index.js'
export * from './core/sot.js'
export * from './core/backend.js'
export * from './core/backends/wgsl.js'
export * from './core/backends/glsl.js'
export * from './core/intrinsics.js'
export { type EmitPlugin, type EmitOptions } from './core/emit.js'
export * from './core/oracle.js'
export { compileModuleJs } from './core/cpu-codegen.js'
export * from './core/reflect.js'
export { type EmitFragment, type FragmentDeclares } from './core/fragment.js'
export {
  linkVariants,
  validateVariantsWgsl,
  type GlLinker,
  type VariantLinkResult,
  type WgslValidator,
  type WgslCompiled,
  type WgslMessage,
  type VariantWgslResult,
} from './core/variant-link.js'
export { emitIdentity, type EmitTarget, type EmitIdentityInput } from './core/emit-identity.js'
export {
  buildRegistry,
  type RegistryEntry,
  type BuildRegistryOptions,
  type BuiltRegistry,
} from './core/registry.js'
export {
  variantFamily,
  selectGuardedArm,
  type VariantFamily,
  type VariantFamilySpec,
  type Variant,
  type AxisValues,
  type GuardDefines,
} from './core/variant-family.js'
export {
  semanticDiff,
  isSemanticallyEqual,
  type SemanticDiff,
  type SemanticDiffOptions,
  type SemanticAspect,
  type SemanticDiffBucket,
  type ExplainedDiffEntry,
  type ClassifiedSemanticDiff,
} from './core/semantic-diff.js'
export { type OptLevel } from './core/passes/opt/index.js'
export { ShaderDslError } from './core/diagnostics/error.js'
export { validate, ValidationError } from './core/passes/validate.js'
export { type Diagnostic } from './core/passes/lint/engine.js'
export { composeModule, type ComposeOptions } from './core/passes/compose.js'
export { renameVarrefsInFunc, rewriteExprsInFunc } from './core/passes/rename-varrefs.js'
export { lowerModule } from './core/passes/match-lower.js'
export { cse } from './core/passes/opt/cse.js'
export { autoVars } from './core/passes/opt/auto-vars.js'
export { reachFrom, type EntryReach } from './core/passes/stage-bindings.js'
export { splitF64, fp64Guard, FP64_GUARD_NAME, type Fp64GuardHandle } from './core/fp64/df64-lib.js'
export { fp64Lower, type Fp64Flavor, type Fp64LowerOptions } from './core/passes/fp64-lower.js'
export { recommendFp64Flavor, isAppleGpu, type Fp64FlavorSignals } from './core/fp64/flavor-select.js'
