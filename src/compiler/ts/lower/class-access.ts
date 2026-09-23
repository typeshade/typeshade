// === Reaching a class's members: accessors, private names, statics (§26, Rules 8.11 to 8.13) ===
//
// A read `o.x` is a field or, when the class declares `get x()`, a call of the getter
// `Cls_get_x(o)`; a write `o.x = v` is an assignment or a call of the setter `Cls_set_x(&o, v)`,
// and `o.x += v` and `o.x++` read through the getter and write through the setter. A private
// name `#x` is a member like any other once it is emitted, without its `#`, so what keeps it
// private is here: it may be named only inside the body of the class that declares it, the rule
// TypeScript's checker enforces and this surface, which does not run the checker, enforces for
// it. `C.K` and `this.K` in a static member name the class's statics.

import ts from 'typescript'
import type { Expr, FuncDecl, Stmt } from '../../../core/ir/nodes.js'
import type { ShaderType } from '../../../core/ir/types.js'
import type { TsCompilerDiagnostic } from '../source-file.js'
import { irNameOf, type Binding, type LoweringScope } from '../context.js'
import { TS_CODES, type TsCode } from '../codes.js'
import { makeDiagnostic } from '../diagnostic.js'
import { withSpan } from '../span.js'
import { staticConstName } from '../module-const.js'
import {
  accessorFnName,
  emittedMemberName,
  isPrivateName,
  isReadonlyMember,
  isStaticMember,
  keywordAccessOf,
  keywordAccessVia,
  privateOwner,
  privateStaticFields,
  staticFieldDeclarations,
  writtenMemberName,
  type KeywordAccess,
} from '../class-names.js'
import {
  MISSING_HALF,
  NO_SUPER,
  classFunctionOf,
  isCollidedFunction,
  methodFnName,
  mutatingReceiver,
  superFieldKey,
  type ClassFunction,
} from './class-methods.js'
import { lowerExpression } from './expression.js'

function pushDiag(
  diagnostics: TsCompilerDiagnostic[],
  sourceFile: ts.SourceFile,
  node: ts.Node,
  message: string,
  code: TsCode = TS_CODES.CLASS_MEMBER,
): void {
  diagnostics.push(makeDiagnostic(sourceFile, node, message, code))
}

const unparen = (e: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(e) ? unparen(e.expression) : e

/** The class a member access's object names when that object is the class and not a value: `C`
 *  in `C.K` and `C.f()`, and `this` inside a static member, which is the class that declares the
 *  member (Rule 8.13). Undefined for anything that is a value, `this` in a method included. */
export function staticOwnerOf(obj: ts.Expression, scope: LoweringScope): string | undefined {
  const e = unparen(obj)
  if (e.kind === ts.SyntaxKind.ThisKeyword) {
    return scope.resolve('this') === undefined ? scope.staticClass() : undefined
  }
  if (ts.isIdentifier(e) && scope.resolve(e.text) === undefined) return e.text
  return undefined
}

/** The class a class function's body was written in, which is what may name it when its name
 *  is private. */
const declaringClass = (cf: ClassFunction): ts.ClassLikeDeclaration | undefined =>
  cf.node !== undefined && ts.isClassLike(cf.node.parent) ? cf.node.parent : undefined

const classLabel = (cls: ts.ClassLikeDeclaration | undefined, fallback: string): string =>
  cls?.name?.text ?? fallback

/** Refuse a private name the code at `at` may not use (Rule 8.12): only the body of the class
 *  that declares `#x` may name it, which is TypeScript's own rule. `owner` is that class, or
 *  undefined when what declares it is not known here. Returns true when the access stands. */
export function checkPrivateAccess(
  written: string,
  owner: ts.ClassLikeDeclaration | undefined,
  ownerShown: string,
  at: ts.Node,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): boolean {
  if (!isPrivateName(written)) return true
  const lexical = privateOwner(at, written)
  if (lexical !== undefined && (owner === undefined || lexical.cls === owner)) return true
  pushDiag(
    diagnostics,
    sourceFile,
    at,
    `"${written}" is private to "${classLabel(owner, ownerShown)}", and this code is outside ` +
      `its class body. Reach it through a member "${classLabel(owner, ownerShown)}" declares ` +
      `without the "#".`,
  )
  return false
}

/** Refuse a member declared `private` or `protected` that the code at `at` may not name (Rule
 *  8.15), as TypeScript's checker refuses it and this surface, which does not run the checker,
 *  must: a private one outside the body of `owner` (TS2341), a protected one outside `owner` and
 *  the classes that extend it (TS2445), and a protected one reached from a class that extends
 *  `owner` on an object that is not of that class (TS2446). `receiver` is the struct the member
 *  is reached on, undefined for a static. Returns true when the access stands. */
export function checkKeywordAccess(
  access: KeywordAccess | undefined,
  owner: ts.ClassLikeDeclaration | undefined,
  member: string,
  receiver: string | undefined,
  at: ts.Node,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): boolean {
  if (access === undefined || owner === undefined) return true
  const ownerName = classLabel(owner, 'its class')
  const shown = `${ownerName}.${member}`
  const via = keywordAccessVia(access, owner, at)
  if (via === undefined) {
    pushDiag(
      diagnostics,
      sourceFile,
      at,
      access === 'private'
        ? `"${shown}" is private, so only the body of "${ownerName}" may name it. Reach it ` +
            `through a public member of "${ownerName}".`
        : `"${shown}" is protected, so only "${ownerName}" and the classes that extend it may ` +
            `name it. Reach it through a public member of "${ownerName}".`,
    )
    return false
  }
  if (access !== 'protected' || via === 'granted' || via === owner || receiver === undefined) {
    return true
  }
  const viaName = via.name?.text
  if (
    viaName === undefined ||
    scope.structByName(viaName) === undefined ||
    receiver === viaName ||
    scope.extendsStruct(receiver, viaName)
  ) {
    return true
  }
  pushDiag(
    diagnostics,
    sourceFile,
    at,
    `"${shown}" is protected, and "${viaName}" may name it only on a "${viaName}"; this object ` +
      `is a "${receiver}". Reach it through a public member of "${ownerName}".`,
  )
  return false
}

/** {@link checkKeywordAccess} for a class function: its own `private` or `protected`. */
export function checkFunctionAccess(
  cf: ClassFunction,
  receiver: string | undefined,
  at: ts.Node,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): boolean {
  if (cf.node === undefined || cf.member === undefined) return true
  return checkKeywordAccess(
    keywordAccessOf(cf.node),
    declaringClass(cf),
    cf.member,
    receiver,
    at,
    sourceFile,
    scope,
    diagnostics,
  )
}

/** {@link checkKeywordAccess} for a field of `struct` reached by the name `written`. */
export function checkFieldAccess(
  struct: string,
  written: string,
  at: ts.Node,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): boolean {
  if (isPrivateName(written)) return true
  const r = scope.restrictedField(struct, emittedMemberName(written))
  if (r === undefined) return true
  return checkKeywordAccess(r.access, r.owner, written, struct, at, sourceFile, scope, diagnostics)
}

/** {@link checkKeywordAccess} for the static field `declaredOn.written`. */
export function checkStaticFieldAccess(
  declaredOn: string,
  written: string,
  at: ts.Node,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): boolean {
  const decl = staticFieldDeclarations(sourceFile).get(`${declaredOn}.${written}`)
  if (decl === undefined) return true
  return checkKeywordAccess(
    keywordAccessOf(decl),
    ts.isClassLike(decl.parent) ? decl.parent : undefined,
    written,
    undefined,
    at,
    sourceFile,
    scope,
    diagnostics,
  )
}

/** The class function `written` names on the struct (or static-only class) `struct` in the
 *  role asked, or undefined when it has none. A private member answers to its `#` name only,
 *  so `o.step()` does not reach `#step`, and a method does not answer for an accessor. */
export function memberFunctionOf(
  struct: string,
  written: string,
  role: 'method' | 'get' | 'set',
  scope: LoweringScope,
): { decl: FuncDecl; cf: ClassFunction } | undefined {
  const fn =
    role === 'method'
      ? methodFnName(struct, emittedMemberName(written))
      : accessorFnName(struct, role, written)
  const decl = scope.resolveCallee(fn)
  const cf = decl === undefined ? undefined : classFunctionOf(decl)
  if (decl === undefined || cf === undefined) return undefined
  if (cf.member !== written || (cf.accessor ?? 'method') !== role) return undefined
  return { decl, cf }
}

/** Whether `struct` has the private field `written` and the code at `at` stands in the body of
 *  the class that declares it, the one place that may name it (Rule 8.12). */
function privateFieldReadable(
  struct: string,
  written: string,
  at: ts.Node,
  scope: LoweringScope,
): boolean {
  const field = scope.privateField(struct, emittedMemberName(written))
  if (field === undefined || field.written !== written) return false
  return privateOwner(at, written)?.cls === field.owner
}

/** Whether `struct` has a field the code at `at` reaches by the name `written`: a public field
 *  under that name, or a private one its class body names. A public name never reaches a
 *  private field, since `#n` and `n` are two members to TypeScript (Rule 8.12). */
export function visibleField(
  struct: string,
  written: string,
  at: ts.Node,
  scope: LoweringScope,
): ShaderType | undefined {
  const emitted = emittedMemberName(written)
  const type = scope.fieldType(struct, emitted)
  if (type === undefined) return undefined
  if (isPrivateName(written)) {
    return privateFieldReadable(struct, written, at, scope) ? type : undefined
  }
  return scope.privateField(struct, emitted) === undefined ? type : undefined
}

/** The call a class function makes with `args`, spanned at `at`. */
const callOf = (
  decl: FuncDecl,
  args: readonly Expr[],
  sourceFile: ts.SourceFile,
  at: ts.Node,
): Expr =>
  withSpan({ op: 'call', type: decl.ret, fn: decl.name, args, declRef: decl }, sourceFile, at)

/** The read of a static member `owner.written`: a static field, a module constant or, when the
 *  file writes it, a module variable (Rule 8.13), or undefined when `owner` has none. A private
 *  static and a public member of one name are two members, so each name reaches its own. */
export function staticFieldBinding(
  owner: string,
  written: string,
  scope: LoweringScope,
  sourceFile: ts.SourceFile,
): Binding | undefined {
  const emitted = emittedMemberName(written)
  const b = scope.resolve(staticConstName(owner, emitted))
  if (b === undefined || (b.kind !== 'module' && b.kind !== 'modvar')) return undefined
  const isPrivate = privateStaticFields(sourceFile).has(`${owner}.${emitted}`)
  return isPrivate === isPrivateName(written) ? b : undefined
}

/** The static field a read of `owner.written` reaches: `owner`'s own, or, as TypeScript's
 *  constructors inherit their bases' statics, the nearest base's that declares it (Rule 8.13).
 *  A private name is never inherited, since only the declaring class's body names it. */
export function staticFieldRead(
  owner: string,
  written: string,
  scope: LoweringScope,
  sourceFile: ts.SourceFile,
): { binding: Binding; declaredOn: string } | undefined {
  const own = staticFieldBinding(owner, written, scope, sourceFile)
  if (own !== undefined) return { binding: own, declaredOn: owner }
  if (isPrivateName(written)) return undefined
  for (const base of scope.ancestorsOf(owner)) {
    const b = staticFieldBinding(base, written, scope, sourceFile)
    if (b !== undefined) return { binding: b, declaredOn: base }
  }
  return undefined
}

/** Why a write through `owner.written` is refused when the static belongs to a base: in
 *  TypeScript the assignment would give `owner` a static of its own, which the base's readers no
 *  longer see, and here there is one module variable. Undefined when nothing above declares it. */
export function inheritedStaticWrite(
  owner: string,
  written: string,
  scope: LoweringScope,
  sourceFile: ts.SourceFile,
): string | undefined {
  const read = staticFieldRead(owner, written, scope, sourceFile)
  if (read === undefined || read.declaredOn === owner) return undefined
  return (
    `"${owner}.${written}" is a static "${read.declaredOn}" declares, and assigning it through ` +
    `"${owner}" would give "${owner}" a copy of its own in TypeScript. Write ` +
    `"${read.declaredOn}.${written}".`
  )
}

/** `o.x` or `C.x` where `x` is an accessor (Rule 8.11): the getter's call, with the object
 *  first for an instance one. `'none'` when `x` is not an accessor of the object's class, which
 *  leaves the read to the field and swizzle paths; undefined having refused it. `base` is the
 *  object as a value, already lowered; undefined for a static read. */
export function lowerAccessorRead(
  node: ts.PropertyAccessExpression,
  struct: string,
  base: Expr | undefined,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined | 'none' {
  const written = node.name.text
  const isStatic = base === undefined
  const getter = memberFunctionOf(struct, written, 'get', scope)
  const setter = memberFunctionOf(struct, written, 'set', scope)
  const pick = (f: { cf: ClassFunction } | undefined): boolean =>
    f !== undefined && (f.cf.kind === 'static') === isStatic
  const found = pick(getter) ? getter : pick(setter) ? setter : undefined
  if (found === undefined) {
    // An accessor whose name a private one down the chain took was reported there (Rule 12.4).
    const taken = scope.resolveCallee(accessorFnName(struct, 'get', written))
    return taken !== undefined && isCollidedFunction(taken) ? undefined : 'none'
  }
  const shown = `${struct}.${written}`
  if (
    !checkPrivateAccess(
      written,
      declaringClass(found.cf),
      struct,
      node.name,
      sourceFile,
      diagnostics,
    )
  ) {
    return undefined
  }
  if (found !== getter) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `"${shown}" has a setter and no getter, so there is nothing to read. Declare ` +
        `"get ${written}()" beside the setter.`,
    )
    return undefined
  }
  if (
    !checkFunctionAccess(
      getter.cf,
      isStatic ? undefined : struct,
      node.name,
      sourceFile,
      scope,
      diagnostics,
    )
  ) {
    return undefined
  }
  if (isStatic) return callOf(getter.decl, [], sourceFile, node)
  // A getter that changes its object (a cache it fills) takes the object by reference, as a
  // method that does would (§26), so the object has to be a place it may write.
  if (getter.cf.mutates) {
    const place = mutatingReceiver(node, node.expression, shown, sourceFile, scope, diagnostics)
    return place === undefined ? undefined : callOf(getter.decl, [place], sourceFile, node)
  }
  return callOf(getter.decl, [base], sourceFile, node)
}

/** `const { area } = r` where `area` is an accessor of `struct`: the getter's call on the value
 *  the pattern reads, `base`, which is a copy held for the pattern. `'none'` when `field` is no
 *  accessor; undefined having refused a getter that changes its object, since the copy it would
 *  change is dropped (Rule 8.11). */
export function destructuredGetter(
  struct: string,
  field: string,
  base: Expr,
  at: ts.Node,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined | 'none' {
  const getter = memberFunctionOf(struct, field, 'get', scope)
  if (getter === undefined || getter.cf.kind === 'static') return 'none'
  if (!checkFunctionAccess(getter.cf, struct, at, sourceFile, scope, diagnostics)) return undefined
  if (getter.cf.mutates) {
    pushDiag(
      diagnostics,
      sourceFile,
      at,
      `"${struct}.${field}" changes its object, and a pattern reads a copy of it that is ` +
        `dropped. Read it as a member instead, "const ${field} = v.${field}".`,
    )
    return undefined
  }
  return callOf(getter.decl, [base], sourceFile, at)
}

/** The object `super.x` runs its base body on: this body's own, as the place it writes
 *  through or as the value it reads; undefined, having said so, where there is no object. */
function superReceiver(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const self = scope.resolve('this')
  if (self === undefined || self.type.kind !== 'struct') {
    pushDiag(diagnostics, sourceFile, node, NO_SUPER)
    return undefined
  }
  return self.kind === 'param'
    ? { op: 'param', type: self.type, name: irNameOf(self) }
    : { op: 'varref', type: self.type, name: irNameOf(self) }
}

/** Whether `super` here is the class above rather than this object's: in a static member, where
 *  `super.K`, `super.x` and `super.k()` name the statics of the class above (Rule 8.13). */
const inStaticMember = (scope: LoweringScope): boolean =>
  scope.resolve('this') === undefined && scope.staticClass() !== undefined

/** The class whose static field `super.written` reads in a static member, or undefined. */
const superField = (written: string, scope: LoweringScope): string | undefined =>
  inStaticMember(scope) ? scope.superMethods()?.get(superFieldKey(written)) : undefined

/** The base body `super.x` names in the half asked, as its declaration, or undefined. */
function superHalf(
  written: string,
  half: 'get' | 'set',
  scope: LoweringScope,
): FuncDecl | undefined {
  const fn = scope.superMethods()?.get(`${half} ${written}`)
  return fn === undefined || fn === MISSING_HALF ? undefined : scope.resolveCallee(fn)
}

/** Why `super.x` names no half `half`: the other half is all there is, the name is a field (the
 *  object's own, which `super` does not reach), or nothing above declares it. */
function superMiss(
  node: ts.PropertyAccessExpression,
  half: 'get' | 'set',
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): void {
  const written = node.name.text
  const shown = `super.${written}`
  const self = scope.resolve('this')
  const struct = self?.type.kind === 'struct' ? self.type.name : undefined
  // The class above declares an accessor of this name, and not this half of it.
  const other = scope.superMethods()?.get(`${half} ${written}`) === MISSING_HALF
  pushDiag(
    diagnostics,
    sourceFile,
    node,
    other
      ? half === 'get'
        ? `"${shown}" has a setter and no getter above this class, so there is nothing to read.`
        : `"${shown}" has a getter and no setter above this class, so it cannot be assigned.`
      : struct !== undefined && visibleField(struct, written, node.name, scope) !== undefined
        ? `"${shown}" names a field, and a field is the object's own, which "super" does not ` +
          `reach. Write "this.${written}".`
        : inStaticMember(scope)
          ? `Nothing above this class declares a static accessor or field "${written}", so ` +
            `"${shown}" names nothing.`
          : `Nothing above this class declares an accessor "${written}", so "${shown}" names ` +
            `nothing.`,
  )
}

/** `super.x` read, where a base declares `get x()`: the base's getter, emitted against this
 *  class, on this body's object (Rule 8.11). */
export function lowerSuperAccessorRead(
  node: ts.PropertyAccessExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const written = node.name.text
  // `super.K` in a static member: the static field of the class above (Rule 8.13).
  const fieldOwner = superField(written, scope)
  if (fieldOwner !== undefined) {
    const b = staticFieldBinding(fieldOwner, written, scope, sourceFile)
    if (b === undefined) return undefined
    if (!checkStaticFieldAccess(fieldOwner, written, node.name, sourceFile, scope, diagnostics)) {
      return undefined
    }
    return b.kind === 'modvar'
      ? { op: 'varref', type: b.type, name: b.name }
      : { op: 'constref', type: b.type, name: b.name }
  }
  const statik = inStaticMember(scope)
  const recv = statik ? undefined : superReceiver(node, sourceFile, scope, diagnostics)
  if (!statik && recv === undefined) return undefined
  const getter = superHalf(written, 'get', scope)
  if (getter === undefined) {
    superMiss(node, 'get', sourceFile, scope, diagnostics)
    return undefined
  }
  const cf = classFunctionOf(getter)
  const self = recv?.type.kind === 'struct' ? recv.type.name : undefined
  if (
    cf !== undefined &&
    !checkFunctionAccess(cf, self, node.name, sourceFile, scope, diagnostics)
  ) {
    return undefined
  }
  return callOf(getter, recv === undefined ? [] : [recv], sourceFile, node)
}

/** `super.x = v`, `super.x += v`, `super.x++`: the base's setter, emitted against this class,
 *  on this body's object; a compound form reads through the base's getter first. */
function superAccessorTarget(
  node: ts.PropertyAccessExpression,
  reads: boolean,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): AccessorTarget | undefined {
  const written = node.name.text
  // `super.K = v` in a static member: TypeScript sets `K` on `this`, the class the body runs
  // for, and not on the class above that declares it (Rule 8.13).
  const fieldOwner = superField(written, scope)
  if (fieldOwner !== undefined) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `Assigning "super.${written}" writes the static "${written}" of "this" in TypeScript, not ` +
        `the one "${fieldOwner}" declares. Write "this.${written}" or "${fieldOwner}.${written}".`,
    )
    return undefined
  }
  const statik = inStaticMember(scope)
  const recv = statik ? undefined : superReceiver(node, sourceFile, scope, diagnostics)
  if (!statik && recv === undefined) return undefined
  const setter = superHalf(written, 'set', scope)
  if (setter === undefined) {
    superMiss(node, 'set', sourceFile, scope, diagnostics)
    return undefined
  }
  const getter = reads ? superHalf(node.name.text, 'get', scope) : undefined
  if (reads && getter === undefined) {
    superMiss(node, 'get', sourceFile, scope, diagnostics)
    return undefined
  }
  const self = recv?.type.kind === 'struct' ? recv.type.name : undefined
  const on = recv === undefined ? [] : [recv]
  for (const half of [setter, getter]) {
    const cf = half === undefined ? undefined : classFunctionOf(half)
    if (
      cf !== undefined &&
      !checkFunctionAccess(cf, self, node.name, sourceFile, scope, diagnostics)
    ) {
      return undefined
    }
  }
  return {
    type: setter.params[setter.params.length - 1]!.type,
    read: getter === undefined ? undefined : callOf(getter, on, sourceFile, node),
    write: (v: Expr): Stmt => ({
      s: 'call',
      expr: callOf(setter, [...on, v], sourceFile, node),
    }),
  }
}

/** An assignment whose target is an accessor (Rule 8.11): what a compound assignment reads,
 *  and how the new value is written. */
export interface AccessorTarget {
  /** The property's type: what the setter takes and the getter returns. */
  readonly type: ShaderType
  /** The getter's call, which `o.x += v` and `o.x++` read; absent for a plain `=`. */
  readonly read: Expr | undefined
  /** The setter's call with the new value, as a statement. */
  readonly write: (value: Expr) => Stmt
}

/** Whether evaluating `e` twice is the same as once: names, literals, fields and elements of
 *  those. A compound assignment through an accessor reads the object for the getter and again
 *  for the setter, so anything else would run twice. */
function readsOnly(e: Expr): boolean {
  switch (e.op) {
    case 'varref':
    case 'param':
    case 'constref':
    case 'overrideref':
    case 'lit':
      return true
    case 'member':
      return readsOnly(e.base)
    case 'index':
      return readsOnly(e.base) && readsOnly(e.idx)
    default:
      return false
  }
}

/** `o.x = v`, `o.x += v`, `o.x++` when `x` is an accessor (Rule 8.11). `reads` is whether the
 *  statement reads the property as well, which a compound assignment and `++`/`--` do.
 *  `'not-an-accessor'` for a target that is a field, a component, an element or a name, which
 *  the ordinary assignment path owns; undefined having refused it. */
export function lowerAccessorTarget(
  left: ts.Expression,
  reads: boolean,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): AccessorTarget | undefined | 'not-an-accessor' {
  const node = unparen(left)
  if (!ts.isPropertyAccessExpression(node)) return 'not-an-accessor'
  // `super.x = v`: the base's setter, run on this body's object.
  if (node.expression.kind === ts.SyntaxKind.SuperKeyword) {
    return superAccessorTarget(node, reads, sourceFile, scope, diagnostics)
  }
  const written = node.name.text
  const obj = node.expression
  const owner = staticOwnerOf(obj, scope)
  let struct: string
  if (owner !== undefined) {
    // A static field is a place of its own, `C.K`; only an accessor is this path's.
    if (staticFieldRead(owner, written, scope, sourceFile) !== undefined) return 'not-an-accessor'
    struct = owner
  } else {
    // Read without reporting: a receiver that does not lower, or is not a struct, takes the
    // ordinary path and gets its diagnostics there.
    const peek = lowerExpression(obj, sourceFile, scope, [])
    if (peek === undefined || peek.type.kind !== 'struct') return 'not-an-accessor'
    if (visibleField(peek.type.name, written, node.name, scope) !== undefined) {
      return 'not-an-accessor'
    }
    struct = peek.type.name
  }
  const isStatic = owner !== undefined
  const getter = memberFunctionOf(struct, written, 'get', scope)
  const setter = memberFunctionOf(struct, written, 'set', scope)
  const usable = (
    f: { cf: ClassFunction } | undefined,
  ): f is { decl: FuncDecl; cf: ClassFunction } =>
    f !== undefined && (f.cf.kind === 'static') === isStatic
  const get = usable(getter) ? getter : undefined
  const set = usable(setter) ? setter : undefined
  const either = set ?? get
  if (either === undefined) return 'not-an-accessor'
  const shown = `${struct}.${written}`
  if (
    !checkPrivateAccess(
      written,
      declaringClass(either.cf),
      struct,
      node.name,
      sourceFile,
      diagnostics,
    )
  ) {
    return undefined
  }
  if (set === undefined) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `"${shown}" has a getter and no setter, so it cannot be assigned. Declare ` +
        `"set ${written}(value)" beside the getter.`,
    )
    return undefined
  }
  if (reads && get === undefined) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `"${shown}" has a setter and no getter, so there is nothing for this assignment to ` +
        `read. Declare "get ${written}()" beside the setter, or assign it with "=".`,
    )
    return undefined
  }
  // Each half has its own `private` or `protected`, as in TypeScript: `private set x` leaves
  // the read public and takes the write away.
  const recvStruct = isStatic ? undefined : struct
  if (!checkFunctionAccess(set.cf, recvStruct, node.name, sourceFile, scope, diagnostics)) {
    return undefined
  }
  if (
    reads &&
    get !== undefined &&
    !checkFunctionAccess(get.cf, recvStruct, node.name, sourceFile, scope, diagnostics)
  ) {
    return undefined
  }
  const type = set.decl.params[set.decl.params.length - 1]!.type
  // The object each half is called on: the place for one that changes its object, the value
  // for one that only reads it.
  const receiverFor = (f: { cf: ClassFunction }): Expr[] | undefined => {
    if (isStatic) return []
    if (f.cf.mutates) {
      const place = mutatingReceiver(node, obj, shown, sourceFile, scope, diagnostics)
      return place === undefined ? undefined : [place]
    }
    const recv = lowerExpression(obj, sourceFile, scope, diagnostics)
    return recv === undefined ? undefined : [recv]
  }
  const setArgs = receiverFor(set)
  if (setArgs === undefined) return undefined
  let read: Expr | undefined
  if (reads && get !== undefined) {
    const getArgs = receiverFor(get)
    if (getArgs === undefined) return undefined
    if (!isStatic && !readsOnly(setArgs[0]!)) {
      pushDiag(
        diagnostics,
        sourceFile,
        obj,
        `"${node.getText(sourceFile)}" reads through the getter and writes through the setter, ` +
          `so "${obj.getText(sourceFile)}" would run twice. Bind it to a let first.`,
      )
      return undefined
    }
    read = callOf(get.decl, getArgs, sourceFile, node)
  }
  return {
    type,
    read,
    write: (v: Expr): Stmt => ({
      s: 'call',
      expr: callOf(set.decl, [...setArgs, v], sourceFile, node),
    }),
  }
}

/** The statement an assignment lowered to, turned into the setter's call when its target was
 *  an accessor: `o.x = v` is `set(o, v)`, and `o.x += v` is `set(o, get(o) + v)`. */
export function finishAccessorWrite(
  stmt: Stmt | undefined,
  target: AccessorTarget | 'not-an-accessor',
): Stmt | undefined {
  if (stmt === undefined || target === 'not-an-accessor') return stmt
  if (stmt.s === 'assign') return target.write(stmt.expr)
  if (stmt.s === 'assignOp') {
    return target.write({
      op: 'binop',
      type: target.type,
      bop: stmt.bop,
      a: target.read!,
      b: stmt.expr,
    })
  }
  return stmt
}

/** Refuse an assignment to a `readonly` field anywhere but a constructor of the class that
 *  declares it (Rule 8.14), TypeScript's TS2540, which this surface enforces since it does not
 *  run the checker. `readonly` is shallow, as TypeScript's is: `o.pos.x = 1.` writes into what
 *  the field holds and stands, and so does a method that changes `o.pos`. Returns true having
 *  refused. */
export function refuseReadonlyWrite(
  target: Expr,
  node: ts.Node,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): boolean {
  if (target.op !== 'member' || target.base.type.kind !== 'struct') return false
  const cls = scope.readonlyField(target.base.type.name, target.field)
  if (cls === undefined) return false
  const owner = scope.owner()
  const cf = owner === undefined ? undefined : classFunctionOf(owner)
  if (cf?.kind === 'ctor' && cf.node !== undefined && cf.node.parent === cls) return false
  const shown = classLabel(cls, target.base.type.name)
  pushDiag(
    diagnostics,
    sourceFile,
    node,
    `Cannot assign to "${node.getText(sourceFile)}" — "${target.field}" is readonly, so only ` +
      `the constructor of "${shown}" may assign it.`,
    TS_CODES.CONST_ASSIGN,
  )
  return true
}

/** The getter a write's target reads through, `o.pos.x = 1.` when `pos` is an accessor: what
 *  the getter returns is a copy, so the write would change the copy and be lost (Rule 8.11). */
export function getterInChain(e: Expr): ClassFunction | undefined {
  let at: Expr = e
  for (;;) {
    if (at.op === 'member' || at.op === 'index') {
      at = at.base
      continue
    }
    if (at.op === 'call' && at.declRef !== undefined) {
      const cf = classFunctionOf(at.declRef)
      return cf?.accessor === 'get' ? cf : undefined
    }
    return undefined
  }
}

/** The refusal for a write through a getter's result, at `node`. */
export function refuseWriteThroughGetter(
  node: ts.Node,
  cf: ClassFunction,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): void {
  pushDiag(
    diagnostics,
    sourceFile,
    node,
    `"${node.getText(sourceFile)}" writes into what the getter "${cf.shown}" returns, which is ` +
      `a copy, so the write would be lost. Assign the whole property, or add a method that ` +
      `changes the field.`,
    TS_CODES.ASSIGN_TARGET,
  )
}

/** A static field as an assignment target, `C.count = 1` or `this.count += 1` in a static
 *  member (Rule 8.13): the module variable a static field the file writes is. Undefined for a
 *  target that is not a static field; `'refused'` having said why it cannot be written. */
export function lowerStaticFieldTarget(
  node: ts.PropertyAccessExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | 'refused' | undefined {
  const owner = staticOwnerOf(node.expression, scope)
  if (owner === undefined) return undefined
  const written = node.name.text
  const b = staticFieldBinding(owner, written, scope, sourceFile)
  if (b === undefined) {
    const inherited = inheritedStaticWrite(owner, written, scope, sourceFile)
    if (inherited !== undefined) {
      pushDiag(diagnostics, sourceFile, node, inherited, TS_CODES.CONST_ASSIGN)
      return 'refused'
    }
    // `this.#k = v` in a static body a class inherits, `#k` being the declaring class's.
    const inheritedPrivate = inheritedPrivateStaticField(owner, written, scope, sourceFile)
    if (inheritedPrivate === undefined) return undefined
    pushDiag(diagnostics, sourceFile, node, inheritedPrivate)
    return 'refused'
  }
  if (!checkPrivateStatic(owner, written, node.name, sourceFile, diagnostics, scope)) {
    return 'refused'
  }
  if (!checkStaticFieldAccess(owner, written, node.name, sourceFile, scope, diagnostics)) {
    return 'refused'
  }
  if (b.kind !== 'modvar') {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      staticConstantWrite(owner, written, sourceFile),
      TS_CODES.CONST_ASSIGN,
    )
    return 'refused'
  }
  return withSpan({ op: 'varref', type: b.type, name: irNameOf(b) } as Expr, sourceFile, node)
}

/** Why a write cannot land on the static field `owner.written`, which is a module constant: it
 *  is `readonly`, or nothing in the file assigns it and the write is a method that changes it
 *  (Rule 8.13). */
export function staticConstantWrite(
  owner: string,
  written: string,
  sourceFile: ts.SourceFile,
): string {
  let readonly = false
  const walk = (n: ts.Node): void => {
    if (readonly) return
    if (ts.isClassDeclaration(n) && n.name?.text === owner) {
      readonly = n.members.some(
        (m) =>
          ts.isPropertyDeclaration(m) &&
          isStaticMember(m) &&
          isReadonlyMember(m) &&
          writtenMemberName(m.name) === written,
      )
      return
    }
    ts.forEachChild(n, walk)
  }
  walk(sourceFile)
  return readonly
    ? `Cannot assign to "${owner}.${written}" — it is static readonly.`
    : `"${owner}.${written}" is a module constant, since this file never assigns it, so it ` +
        `cannot change here. Assign it where it should change, "${owner}.${written} = ...", and ` +
        `it becomes a module variable.`
}

/** The private-name rule for a static member, `C.#count`: the class that declares it is the one
 *  named, so its body is the only place that may name it (Rule 8.12). */
export function checkPrivateStatic(
  owner: string,
  written: string,
  at: ts.Node,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  scope?: LoweringScope,
): boolean {
  if (!isPrivateName(written)) return true
  const lexical = privateOwner(at, written)
  const declaredIn = lexical?.cls.name?.text
  if (declaredIn === owner) return true
  pushDiag(
    diagnostics,
    sourceFile,
    at,
    declaredIn !== undefined && scope?.extendsStruct(owner, declaredIn) === true
      ? inheritedPrivateStatic(owner, written, declaredIn)
      : `"${written}" is private to "${owner}", and this code is outside its class body. Reach ` +
          `it through a member "${owner}" declares without the "#".`,
  )
  return false
}

/** Why `this.#x` in a static body a class inherits names nothing: the private static is the
 *  declaring class's own and no class that extends it has one, which TypeScript finds only when
 *  the body runs (Rule 8.12, Rule 8.13). */
export function inheritedPrivateStatic(owner: string, written: string, declaredIn: string): string {
  return (
    `"${owner}" has no "${written}": a private static is the class's own, and TypeScript throws ` +
    `where a body "${owner}" inherits reaches it through "this". Name the class that declares ` +
    `it, "${declaredIn}.${written}".`
  )
}

/** {@link inheritedPrivateStatic} for `owner.written` when a class above `owner` declares the
 *  private static field `written`; undefined when none does. */
export function inheritedPrivateStaticField(
  owner: string,
  written: string,
  scope: LoweringScope,
  sourceFile: ts.SourceFile,
): string | undefined {
  if (!isPrivateName(written)) return undefined
  for (const base of scope.ancestorsOf(owner)) {
    if (staticFieldBinding(base, written, scope, sourceFile) !== undefined) {
      return inheritedPrivateStatic(owner, written, base)
    }
  }
  return undefined
}
