// Top-level `override` declarations — specialization constants (#8 A7).
//
//   declare const quality: override<f32>          // default 0, the pipeline supplies the rest
//   const quality: override<f32> = 1.             // declared default
//
// An override is NOT a binding and NOT a module const: it occupies no bind slot, and its
// value is unknown until a pipeline is built, so the optimizer must not fold it. `ModuleDecl`
// has carried an `overrides` array and `Expr.overrideref` all along — this is the EDSL's
// `overrideConst(name, type, default)` given a source spelling.

import ts from 'typescript'
import type { OverrideDecl } from '../../core/ir/nodes.js'
import type { ShaderType } from '../../core/ir/types.js'
import { typeKey } from '../../core/ir/types.js'
import type { TsCompilerDiagnostic } from './source-file.js'
import { mapTsTypeToShaderType } from './type-map.js'
import { recordDeclaration, type DeclaredSymbolSink } from './symbols.js'
import { TS_CODES } from './codes.js'
import { makeDiagnostic } from './diagnostic.js'

/** Whether a declaration's type annotation is `override<T>`. Read by the binding and module
 *  const collectors, which both walk the same top-level statements and must leave this one
 *  to {@link collectOverrides}. */
export function isOverrideType(type: ts.TypeNode | undefined): boolean {
  return (
    type !== undefined &&
    ts.isTypeReferenceNode(type) &&
    ts.isIdentifier(type.typeName) &&
    type.typeName.text === 'override'
  )
}

/** Every `override<T>` declared at the top level, in source order.
 *
 *  @param sourceFile - the parsed module.
 *  @param diagnostics - collected diagnostics, appended to.
 *  @param symbols - the editor's declaration sink.
 *  @returns the `OverrideDecl` list for `ModuleDecl.overrides`.
 */
export function collectOverrides(
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  symbols?: DeclaredSymbolSink,
): OverrideDecl[] {
  const out: OverrideDecl[] = []
  for (const stmt of sourceFile.statements) {
    if (!ts.isVariableStatement(stmt)) continue
    const isConst = (stmt.declarationList.flags & ts.NodeFlags.Const) !== 0
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !isOverrideType(decl.type)) continue
      const one = lowerOne(decl, isConst, sourceFile, diagnostics)
      if (!one) continue
      out.push(one)
      recordDeclaration(symbols, sourceFile, decl.name, {
        name: one.name,
        kind: 'override',
        type: one.type,
        mutable: false,
      })
    }
  }
  return out
}

function lowerOne(
  decl: ts.VariableDeclaration,
  isConst: boolean,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): OverrideDecl | undefined {
  const name = (decl.name as ts.Identifier).text
  if (!isConst) {
    diagnostics.push(diag(sourceFile, decl, `override "${name}" must be const, not let.`))
    return undefined
  }
  const inner = (decl.type as ts.TypeReferenceNode).typeArguments?.[0]
  if (!inner) {
    diagnostics.push(diag(sourceFile, decl, `override<T> needs a type argument.`))
    return undefined
  }
  const type = mapTsTypeToShaderType(inner, sourceFile, diagnostics)
  if (!type) return undefined
  const k = typeKey(type)
  if (k !== 'f32' && k !== 'i32' && k !== 'u32' && k !== 'bool') {
    // WGSL's own rule: an override is a scalar. A vector or a struct has no `override`
    // spelling to emit, and GLSL's `#define` stand-in has nothing to substitute either.
    diagnostics.push(
      diag(sourceFile, decl, `override "${name}" must be f32, i32, u32 or bool, not ${k}.`),
    )
    return undefined
  }
  const dflt = defaultValue(decl, type, sourceFile, diagnostics)
  if (dflt === undefined) return undefined
  return { name, type, default: dflt }
}

/** The value the override takes when the pipeline supplies none.
 *
 *  `const q: override<f32> = 1.` states it. `declare const q: override<f32>` does not, and
 *  takes the type's zero — which is what an unset specialization constant is worth, and is
 *  spelled out in the surface document rather than left to be discovered. Only a literal is
 *  accepted: the default is baked into the declaration both backends emit, so it has to be
 *  known here, not folded later. */
function defaultValue(
  decl: ts.VariableDeclaration,
  type: ShaderType,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): number | boolean | undefined {
  const init = decl.initializer
  if (!init) return typeKey(type) === 'bool' ? false : 0
  const unwrapped = ts.isPrefixUnaryExpression(init) ? init.operand : init
  const negated = ts.isPrefixUnaryExpression(init) && init.operator === ts.SyntaxKind.MinusToken
  if (init.kind === ts.SyntaxKind.TrueKeyword) return true
  if (init.kind === ts.SyntaxKind.FalseKeyword) return false
  if (ts.isNumericLiteral(unwrapped)) {
    const v = Number(unwrapped.text)
    return negated ? -v : v
  }
  diagnostics.push(
    diag(
      sourceFile,
      init,
      `override "${(decl.name as ts.Identifier).text}" default must be a literal; ` +
        `the declaration each backend emits carries it.`,
    ),
  )
  return undefined
}

function diag(sf: ts.SourceFile, node: ts.Node, message: string): TsCompilerDiagnostic {
  return makeDiagnostic(sf, node, message, TS_CODES.TOP_LEVEL)
}
