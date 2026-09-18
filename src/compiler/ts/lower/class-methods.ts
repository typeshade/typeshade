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
// A method that assigns to `this` (step 2 of #86) takes and returns the struct: `Ray_advance(
// self_in: Ray, t: f32) -> Ray` starts with `var self_ = self_in`, runs the body on that local
// and returns it, and the call statement `r.advance(2.)` lowers to `r = Ray_advance(r, 2.)`.
// The receiver has to be a place a function may write (a `let` local, a module variable, a
// storage element); a `const`, a parameter or a temporary is refused with the fix. Such a
// method returns nothing, so its caller can write the object back; one that returns a value
// reads its object only.
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
import { irNameOf, readOnlyPhrase, type LoweringScope, type SuperCtor } from '../context.js'
import { TS_CODES, type TsCode } from '../codes.js'
import { makeDiagnostic } from '../diagnostic.js'
import { spanOf, withSpan } from '../span.js'
import { retargetIntLitCtx } from '../lit-coerce.js'
import { lowerExpression } from './expression.js'
import { lowerUserCall } from './expression-misc.js'
import { lowerLValue } from './statement.js'
import { parseParams, parseReturnType } from './function.js'
import { recordParamDefaults } from './param-defaults.js'

/** What `this` is while a member's body is lowered: the struct type; whether it is the
 *  read-only first parameter of a method (`param`), the local a constructor builds from the
 *  zero struct (`ctor`), or the local a method that changes its object copies its parameter
 *  into and returns (`copy`); the field initializers a constructor assigns first; and how
 *  messages name the member. */
export interface Receiver {
  readonly type: ShaderType
  readonly mode: 'param' | 'ctor' | 'copy'
  readonly fieldInits: readonly FieldInit[]
  readonly shown: string
  /** What `super(...)` in this constructor's body calls (roadmap 0.3 item T5, #92): the base's
   *  constructor function and the fields it fills. Relative to the class that DECLARED the
   *  body, which for an inherited constructor is not the class being built. Absent when the
   *  chain above has no constructor, where `super()` has nothing to run. */
  readonly superCtor?: SuperCtor
  /** `super.m(...)` in this body, to the function that carries the base's body, lowered against
   *  this class (roadmap 0.3 item T5, #92). Keyed by the member written, since which base
   *  declares it depends on the class that wrote the body and not on the one being built. */
  readonly superMethods?: ReadonlyMap<string, string>
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
  /** A method that changes its object: it takes and returns the struct, and a call of it is
   *  a statement that writes the receiver back. */
  readonly mutates: boolean
}

/** The name the struct arrives under in a method that changes its object; the body works on
 *  `self_`, a copy of it. */
export const SELF_IN = 'self_in'

/** The emitted name of a method or a static function: `Ray_at`. */
export const methodFnName = (struct: string, member: string): string => `${struct}_${member}`
/** The emitted name of a constructor: `Ray_new`. */
export const ctorFnName = (struct: string): string => `${struct}_new`
/** The emitted name of the BASE's body of a method a class overrides, which is what
 *  `super.at(t)` in `Ray`'s `at` calls: `Ray_super_Base_at` (roadmap 0.3 item T5, #92). The
 *  base is named, not just the class, so a body re-lowered two steps down still counts its own
 *  `super` from where it was written. One underscore between the parts, like every other
 *  flattened name, because GLSL ES reserves an identifier that holds two in a row. */
export const superFnName = (struct: string, base: string, member: string): string =>
  `${struct}_super_${base}_${member}`

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

function unparen(e: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(e) ? unparen(e.expression) : e
}

/** Whether a write target (`this.x`, `this.xs[i].y`, `(this).z`) is rooted in `this`. */
function rootedInThis(e: ts.Expression): boolean {
  const n = unparen(e)
  if (n.kind === ts.SyntaxKind.ThisKeyword) return true
  if (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) {
    return rootedInThis(n.expression)
  }
  return false
}

/** Whether a method's body writes its object: an assignment or `++`/`--` rooted in `this`, or
 *  a call of one of `mutating` (the class's methods already known to write) on `this`. */
function writesThis(body: ts.Block, mutating: ReadonlySet<string>): boolean {
  let found = false
  const walk = (n: ts.Node): void => {
    if (found) return
    if (
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      n.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
      rootedInThis(n.left)
    ) {
      found = true
      return
    }
    if (
      (ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) &&
      (n.operator === ts.SyntaxKind.PlusPlusToken ||
        n.operator === ts.SyntaxKind.MinusMinusToken) &&
      rootedInThis(n.operand)
    ) {
      found = true
      return
    }
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      unparen(n.expression.expression).kind === ts.SyntaxKind.ThisKeyword &&
      mutating.has(n.expression.name.text)
    ) {
      found = true
      return
    }
    ts.forEachChild(n, walk)
  }
  walk(body)
  return found
}

/** The methods of a class that change their object, to a fixpoint: one that writes a field
 *  directly, and one that calls such a method on `this`. */
function mutatingMethodsOf(methods: readonly ts.MethodDeclaration[]): Set<string> {
  const out = new Set<string>()
  const candidates = methods.filter(
    (m) =>
      m.body !== undefined &&
      ts.isIdentifier(m.name) &&
      !(m.modifiers?.some((x) => x.kind === ts.SyntaxKind.StaticKeyword) ?? false),
  )
  for (;;) {
    let grew = false
    for (const m of candidates) {
      const name = (m.name as ts.Identifier).text
      if (out.has(name)) continue
      if (writesThis(m.body!, out)) {
        out.add(name)
        grew = true
      }
    }
    if (!grew) return out
  }
}

/** One method body a class emits, and what `super` means inside it (roadmap 0.3 item T5, #92).
 *
 *  A class inherits a method by lowering the BASE's node again with `this` typed as itself:
 *  dispatch is static, a derived struct carries the base's fields under the same names, and a
 *  base-typed variable cannot hold a derived value, so the body means on the derived class
 *  exactly what it means on the base — including a call to a method the derived class
 *  overrides, which resolves to the override, as it does in TypeScript.
 *
 *  `super.m(...)` is the same idea one step up. The body it names is emitted against this class
 *  too, under `T_super_B_m`, where `B` is the class that DECLARED the body doing the calling.
 *  That last part is what keeps a three-deep chain finite: `super.at` inside `B`'s body means
 *  `A`'s `at`, whichever class the body is being lowered for. */
interface ClassBody {
  readonly node: ts.MethodDeclaration
  /** The class that wrote this body, which is what `super` inside it counts from. */
  readonly declaredIn: string
  readonly fnName: string
  readonly member: string
  readonly isStatic: boolean
  /** `super.m(...)` in this body, to the function that carries the base's body. */
  readonly superMethods: ReadonlyMap<string, string>
}

/** The chain above `name`, nearest first, without `name` itself. */
function ancestorsOf(
  name: string,
  byName: ReadonlyMap<string, CollectedStruct>,
): readonly CollectedStruct[] {
  const out: CollectedStruct[] = []
  const seen = new Set<string>([name])
  const queue = [...(byName.get(name)?.bases ?? [])]
  while (queue.length > 0) {
    const next = queue.shift()!
    if (seen.has(next)) continue
    seen.add(next)
    const s = byName.get(next)
    if (!s) continue
    out.push(s)
    queue.push(...(s.bases ?? []))
  }
  return out
}

/** A method with a body, by name, on `struct` itself. A body-less one is an overload signature
 *  (T6) or an `abstract` member: neither has a body to lower. */
function ownMethod(
  struct: CollectedStruct | undefined,
  member: string,
  isStatic: boolean,
): ts.MethodDeclaration | undefined {
  for (const m of struct?.members?.methods ?? []) {
    if (!m.body || !ts.isIdentifier(m.name) || m.name.text !== member) continue
    const st = m.modifiers?.some((x) => x.kind === ts.SyntaxKind.StaticKeyword) ?? false
    if (st === isStatic) return m
  }
  return undefined
}

/** Every `super.<name>(` written under `node`. */
function eachSuperMember(node: ts.Node, f: (member: string) => void): void {
  const walk = (n: ts.Node): void => {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.expression.kind === ts.SyntaxKind.SuperKeyword
    ) {
      f(n.expression.name.text)
    }
    ts.forEachChild(n, walk)
  }
  walk(node)
}

/** The bodies `struct` emits, and its inherited field initializers.
 *
 *  The primary set is one body per method name the class has, its own before any it inherits.
 *  From there a worklist follows each `super.m(...)`: the body it names is the nearest one
 *  above the class that WROTE the call, emitted against this class under its own name, and its
 *  own `super` calls are followed the same way until nothing new appears. */
function effectiveMembers(
  struct: CollectedStruct,
  byName: ReadonlyMap<string, CollectedStruct>,
): { bodies: readonly ClassBody[]; fieldInits: readonly FieldInit[] } {
  const target = struct.decl.name
  const chain = [struct, ...ancestorsOf(target, byName)]
  const bodies: ClassBody[] = []
  const emitted = new Set<string>()
  const pending: { node: ts.MethodDeclaration; declaredIn: string; fnName: string }[] = []

  const see = (node: ts.MethodDeclaration, declaredIn: string, fnName: string): void => {
    if (emitted.has(fnName)) return
    emitted.add(fnName)
    pending.push({ node, declaredIn, fnName })
  }
  const taken = new Set<string>()
  for (const owner of chain) {
    for (const m of owner.members?.methods ?? []) {
      if (!m.body || !ts.isIdentifier(m.name)) continue
      const isStatic = m.modifiers?.some((x) => x.kind === ts.SyntaxKind.StaticKeyword) ?? false
      const key = `${isStatic ? 'static ' : ''}${m.name.text}`
      if (taken.has(key)) continue
      taken.add(key)
      see(m, owner.decl.name, methodFnName(target, m.name.text))
    }
  }
  /** The body `super.member` names from a body written by `declaredIn`. */
  const above = (declaredIn: string, member: string): ts.MethodDeclaration | undefined => {
    for (const a of ancestorsOf(declaredIn, byName)) {
      const hit = ownMethod(a, member, false)
      if (hit) return hit
    }
    return undefined
  }
  const superOwner = (declaredIn: string, member: string): string | undefined => {
    for (const a of ancestorsOf(declaredIn, byName)) {
      if (ownMethod(a, member, false)) return a.decl.name
    }
    return undefined
  }
  while (pending.length > 0) {
    const { node, declaredIn, fnName } = pending.shift()!
    const superMethods = new Map<string, string>()
    eachSuperMember(node.body!, (member) => {
      const owner = superOwner(declaredIn, member)
      const base = above(declaredIn, member)
      if (!owner || !base) return
      const name = superFnName(target, owner, member)
      superMethods.set(member, name)
      see(base, owner, name)
    })
    bodies.push({
      node,
      declaredIn,
      fnName,
      member: ts.isIdentifier(node.name) ? node.name.text : '',
      isStatic: node.modifiers?.some((x) => x.kind === ts.SyntaxKind.StaticKeyword) ?? false,
      superMethods,
    })
  }
  // A field initializer runs base first, so a derived class that initializes an inherited
  // field wins, the way its assignment would.
  const fieldInits: FieldInit[] = []
  const initNames = new Set<string>()
  const initsOf = (s: CollectedStruct | undefined, seen: Set<string>): void => {
    if (!s || seen.has(s.decl.name)) return
    seen.add(s.decl.name)
    for (const base of s.bases ?? []) initsOf(byName.get(base), seen)
    for (const f of s.members?.fieldInits ?? []) {
      if (initNames.has(f.name)) continue
      initNames.add(f.name)
      fieldInits.push(f)
    }
  }
  initsOf(struct, new Set())
  return { bodies, fieldInits }
}

/** The map a constructor body needs for its own `super.m(...)` calls. */
function ctorSuperMethods(
  struct: CollectedStruct,
  declaredIn: string,
  byName: ReadonlyMap<string, CollectedStruct>,
  ctor: ts.ConstructorDeclaration | undefined,
): ReadonlyMap<string, string> {
  const out = new Map<string, string>()
  if (!ctor?.body) return out
  eachSuperMember(ctor.body, (member) => {
    for (const a of ancestorsOf(declaredIn, byName)) {
      if (ownMethod(a, member, false)) {
        out.set(member, superFnName(struct.decl.name, a.decl.name, member))
        return
      }
    }
  })
  return out
}

/** The constructor a class uses: its own, or the nearest base's, which TypeScript inherits
 *  when the derived class declares none (T5, #92). */
function effectiveCtor(
  struct: CollectedStruct,
  byName: ReadonlyMap<string, CollectedStruct>,
): { node: ts.ConstructorDeclaration; owner: CollectedStruct } | undefined {
  const seen = new Set<string>()
  const walk = (
    s: CollectedStruct | undefined,
  ): { node: ts.ConstructorDeclaration; owner: CollectedStruct } | undefined => {
    if (!s || seen.has(s.decl.name)) return undefined
    seen.add(s.decl.name)
    if (s.members?.ctor) return { node: s.members.ctor, owner: s }
    for (const base of s.bases ?? []) {
      const hit = walk(byName.get(base))
      if (hit) return hit
    }
    return undefined
  }
  return walk(struct)
}

/** The constructor `super(...)` reaches from the body `owner` declared: the nearest class above
 *  it that has one. A class whose chain declares none gives `undefined`, and a bare `super()`
 *  there has nothing to run, which is what TypeScript's implicit one does too. */
function superCtorOf(
  owner: CollectedStruct,
  byName: ReadonlyMap<string, CollectedStruct>,
): SuperCtor | undefined {
  for (const base of owner.bases ?? []) {
    const found = effectiveCtor(byName.get(base) ?? owner, byName)
    if (!found) continue
    const filled = byName.get(base)
    if (!filled) continue
    return { fn: ctorFnName(base), type: structT(base), fields: filled.decl.fields }
  }
  return undefined
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
  const byName = new Map(structs.map((s) => [s.decl.name, s]))
  for (const struct of structs) {
    const name = struct.decl.name
    const selfT = structT(name)
    const members = struct.members
    const effective = effectiveMembers(struct, byName)
    // An abstract class is a base and never a value, so it contributes no instance method and
    // no constructor of its own; its bodies are lowered into each concrete class below. Its
    // statics are functions like any other and are kept.
    const bodies = struct.abstract ? effective.bodies.filter((b) => b.isStatic) : effective.bodies
    const mutating = mutatingMethodsOf(bodies.map((b) => b.node))
    for (const body of bodies) {
      const method = body.node
      if (!ts.isIdentifier(method.name)) continue
      const member = body.member
      const isSuperBody = body.fnName !== methodFnName(name, member)
      const shown = isSuperBody ? `super.${member}` : `${name}.${member}`
      const isStatic = body.isStatic
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
      // A method that changes its object takes and returns the struct, so its caller can write
      // the object back; it has to return nothing itself. One that returns a value keeps its
      // object read-only, and a write inside it is refused where it stands (statement.ts).
      // A body reached through `super` is read-only: it has no receiver to write back to, so
      // the copy protocol a mutating method uses has nowhere to land.
      const copies = !isStatic && !isSuperBody && mutating.has(member) && typeKey(ret) === 'void'
      const stub: FuncDecl = {
        name: body.fnName,
        params: isStatic ? params : [{ name: copies ? SELF_IN : 'self_', type: selfT }, ...params],
        ret: copies ? selfT : ret,
        body: [],
      }
      ;(stub as { span?: SourceSpan }).span = spanOf(sourceFile, method)
      ;(stub as { nameSpan?: SourceSpan }).nameSpan = spanOf(sourceFile, method.name)
      // A method's stub carries `self_` ahead of the written parameters, so the defaults sit
      // one index along (roadmap 0.3 item T7, #92); a static method's do not.
      recordParamDefaults(stub, method.parameters, isStatic ? 0 : 1)
      const cf: ClassFunction = {
        stub,
        kind: isStatic ? 'static' : 'method',
        struct,
        shown,
        node: method,
        receiver: isStatic
          ? undefined
          : {
              type: selfT,
              mode: copies ? 'copy' : 'param',
              fieldInits: [],
              shown,
              superMethods: body.superMethods,
            },
        mutates: copies,
      }
      registry.set(stub, cf)
      out.push(cf)
    }
    // A derived class inherits its base's field initializers and, when it declares none of its
    // own, its constructor (T5, #92). An abstract class is never constructed, so it has no
    // constructor function of its own; the body reaches each concrete class through the same
    // inheritance.
    const fieldInits = effective.fieldInits
    // An abstract class is never `new`ed, but a derived constructor's `super(...)` calls its
    // constructor, so one it declares itself is still emitted.
    const found = struct.abstract
      ? struct.members?.ctor
        ? { node: struct.members.ctor, owner: struct }
        : undefined
      : effectiveCtor(struct, byName)
    const ctor = found?.node
    if (struct.abstract && ctor === undefined) continue
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
    if (ctor) recordParamDefaults(stub, ctor.parameters)
    const at = ctor ?? members?.node
    if (at !== undefined) (stub as { span?: SourceSpan }).span = spanOf(sourceFile, at)
    const cf: ClassFunction = {
      stub,
      kind: 'ctor',
      struct,
      shown,
      node: ctor,
      receiver: {
        type: selfT,
        mode: 'ctor',
        fieldInits,
        shown,
        // Relative to the class that DECLARED this body: an inherited constructor's `super`
        // still names ITS base, not the base of the class being built.
        ...(found ? { superCtor: superCtorOf(found.owner, byName) } : {}),
        superMethods: ctorSuperMethods(struct, found?.owner.decl.name ?? name, byName, ctor),
      },
      mutates: false,
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

/** The statements a member that builds its object starts with. A constructor: `var self_: T`
 *  at the zero struct, spelled out where {@link zeroExprOf} can so GLSL starts from zero too,
 *  then each field initializer assigned in declaration order. A method that changes its
 *  object: `var self_ = self_in`, the copy the body works on and returns. Defines `this` as
 *  that local either way. */
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
  if (receiver.mode === 'copy') {
    return [
      {
        s: 'var',
        name: irNameOf(self),
        type: receiver.type,
        init: { op: 'param', type: receiver.type, name: SELF_IN },
      },
    ]
  }
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
/** The owner a call's receiver names, flattened: `A` for `A.f()`, `A_B` for `A.B.f()`, and
 *  the namespace-qualified form when the body being lowered is inside one. Undefined when the
 *  receiver is not a chain of identifiers, which is a call on a value. */
function flattenedOwner(expr: ts.Expression, scope: LoweringScope): string | undefined {
  const parts: string[] = []
  let node: ts.Expression = expr
  for (;;) {
    if (ts.isIdentifier(node)) {
      parts.unshift(node.text)
      break
    }
    if (ts.isPropertyAccessExpression(node)) {
      parts.unshift(node.name.text)
      node = node.expression
      continue
    }
    return undefined
  }
  const joined = parts.join('_')
  // Inside a namespace body, a member namespace may be written by its short name: `B.two()`
  // inside `namespace A` is `A_B_two`.
  const qualified = scope.qualifiedNamespace(joined)
  if (qualified !== undefined) return qualified
  if (parts.length === 1) return joined
  // A longer path that names no namespace is a field read on a value, which the receiver path
  // below handles.
  return undefined
}

/** `super.at(t)` inside a method that overrides `at` (roadmap 0.3 item T5, #92): a call of the
 *  base's body, which the collector lowered against this class under `Ray_super_at`, with the
 *  object first. Refused where there is no object, where nothing above declares the method, and
 *  where the base's version writes to its object, which would need the copy-back a plain
 *  method call gets and `super` has no receiver to write to. */
function lowerSuperMethodCall(
  node: ts.CallExpression,
  callee: ts.PropertyAccessExpression,
  member: string,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const self = scope.resolve('this')
  if (!self || self.type.kind !== 'struct') {
    pushDiag(
      diagnostics,
      sourceFile,
      callee,
      '"super" names the base of a method\'s class; a static function and a top-level function have none.',
    )
    return undefined
  }
  // Which base body this names was decided by the collector, from the class that WROTE the
  // body rather than the one it is being lowered for; the scope carries that answer.
  const fn = scope.superMethods()?.get(member)
  const decl = fn === undefined ? undefined : scope.resolveCallee(fn)
  if (!decl) {
    pushDiag(
      diagnostics,
      sourceFile,
      callee,
      `Nothing above this class declares a method "${member}", so "super.${member}" names no body.`,
    )
    return undefined
  }
  const leading: Expr[] = [
    self.kind === 'param'
      ? { op: 'param', type: self.type, name: irNameOf(self) }
      : { op: 'varref', type: self.type, name: irNameOf(self) },
  ]
  return lowerUserCall(node, decl, sourceFile, scope, diagnostics, {
    leading,
    shown: `super.${member}`,
  })
}

export function lowerClassCall(
  node: ts.CallExpression,
  callee: ts.PropertyAccessExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined | 'not-a-class-call' {
  const obj = callee.expression
  const member = callee.name.text
  // `super.at(t)` runs the BASE's body on this object (T5, #92). The base's body was lowered
  // against this class under `Ray_super_at`, so the call is an ordinary one with `this` first.
  if (obj.kind === ts.SyntaxKind.SuperKeyword) {
    return lowerSuperMethodCall(node, callee, member, sourceFile, scope, diagnostics)
  }
  // `A.B.two()` names the namespace `A_B` (T4, #92): a chain of identifiers joins the way the
  // members do. A single identifier is the class or namespace itself, as before.
  const owner = flattenedOwner(obj, scope)
  if (
    owner !== undefined &&
    scope.resolve(owner) === undefined &&
    (scope.structByName(owner) !== undefined || scope.isNamespace(owner))
  ) {
    const name = owner
    const shown = `${name}.${member}`
    const decl = scope.resolveCallee(methodFnName(name, member))
    const cf = decl === undefined ? undefined : classFunctionOf(decl)
    if (cf === undefined) {
      // A namespace's member is a plain function of the module (T4, #92), so it has no
      // ClassFunction record; the callee lookup above is the whole of its resolution.
      if (scope.isNamespace(name)) {
        if (decl !== undefined)
          return lowerUserCall(node, decl, sourceFile, scope, diagnostics, { shown })
        pushDiag(diagnostics, sourceFile, callee, `"${name}" has no function "${member}".`)
        return undefined
      }
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
  if (cf.mutates) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `"${shown}" changes its object and returns nothing; call it on its own line.`,
    )
    return undefined
  }
  return lowerUserCall(node, decl!, sourceFile, scope, diagnostics, { shown, leading: [recv] })
}

/** A call statement of a method that changes its object, `r.advance(2.)`: the receiver is
 *  lowered as a place and written back, `r = Ray_advance(r, 2.0)`. Returns the marker for any
 *  other call statement, which takes the ordinary path. A receiver that is not a place a
 *  function may write (a `const`, a parameter, a value that is dropped) is refused with the
 *  fix. */
export function lowerMutatingCall(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt | undefined | 'not-a-mutating-call' {
  const callee = node.expression
  if (!ts.isPropertyAccessExpression(callee)) return 'not-a-mutating-call'
  const obj = callee.expression
  const member = callee.name.text
  // The receiver's type, read without reporting: a receiver that does not lower, or is not a
  // struct, takes the ordinary path and gets its diagnostics there.
  const peek = lowerExpression(obj, sourceFile, scope, [])
  if (!peek || peek.type.kind !== 'struct') return 'not-a-mutating-call'
  const name = peek.type.name
  const decl = scope.resolveCallee(methodFnName(name, member))
  const cf = decl === undefined ? undefined : classFunctionOf(decl)
  if (cf === undefined || !cf.mutates) return 'not-a-mutating-call'
  const shown = cf.shown
  const bare = unparen(obj)
  if (ts.isIdentifier(bare)) {
    const b = scope.resolve(bare.text)
    if (b !== undefined && b.kind === 'param') {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `"${shown}" changes its object, and "${bare.text}" is a parameter, which a function ` +
          `cannot write; copy it into a let first.`,
      )
      return undefined
    }
    if (b !== undefined && !b.mutable) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `"${shown}" changes its object, and "${bare.text}" is ${readOnlyPhrase(b.kind)}; ` +
          `declare it with let.`,
      )
      return undefined
    }
  }
  if (ts.isCallExpression(bare) || ts.isNewExpression(bare)) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `"${shown}" changes its object, and this one is a value that is dropped; keep it in a ` +
        `let and call the method on that.`,
    )
    return undefined
  }
  const target = lowerLValue(obj, sourceFile, scope, diagnostics)
  if (!target) return undefined
  const call = lowerUserCall(node, decl!, sourceFile, scope, diagnostics, {
    shown,
    leading: [target],
  })
  if (!call) return undefined
  return { s: 'assign', target, expr: call }
}
