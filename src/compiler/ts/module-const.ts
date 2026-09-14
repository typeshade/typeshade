// Top-level `const` → ModuleDecl.consts (foldable scalars).

import ts from 'typescript'
import type { ConstDecl, Expr } from '../../core/ir/nodes.js'
import type { ShaderType } from '../../core/ir/types.js'
import { typeKey } from '../../core/ir/types.js'
import type { TsCompilerDiagnostic } from './source-file.js'
import { LoweringScope } from './context.js'
import { mapTsTypeToShaderType } from './type-map.js'
import { foldConstValue } from './loop-bound.js'
import { lowerExpression } from './lower/expression.js'
import { isResourceCall } from './bindings.js'
import { TS_CODES } from './codes.js'
import { makeDiagnostic } from './diagnostic.js'

function isTopLevelConst(stmt: ts.Statement): stmt is ts.VariableStatement {
  return ts.isVariableStatement(stmt) && (stmt.declarationList.flags & ts.NodeFlags.Const) !== 0
}

export function collectModuleConsts(
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): ConstDecl[] {
  const scope = new LoweringScope()
  const out: ConstDecl[] = []
  for (const stmt of sourceFile.statements) {
    if (!isTopLevelConst(stmt)) continue
    if (stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword)) continue
    for (const decl of stmt.declarationList.declarations) {
      const c = lowerOne(decl, sourceFile, scope, diagnostics)
      if (c) out.push(c)
    }
  }
  return out
}

/** The shapes {@link ConstDecl.valueExpr} documents as constant-foldable: a literal, a
 *  constructor over those, arithmetic over those, and a reference to a constant declared
 *  earlier in the file. Anything reading a binding, a parameter or a runtime input is not
 *  one, and neither is a call — a module constant is folded once at emit, not evaluated. */
function isFoldableValueExpr(e: Expr): boolean {
  switch (e.op) {
    case 'lit':
    case 'constref':
      return true
    case 'unop':
      return isFoldableValueExpr(e.a)
    case 'binop':
      return isFoldableValueExpr(e.a) && isFoldableValueExpr(e.b)
    case 'construct':
      return e.args.every(isFoldableValueExpr)
    default:
      return false
  }
}

/** The kinds a `valueExpr` constant may have, as {@link ConstDecl.valueExpr} documents them.
 *  An emulated-double vector is left out: a vec64 is a pair of f32 lanes the fp64 pass
 *  assembles from inside a function body, not a value a module-scope constant can carry yet.
 *  `struct` and `mat` are listed because the field carries them and every backend emits
 *  them, but neither is reachable from this surface today — a module-scope object literal
 *  has no struct table to match against here, and there is no matrix constructor — so the
 *  diagnostic below names only the vector and the array. */
function isValueExprType(t: ShaderType): boolean {
  return t.kind === 'vec' || t.kind === 'array' || t.kind === 'struct' || t.kind === 'mat'
}

/** `const UP = vec3(0., 1., 0.)` and friends: a module constant whose value is a whole
 *  vector, array, struct or matrix rather than a scalar. It is emitted from
 *  {@link ConstDecl.valueExpr}, the field the EDSL's `constExpr(name, type, node)` fills, so
 *  the two surfaces produce the same declaration and the WGSL writer, the GLSL writer and
 *  both CPU backends all take the path they already had for it. */
function valueExprConst(
  name: string,
  decl: ts.VariableDeclaration,
  init: Expr,
  annotated: ShaderType | undefined,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): ConstDecl | undefined {
  const type = annotated ?? init.type
  if (annotated && typeKey(annotated) !== typeKey(init.type)) {
    diagnostics.push(
      makeDiagnostic(
        sourceFile,
        decl,
        `Module const "${name}" is declared ${typeKey(annotated)} but its value is ${typeKey(init.type)}.`,
        TS_CODES.TYPE_MISMATCH,
      ),
    )
    return undefined
  }
  if (!isValueExprType(type)) {
    diagnostics.push(
      makeDiagnostic(
        sourceFile,
        decl,
        `Module const "${name}" must be a foldable scalar (literal or const expression), ` +
          `or a whole vector or array built from them; ${typeKey(type)} is neither.`,
        TS_CODES.TYPE_MISMATCH,
      ),
    )
    return undefined
  }
  if (!isFoldableValueExpr(init)) {
    diagnostics.push(
      makeDiagnostic(
        sourceFile,
        decl,
        `Module const "${name}" must be constant: a literal, a constructor over literals, ` +
          `arithmetic over those, or an earlier module const. It cannot call a function or ` +
          `read a resource.`,
        TS_CODES.TYPE_MISMATCH,
      ),
    )
    return undefined
  }
  scope.define({ kind: 'module', name, type, mutable: false })
  return { name, type, wgslValue: 0, cpuValue: 0, valueExpr: init }
}

function lowerOne(
  decl: ts.VariableDeclaration,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): ConstDecl | undefined {
  if (!ts.isIdentifier(decl.name)) {
    diagnostics.push(
      makeDiagnostic(
        sourceFile,
        decl.name,
        'Module const must be a simple name.',
        TS_CODES.TOP_LEVEL,
      ),
    )
    return undefined
  }
  const name = decl.name.text
  if (scope.hasInCurrent(name)) {
    diagnostics.push(
      makeDiagnostic(
        sourceFile,
        decl.name,
        `Duplicate module const "${name}".`,
        TS_CODES.DUPLICATE_SYMBOL,
      ),
    )
    return undefined
  }
  if (decl.initializer && isResourceCall(decl.initializer)) return undefined
  if (!decl.initializer) {
    diagnostics.push(
      makeDiagnostic(
        sourceFile,
        decl,
        `Module const "${name}" needs an initializer.`,
        TS_CODES.TOP_LEVEL,
      ),
    )
    return undefined
  }
  const annotated = decl.type
    ? mapTsTypeToShaderType(decl.type, sourceFile, diagnostics)
    : undefined
  const init = lowerExpression(decl.initializer, sourceFile, scope, diagnostics)
  if (!init) return undefined
  const folded = foldConstValue(init, scope)
  if (typeof folded !== 'number' && typeof folded !== 'boolean') {
    // A non-scalar constant — a vector, an array, a struct, a matrix — is carried by
    // ConstDecl.valueExpr instead of the wgslValue/cpuValue pair, which is what the EDSL's
    // constExpr fills: both writers emit the expression and the CPU backend evaluates it.
    return valueExprConst(name, decl, init, annotated, sourceFile, scope, diagnostics)
  }
  const type = annotated ?? init.type
  const k = typeKey(type)
  if (k !== 'f32' && k !== 'i32' && k !== 'u32' && k !== 'bool') {
    diagnostics.push(
      makeDiagnostic(
        sourceFile,
        decl,
        `Module const "${name}" must be f32, i32, u32, or bool for now.`,
        TS_CODES.TYPE_MISMATCH,
      ),
    )
    return undefined
  }
  const numeric = typeof folded === 'boolean' ? (folded ? 1 : 0) : folded
  const value = k === 'f32' ? numeric : k === 'bool' ? numeric : Math.trunc(numeric)
  scope.define({
    kind: 'module',
    name,
    type,
    mutable: false,
    constValue: typeof folded === 'boolean' ? folded : value,
  })
  return { name, type, wgslValue: value, cpuValue: value }
}
