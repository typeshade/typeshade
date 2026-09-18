// === Module variables: `let x: workgroup<T>` and `let y: perInvocation<T> = init` (§24) ===
//
// Roadmap 0.2 item 5, design #82. A module-scope variable that is not a resource: WGSL's
// `var<workgroup>`, memory one workgroup's invocations share, and `var<private>`, a value each
// invocation owns for its lifetime. The surface spells the address space as a wrapper type on
// a top-level `let`, the way a resource spells it on a `declare const|let`; `declare` stays
// the mark of a value the host provides, and these are the module's own.
//
// `private<T>` was the first spelling and TypeScript refuses it: `private` is a reserved word
// in strict mode, every module is strict, and the checker reports "Identifier expected" on
// `let seed: private<u32>`. The parser alone accepts it, which is why the name survived to a
// measurement. "Per invocation" is what the address space means, so that is the name.

import ts from 'typescript'
import type { Expr, ModuleVarDecl } from '../../core/ir/nodes.js'
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

/** Whether every declaration of a top-level `let` statement carries a module-variable wrapper,
 *  which is what lets it past the top-level `let` refusal (`semantic.ts`). */
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
  if (t.kind === 'texture' || t.kind === 'sampler') {
    return `a ${t.kind} is a resource, declared bare with "declare const"`
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

/** Collect every module variable of `sourceFile`: each top-level `let` whose annotation is a
 *  module-variable wrapper. A `const` with such a wrapper, a workgroup variable with an
 *  initializer, a type the space cannot hold, and an initializer that is not a constant are
 *  each TS8033 with the fix. `consts` are the module constants an initializer may name. */
export function collectModuleVars(
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  symbols?: DeclaredSymbolSink,
  consts: readonly ScopedConst[] = [],
): ModuleVarDecl[] {
  const out: ModuleVarDecl[] = []
  const seen = new Set<string>()
  const scope = new LoweringScope(undefined, undefined)
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
    for (const decl of stmt.declarationList.declarations) {
      const space = moduleVarSpace(decl.type)
      if (space === undefined || !ts.isIdentifier(decl.name) || decl.type === undefined) continue
      const name = decl.name.text
      const word = spelled(space)
      if (isConst) {
        diagnostics.push(
          diag(
            sourceFile,
            decl,
            `"${name}" is a module variable and is declared with let, not const: ` +
              `let ${name}: ${word}<T>. A const is a module constant (§12).`,
          ),
        )
        continue
      }
      const one = lowerOne(decl, decl.type, name, space, sourceFile, scope, diagnostics)
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

function lowerOne(
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
  const type =
    mapTsTypeToShaderType(inner, sourceFile, diagnostics) ??
    (ts.isTypeReferenceNode(inner) && ts.isIdentifier(inner.typeName)
      ? structT(inner.typeName.text)
      : undefined)
  if (!type) return undefined
  const refusal = typeRefusal(type, space)
  if (refusal !== undefined) {
    diagnostics.push(
      diag(sourceFile, inner, `"${name}" cannot be a ${word}<${typeKey(type)}>: ${refusal}.`),
    )
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
  let init: Expr | undefined = lowerExpression(
    decl.initializer,
    sourceFile,
    scope,
    diagnostics,
    type,
  )
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
  // literals and module consts. Anything else is an invocation's own work.
  const folds =
    (init.op === 'lit' && typeof init.value === 'boolean') ||
    foldConstComponents(init, scope) !== undefined
  if (!folds) {
    diagnostics.push(
      diag(
        sourceFile,
        decl.initializer,
        `"${name}" needs a constant initializer (a literal, a module const, or arithmetic over ` +
          `those); "${decl.initializer.getText(sourceFile)}" is not one. Assign it inside the entry.`,
      ),
    )
    return undefined
  }
  return { name, space, type, init }
}
