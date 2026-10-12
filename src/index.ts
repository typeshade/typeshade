// ═══ TypeShade — public API barrel ═══
//
// An author writes a program as a normal TypeScript file beginning with
// `"use typeshade"`. The compiler lowers that source into the shared IR the backends
// read. The IR builder is not exported here: it is `typeshade/core/ir` (Rule 11.19).

// TypeShade source compiler — the author-facing `"use typeshade"` surface.
export { compile, type CompileOptions, type CompileResult } from './compiler/ts/compile.js';
export { type TsCompilerDiagnostic } from './compiler/ts/source-file.js';
export {
  determinismReport,
  accuracyOf,
  type DeterminismAccuracy,
  type DeterminismEntry,
  type DeterminismKind,
} from './core/passes/determinism.js';
export {
  compileTsSource,
  isTypeshadeSource,
  type CompileTsSourceOptions,
  type CompileTsSourceResult,
} from './compiler/ts/source-file.js';
export {
  USE_TYPESHADE,
  hasUseTypeshadeDirective,
  isUseTypeshadeDirective,
  findUseTypeshadeDirective,
} from './compiler/ts/directive.js';
export {
  packModule,
  packJson,
  type Pack,
  type PackBinding,
  type PackEntry,
  type PackGlCompute,
  type PackOptions,
} from './compiler/ts/pack.js';

// Editor intelligence shared by the Playground, VS Code adapter, and future LSP.
export {
  TypeshadeLanguageService,
  type TypeshadeCompletionItem,
  type TypeshadeDiagnostic,
  type TypeshadeHover,
  type TypeshadeLanguageServiceOptions,
  type TypeshadePosition,
  type TypeshadeRange,
  type TypeshadeTextSpan,
} from './language-service.js';

export * from './core/backend.js';
export * from './core/backends/wgsl.js';
// The GLSL writer's public names, by name: what the writer exports for the manifest and the
// program runtime alone (`emitGlslEntries`) is no part of the package (change 0054).
export {
  emitGlslFragment,
  emitGlslModule,
  emitGlslStages,
  glslEs300Backend,
  lowerComputeToFragment,
  type GlslEmitOptions,
} from './core/backends/glsl.js';
export * from './core/intrinsics.js';
export {
  CONSOLE_METHODS,
  decodeConsole,
  isConsoleMethod,
  type ConsoleEvent,
  type ConsoleLog,
  type ConsoleSite,
  type ConsoleMethod,
  type ConsoleSink,
} from './core/console.js';
export { type EmitPlugin, type EmitOptions } from './core/emit.js';
export * from './core/oracle.js';
export { compileModuleJs } from './core/cpu-codegen.js';
export * from './core/reflect.js';
export { type EmitFragment, type FragmentDeclares } from './core/fragment.js';
export {
  linkVariants,
  validateVariantsWgsl,
  type GlLinker,
  type VariantLinkResult,
  type WgslValidator,
  type WgslCompiled,
  type WgslMessage,
  type VariantWgslResult,
} from './core/variant-link.js';
export { emitIdentity, type EmitTarget, type EmitIdentityInput } from './core/emit-identity.js';
export {
  buildRegistry,
  type RegistryEntry,
  type BuildRegistryOptions,
  type BuiltRegistry,
} from './core/registry.js';
export {
  variantFamily,
  selectGuardedArm,
  type VariantFamily,
  type VariantFamilySpec,
  type Variant,
  type AxisValues,
  type GuardDefines,
} from './core/variant-family.js';
export {
  semanticDiff,
  isSemanticallyEqual,
  type SemanticDiff,
  type SemanticDiffOptions,
  type SemanticAspect,
  type SemanticDiffBucket,
  type ExplainedDiffEntry,
  type ClassifiedSemanticDiff,
} from './core/semantic-diff.js';
export { type OptLevel } from './core/passes/opt/index.js';
export { TypeShadeError, ShaderDslError } from './core/diagnostics/error.js';
export { validate, ValidationError } from './core/passes/validate.js';
export { type Diagnostic } from './core/passes/lint/engine.js';
export { grad, type GradOptions, type GradResult } from './core/passes/grad.js';
export {
  gradCheck,
  type GradCheckOptions,
  type GradCheckResult,
} from './core/passes/grad-check.js';
export { resident, configure, type Resident } from './core/resident.js';
export { composeModule, type ComposeOptions } from './core/passes/compose.js';
export { renameVarrefsInFunc, rewriteExprsInFunc } from './core/passes/rename-varrefs.js';
export { lowerModule } from './core/passes/match-lower.js';
export { cse } from './core/passes/opt/cse.js';
export { autoVars } from './core/passes/opt/auto-vars.js';
export { reachFrom, type EntryReach } from './core/passes/stage-bindings.js';
export {
  splitF64,
  fp64Guard,
  FP64_GUARD_NAME,
  type Fp64GuardHandle,
} from './core/fp64/df64-lib.js';
export { fp64Lower, type Fp64Flavor, type Fp64LowerOptions } from './core/passes/fp64-lower.js';
export {
  recommendFp64Flavor,
  isAppleGpu,
  type Fp64FlavorSignals,
} from './core/fp64/flavor-select.js';

// The IR's types, and the readers a tool needs to inspect what `compile()` returns (Rule 11.19,
// change 0060). The builder, its node classes and its declarators are `typeshade/core/ir` only.
// Listed in their declaration order, last among the named exports: the order in which the
// API-surface reader meets them decides how TypeScript prints a nested union, and this order
// keeps `src/__api__/surface.md` spelled as it was.
export {
  // core/ir/types.ts
  typeKey,
  typeEq,
  type Scalar,
  type TextureElem,
  type StorageTextureFormat,
  ALL_STORAGE_TEXTURE_FORMATS,
  type StorageTextureAccess,
  READ_WRITE_STORAGE_FORMATS,
  WRITE_ONLY_STORAGE_FORMATS,
  storageFormatFeature,
  type ShaderType,
  type KeyOf,
  type ElemKey,
  type ArrayElemKey,
  type ScalarKey,
  isVec,
  isScalar,
  isMat,
  isMat64,
  isF64,
  isVec64,
  // core/ir/span.ts
  sourceSpanOf,
  type SourceSpan,
  // core/ir/nodes.ts
  type BinOp,
  type CmpOp,
  type LogOp,
  type Expr,
  type Stmt,
  type RawStmt,
  type RawPayload,
  type ConstDecl,
  type OverrideDecl,
  type ModuleVarDecl,
  type StructField,
  type StructDecl,
  type AddressSpace,
  type BindingDecl,
  type ExternVarDecl,
  type FuncDecl,
  type Capability,
  ALL_CAPABILITIES,
  type DeclarableCapability,
  type ModuleDecl,
  type DiagnosticDirective,
  stageOf,
  type WorkgroupShape,
  workgroupSizeOf,
  workgroupShapeOf,
  type EntryParam,
  // core/ir/node.ts
  type NodeLike,
  type ArithArg,
  type CmpArg,
  type NonComposite,
  type SwizzleKey,
  type ScalarCastSource,
  type FloatKey,
  type Float64Key,
  type IntKey,
  type TextureLoad2dKey,
  type TextureLoadArrayKey,
  type TexelKey,
  type EnumU32,
  // core/ir/builder.ts
  type ParamSpec,
  type FnParamSpec,
  type FnHandle,
  type ExternFn,
  type UsesHandle,
  type ModuleParts,
  type ConstExprDecl,
  type OverrideHandle,
  type ExternVarHandle,
  // core/sot.ts
  type ConstHandle,
  type FieldSpec,
  type WgslBuiltinName,
  type FixedTypeBuiltinName,
  type IoStruct,
  type PlainStruct,
  type HandleArray,
  type TypeArray,
  type UniformStruct,
  type Resource,
  type StorageBuffer,
} from './core/ir/index.js';
