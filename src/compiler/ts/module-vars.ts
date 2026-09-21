// === Module variables: `let seed: u32 = 7`, `let x: workgroup<T>`, `let y: perInvocation<T>` (§24) ===
//
// Roadmap 0.2 item 5, design #82. A module-scope variable that is not a resource: WGSL's
// `var<workgroup>`, memory one workgroup's invocations share, and `var<private>`, a value each
// invocation owns for its lifetime. A plain top-level `let` is the per-invocation one: that is
// what a module-level `let` means to a TypeScript reader, a value this run of the program
// owns, and in a shader the run is the invocation (GLSL spells it as a plain global for the
// same reason). The address space can also be written as a wrapper type on the annotation,
// the way a resource spells it on a `declare const|let`; `workgroup<T>` has no TypeScript
// counterpart and is never implied. `declare` stays the mark of a value the host provides, and
// these are the module's own.
//
// `private<T>` was the first spelling and TypeScript refuses it: `private` is a reserved word
// in strict mode, every module is strict, and the checker reports "Identifier expected" on
// `let seed: private<u32>`. The parser alone accepts it, which is why the name survived to a
// measurement. "Per invocation" is what the address space means, so that is the name.

import ts from 'typescript'
import type { Expr, ModuleVarDecl, StructDecl } from '../../core/ir/nodes.js'
import type { ShaderType } from '../../core/ir/types.js'
import { structT, typeKey } from '../../core/ir/types.js'
import type { TsCompilerDiagnostic } from './source-file.js'
import { LoweringScope } from './context.js'
import { TS_CODES } from './codes.js'
import { makeDiagnostic } from './diagnostic.js'
import { mapTsTypeToShaderType } from './type-map.js'
import { recordDeclaration, type DeclaredSymbolSink } from './symbols.js'
import { foldConstComponents } from './loop-bound.js'
import { retargetDeclaredIntLit } from './lit-coerce.js'
import { lowerExpression } from './lower/expression.js'
import { lowerArrayLiteral } from './lower/expression-array.js'
import { isOverrideType } from './overrides.js'
import { isFoldableConstExpr } from './module-const.js'
import type { ScopedConst } from './lower/function.js'

const WRAPPERS: Readonly<Record<string, ModuleVarDecl['space']>> = {
  workgroup: 'workgroup',
  perInvocation: 'private',
}

/** The address space a type annotation names, or `undefined` when it is not a module
 *  variable's wrapper: `workgroup<T>` and `perInvocation<T>`. */
export function moduleVarSpace(type: ts.TypeNode | undefined): ModuleVarDecl['space'] | undefined {
  if (type === undefined || !ts.isTypeReferenceNode(type) || !ts.isIdentifier(type.typeName)) {
    return undefined
  }
  return WRAPPERS[type.typeName.text]
}

/** Whether every declaration of a top-level `let` statement carries a module-variable wrapper.
 *  Since a plain top-level `let` became the per-invocation variable this no longer gates
 *  anything; it stays for callers that want to know the space was written out. */
export function isModuleVarStatement(stmt: ts.VariableStatement): boolean {
  const decls = stmt.declarationList.declarations
  return decls.length > 0 && decls.every((d) => moduleVarSpace(d.type) !== undefined)
}

const diag = (sourceFile: ts.SourceFile, node: ts.Node, message: string): TsCompilerDiagnostic =>
  makeDiagnostic(sourceFile, node, message, TS_CODES.MODULE_VAR)

/** The one word each space is spelled with on this surface, for messages. */
const spelled = (space: ModuleVarDecl['space']): string =>
  space === 'workgroup' ? 'workgroup' : 'perInvocation'

/** What a module variable's type may hold: a scalar, a vector, a matrix, a sized array or a
 *  struct of those, and in workgroup memory an atomic. Textures, samplers and runtime-sized
 *  arrays have no place in either space; an atomic in a private variable is WGSL's own rule
 *  (`atomic` types are allowed in `workgroup` and `storage` only). Returns the reason, or
 *  `undefined` when the type is fine. */
function typeRefusal(t: ShaderType, space: ModuleVarDecl['space']): string | undefined {
  if (
    t.kind === 'texture' ||
    t.kind === 'sampler' ||
    t.kind === 'storage-texture' ||
    t.kind === 'depth-texture' ||
    t.kind === 'sampler-comparison'
  ) {
    const shown =
      t.kind === 'storage-texture'
        ? 'storage texture'
        : t.kind === 'depth-texture'
          ? 'depth texture'
          : t.kind === 'sampler-comparison'
            ? 'comparison sampler'
            : t.kind
    return `a ${shown} is a resource, declared bare with "declare const"`
  }
  if (t.kind === 'array' && t.size === undefined) {
    return 'a runtime-sized array lives in a storage binding only; give this one a size, array<f32, 64>'
  }
  if (t.kind === 'array') return typeRefusal(t.elem, space)
  if (t.kind === 'atomic' && space === 'private') {
    return 'an atomic lives in storage or workgroup memory, not in a per-invocation variable'
  }
  return undefined
}

/** The shader type a module variable's annotation names: a mapped type, or a struct the file
 *  declares under that name. */
const typeOf = (
  node: ts.TypeNode,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): ShaderType | undefined =>
  mapTsTypeToShaderType(node, sourceFile, diagnostics) ??
  (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)
    ? structT(node.typeName.text)
    : undefined)

/** Whether `type` is `uniform<T>` or `storage<T>`: a binding's wrapper, which on a `let`
 *  without `declare` is a binding that lost its `declare`, not a variable. */
const resourceWrapperOf = (type: ts.TypeNode | undefined): string | undefined =>
  type !== undefined &&
  ts.isTypeReferenceNode(type) &&
  ts.isIdentifier(type.typeName) &&
  (type.typeName.text === 'uniform' || type.typeName.text === 'storage')
    ? type.typeName.text
    : undefined

/** Collect every module variable of `sourceFile`: each top-level `let` that is not a
 *  `declare`. A plain one is per-invocation; one with a wrapper is in the space the wrapper
 *  names. A `const` with such a wrapper, a workgroup variable with an initializer, a type the
 *  space cannot hold, a resource type without `declare`, a `let` with neither type nor
 *  initializer, and an initializer that is not a constant are each TS8033 with the fix.
 *  `consts` are the module constants an initializer may name, `structs` the structs a struct
 *  initializer (`let p: P = { a: 1., b: vec2(2., 3.) }`) is matched against. */
export function collectModuleVars(
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  symbols?: DeclaredSymbolSink,
  consts: readonly ScopedConst[] = [],
  structs: readonly StructDecl[] = [],
): ModuleVarDecl[] {
  const out: ModuleVarDecl[] = []
  const seen = new Set<string>()
  const scope = new LoweringScope(undefined, undefined)
  scope.setStructs(structs)
  for (const c of consts) {
    scope.define({
      kind: 'module',
      name: c.name,
      type: c.type,
      mutable: false,
      constValue: c.type.kind === 'scalar' ? c.cpuValue : undefined,
      ...(c.type.kind !== 'scalar' && c.valueExpr !== undefined ? { valueExpr: c.valueExpr } : {}),
    })
  }
  for (const stmt of sourceFile.statements) {
    if (!ts.isVariableStatement(stmt)) continue
    if (stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword)) continue
    const isConst = (stmt.declarationList.flags & ts.NodeFlags.Const) !== 0
    const isLet = (stmt.declarationList.flags & ts.NodeFlags.Let) !== 0
    // A top-level `var` is semantic.ts's refusal.
    if (!isConst && !isLet) continue
    for (const decl of stmt.declarationList.declarations) {
      const wrapper = moduleVarSpace(decl.type)
      if (isConst) {
        // A module constant is module-const.ts's; only a const that names a space is ours.
        if (wrapper === undefined) continue
        const shown = ts.isIdentifier(decl.name) ? decl.name.text : decl.name.getText(sourceFile)
        diagnostics.push(
          diag(
            sourceFile,
            decl,
            `"${shown}" is a module variable and is declared with let, not const: ` +
              `let ${shown}: ${spelled(wrapper)}<T>. A const is a module constant (§12).`,
          ),
        )
        continue
      }
      // `let q: override<f32>` is overrides.ts's refusal, with the fix (`const`).
      if (isOverrideType(decl.type)) continue
      if (!ts.isIdentifier(decl.name)) {
        diagnostics.push(
          diag(
            sourceFile,
            decl.name,
            `A module variable is one name with one type, let name: T = init; ` +
              `"${decl.name.getText(sourceFile)}" has no shader form.`,
          ),
        )
        continue
      }
      const name = decl.name.text
      const one =
        wrapper !== undefined && decl.type !== undefined
          ? lowerWrapped(decl, decl.type, name, wrapper, sourceFile, scope, diagnostics)
          : lowerPlain(decl, name, sourceFile, scope, diagnostics)
      if (!one) continue
      if (seen.has(one.name)) {
        diagnostics.push(
          makeDiagnostic(
            sourceFile,
            decl.name,
            `Duplicate module variable "${one.name}".`,
            TS_CODES.DUPLICATE_SYMBOL,
          ),
        )
        continue
      }
      seen.add(one.name)
      out.push(one)
      // Recorded as a binding for the editor: hover spells it `let name: T`, which is the
      // declaration's own shape, and a module variable is mutable by construction.
      recordDeclaration(symbols, sourceFile, decl.name, {
        name: one.name,
        kind: 'binding',
        type: one.type,
        mutable: true,
      })
    }
  }
  return out
}

/** `let x: workgroup<T>` / `let y: perInvocation<T> = init`: the space is the wrapper's. */
function lowerWrapped(
  decl: ts.VariableDeclaration,
  wrapper: ts.TypeNode,
  name: string,
  space: ModuleVarDecl['space'],
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): ModuleVarDecl | undefined {
  const word = spelled(space)
  const inner = ts.isTypeReferenceNode(wrapper) ? wrapper.typeArguments?.[0] : undefined
  if (inner === undefined) {
    diagnostics.push(diag(sourceFile, wrapper, `${word}<T> needs a type argument.`))
    return undefined
  }
  const type = typeOf(inner, sourceFile, diagnostics)
  if (!type) return undefined
  return finish(
    decl,
    inner,
    name,
    space,
    type,
    `a ${word}<${typeKey(type)}>`,
    sourceFile,
    scope,
    diagnostics,
  )
}

/** `let seed: u32 = 7`, `let hits: u32`, `let v = 1.5`: the per-invocation variable, its type
 *  from the annotation or, without one, from the initializer by §12's rule for a `const`. */
function lowerPlain(
  decl: ts.VariableDeclaration,
  name: string,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): ModuleVarDecl | undefined {
  if (decl.type !== undefined) {
    const resource = resourceWrapperOf(decl.type)
    if (resource !== undefined) {
      diagnostics.push(
        diag(
          sourceFile,
          decl,
          `"${name}" is a ${resource} binding the host provides, and needs declare: ` +
            `declare let ${name}: ${decl.type.getText(sourceFile)}.`,
        ),
      )
      return undefined
    }
    const type = typeOf(decl.type, sourceFile, diagnostics)
    if (!type) return undefined
    return finish(
      decl,
      decl.type,
      name,
      'private',
      type,
      typeKey(type),
      sourceFile,
      scope,
      diagnostics,
    )
  }
  if (decl.initializer === undefined) {
    diagnostics.push(
      diag(
        sourceFile,
        decl,
        `"${name}" needs a type or an initializer: let ${name}: f32, or let ${name} = 0.`,
      ),
    )
    return undefined
  }
  if (ts.isArrayLiteralExpression(decl.initializer)) {
    diagnostics.push(
      diag(
        sourceFile,
        decl,
        `"${name}" needs an array type to take a list: ` +
          `let ${name}: array<f32, ${decl.initializer.elements.length}> = [...].`,
      ),
    )
    return undefined
  }
  const init = lowerExpression(decl.initializer, sourceFile, scope, diagnostics)
  if (!init) return undefined
  return finish(
    decl,
    decl,
    name,
    'private',
    init.type,
    typeKey(init.type),
    sourceFile,
    scope,
    diagnostics,
    init,
  )
}

/** The rules both spellings share once the type is known: what the space may hold, no
 *  initializer on workgroup memory, and an initializer of the declared type that is a constant
 *  by §12's measure. `shown` is how a message spells the type the writer wrote; `lowered` is an
 *  initializer already lowered, when the type came from it. */
function finish(
  decl: ts.VariableDeclaration,
  typeNode: ts.Node,
  name: string,
  space: ModuleVarDecl['space'],
  type: ShaderType,
  shown: string,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
  lowered?: Expr,
): ModuleVarDecl | undefined {
  const refusal = typeRefusal(type, space)
  if (refusal !== undefined) {
    diagnostics.push(diag(sourceFile, typeNode, `"${name}" cannot be ${shown}: ${refusal}.`))
    return undefined
  }
  if (decl.initializer === undefined) return { name, space, type }
  if (space === 'workgroup') {
    diagnostics.push(
      diag(
        sourceFile,
        decl.initializer,
        `"${name}" is workgroup memory and takes no initializer: it is zero at the start of ` +
          `each workgroup. Assign it inside the entry, or make it perInvocation<T>.`,
      ),
    )
    return undefined
  }
  let init: Expr | undefined =
    lowered ??
    (ts.isArrayLiteralExpression(decl.initializer)
      ? lowerArrayLiteral(decl.initializer, type, sourceFile, scope, diagnostics)
      : lowerExpression(decl.initializer, sourceFile, scope, diagnostics, type))
  if (!init) return undefined
  init = retargetDeclaredIntLit(init, decl.initializer, type)
  if (typeKey(init.type) !== typeKey(type)) {
    diagnostics.push(
      diag(
        sourceFile,
        decl.initializer,
        `"${name}" is declared ${typeKey(type)} but its initializer is ${typeKey(init.type)}.`,
      ),
    )
    return undefined
  }
  // A constant expression by §12's measure: what the componentwise folder can evaluate over
  // literals and module consts, or for an array or a struct, which it stops at, what a
  // non-scalar module const may be built from. Anything else is an invocation's own work.
  const folds =
    (init.op === 'lit' && typeof init.value === 'boolean') ||
    foldConstComponents(init, scope) !== undefined ||
    isFoldableConstExpr(init, scope)
  if (!folds) {
    diagnostics.push(
      diag(
        sourceFile,
        decl.initializer,
        `"${name}" needs a constant initializer (a literal, a module const, arithmetic or a math ` +
          `builtin over those); "${decl.initializer.getText(sourceFile)}" is not one. Assign it inside the entry.`,
      ),
    )
    return undefined
  }
  return { name, space, type, init }
}
