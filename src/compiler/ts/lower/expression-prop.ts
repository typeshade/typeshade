import ts from 'typescript'
import type { Expr } from '../../../core/ir/nodes.js'
import { f32T, i32T, structT, typeKey } from '../../../core/ir/types.js'
import type { TsCompilerDiagnostic } from '../source-file.js'
import type { LoweringScope } from '../context.js'
import { resolveMathConst, resolveMathExpand, resolveMathFn } from '../math-alias.js'
import { parseSwizzle } from '../swizzle.js'
import { numericMismatch } from '../numeric.js'
import { retargetIntLitCtx } from '../lit-coerce.js'
import { lowerExpression } from './expression.js'
import { makeDiagnostic } from '../diagnostic.js'
import { TS_CODES, type TsCode } from '../codes.js'

const JS_ARRAY_METHODS = new Set([
  'map',
  'filter',
  'reduce',
  'forEach',
  'find',
  'some',
  'every',
  'flat',
  'flatMap',
  'slice',
  'concat',
  'includes',
  'indexOf',
  'join',
  'push',
  'pop',
  'shift',
  'unshift',
  'splice',
  'sort',
  'reverse',
])

export { JS_ARRAY_METHODS }

/** Whether `e` bottoms out in a STORAGE resource binding — the binding itself, a field of one,
 *  or an element of one. Only that shape gets the `arrayLength` sentence, because only that
 *  shape is what `arrayLength` accepts (`ptr<storage, array<E>, AM>`); a `uniform<array<T>>`,
 *  a local or a parameter needs an explicit `N` instead. */
function storageRooted(e: Expr, scope: LoweringScope): boolean {
  switch (e.op) {
    case 'varref':
      return scope.resolve(e.name)?.space === 'storage'
    case 'member':
      return storageRooted(e.base, scope)
    case 'index':
      return storageRooted(e.base, scope)
    default:
      return false
  }
}

export function lowerPropertyAccess(
  node: ts.PropertyAccessExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const obj = node.expression
  const prop = node.name.text
  if (ts.isIdentifier(obj) && obj.text === 'Math') {
    const value = resolveMathConst(prop)
    if (value !== undefined) return { op: 'lit', type: f32T, value }
    if (resolveMathFn(prop) || resolveMathExpand(prop)) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `"Math.${prop}" is a function alias. Call it.`,
        TS_CODES.UNSUPPORTED,
      )
      return undefined
    }
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `"Math.${prop}" is not a TypeShade alias.`,
      TS_CODES.UNKNOWN_NAME,
    )
    return undefined
  }
  const base = lowerExpression(obj, sourceFile, scope, diagnostics)
  if (!base) return undefined
  if (prop === 'length' && base.type.kind === 'array') {
    // `?? 0` used to be the whole of this line, and 0 is not a length — it is the absence of
    // one. A runtime-sized array carries no `size`, so the standard bounds guard folded to
    // `if (gid.x >= 0u) { return; }`, which is TRUE for every unsigned invocation: the kernel
    // returned immediately and wrote nothing, with zero diagnostics, as valid WGSL, on a real
    // GPU (#46). A wrong answer that every gate accepts is the one failure mode worth a hard
    // error, so an unsized array says so instead.
    //
    // The guard fires on FOUR shapes, not just the storage one, and they do not deserve the
    // same sentence. `arrayLength` is spelled `ptr<storage, array<E>, AM>` and exists for
    // nothing else, so naming it to the author of a local `array<f32>(1., 2., 3.)` or a
    // `uniform<array<f32>>` sends them to an intrinsic Tint would refuse on their program,
    // and never tells them the one fix that does work: write the `N`. Both shapes were
    // already invalid GPU code before this check (Tint: "cannot construct a runtime-sized
    // array"; "runtime-sized arrays can only be used in the <storage> address space"), so
    // rejecting them is right — it is only the advice that has to be true.
    if (base.type.size === undefined) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        storageRooted(base, scope)
          ? `".length" on a runtime-sized array is not known at compile time: the length belongs to the buffer the host binds, not to the type. WGSL spells it arrayLength(&x), which TypeShade does not expose yet (#46).`
          : `".length" on an array with no size is not known at compile time. Give the type a size: array<f32, 3> rather than array<f32>.`,
        TS_CODES.UNSIZED_ARRAY_LENGTH,
      )
      return undefined
    }
    return { op: 'lit', type: i32T, value: base.type.size }
  }
  if (JS_ARRAY_METHODS.has(prop)) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `JS Array method ".${prop}" is not a shader op. Use sum/min/any/all/zip/fill.`,
      TS_CODES.UNSUPPORTED,
    )
    return undefined
  }
  if (base.type.kind === 'struct') {
    const ft = scope.fieldType(base.type.name, prop)
    if (!ft) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `Unknown field "${prop}" on ${typeKey(base.type)}.`,
        TS_CODES.UNKNOWN_NAME,
      )
      return undefined
    }
    return { op: 'member', type: ft, base, field: prop }
  }
  const sw = parseSwizzle(base.type, prop)
  if (!sw.ok) {
    pushDiag(diagnostics, sourceFile, node, sw.message, TS_CODES.UNKNOWN_NAME)
    return undefined
  }
  return { op: 'member', type: sw.type, base, field: sw.field }
}

export function lowerObjectLiteral(
  node: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const given: { name: string; expr: Expr; node: ts.Expression }[] = []
  for (const prop of node.properties) {
    if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) {
      pushDiag(
        diagnostics,
        sourceFile,
        prop,
        'Object literals must use identifier fields, e.g. { pos: vec4(...) }.',
        TS_CODES.UNSUPPORTED,
      )
      return undefined
    }
    const expr = lowerExpression(prop.initializer, sourceFile, scope, diagnostics)
    if (!expr) return undefined
    given.push({ name: prop.name.text, expr, node: prop.initializer })
  }
  const names = given.map((g) => g.name)
  const match = scope.matchStruct(names)
  if (!match) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `Object literal { ${names.join(', ')} } does not match a known struct.`,
      TS_CODES.UNKNOWN_NAME,
    )
    return undefined
  }
  const byName = new Map(given.map((g) => [g.name, g.expr]))
  const nodeByName = new Map(given.map((g) => [g.name, g.node]))
  const args: Expr[] = []
  for (const field of match.fields) {
    // `{ id: 0 }` takes the field's type when it is i32 or u32 (#8 A3).
    const named = byName.get(field.name)
    const namedNode = nodeByName.get(field.name)
    const expr = named && namedNode ? retargetIntLitCtx(named, namedNode, field.type) : named
    if (!expr) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `Missing field "${field.name}" for struct ${match.name}.`,
        TS_CODES.STRUCT_FIELD,
      )
      return undefined
    }
    if (typeKey(expr.type) !== typeKey(field.type)) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        numericMismatch(`field ${match.name}.${field.name}`, field.type, expr.type),
        TS_CODES.TYPE_MISMATCH,
      )
      return undefined
    }
    args.push(expr)
  }
  return { op: 'construct', type: structT(match.name), args }
}

function pushDiag(
  diagnostics: TsCompilerDiagnostic[],
  sourceFile: ts.SourceFile,
  node: ts.Node,
  message: string,
  code: TsCode,
): void {
  diagnostics.push(makeDiagnostic(sourceFile, node, message, code))
}
