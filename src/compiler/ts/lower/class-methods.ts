// === Classes with methods, a constructor and static functions (#86, §26) ===
//
// A class stays a struct: its fields are the struct's fields, and the object literal still
// builds one. What this file adds is that its methods, its constructor and its static functions
// are functions of the module, which is all a method is once `this` has a name. `Ray.at(t)`
// becomes `fn Ray_at(self_: Ray, t: f32)` with `this.origin` read as `self_.origin`, and the
// call `r.at(2.)` becomes `Ray_at(r, 2.)`; a static `Ray.up()` is `Ray_up()`; the constructor
// is `Ray_new(...)`, which starts from the zero struct, assigns the field initializers, runs the
// body and returns `self`. WGSL and GLSL ES 3.00 both take a struct parameter by value, so both
// targets spell every one of these as written, and the IR is unchanged: the oracle, the codegen
// and the debug stepper see functions.
//
// A method that assigns to `this` is the next step of #86 (the copy-back on an assignable
// receiver) and is refused here with that reason; `this` in a method reads only.
//
// The object's name in the emitted function is `self_`, not `self`: Tint refuses `self`, which
// is on WGSL's reserved-word list (as `this` is), and GLSL ES 3.00 takes either.

import ts from 'typescript'
import type { Expr, FuncDecl, Stmt } from '../../../core/ir/nodes.js'
import type { ShaderType } from '../../../core/ir/types.js'
import type { SourceSpan } from '../../../core/ir/span.js'
import { boolT, f32T, i32T, structT, typeKey, u32T } from '../../../core/ir/types.js'
import type { TsCompilerDiagnostic } from '../source-file.js'
import type { CollectedStruct, FieldInit } from '../structs.js'
import { irNameOf, type LoweringScope } from '../context.js'
import { TS_CODES, type TsCode } from '../codes.js'
import { makeDiagnostic } from '../diagnostic.js'
import { spanOf, withSpan } from '../span.js'
import { retargetIntLitCtx } from '../lit-coerce.js'
import { lowerExpression } from './expression.js'
import { lowerUserCall } from './expression-misc.js'
import { parseParams, parseReturnType } from './function.js'

/** What `this` is while a member's body is lowered: the struct type, whether it is the local a
 *  constructor builds (`asLocal`) or the read-only first parameter of a method, the field
 *  initializers a constructor assigns first, and how messages name the member. */
export interface Receiver {
  readonly type: ShaderType
  readonly asLocal: boolean
  readonly fieldInits: readonly FieldInit[]
  readonly shown: string
}

/** One function a class contributes to the module. `node` is absent for the constructor a
 *  class without one gets when the file says `new P(...)` or a field has an initializer. */
export interface ClassFunction {
  readonly stub: FuncDecl
  readonly kind: 'method' | 'static' | 'ctor'
  readonly struct: CollectedStruct
  /** How a message names it: `Ray.at`, `Ray.up`, `new Ray`. */
  readonly shown: string
  readonly node: ts.MethodDeclaration | ts.ConstructorDeclaration | undefined
  readonly receiver: Receiver | undefined
}

/** The emitted name of a method or a static function: `Ray_at`. */
export const methodFnName = (struct: string, member: string): string => `${struct}_${member}`
/** The emitted name of a constructor: `Ray_new`. */
export const ctorFnName = (struct: string): string => `${struct}_new`

const registry = new WeakMap<FuncDecl, ClassFunction>()

/** The class function a callee is, or `undefined` for a top-level function. */
export const classFunctionOf = (decl: FuncDecl): ClassFunction | undefined => registry.get(decl)

/** The `self_` a constructor builds and a method reads. */
export const selfRef = (type: ShaderType): Expr => ({ op: 'varref', type, name: 'self_' })

function pushDiag(
  diagnostics: TsCompilerDiagnostic[],
  sourceFile: ts.SourceFile,
  node: ts.Node,
  message: string,
  code: TsCode = TS_CODES.CLASS_MEMBER,
): void {
  diagnostics.push(makeDiagnostic(sourceFile, node, message, code))
}

/** Every identifier the file writes `new X(...)` on. */
function namesConstructed(sourceFile: ts.SourceFile): Set<string> {
  const out = new Set<string>()
  const walk = (n: ts.Node): void => {
    if (ts.isNewExpression(n) && ts.isIdentifier(n.expression)) out.add(n.expression.text)
    ts.forEachChild(n, walk)
  }
  walk(sourceFile)
  return out
}

/** The functions every class in `structs` contributes, with their signatures parsed and
 *  their bodies still empty: a method (`self` first), a static function, and a constructor for
 *  a class that declares one, has a field initializer, or is constructed with `new`. */
export function collectClassFunctions(
  structs: readonly CollectedStruct[],
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): ClassFunction[] {
  const out: ClassFunction[] = []
  const constructed = namesConstructed(sourceFile)
  for (const struct of structs) {
    const name = struct.decl.name
    const selfT = structT(name)
    const members = struct.members
    for (const method of members?.methods ?? []) {
      if (!ts.isIdentifier(method.name)) continue
      const member = method.name.text
      const shown = `${name}.${member}`
      const isStatic =
        method.modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword) ?? false
      const decorated = ts.canHaveDecorators(method) ? (ts.getDecorators(method) ?? []) : []
      if (decorated.length > 0) {
        pushDiag(
          diagnostics,
          sourceFile,
          decorated[0]!,
          `A decorator has no place on "${shown}"; an entry is a top-level function.`,
        )
        continue
      }
      if (
        method.asteriskToken ||
        method.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)
      ) {
        pushDiag(
          diagnostics,
          sourceFile,
          method,
          `"${shown}" is a plain method or nothing: no async, no generator.`,
        )
        continue
      }
      if (method.modifiers?.some((m) => m.kind === ts.SyntaxKind.AbstractKeyword)) {
        pushDiag(
          diagnostics,
          sourceFile,
          method,
          `"${shown}" is abstract; a shader function has one body.`,
        )
        continue
      }
      const params = parseParams(method.parameters, sourceFile, diagnostics, structs, undefined, {
        owner: shown,
        forbidSelf: !isStatic,
      })
      if (!params) continue
      const ret = parseReturnType(
        method.type,
        shown,
        method,
        sourceFile,
        diagnostics,
        structs,
        undefined,
      )
      if (!ret) continue
      const stub: FuncDecl = {
        name: methodFnName(name, member),
        params: isStatic ? params : [{ name: 'self_', type: selfT }, ...params],
        ret,
        body: [],
      }
      ;(stub as { span?: SourceSpan }).span = spanOf(sourceFile, method)
      ;(stub as { nameSpan?: SourceSpan }).nameSpan = spanOf(sourceFile, method.name)
      const cf: ClassFunction = {
        stub,
        kind: isStatic ? 'static' : 'method',
        struct,
        shown,
        node: method,
        receiver: isStatic ? undefined : { type: selfT, asLocal: false, fieldInits: [], shown },
      }
      registry.set(stub, cf)
      out.push(cf)
    }
    const fieldInits = members?.fieldInits ?? []
    const ctor = members?.ctor
    if (ctor === undefined && fieldInits.length === 0 && !constructed.has(name)) continue
    const shown = `new ${name}`
    const params = ctor
      ? parseParams(ctor.parameters, sourceFile, diagnostics, structs, undefined, {
          owner: shown,
          forbidSelf: true,
        })
      : []
    if (!params) continue
    const stub: FuncDecl = { name: ctorFnName(name), params, ret: selfT, body: [] }
    const at = ctor ?? members?.node
    if (at !== undefined) (stub as { span?: SourceSpan }).span = spanOf(sourceFile, at)
    const cf: ClassFunction = {
      stub,
      kind: 'ctor',
      struct,
      shown,
      node: ctor,
      receiver: { type: selfT, asLocal: true, fieldInits, shown },
    }
    registry.set(stub, cf)
    out.push(cf)
  }
  return out
}

/** The zero value of `type` as an expression, or `undefined` for a type this cannot spell (a
 *  matrix, a type outside the table). WGSL zero-initializes a `var` with no initializer, but
 *  GLSL ES 3.00 leaves it undefined, so a constructor's `self` starts from this on both. */
export function zeroExprOf(type: ShaderType, scope: LoweringScope): Expr | undefined {
  switch (type.kind) {
    case 'scalar': {
      const k = typeKey(type)
      if (k === 'bool') return { op: 'lit', type: boolT, value: false }
      if (k === 'f32') return { op: 'lit', type: f32T, value: 0 }
      if (k === 'i32') return { op: 'lit', type: i32T, value: 0 }
      if (k === 'u32') return { op: 'lit', type: u32T, value: 0 }
      return undefined
    }
    case 'vec': {
      const elemT = type.elem === 'f32' ? f32T : type.elem === 'i32' ? i32T : u32T
      const elem: Expr = { op: 'lit', type: elemT, value: 0 }
      return { op: 'construct', type, args: Array.from({ length: type.n }, () => elem) }
    }
    case 'array': {
      if (type.size === undefined) return undefined
      const elem = zeroExprOf(type.elem, scope)
      if (!elem) return undefined
      return { op: 'construct', type, args: Array.from({ length: type.size }, () => elem) }
    }
    case 'struct': {
      const decl = scope.structByName(type.name)
      if (!decl) return undefined
      const args: Expr[] = []
      for (const f of decl.fields) {
        const z = zeroExprOf(f.type, scope)
        if (!z) return undefined
        args.push(z)
      }
      return { op: 'construct', type, args }
    }
    default:
      return undefined
  }
}

/** The statements a constructor starts with: `var self: T` at the zero struct, spelled out
 *  where {@link zeroExprOf} can so GLSL starts from zero too, then each field initializer
 *  assigned in declaration order. Defines `this` as that local. */
export function ctorPrologue(
  receiver: Receiver,
  scope: LoweringScope,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): Stmt[] {
  const self = scope.define({
    kind: 'local',
    name: 'this',
    type: receiver.type,
    mutable: true,
    irName: 'self_',
  })
  const zero = zeroExprOf(receiver.type, scope)
  const out: Stmt[] = [
    zero
      ? { s: 'var', name: irNameOf(self), type: receiver.type, init: zero }
      : { s: 'var', name: irNameOf(self), type: receiver.type },
  ]
  for (const f of receiver.fieldInits) {
    const lowered = lowerExpression(f.init, sourceFile, scope, diagnostics, f.type)
    if (!lowered) continue
    const init = retargetIntLitCtx(lowered, f.init, f.type)
    if (typeKey(init.type) !== typeKey(f.type)) {
      pushDiag(
        diagnostics,
        sourceFile,
        f.init,
        `Field "${f.name}" is ${typeKey(f.type)} but its initializer is ${typeKey(init.type)}.`,
        TS_CODES.TYPE_MISMATCH,
      )
      continue
    }
    out.push({
      s: 'assign',
      target: { op: 'member', type: f.type, base: selfRef(receiver.type), field: f.name },
      expr: init,
    })
  }
  return out
}

/** `this`: the method's object or the struct a constructor builds, or a refusal. */
export function lowerThis(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const b = scope.resolve('this')
  if (!b) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      '"this" names a method\'s object; a static function and a top-level function have none.',
    )
    return undefined
  }
  return b.kind === 'param'
    ? { op: 'param', type: b.type, name: irNameOf(b) }
    : { op: 'varref', type: b.type, name: irNameOf(b) }
}

/** `new Ray(a, b)`: the class's constructor function. A `new` on anything that is not a class
 *  the file declares was refused by the semantic pass; here it lowers to nothing more. */
export function lowerNew(
  node: ts.NewExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  if (!ts.isIdentifier(node.expression)) return undefined
  const name = node.expression.text
  if (scope.structByName(name) === undefined) return undefined
  const decl = scope.resolveCallee(ctorFnName(name))
  if (decl === undefined || classFunctionOf(decl)?.kind !== 'ctor') {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `"${name}" has no constructor here; build it as an object literal, { field: value }.`,
    )
    return undefined
  }
  const call = lowerUserCall(node, decl, sourceFile, scope, diagnostics, { shown: `new ${name}` })
  return call?.op === 'call' ? withSpan(call, sourceFile, node) : call
}

/** A call through a member access, `r.at(2.)`, `this.at(t)` or `Ray.up()`: the class function
 *  it names, with the receiver as the first argument for a method. Returns the marker when the
 *  receiver is not a struct value or a class name, so the caller's other member calls (the
 *  swizzles, the array folds) keep their turn. */
export function lowerClassCall(
  node: ts.CallExpression,
  callee: ts.PropertyAccessExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined | 'not-a-class-call' {
  const obj = callee.expression
  const member = callee.name.text
  if (
    ts.isIdentifier(obj) &&
    scope.resolve(obj.text) === undefined &&
    scope.structByName(obj.text) !== undefined
  ) {
    const name = obj.text
    const shown = `${name}.${member}`
    const decl = scope.resolveCallee(methodFnName(name, member))
    const cf = decl === undefined ? undefined : classFunctionOf(decl)
    if (cf === undefined) {
      pushDiag(diagnostics, sourceFile, callee, `"${name}" has no static function "${member}".`)
      return undefined
    }
    if (cf.kind !== 'static') {
      pushDiag(
        diagnostics,
        sourceFile,
        callee,
        `"${shown}" is a method; call it on a ${name} value: v.${member}(...).`,
      )
      return undefined
    }
    return lowerUserCall(node, decl!, sourceFile, scope, diagnostics, { shown })
  }
  const recv = lowerExpression(obj, sourceFile, scope, diagnostics)
  if (!recv) return undefined
  if (recv.type.kind !== 'struct') return 'not-a-class-call'
  const name = recv.type.name
  const shown = `${name}.${member}`
  const decl = scope.resolveCallee(methodFnName(name, member))
  const cf = decl === undefined ? undefined : classFunctionOf(decl)
  if (cf === undefined) {
    pushDiag(
      diagnostics,
      sourceFile,
      callee,
      scope.fieldType(name, member) !== undefined
        ? `"${member}" is a field of ${name}, not a method.`
        : `"${name}" has no method "${member}".`,
    )
    return undefined
  }
  if (cf.kind === 'static') {
    pushDiag(
      diagnostics,
      sourceFile,
      callee,
      `"${shown}" is static; call it on the class: ${name}.${member}(...).`,
    )
    return undefined
  }
  return lowerUserCall(node, decl!, sourceFile, scope, diagnostics, { shown, leading: [recv] })
}
