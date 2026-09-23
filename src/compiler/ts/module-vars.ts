// === Module variables: `let seed: u32 = 7`, `let x: workgroup<T>` (§24) ===
//
// Roadmap 0.2 item 5, design #82. A module-scope variable that is not a resource: WGSL's
// `var<workgroup>`, memory one workgroup's invocations share, and `var<private>`, a value each
// invocation owns for its lifetime. A plain top-level `let` is the per-invocation one: that is
// what a module-level `let` means to a TypeScript reader, a value this run of the program
// owns, and in a shader the run is the invocation (GLSL spells it as a plain global for the
// same reason). Workgroup memory is the one space written out, as a wrapper type on the
// annotation the way a resource spells it on a `declare const|let`: it has no TypeScript
// counterpart, so it is never implied. `declare` stays the mark of a value the host provides,
// and these are the module's own.
//
// The private space is never spelled on this surface at all. `perInvocation<T>` (#83) was the
// wrapper for it and was removed (§24): a second spelling of the variable a plain `let`
// already declares is two ways to write one thing, so a file that still writes it is refused
// at the annotation with the plain `let` to write instead. WGSL's own name for the space could
// not be the spelling either: `private` is a reserved word in strict mode, every module is
// strict, and the checker reports "Identifier expected" on `let seed: private<u32>`. The
// parser alone accepts it, which is why that name survived to a measurement.

import ts from 'typescript'
import type { Expr, ModuleVarDecl, StructDecl } from '../../core/ir/nodes.js'
import type { ShaderType } from '../../core/ir/types.js'
import { structT, typeKey } from '../../core/ir/types.js'
import type { TsCompilerDiagnostic } from './source-file.js'
import { LoweringScope } from './context.js'
import { TS_CODES } from './codes.js'
import { makeDiagnostic } from './diagnostic.js'
import { mapTsTypeToShaderType, RETIRED_VAR_WRAPPER, retiredWrapperMessage } from './type-map.js'
import { recordDeclaration, type DeclaredSymbolSink } from './symbols.js'
import { foldConstComponents } from './loop-bound.js'
import { reportIntLitRange, retargetDeclaredIntLit } from './lit-coerce.js'
import { lowerExpression } from './lower/expression.js'
import { lowerArrayLiteral } from './lower/expression-array.js'
import { isOverrideType } from './overrides.js'
import { isFoldableConstExpr, staticConstName } from './module-const.js'
import { eachNamespaceStatement } from './namespaces.js'
import {
  emittedMemberName,
  holdsFunction,
  isStaticMember,
  shadowedStaticFields,
  writtenMemberName,
  writtenStaticFields,
} from './class-names.js'
import type { ScopedConst } from './lower/function.js'

// One row, and still a table: the private space has no spelling on this surface (see the
// header), so `workgroup` is the only wrapper, and a table keeps the shape a second space
// would need.
const WRAPPERS: Readonly<Record<string, ModuleVarDecl['space']>> = {
  workgroup: 'workgroup',
}

/** The address space a type annotation names, or `undefined` when it is not a module
 *  variable's wrapper: `workgroup<T>` is the only one. */
export function moduleVarSpace(type: ts.TypeNode | undefined): ModuleVarDecl['space'] | undefined {
  if (type === undefined || !ts.isTypeReferenceNode(type) || !ts.isIdentifier(type.typeName)) {
    return undefined
  }
  return WRAPPERS[type.typeName.text]
}

const diag = (sourceFile: ts.SourceFile, node: ts.Node, message: string): TsCompilerDiagnostic =>
  makeDiagnostic(sourceFile, node, message, TS_CODES.MODULE_VAR)

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

/** The type argument of a retired `perInvocation<T>` annotation as the author wrote it, `T`
 *  when it has none, or `undefined` when the annotation is not one. */
const retiredWrapperArg = (type: ts.TypeNode, sourceFile: ts.SourceFile): string | undefined =>
  ts.isTypeReferenceNode(type) &&
  ts.isIdentifier(type.typeName) &&
  type.typeName.text === RETIRED_VAR_WRAPPER
    ? (type.typeArguments?.[0]?.getText(sourceFile) ?? 'T')
    : undefined

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
  // A static field the file writes is a per-invocation module variable named `Cls_field`, the
  // same variable a top-level `let` is (Rule 8.13); every other static field is a module
  // constant, module-const.ts's. Walked through the namespaces as module-const.ts walks them, so
  // a class inside one loses no static to the split. `this` in an initializer is the class.
  const writtenStatics = writtenStaticFields(sourceFile)
  const classes: ts.ClassDeclaration[] = []
  eachNamespaceStatement(sourceFile.statements, sourceFile, [], (stmt) => {
    if (ts.isClassDeclaration(stmt) && stmt.name !== undefined) classes.push(stmt)
  })
  for (const cls of classes) {
    const owner = cls.name!.text
    const shadowed = shadowedStaticFields(cls)
    for (const member of cls.members) {
      if (!ts.isPropertyDeclaration(member) || !isStaticMember(member)) continue
      // A static field that holds a function is a static method, and structs.ts says so.
      if (holdsFunction(member)) continue
      if (shadowed.has(member)) continue
      const written = writtenMemberName(member.name)
      if (written === undefined || !writtenStatics.has(`${owner}.${written}`)) continue
      const name = staticConstName(owner, emittedMemberName(written))
      scope.setStaticClass(owner)
      const one = lowerPlain(member, name, sourceFile, scope, diagnostics)
      scope.setStaticClass(undefined)
      if (!one) continue
      if (seen.has(one.name)) {
        diagnostics.push(
          makeDiagnostic(
            sourceFile,
            member.name,
            `Duplicate module variable "${one.name}".`,
            TS_CODES.DUPLICATE_SYMBOL,
          ),
        )
        continue
      }
      seen.add(one.name)
      out.push(one)
      recordDeclaration(symbols, sourceFile, member.name, {
        name: one.name,
        kind: 'binding',
        type: one.type,
        mutable: true,
      })
    }
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
              `let ${shown}: workgroup<T>. A const is a module constant (§12).`,
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

/** A declaration this collector makes a module variable of: a top-level `let`, or a class's
 *  `static` field the file writes (Rule 8.13). Both carry a name, an optional annotation and an
 *  optional initializer. */
type VarSite = ts.VariableDeclaration | ts.PropertyDeclaration

/** `let x: workgroup<T>`: the space is the wrapper's, and workgroup memory is the only space
 *  this surface writes out. */
function lowerWrapped(
  decl: ts.VariableDeclaration,
  wrapper: ts.TypeNode,
  name: string,
  space: ModuleVarDecl['space'],
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): ModuleVarDecl | undefined {
  // `workgroup<T>` is the only wrapper, so it is the word every message from here spells.
  const word = 'workgroup'
  const inner = ts.isTypeReferenceNode(wrapper) ? wrapper.typeArguments?.[0] : undefined
  if (inner === undefined) {
    diagnostics.push(diag(sourceFile, wrapper, `${word}<T> needs a type argument.`))
    return undefined
  }
  const type = typeOf(inner, sourceFile, diagnostics)
  if (!type) return undefined
  // The per-invocation line to offer an author who put an initializer on workgroup memory,
  // spelled the way they wrote the inner type (`P`, `array<f32, 64>`) rather than from the
  // compiler's type key, which is not this surface's spelling: `struct:P` does not parse and
  // `vec2<f32>` is WGSL's name for `vec2`. Withheld when the private space cannot hold the
  // type, since an atomic or an array of them is refused there (WGSL's own rule, see
  // `typeRefusal`) and the offer would name a line the compiler turns down.
  const asPrivate =
    typeRefusal(type, 'private') === undefined ? inner.getText(sourceFile) : undefined
  return finish(
    decl,
    inner,
    name,
    space,
    type,
    `a ${word}<${typeKey(type)}>`,
    asPrivate,
    sourceFile,
    scope,
    diagnostics,
  )
}

/** `let seed: u32 = 7`, `let hits: u32`, `let v = 1.5`: the per-invocation variable, its type
 *  from the annotation or, without one, from the initializer by §12's rule for a `const`. */
function lowerPlain(
  decl: VarSite,
  name: string,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): ModuleVarDecl | undefined {
  if (decl.type !== undefined) {
    // `let seed: perInvocation<u32> = 7` (#83, removed in §24). Refused here, at the
    // annotation and before `typeOf` runs, so it is the author's only diagnostic: `typeOf`
    // would otherwise fall back to `structT('perInvocation')` and report a type mismatch
    // against a struct no file declares, or, with no initializer, lower a variable of it.
    const retired = retiredWrapperArg(decl.type, sourceFile)
    if (retired !== undefined) {
      diagnostics.push(
        diag(
          sourceFile,
          decl.type,
          retiredWrapperMessage(`Drop the wrapper and write let ${name}: ${retired}.`),
        ),
      )
      return undefined
    }
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
      undefined,
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
    undefined,
    sourceFile,
    scope,
    diagnostics,
    init,
  )
}

/** The rules both spaces share once the type is known: what the space may hold, no initializer
 *  on workgroup memory, and an initializer of the declared type that is a constant by §12's
 *  measure. `shown` is how a message spells the type the writer wrote; `asPrivate` is the
 *  author's own spelling of the type for the one message that offers the per-invocation line,
 *  or `undefined` when that line is not on offer (a plain `let` is already per-invocation, and
 *  a type the private space cannot hold has nowhere to go); `lowered` is an initializer already
 *  lowered, when the type came from it. */
function finish(
  decl: VarSite,
  typeNode: ts.Node,
  name: string,
  space: ModuleVarDecl['space'],
  type: ShaderType,
  shown: string,
  asPrivate: string | undefined,
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
    const move =
      asPrivate === undefined ? '' : `, or make it per-invocation: let ${name}: ${asPrivate}`
    diagnostics.push(
      diag(
        sourceFile,
        decl.initializer,
        `"${name}" is workgroup memory and takes no initializer: it is zero at the start of ` +
          `each workgroup. Assign it inside the entry${move}.`,
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
  init = reportIntLitRange(init, decl.initializer, type, sourceFile, diagnostics) ?? init
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
