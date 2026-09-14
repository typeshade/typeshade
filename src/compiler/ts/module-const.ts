// Top-level `const` → ModuleDecl.consts (foldable scalars).

import ts from 'typescript'
import type { ConstDecl, Expr } from '../../core/ir/nodes.js'
import type { ShaderType } from '../../core/ir/types.js'
import { typeKey } from '../../core/ir/types.js'
import type { TsCompilerDiagnostic } from './source-file.js'
import { LoweringScope } from './context.js'
import { mapTsTypeToShaderType } from './type-map.js'
import { foldConstNumber, foldConstValue } from './loop-bound.js'
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
 *  WHOLE constant declared earlier in the file, a constructor over those, and arithmetic
 *  over those. Anything reading a binding, a parameter or a runtime input is not one, and
 *  neither is a call, a swizzle, a member, an index or a conditional — a module constant is
 *  folded once at emit, not evaluated.
 *
 *  Division is the one arm that looks at a value rather than a shape. The scalar path gets
 *  that for free — `foldConstNumber` returns `undefined` for `/ 0`, so `const K: f32 = 1. / 0.`
 *  never becomes a constant — but this path only asked whether the operands were foldable, so
 *  `const Y = vec3(1. / ZERO, 0., 0.)` compiled with no diagnostic at all: Tint refuses the
 *  WGSL it produces, and GLSL and the CPU oracle disagree about the value. A divisor this can
 *  prove is zero is refused here instead. */
function isFoldableValueExpr(e: Expr, scope: LoweringScope): boolean {
  switch (e.op) {
    case 'lit':
    case 'constref':
      return true
    case 'unop':
      return isFoldableValueExpr(e.a, scope)
    case 'binop':
      if ((e.bop === '/' || e.bop === '%') && foldsToZero(e.b, scope)) return false
      return isFoldableValueExpr(e.a, scope) && isFoldableValueExpr(e.b, scope)
    case 'construct':
      return e.args.every((a) => isFoldableValueExpr(a, scope))
    default:
      return false
  }
}

/** Whether `e` is a divisor this can PROVE is zero: a scalar that folds to 0, or a vector
 *  constructor with a component that does (`v / vec3(1., 0., 1.)` divides componentwise, so
 *  one zero is enough). A divisor that does not fold is not proven anything and passes — the
 *  point is to refuse what is certainly undefined, not to demand a proof of safety. */
function foldsToZero(e: Expr, scope: LoweringScope): boolean {
  if (e.op === 'construct') return e.args.some((a) => foldsToZero(a, scope))
  return foldConstNumber(e, scope) === 0
}

/** The kinds a `valueExpr` constant may have, as {@link ConstDecl.valueExpr} documents them.
 *  `struct` and `mat` are listed because the field carries them and every backend emits them,
 *  but neither is reachable from this surface today — a module-scope object literal has no
 *  struct table to match against here, and there is no matrix constructor — so the diagnostic
 *  below names only the vector and the array. A vec64 is not listed either, and there is no
 *  way to build one at module scope to test the refusal with: `vec3f64(...)` is not a
 *  constructor this surface has, so the exclusion is a statement of intent, not a live arm. */
function isValueExprType(t: ShaderType): boolean {
  // An array OF arrays is refused: the GLSL ES 3.00 writer spells the element type inline and
  // the nested form it produces is not something ANGLE accepts, so allowing it here would ship
  // a declaration that compiles on one backend and not the other.
  if (t.kind === 'array') return t.elem.kind !== 'array'
  return t.kind === 'vec' || t.kind === 'struct' || t.kind === 'mat'
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
  // Constant-ness first, TYPE second. The other order answered `const K: f32 = sin(1.)` with
  // "f32 is neither a foldable scalar nor a whole vector or array", which is untrue of f32 —
  // the problem was never the type. Now the type message fires only for a value that IS
  // constant and whose type this surface cannot carry.
  if (!isFoldableValueExpr(init, scope)) {
    diagnostics.push(
      makeDiagnostic(
        sourceFile,
        decl,
        `Module const "${name}" must be constant: a literal, a whole earlier module const, ` +
          `a constructor over those, or arithmetic over those with a non-zero divisor. ` +
          `It cannot call a function, read a resource, or take a component, field or element.`,
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
