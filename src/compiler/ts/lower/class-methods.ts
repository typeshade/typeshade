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
// A method that assigns to `this` (step 2 of #86) takes its object BY REFERENCE: `inout` on
// GLSL ES 3.00, a pointer on WGSL, `fn Ray_advance(self_: ptr<function, Ray>, t: f32)`, and
// the call `r.advance(2.)` passes the receiver itself, `Ray_advance(&r, 2.0)`. The receiver has
// to be a place a function may write (a `let` local, a module variable, a storage element); a
// `const`, a parameter or a temporary is refused with the fix. Such a method may return a
// value like any other (§26, Rule 8.10), since the reference leaves the return free: a
// generator's `next()` advances its state and returns the draw, `fn Rng_next(self_:
// ptr<function, Rng>) -> f32`. It returned nothing while it took the struct and returned THAT,
// which is what the caller stored back. A call of one inside a larger expression is put in
// source order by `sequence.ts` (Rule 7.9).
//
// The object's name in the emitted function is `self_`, not `self`: Tint refuses `self`, which
// is on WGSL's reserved-word list (as `this` is), and GLSL ES 3.00 takes either.

import ts from 'typescript'
import type { Expr, FuncDecl, Stmt } from '../../../core/ir/nodes.js'
import type { ShaderType } from '../../../core/ir/types.js'
import type { SourceSpan } from '../../../core/ir/span.js'
import { boolT, f32T, i32T, structT, typeKey, u32T, voidT } from '../../../core/ir/types.js'
import type { TsCompilerDiagnostic } from '../source-file.js'
import type { CollectedStruct, FieldInit } from '../structs.js'
import { irNameOf, readOnlyPhrase, type LoweringScope, type SuperCtor } from '../context.js'
import { pushTypeArguments } from '../generics.js'
import { ambiguousNew, newInstanceName } from '../generic-structs.js'
import { TS_CODES, type TsCode } from '../codes.js'
import { makeDiagnostic } from '../diagnostic.js'
import { spanOf, withSpan } from '../span.js'
import { retargetIntLitCtx } from '../lit-coerce.js'
import { lowerExpression } from './expression.js'
import { lowerUserCall } from './expression-misc.js'
import { lowerLValue } from './statement.js'
import { parseParams, parseReturnType } from './function.js'
import { recordParamDefaults } from './param-defaults.js'
import {
  accessorFnName,
  emittedMemberName,
  isPrivateName,
  isStaticMember,
  returnsThis,
  staticThisClass,
  writtenMemberName,
} from '../class-names.js'
import { mapTsTypeToShaderType } from '../type-map.js'
import {
  checkFunctionAccess,
  checkInheritedPrivateStatic,
  checkPrivateAccess,
  memberFunctionOf,
  visibleField,
} from './class-access.js'

/** What `this` is while a member's body is lowered: the struct type; whether it is the
 *  read-only first parameter of a method (`param`), the local a constructor builds from the
 *  zero struct (`ctor`), or the parameter a method that changes its object writes through
 *  (`inout`); the field initializers a constructor assigns first; and how messages name the
 *  member. */
export interface Receiver {
  readonly type: ShaderType
  readonly mode: 'param' | 'ctor' | 'inout'
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
  /** A constructor's parameter properties, which it assigns from their parameters before the
   *  field initializers run (Rule 8.14), the order TypeScript's own constructor keeps. */
  readonly paramProps?: readonly { readonly name: string; readonly type: ShaderType }[]
  /** What a constructor whose `super(...)` runs a base's constructor does right after that call
   *  returns: its parameter properties, then its class's own field initializers, which
   *  TypeScript runs there and not before the base's constructor (Rule 8.14). */
  readonly afterSuper?: {
    readonly paramProps: readonly { readonly name: string; readonly type: ShaderType }[]
    readonly fieldInits: readonly FieldInit[]
  }
  /** The initializers of the classes below the one that declared this constructor, down to the
   *  class being built, which run when its body returns, as their implicit constructors would. */
  readonly afterBody?: readonly FieldInit[]
  /** A constructor's own class's initializers when no base constructor runs first: after its
   *  parameter properties, and after the initializers of `fieldInits`, which are the classes
   *  above it (Rule 8.14). */
  readonly ownInits?: readonly FieldInit[]
}

/** A member that becomes a function of the module: a method, or one half of an accessor. */
export type MemberFunction = ts.MethodDeclaration | ts.AccessorDeclaration

/** Which half of an accessor `node` is, or `undefined` for a method. */
export const accessorHalf = (node: ts.Node): 'get' | 'set' | undefined =>
  ts.isGetAccessorDeclaration(node) ? 'get' : ts.isSetAccessorDeclaration(node) ? 'set' : undefined

/** One function a class contributes to the module. `node` is absent for the constructor a
 *  class without one gets when the file says `new P(...)` or a field has an initializer. */
export interface ClassFunction {
  readonly stub: FuncDecl
  readonly kind: 'method' | 'static' | 'ctor'
  readonly struct: CollectedStruct
  /** How a message names it: `Ray.at`, `Ray.up`, `new Ray`. */
  readonly shown: string
  readonly node: MemberFunction | ts.ConstructorDeclaration | undefined
  readonly receiver: Receiver | undefined
  /** A method that changes its object: it takes the struct by reference, so its receiver has
   *  to be a place a function may write. It may return a value (§26). */
  readonly mutates: boolean
  /** The member as written, `at` or `#step`, or the property an accessor half serves: what an
   *  access has to name to reach it, since a private member answers to its `#` name only
   *  (Rule 8.12). Absent on a constructor. */
  readonly member?: string
  /** Which half of an accessor this is (Rule 8.11); absent on a method. */
  readonly accessor?: 'get' | 'set'
  /** For a static member, the class it is emitted for, which is the class a call of it names:
   *  what `this` names inside it (Rule 8.13). A static a class inherits is lowered again for each
   *  class that extends it, with `this` as that class, which is how TypeScript binds it. */
  readonly staticOwner?: string
  /** For a static member, what `super.k()`, `super.x` and `super.K` name in its body: in a
   *  static member `super` is the class above the one that wrote it (Rule 8.13). */
  readonly staticSuper?: ReadonlyMap<string, string>
  /** A body lowered for a class that inherits it, not for the class that wrote it. What it says
   *  the declaring class's body has said already (Rule 12.4), and a static one that fails only
   *  for this class is said where something calls it (Rule 8.13). */
  readonly inherited?: true
  /** A method whose every `return` is `return this`, typed as its class: it hands back its own
   *  object, so a chain `v.setX(1.).setY(2.)` continues on `v` (Rule 8.10). */
  readonly returnsThis?: true
}

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

/** The functions a private name collided into (Rule 8.12): the name is reported once, where it is
 *  declared, and a call that would have reached the member that lost says nothing more (Rule
 *  12.4). */
const collided = new WeakSet<FuncDecl>()

/** Whether `decl` is a function two members of one class chain would both have been. */
export const isCollidedFunction = (decl: FuncDecl): boolean => collided.has(decl)

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

/** Every identifier the file writes `new X(...)` on, and the classes a `new this()` in a static
 *  member builds: the class that declares the member, and each class that inherits it, for which
 *  the member is lowered again with `this` as that class (Rule 8.13). */
function namesConstructed(
  sourceFile: ts.SourceFile,
  structs: readonly CollectedStruct[],
  byName: ReadonlyMap<string, CollectedStruct>,
): Set<string> {
  const out = new Set<string>()
  const throughThis = new Set<string>()
  const walk = (n: ts.Node): void => {
    if (ts.isNewExpression(n) && ts.isIdentifier(n.expression)) {
      // `new Pair<f32>()` constructs the INSTANCE struct (T9, #92), which is the name a
      // synthesised constructor has to be registered under.
      out.add(newInstanceName(n, n.expression.text, sourceFile) ?? n.expression.text)
    }
    if (ts.isNewExpression(n) && n.expression.kind === ts.SyntaxKind.ThisKeyword) {
      const cls = staticThisClass(n.expression)?.name?.text
      if (cls !== undefined) {
        out.add(newInstanceName(n, cls, sourceFile) ?? cls)
        throughThis.add(cls)
      }
    }
    ts.forEachChild(n, walk)
  }
  walk(sourceFile)
  for (const s of structs) {
    if (ancestorsOf(s.decl.name, byName).some((a) => throughThis.has(a.decl.name))) {
      out.add(s.decl.name)
    }
  }
  return out
}

/** Whether a constructor body calls `super(...)`. */
function callsSuper(node: ts.Node): boolean {
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.SuperKeyword) return true
  if (ts.isFunctionLike(node) && !ts.isArrowFunction(node)) return false
  return ts.forEachChild(node, callsSuper) ?? false
}

/** Whether every `return` of a body returns what `new this(...)` built: the expression itself,
 *  or a name the body declared from one. A body that returns anything else, on any path, keeps
 *  the type it declares. */
function returnsBuiltThis(node: MemberFunction): boolean {
  const isNewThis = (e: ts.Expression): boolean => {
    const x = unparen(e)
    return ts.isNewExpression(x) && x.expression.kind === ts.SyntaxKind.ThisKeyword
  }
  const built = new Set<string>()
  let returns = 0
  let others = 0
  const walk = (n: ts.Node): void => {
    if (ts.isFunctionLike(n) && !ts.isArrowFunction(n)) return
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.initializer !== undefined &&
      isNewThis(n.initializer)
    ) {
      built.add(n.name.text)
    }
    if (ts.isReturnStatement(n)) {
      returns++
      const e = n.expression !== undefined ? unparen(n.expression) : undefined
      if (!(e !== undefined && (isNewThis(e) || (ts.isIdentifier(e) && built.has(e.text))))) {
        others++
      }
    }
    ts.forEachChild(n, walk)
  }
  if (node.body !== undefined) ts.forEachChild(node.body, walk)
  return returns > 0 && others === 0
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

/** The key a member function has in the set {@link mutatingMembersOf} builds: the method as
 *  written, `step` or `#step`, and an accessor half as `get x` or `set x`. */
const memberKeyOf = (node: MemberFunction): string | undefined => {
  const written = writtenMemberName(node.name)
  if (written === undefined) return undefined
  const half = accessorHalf(node)
  return half === undefined ? written : `${half} ${written}`
}

/** Whether a member's body writes its object: an assignment or `++`/`--` rooted in `this`, a
 *  call of one of `mutating` (the class's members already known to write) on `this`, or a read
 *  of `this.x` whose getter is one of them (Rule 8.11). A call on a chain rooted in `this`,
 *  through methods that return `this` (`chainable`), is a call on `this` (Rule 8.10). */
function writesThis(
  body: ts.Block,
  mutating: ReadonlySet<string>,
  chainable: ReadonlySet<string> = new Set(),
): boolean {
  const rootOf = (e: ts.Expression): ts.Expression => {
    let x = unparen(e)
    while (
      ts.isCallExpression(x) &&
      ts.isPropertyAccessExpression(x.expression) &&
      chainable.has(x.expression.name.text)
    ) {
      x = unparen(x.expression.expression)
    }
    return x
  }
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
      rootOf(n.expression.expression).kind === ts.SyntaxKind.ThisKeyword &&
      mutating.has(n.expression.name.text)
    ) {
      found = true
      return
    }
    if (
      ts.isPropertyAccessExpression(n) &&
      unparen(n.expression).kind === ts.SyntaxKind.ThisKeyword &&
      mutating.has(`get ${n.name.text}`)
    ) {
      found = true
      return
    }
    ts.forEachChild(n, walk)
  }
  walk(body)
  return found
}

/** The bodies a class emits that change their object, by the function each is emitted as, to
 *  a fixpoint: one that writes a field directly, one that calls such a method or reads such a
 *  getter on `this`, and one that reaches such a base body through `super`, which runs on the
 *  same object (Rule 8.10). A call on `this` resolves to the class's own member, so only a body
 *  the class emits under its own name answers to one. */
function mutatingBodiesOf(bodies: readonly ClassBody[]): Set<string> {
  const fns = new Set<string>()
  const keys = new Set<string>()
  const candidates = bodies.filter(
    (b) => !b.isStatic && b.node.body !== undefined && memberKeyOf(b.node) !== undefined,
  )
  // The class's own methods that hand back `this`, which a chain on `this` runs through.
  const chainable = new Set(
    candidates
      .filter((b) => !b.isSuper && b.accessor === undefined && returnsThis(b.node.body))
      .map((b) => b.member),
  )
  const throughSuper = (b: ClassBody): boolean => {
    let found = false
    eachSuperRef(b.node.body!, (ref) => {
      const fn = b.superMethods.get(superKey(ref))
      if (fn !== undefined && fns.has(fn)) found = true
    })
    return found
  }
  for (;;) {
    let grew = false
    for (const b of candidates) {
      if (fns.has(b.fnName)) continue
      if (writesThis(b.node.body!, keys, chainable) || throughSuper(b)) {
        fns.add(b.fnName)
        if (!b.isSuper) keys.add(memberKeyOf(b.node)!)
        grew = true
      }
    }
    if (!grew) return fns
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
  readonly node: MemberFunction
  /** The class that wrote this body, which is what `super` inside it counts from. */
  readonly declaredIn: string
  readonly fnName: string
  /** The member as written, `at` or `#step`, or the property an accessor half serves. */
  readonly member: string
  /** Which half of an accessor this body is; absent on a method. */
  readonly accessor?: 'get' | 'set'
  readonly isStatic: boolean
  /** A base's body reached through `super.m(...)`, lowered against this class. */
  readonly isSuper: boolean
  /** `super.m(...)` in this body, to the function that carries the base's body. */
  readonly superMethods: ReadonlyMap<string, string>
}

/** Two members of one chain that would be one function of the module, and where to say so. */
interface MemberCollision {
  readonly at: ts.Node
  readonly message: string
  /** The function name the two would share. */
  readonly fnName: string
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
    if (!m.body || writtenMemberName(m.name) !== member) continue
    if (isStaticMember(m) === isStatic) return m
  }
  return undefined
}

/** A member a body names through `super`: a method it calls, `super.m(...)`, or one half of
 *  an accessor, `super.x` read (`get`) or assigned (`set`). A compound assignment and `++` or
 *  `--` name both halves. */
export interface SuperRef {
  readonly kind: 'method' | 'get' | 'set'
  readonly member: string
}

/** What a body's `superMethods` holds for an accessor half the class above declares only the
 *  other half of: nothing to call, and the reason is not that nothing is there. */
export const MISSING_HALF = ''

/** The key a {@link SuperRef} takes in a body's `superMethods`: the method's name, or `get x`
 *  and `set x` for the halves of an accessor. */
export const superKey = (ref: SuperRef): string =>
  ref.kind === 'method' ? ref.member : `${ref.kind} ${ref.member}`

/** Every member named through `super` under `node`. */
function eachSuperRef(node: ts.Node, f: (ref: SuperRef) => void): void {
  const isSuper = (e: ts.Expression): boolean => e.kind === ts.SyntaxKind.SuperKeyword
  const walk = (n: ts.Node): void => {
    if (ts.isPropertyAccessExpression(n) && isSuper(n.expression)) {
      const member = n.name.text
      const parent = n.parent
      if (ts.isCallExpression(parent) && parent.expression === n) {
        f({ kind: 'method', member })
      } else if (
        ts.isBinaryExpression(parent) &&
        parent.left === n &&
        parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment
      ) {
        if (parent.operatorToken.kind !== ts.SyntaxKind.EqualsToken) f({ kind: 'get', member })
        f({ kind: 'set', member })
      } else if (
        (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) &&
        (parent.operator === ts.SyntaxKind.PlusPlusToken ||
          parent.operator === ts.SyntaxKind.MinusMinusToken)
      ) {
        f({ kind: 'get', member })
        f({ kind: 'set', member })
      } else {
        f({ kind: 'get', member })
      }
    }
    ts.forEachChild(n, walk)
  }
  walk(node)
}

/** The accessor half `half` a class declares itself under the name `member`, static or not. */
function ownAccessor(
  struct: CollectedStruct | undefined,
  member: string,
  half: 'get' | 'set',
  isStatic: boolean,
): ts.AccessorDeclaration | undefined {
  return struct?.members?.accessors.find(
    (a) =>
      a.body !== undefined &&
      accessorHalf(a) === half &&
      isStaticMember(a) === isStatic &&
      writtenMemberName(a.name) === member,
  )
}

/** Whether a class declares the static field `member` itself. */
const ownStaticField = (struct: CollectedStruct, member: string): boolean =>
  struct.classNode?.members.some(
    (m) => ts.isPropertyDeclaration(m) && isStaticMember(m) && writtenMemberName(m.name) === member,
  ) ?? false

/** The key under which a static body's `superMethods` holds the class whose static field
 *  `super.K` reads: in a static member `super` is the class above, and a static field is one of
 *  its members (Rule 8.13). */
export const superFieldKey = (member: string): string => `field ${member}`

/** The body `ref`, written in a body `declaredIn` declared, names: the nearest class above
 *  `declaredIn` that declares it, and the function that body is emitted as for `target`. For an
 *  accessor, the nearest class that declares either half owns both, as it does for a read on the
 *  object (Rule 8.11); a half it does not declare names nothing. */
function superTargetOf(
  target: string,
  declaredIn: string,
  ref: SuperRef,
  byName: ReadonlyMap<string, CollectedStruct>,
  isStatic = false,
):
  | { node: MemberFunction; owner: string; fnName: string }
  | { field: string }
  | typeof MISSING_HALF
  | undefined {
  for (const a of ancestorsOf(declaredIn, byName)) {
    if (ref.kind === 'method') {
      const hit = ownMethod(a, ref.member, isStatic)
      if (hit === undefined) continue
      return {
        node: hit,
        owner: a.decl.name,
        fnName: superFnName(target, a.decl.name, emittedMemberName(ref.member)),
      }
    }
    const either =
      ownAccessor(a, ref.member, 'get', isStatic) ?? ownAccessor(a, ref.member, 'set', isStatic)
    if (either === undefined) {
      // A static field is a member of the class above, as a static accessor is; an instance
      // field is the object's own, and `super` does not reach it.
      if (isStatic && ownStaticField(a, ref.member)) return { field: a.decl.name }
      continue
    }
    const hit = ownAccessor(a, ref.member, ref.kind, isStatic)
    if (hit === undefined) return MISSING_HALF
    return {
      node: hit,
      owner: a.decl.name,
      fnName: superFnName(target, a.decl.name, `${ref.kind}_${emittedMemberName(ref.member)}`),
    }
  }
  return undefined
}

/** A class's own methods and accessors with a body, in declaration order. */
const memberFunctionsOf = (struct: CollectedStruct): readonly MemberFunction[] =>
  [...(struct.members?.methods ?? []), ...(struct.members?.accessors ?? [])]
    .filter((m) => m.body !== undefined)
    .sort((a, b) => a.pos - b.pos)

/** The bodies `struct` emits, and its inherited field initializers.
 *
 *  The primary set is one body per member the class has, its own before any it inherits. An
 *  accessor is one member however many halves it has: the nearest class that declares either
 *  half owns both, so a class that overrides a getter alone has no setter, as in TypeScript
 *  (Rule 8.11). A private member is its class's own and is never overridden: a second class in
 *  the chain declaring the same `#m`, or any member that would take the same function name, is
 *  reported (Rule 8.12). From there a worklist follows each `super.m(...)`: the body it names is
 *  the nearest one above the class that WROTE the call, emitted against this class under its
 *  own name, and its own `super` calls are followed the same way until nothing new appears. */
function effectiveMembers(
  struct: CollectedStruct,
  byName: ReadonlyMap<string, CollectedStruct>,
): {
  bodies: readonly ClassBody[]
  fieldInits: readonly FieldInit[]
  collisions: readonly MemberCollision[]
} {
  const target = struct.decl.name
  const chain = [struct, ...ancestorsOf(target, byName)]
  const bodies: ClassBody[] = []
  const collisions: MemberCollision[] = []
  const emitted = new Set<string>()
  const pending: {
    node: MemberFunction
    declaredIn: string
    fnName: string
    member: string
    isSuper: boolean
  }[] = []

  const see = (
    node: MemberFunction,
    declaredIn: string,
    fnName: string,
    member: string,
    isSuper: boolean,
  ): void => {
    if (emitted.has(fnName)) return
    emitted.add(fnName)
    pending.push({ node, declaredIn, fnName, member, isSuper })
  }
  // The member each function name was claimed for, and by which class: `#step` and `step`, or
  // two classes' `#step`, reach one name and are two members.
  const claimed = new Map<string, { key: string; owner: string; shown: string; written: string }>()
  const taken = new Map<string, string>()
  for (const owner of chain) {
    for (const m of memberFunctionsOf(owner)) {
      const written = writtenMemberName(m.name)
      if (written === undefined) continue
      const isStatic = isStaticMember(m)
      const half = accessorHalf(m)
      const key = `${isStatic ? 'static ' : ''}${half !== undefined ? 'accessor ' : ''}${written}`
      const holder = taken.get(key)
      if (holder !== undefined && holder !== owner.decl.name) {
        // A public member a nearer class declares again is an override, the ordinary case.
        if (!isPrivateName(written)) continue
      } else taken.set(key, owner.decl.name)
      const fnName =
        half !== undefined
          ? accessorFnName(target, half, written)
          : methodFnName(target, emittedMemberName(written))
      const shown = `${owner.decl.name}.${written}`
      const prior = claimed.get(fnName)
      if (prior !== undefined) {
        // Only a private name is new here: a public member that reaches a taken name (a static
        // and an instance one down a chain) keeps the first, as it always has.
        const two = prior.key !== key || prior.owner !== owner.decl.name
        if (two && (isPrivateName(written) || isPrivateName(prior.written))) {
          collisions.push({
            at: m.name,
            fnName,
            message:
              `"${prior.shown}" and "${shown}" would both be the function "${fnName}": a ` +
              `private name is emitted without its "#". Rename one of them.`,
          })
        }
        continue
      }
      claimed.set(fnName, { key, owner: owner.decl.name, shown, written })
      see(m, owner.decl.name, fnName, written, false)
    }
  }
  // A static field of this class is the module value `C_x` (Rule 8.13), and a function of the
  // same name would declare `C_x` a second time: `static #n` beside `n()`, or a static field
  // beside an instance method of its name, which TypeScript keeps on two sides of the class
  // (Rule 8.12). A generic class's instance carries no static of its own.
  if (struct.binding === undefined) {
    for (const f of struct.classNode?.members ?? []) {
      if (!ts.isPropertyDeclaration(f) || !isStaticMember(f)) continue
      const written = writtenMemberName(f.name)
      if (written === undefined) continue
      const fnName = methodFnName(target, emittedMemberName(written))
      const prior = claimed.get(fnName)
      if (prior === undefined) continue
      const why =
        isPrivateName(written) || isPrivateName(prior.written)
          ? ': a private name is emitted without its "#"'
          : ', where a class names its functions and its statics alike'
      collisions.push({
        at: f.name,
        fnName,
        message:
          `The static field "${target}.${written}" and the function "${prior.shown}" would both ` +
          `be "${fnName}"${why}. Rename one of them.`,
      })
    }
  }
  /** Each member `body` names through `super`, to the function its base body is emitted as,
   *  queueing that body. */
  const follow = (body: ts.Node, declaredIn: string, isStatic = false): Map<string, string> => {
    const superMethods = new Map<string, string>()
    eachSuperRef(body, (ref) => {
      const found = superTargetOf(target, declaredIn, ref, byName, isStatic)
      if (found === undefined) return
      if (found === MISSING_HALF) {
        superMethods.set(superKey(ref), MISSING_HALF)
        return
      }
      if ('field' in found) {
        superMethods.set(superFieldKey(ref.member), found.field)
        return
      }
      superMethods.set(superKey(ref), found.fnName)
      see(found.node, found.owner, found.fnName, ref.member, true)
    })
    return superMethods
  }
  // The constructor this class runs names base bodies through `super` too: `super.reset()`
  // after `super(...)`. They are emitted here, beside the ones methods name.
  const ctor = effectiveCtor(struct, byName)
  if (ctor?.node.body !== undefined) follow(ctor.node.body, ctor.owner.decl.name)
  while (pending.length > 0) {
    const { node, declaredIn, fnName, member, isSuper } = pending.shift()!
    const superMethods = follow(node.body!, declaredIn, isStaticMember(node))
    const half = accessorHalf(node)
    bodies.push({
      node,
      declaredIn,
      fnName,
      member,
      ...(half !== undefined ? { accessor: half } : {}),
      isStatic: isStaticMember(node),
      isSuper,
      superMethods,
    })
  }
  // A field initializer runs base first, so a derived class that initializes an inherited
  // field wins, the way its assignment would.
  const fieldInits: FieldInit[] = []
  // Every one of them runs, a class's own after its base's, so one a derived class writes for
  // an inherited field lands last, as TypeScript's does. The first one alone used to be kept,
  // which gave the field the base's value (Rule 8.14).
  const initsOf = (s: CollectedStruct | undefined, seen: Set<string>): void => {
    if (!s || seen.has(s.decl.name)) return
    seen.add(s.decl.name)
    for (const base of s.bases ?? []) initsOf(byName.get(base), seen)
    for (const f of s.members?.fieldInits ?? []) fieldInits.push(f)
  }
  initsOf(struct, new Set())
  return { bodies, fieldInits, collisions }
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
  eachSuperRef(ctor.body, (ref) => {
    const found = superTargetOf(struct.decl.name, declaredIn, ref, byName)
    if (found !== undefined && !(typeof found === 'object' && 'field' in found)) {
      out.set(superKey(ref), found === MISSING_HALF ? MISSING_HALF : found.fnName)
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

/** What a class inherits its base's type parameters as, when it extends a generic class's
 *  instance: `class Small extends Box_f32` inherits bodies written in terms of `Box`'s `T`, and
 *  `T -> f32` is what those bodies have to be read under (T9, #92). A class with type parameters
 *  of its own never reaches this — it carries its own binding — and the chain is walked base
 *  first, so a class two levels below a generic one still finds it. */
function inheritedBinding(
  struct: CollectedStruct,
  byName: ReadonlyMap<string, CollectedStruct>,
  seen: Set<string> = new Set(),
): ReadonlyMap<string, ShaderType> | undefined {
  for (const base of struct.bases ?? []) {
    if (seen.has(base)) continue
    seen.add(base)
    const owner = byName.get(base)
    if (owner === undefined) continue
    const found = owner.binding ?? inheritedBinding(owner, byName, seen)
    if (found !== undefined) return found
  }
  return undefined
}

/** A method's parameters and return type. A return written `this` is the class's own struct:
 *  the method hands back its object, a copy of it here, since a struct is a value. */
function methodSignature(
  method: MemberFunction,
  shown: string,
  isStatic: boolean,
  selfT: ShaderType,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  structs: readonly CollectedStruct[],
): { params: FuncDecl['params'][number][]; ret: ShaderType } | undefined {
  const params = parseParams(method.parameters, sourceFile, diagnostics, structs, undefined, {
    owner: shown,
    forbidSelf: !isStatic,
  })
  if (!params) return undefined
  if (method.type?.kind === ts.SyntaxKind.ThisType) return { params, ret: selfT }
  const ret = parseReturnType(
    method.type,
    shown,
    method,
    sourceFile,
    diagnostics,
    structs,
    undefined,
  )
  if (!ret) return undefined
  return { params, ret }
}

/** The other half of the accessor `node` declares, in the same class body, or `undefined`. */
function otherHalf(node: ts.AccessorDeclaration): ts.AccessorDeclaration | undefined {
  const written = writtenMemberName(node.name)
  const want = ts.isGetAccessorDeclaration(node) ? 'set' : 'get'
  const parent = node.parent
  if (!ts.isClassLike(parent)) return undefined
  return parent.members.find(
    (m): m is ts.AccessorDeclaration =>
      accessorHalf(m) === want &&
      writtenMemberName((m as ts.AccessorDeclaration).name) === written &&
      isStaticMember(m) === isStaticMember(node),
  )
}

/** One half of an accessor's signature (Rule 8.11). A getter takes nothing and returns the
 *  property's type; a setter takes the new value and returns nothing. TypeScript reads either
 *  half's annotation as the property's type when the other has none, and so does this. */
function accessorSignature(
  node: ts.AccessorDeclaration,
  half: 'get' | 'set',
  shown: string,
  selfT: ShaderType,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  structs: readonly CollectedStruct[],
): { params: FuncDecl['params'][number][]; ret: ShaderType } | undefined {
  const pair = otherHalf(node)
  const written = writtenMemberName(node.name) ?? 'x'
  const pairType = (): ShaderType | undefined => {
    const t = pair === undefined ? undefined : half === 'get' ? pair.parameters[0]?.type : pair.type
    if (t === undefined) return undefined
    if (t.kind === ts.SyntaxKind.ThisType) return selfT
    return mapTsTypeToShaderType(t, sourceFile, undefined)
  }
  if (half === 'get') {
    if (node.type === undefined) {
      const inferred = pairType()
      if (inferred !== undefined) return { params: [], ret: inferred }
      pushDiag(
        diagnostics,
        sourceFile,
        node.name,
        `The getter "${shown}" needs a return type: write "get ${written}(): T".`,
        TS_CODES.UNKNOWN_TYPE,
      )
      return undefined
    }
    if (node.type.kind === ts.SyntaxKind.ThisType) return { params: [], ret: selfT }
    const ret = parseReturnType(node.type, shown, node, sourceFile, diagnostics, structs, undefined)
    return ret === undefined ? undefined : { params: [], ret }
  }
  const value = node.parameters[0]
  if (value === undefined || !ts.isIdentifier(value.name)) return undefined // TypeScript's own
  if (value.type !== undefined) {
    const params = parseParams(node.parameters, sourceFile, diagnostics, structs, undefined, {
      owner: shown,
      forbidSelf: true,
    })
    return params === undefined ? undefined : { params, ret: voidT }
  }
  const inferred = pairType()
  if (inferred === undefined) {
    pushDiag(
      diagnostics,
      sourceFile,
      value,
      `The setter "${shown}" needs a type for "${value.name.text}": write ` +
        `"set ${written}(${value.name.text}: T)", or give the getter a return type.`,
      TS_CODES.UNKNOWN_TYPE,
    )
    return undefined
  }
  if (value.name.text === 'self_') {
    pushDiag(
      diagnostics,
      sourceFile,
      value,
      `"self_" is a name ${shown} gives its object in the emitted function; rename the parameter.`,
    )
    return undefined
  }
  return { params: [{ name: value.name.text, type: inferred }], ret: voidT }
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
  const byName = new Map(structs.map((s) => [s.decl.name, s]))
  const constructed = namesConstructed(sourceFile, structs, byName)
  const reported = new Set<string>()
  for (const struct of structs) {
    // A generic class's instance carries what its type parameters are bound to (roadmap 0.3
    // item T9, #92): its methods are written in terms of `T`, so their signatures are parsed
    // and their bodies lowered with that in force. Absent on every other struct, where this
    // binds nothing and the walk is what it was. Imperative rather than a callback, because
    // the body below `continue`s.
    const unbind = pushTypeArguments(struct.binding ?? inheritedBinding(struct, byName))
    try {
      const name = struct.decl.name
      const selfT = structT(name)
      const members = struct.members
      const effective = effectiveMembers(struct, byName)
      // A generic class's INSTANCE contributes no static: a static cannot mention the class's
      // type parameters, so it is one function however many instances there are, carried once
      // by the collection under the class's own name (T9, #92). Keeping it here would emit one
      // dead copy per instance, under a name no call site can reach.
      const own =
        struct.binding !== undefined
          ? effective.bodies.filter((b) => !b.isStatic)
          : effective.bodies
      // An abstract class is a base and never a value, so it contributes no instance method and
      // no constructor of its own; its bodies are lowered into each concrete class below. Its
      // statics are functions like any other and are kept.
      const bodies = struct.abstract ? own.filter((b) => b.isStatic) : own
      const mutating = mutatingBodiesOf(bodies)
      // The function names a member of the chain lost to another, already reported where the
      // two were declared (structs.ts); a call that misses because of it adds nothing.
      const lost = new Set(
        [struct, ...ancestorsOf(name, byName)].flatMap((s) => [...(s.withheldFunctions ?? [])]),
      )
      // A collision down the chain is reported once, at the member, however many classes below
      // it inherit the pair.
      for (const c of effective.collisions) {
        const key = `${c.at.pos}:${c.message}`
        if (reported.has(key)) continue
        reported.add(key)
        pushDiag(diagnostics, sourceFile, c.at, c.message)
      }
      for (const body of bodies) {
        const method = body.node
        const member = body.member
        const half = body.accessor
        const isSuperBody = body.isSuper
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
          (ts.isMethodDeclaration(method) && method.asteriskToken) ||
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
        const signature =
          half === undefined
            ? methodSignature(method, shown, isStatic, selfT, sourceFile, diagnostics, structs)
            : accessorSignature(
                method as ts.AccessorDeclaration,
                half,
                shown,
                selfT,
                sourceFile,
                diagnostics,
                structs,
              )
        if (!signature) continue
        const { params } = signature
        // A method whose every `return` is `return this` hands back the object it runs on. Its
        // return type names the class that wrote it, and lowered for a class that inherits it
        // that object is the derived one: `setY(y: f32): V { …; return this }` in `W extends V`
        // returns a `W`, as it does at run time in TypeScript. Read as `V`, the inherited body
        // was a type mismatch against its own `return this` (Rule 8.10).
        //
        // A static is the same when it builds its object with `new this(...)`: lowered for a
        // class that inherits it, `this` is that class (Rule 8.13), so `Derived.make()` builds and
        // returns a `Derived`, as TypeScript does at run time where its type says `Base`.
        const declaresOwnClass = typeKey(signature.ret) === typeKey(structT(body.declaredIn))
        const ret =
          declaresOwnClass &&
          ((half === undefined && !isStatic && returnsThis(method.body)) ||
            (isStatic && body.declaredIn !== name && returnsBuiltThis(method)))
            ? selfT
            : signature.ret
        // A method that changes its object takes it BY REFERENCE: `mode: 'inout'` on the
        // receiver, which GLSL ES 3.00 spells `inout Particle self_` and WGSL as a pointer. What
        // it returns is its own business (§26): the reference, not the return, carries the
        // object back. A body reached through `super` is the same: it runs on the object of the
        // body that called it, which hands its own reference on, so `super.bump()` inside an
        // override that writes is a call like any other (Rule 8.10). It was read-only until
        // this, and a write inside it was refused. An accessor half is a method in this (Rule
        // 8.11): a setter that assigns a field takes its object by reference, and so does a
        // getter that caches into one.
        const writes = !isStatic && mutating.has(body.fnName)
        const stub: FuncDecl = {
          name: body.fnName,
          params: isStatic
            ? params
            : [
                { name: 'self_', type: selfT, ...(writes ? { mode: 'inout' as const } : {}) },
                ...params,
              ],
          ret,
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
                mode: writes ? 'inout' : 'param',
                fieldInits: [],
                shown,
                superMethods: body.superMethods,
              },
          mutates: writes,
          member,
          ...(half !== undefined ? { accessor: half } : {}),
          ...(isStatic ? { staticOwner: name, staticSuper: body.superMethods } : {}),
          ...(body.declaredIn !== name ? { inherited: true as const } : {}),
          ...(half === undefined &&
          !isStatic &&
          returnsThis(method.body) &&
          typeKey(ret) === typeKey(selfT)
            ? { returnsThis: true as const }
            : {}),
        }
        registry.set(stub, cf)
        if (
          effective.collisions.some((c) => c.fnName === stub.name) ||
          lost.has(stub.name.slice(name.length + 1))
        ) {
          collided.add(stub)
        }
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
      // The parameter properties of the constructor this class runs, which may be a base's: the
      // fields they declare are this struct's too, and they are assigned before anything else
      // (Rule 8.14). One whose field was refused at the declaration assigns nothing.
      const propNames = new Set(
        (ctor?.parameters ?? [])
          .filter((p) => ts.isParameterPropertyDeclaration(p, ctor!) && ts.isIdentifier(p.name))
          .map((p) => (p.name as ts.Identifier).text),
      )
      const paramProps = params
        .filter(
          (p) =>
            propNames.has(p.name) &&
            struct.decl.fields.some(
              (f) => f.name === p.name && typeKey(f.type) === typeKey(p.type),
            ),
        )
        .map((p) => ({ name: p.name, type: p.type }))
      const at = ctor ?? members?.node
      if (at !== undefined) (stub as { span?: SourceSpan }).span = spanOf(sourceFile, at)
      // Relative to the class that DECLARED this body: an inherited constructor's `super` still
      // names ITS base, not the base of the class being built.
      const superCtor = found ? superCtorOf(found.owner, byName) : undefined
      // Which class wrote an initializer decides when it runs, as in TypeScript (Rule 8.14).
      // The classes above the one that declared this constructor run theirs first: in the base
      // constructor `super(...)` calls, when there is one, and before the body when there is
      // not. That class runs its parameter properties and its own after its `super(...)`
      // returns. The classes below it, down to this one, run theirs when its body returns, as
      // their implicit constructors would. An initializer whose class is not in the chain (a
      // mixin's) runs first, as every one did before.
      const chain: readonly (ts.ClassLikeDeclaration | undefined)[] = [
        struct,
        ...ancestorsOf(name, byName),
      ].map((c) => c.classNode)
      const ownerAt = found?.owner.classNode ? chain.indexOf(found.owner.classNode) : -1
      const afterSuperRuns =
        superCtor !== undefined && ctor?.body !== undefined && callsSuper(ctor.body)
      const first: FieldInit[] = []
      const atOwner: FieldInit[] = []
      const below: FieldInit[] = []
      for (const f of fieldInits) {
        const cls = ts.findAncestor(f.init, ts.isClassLike)
        const depth = ownerAt < 0 || cls === undefined ? -1 : chain.indexOf(cls)
        if (depth < 0) first.push(f)
        else if (depth > ownerAt) {
          if (superCtor === undefined) first.push(f)
        } else if (depth === ownerAt) atOwner.push(f)
        else below.push(f)
      }
      const cf: ClassFunction = {
        stub,
        kind: 'ctor',
        struct,
        shown,
        node: ctor,
        receiver: {
          type: selfT,
          mode: 'ctor',
          fieldInits: first,
          shown,
          ...(superCtor !== undefined ? { superCtor } : {}),
          superMethods: ctorSuperMethods(struct, found?.owner.decl.name ?? name, byName, ctor),
          ...(paramProps.length > 0 && !afterSuperRuns ? { paramProps } : {}),
          ...(afterSuperRuns
            ? { afterSuper: { paramProps, fieldInits: atOwner } }
            : atOwner.length > 0
              ? { ownInits: atOwner }
              : {}),
          ...(below.length > 0 ? { afterBody: below } : {}),
        },
        mutates: false,
      }
      registry.set(stub, cf)
      out.push(cf)
    } finally {
      unbind()
    }
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
  const parts = ctorParts(receiver, scope, sourceFile, diagnostics)
  return [...parts.prologue, ...parts.afterSuper, ...parts.afterBody]
}

/** A constructor's statements that are not its body's: what starts it (`self_` at the zero
 *  struct, and what runs before the body), what runs right after its `super(...)`, and what
 *  runs when its body returns (Rule 8.14). All are lowered here, before the body and its
 *  parameters are in scope, since an initializer is written in the class and sees neither. */
export function ctorParts(
  receiver: Receiver,
  scope: LoweringScope,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): { prologue: Stmt[]; afterSuper: Stmt[]; afterBody: Stmt[] } {
  const prologue = ctorStart(receiver, scope, sourceFile, diagnostics)
  if (receiver.mode === 'inout') return { prologue, afterSuper: [], afterBody: [] }
  const after = receiver.afterSuper
  return {
    prologue,
    afterSuper:
      after === undefined
        ? []
        : [
            ...paramPropAssigns(after.paramProps, receiver.type),
            ...initAssigns(after.fieldInits, receiver.type, scope, sourceFile, diagnostics),
          ],
    afterBody: initAssigns(receiver.afterBody ?? [], receiver.type, scope, sourceFile, diagnostics),
  }
}

/** `self_.x = x` for each parameter property. */
function paramPropAssigns(
  props: readonly { readonly name: string; readonly type: ShaderType }[],
  type: ShaderType,
): Stmt[] {
  return props.map((p) => ({
    s: 'assign',
    target: { op: 'member', type: p.type, base: selfRef(type), field: p.name },
    expr: { op: 'param', type: p.type, name: p.name },
  }))
}

/** `self_.f = init` for each field initializer, in order, each checked against its field. */
function initAssigns(
  inits: readonly FieldInit[],
  type: ShaderType,
  scope: LoweringScope,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): Stmt[] {
  const out: Stmt[] = []
  for (const f of inits) {
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
      target: { op: 'member', type: f.type, base: selfRef(type), field: f.name },
      expr: init,
    })
  }
  return out
}

/** `self_` at the zero struct, then what runs before the body. */
function ctorStart(
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
  // A method that changes its object writes THROUGH the parameter, so there is nothing to
  // start: `self_` is the parameter's own name, and `this.pos = …` assigns to it. What used to
  // be here was `var self_ = self_in`, the copy the body worked on and returned.
  if (receiver.mode === 'inout') return []
  const zero = zeroExprOf(receiver.type, scope)
  const out: Stmt[] = [
    zero
      ? { s: 'var', name: irNameOf(self), type: receiver.type, init: zero }
      : { s: 'var', name: irNameOf(self), type: receiver.type },
  ]
  // The initializers of the classes above the one that declared this constructor come first,
  // as their implicit constructors run them. Then `constructor(public x: f32)`: the field takes
  // its parameter, then this class's initializers run, so one written `y = this.x * 2.` reads the
  // value passed in (Rule 8.14). A parameter is named as the signature wrote it; the scope
  // defines the parameters after this prologue.
  out.push(
    ...initAssigns(receiver.fieldInits, receiver.type, scope, sourceFile, diagnostics),
    ...paramPropAssigns(receiver.paramProps ?? [], receiver.type),
    ...initAssigns(receiver.ownInits ?? [], receiver.type, scope, sourceFile, diagnostics),
  )
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
    // In a static member `this` is the class, which is a namespace of statics and never a
    // value (Rule 8.13): `this.K` and `this.f()` reach them, and nothing else does.
    const cls = scope.staticClass()
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      cls !== undefined
        ? `In a static member, "this" is the class "${cls}", which is not a value. Name one of ` +
            `its statics through it, "this.K" or "this.f()".`
        : '"this" names a method\'s object; a static function and a top-level function have none.',
    )
    return undefined
  }
  return b.kind === 'param'
    ? { op: 'param', type: b.type, name: irNameOf(b) }
    : { op: 'varref', type: b.type, name: irNameOf(b) }
}

/** The struct a `new` names, flattened: `P` for `new P()`, `N_P` for `new N.P()`. Undefined
 *  when the expression is not a chain of identifiers, which is a `new` on a value. */
function newTargetName(expr: ts.Expression): string | undefined {
  const parts: string[] = []
  let node: ts.Expression = expr
  for (;;) {
    if (ts.isIdentifier(node)) {
      parts.unshift(node.text)
      return parts.join('_')
    }
    if (!ts.isPropertyAccessExpression(node)) return undefined
    parts.unshift(node.name.text)
    node = node.expression
  }
}

/** `new Ray(a, b)`: the class's constructor function. A `new` on anything that is not a class
 *  the file declares was refused by the semantic pass; here it lowers to nothing more. */
export function lowerNew(
  node: ts.NewExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  // `new P(...)`, and `new N.P(...)` for a class inside a namespace, which the module emits as
  // `N_P` (#107). A bare name inside that namespace's own bodies reaches it too, through the
  // scope's namespace chain. `new this()` in a static member builds the class that declares the
  // member (Rule 8.13).
  const written =
    node.expression.kind === ts.SyntaxKind.ThisKeyword
      ? scope.resolve('this') === undefined
        ? scope.staticClass()
        : undefined
      : newTargetName(node.expression)
  if (written === undefined) return undefined
  // `new Pair<f32>()` builds the instance struct the file collected for that set of type
  // arguments (roadmap 0.3 item T9, #92), and a bare `new Pair()` the one instance the file
  // writes, when it writes exactly one. Otherwise the expression names no layout, and saying so
  // here is the whole of it: the ordinary "unknown struct" below would name the class, which
  // exists, and never mention the type argument that is missing.
  const instance = newInstanceName(node, written, sourceFile)
  if (instance === undefined) {
    const why = ambiguousNew(written, sourceFile)
    if (why !== undefined) {
      pushDiag(diagnostics, sourceFile, node, why)
      return undefined
    }
  }
  const name = instance ?? scope.qualifiedStruct(written)
  if (name === undefined) return undefined
  const struct = scope.structByName(name)
  if (struct === undefined) return undefined
  // A class whose members are all static is a namespace of functions and is not emitted as a
  // struct at all (T3, #92), so a constructor for it would return a type the module never
  // declares. Before this it emitted `fn U_new() -> U` with no `struct U` anywhere, which
  // Tint refuses, and said nothing.
  if (struct.fields.length === 0) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `"${name}" declares only static members, so it is a group of functions and there is no ` +
        `value of it to build. Call "${name}.f(...)" directly.`,
    )
    return undefined
  }
  const decl = scope.resolveCallee(ctorFnName(name))
  const cf = decl === undefined ? undefined : classFunctionOf(decl)
  if (decl === undefined || cf?.kind !== 'ctor') {
    // An abstract class has no constructor function of its own (T5, #92) and the semantic pass
    // already said why a `new` on one is refused; repeating it here in weaker words sends the
    // author to the second message.
    if (!scope.isAbstractStruct(name)) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `"${name}" has no constructor here; build it as an object literal, { field: value }.`,
      )
    }
    return undefined
  }
  // A class with no constructor of its own answers `new P()` with the zero struct and its
  // field initializers, which is TypeScript's implicit constructor; it takes no arguments, and
  // TypeScript says so too. The arity message alone left an author guessing which of the two
  // ways to write it they wanted.
  if (cf.node === undefined && (node.arguments?.length ?? 0) > 0) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `"${name}" declares no constructor, so "new ${name}()" takes no arguments, as it does in ` +
        `TypeScript. Declare a constructor to pass values, or write the fields: ` +
        `{ ${struct.fields.map((f) => `${f.name}: ...`).join(', ')} }.`,
      TS_CODES.ARITY_MISMATCH,
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
  if (!self && scope.staticClass() !== undefined) {
    return lowerStaticSuperCall(node, callee, member, sourceFile, scope, diagnostics)
  }
  if (!self || self.type.kind !== 'struct') {
    pushDiag(diagnostics, sourceFile, callee, NO_SUPER)
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
  // A base's `private` method is not the derived class's to call, through `super` or not
  // (Rule 8.15).
  const cf = classFunctionOf(decl)
  if (
    cf !== undefined &&
    !checkFunctionAccess(cf, self.type.name, callee.name, sourceFile, scope, diagnostics)
  ) {
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

/** What `super` is refused with outside a class body's own members. */
export const NO_SUPER =
  '"super" names the class above the one whose body it is written in; a top-level function has none.'

/** `super.k(...)` in a static member: the static body the class above declares, lowered for
 *  this class so that `this` in it is this class, as TypeScript binds it (Rule 8.13). */
function lowerStaticSuperCall(
  node: ts.CallExpression,
  callee: ts.PropertyAccessExpression,
  member: string,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const fn = scope.superMethods()?.get(member)
  const decl = fn === undefined || fn === MISSING_HALF ? undefined : scope.resolveCallee(fn)
  if (!decl) {
    pushDiag(
      diagnostics,
      sourceFile,
      callee,
      `Nothing above this class declares a static function "${member}", so "super.${member}" ` +
        `names no body.`,
    )
    return undefined
  }
  const cf = classFunctionOf(decl)
  if (
    cf !== undefined &&
    !checkFunctionAccess(cf, undefined, callee.name, sourceFile, scope, diagnostics)
  ) {
    return undefined
  }
  return lowerUserCall(node, decl, sourceFile, scope, diagnostics, { shown: `super.${member}` })
}

export function lowerClassCall(
  node: ts.CallExpression,
  callee: ts.PropertyAccessExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined | 'not-a-class-call' {
  const obj = callee.expression
  // The member as written: `at`, or `#step` for a private one (Rule 8.12).
  const member = callee.name.text
  // `super.at(t)` runs the BASE's body on this object (T5, #92). The base's body was lowered
  // against this class under `Ray_super_at`, so the call is an ordinary one with `this` first.
  if (obj.kind === ts.SyntaxKind.SuperKeyword) {
    return lowerSuperMethodCall(node, callee, member, sourceFile, scope, diagnostics)
  }
  // `A.B.two()` names the namespace `A_B` (T4, #92): a chain of identifiers joins the way the
  // members do. A single identifier is the class or namespace itself, as before. `this` inside a
  // static member is the class that declares it (Rule 8.13).
  const staticThis =
    unparen(obj).kind === ts.SyntaxKind.ThisKeyword && scope.resolve('this') === undefined
      ? scope.staticClass()
      : undefined
  const owner = staticThis ?? flattenedOwner(obj, scope)
  if (
    owner !== undefined &&
    (staticThis !== undefined || scope.resolve(owner) === undefined) &&
    (scope.structByName(owner) !== undefined || scope.isNamespace(owner))
  ) {
    const name = owner
    const shown = `${name}.${member}`
    const decl = scope.resolveCallee(methodFnName(name, emittedMemberName(member)))
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
    if (cf.member !== member || cf.accessor !== undefined) {
      if (isCollidedFunction(decl!)) return undefined
      pushDiag(diagnostics, sourceFile, callee, `"${name}" has no static function "${member}".`)
      return undefined
    }
    if (
      !checkPrivateAccess(member, declaringClassOf(cf), name, callee.name, sourceFile, diagnostics)
    )
      return undefined
    // `this.#h()` in a static body a class inherits: `#h` is the declaring class's own.
    if (!checkInheritedPrivateStatic(cf, name, callee, sourceFile, diagnostics)) return undefined
    if (!checkFunctionAccess(cf, undefined, callee.name, sourceFile, scope, diagnostics)) {
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
  const found = memberFunctionOf(name, member, 'method', scope)
  if (found === undefined) {
    const taken = scope.resolveCallee(methodFnName(name, emittedMemberName(member)))
    if (taken !== undefined && isCollidedFunction(taken)) return undefined
    const accessor =
      memberFunctionOf(name, member, 'get', scope) ?? memberFunctionOf(name, member, 'set', scope)
    pushDiag(
      diagnostics,
      sourceFile,
      callee,
      accessor !== undefined
        ? `"${shown}" is an accessor, not a method; read or assign it without the call: ` +
            `v.${member}.`
        : visibleField(name, member, callee.name, scope) !== undefined
          ? `"${member}" is a field of ${name}, not a method.`
          : `"${name}" has no method "${member}".`,
    )
    return undefined
  }
  const { decl, cf } = found
  if (!checkPrivateAccess(member, declaringClassOf(cf), name, callee.name, sourceFile, diagnostics))
    return undefined
  if (!checkFunctionAccess(cf, name, callee.name, sourceFile, scope, diagnostics)) return undefined
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
    // A method that changes its object and returns a value is a value like any call (§26):
    // `const x = rng.next()`, `vec2(rng.next(), rng.next())`. Its receiver is still the place
    // it writes, and `sequence.ts` puts the call in source order among what is around it. One
    // that returns nothing has no value to give.
    if (typeKey(cf.stub.ret) === 'void') {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `"${shown}" changes its object and returns nothing; call it on its own line.`,
      )
      return undefined
    }
    const target = mutatingReceiver(node, obj, shown, sourceFile, scope, diagnostics)
    if (!target) return undefined
    return lowerUserCall(node, decl, sourceFile, scope, diagnostics, { shown, leading: [target] })
  }
  return lowerUserCall(node, decl, sourceFile, scope, diagnostics, { shown, leading: [recv] })
}

/** The class a class function's body was written in: the one whose body may name it when its
 *  name is private (Rule 8.12). */
const declaringClassOf = (cf: ClassFunction): ts.ClassLikeDeclaration | undefined =>
  cf.node !== undefined && ts.isClassLike(cf.node.parent) ? cf.node.parent : undefined

/** The receiver of a method that changes its object, lowered as the place the method writes
 *  through, or `undefined` having said why it is not one: a parameter, a `const`, or a value
 *  nothing holds (a call's result, a `new`), which the method would change and then drop. An
 *  accessor half that changes its object takes its receiver by the same rule (Rule 8.11). */
export function mutatingReceiver(
  node: ts.Node,
  obj: ts.Expression,
  shown: string,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const bare = unparen(obj)
  // A call a chain already ran stands for the object the chain runs on (chains.ts).
  const alias = scope.chainAlias(bare)
  if (alias !== undefined) return alias()
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
  // A chain inside a larger expression: what a method that returns `this` hands back is a copy
  // there, since a struct is a value, and a change to it would be dropped (chains.ts).
  if (ts.isCallExpression(bare) && ts.isPropertyAccessExpression(bare.expression)) {
    const inner = lowerExpression(bare.expression.expression, sourceFile, scope, [])
    const link =
      inner?.type.kind === 'struct'
        ? memberFunctionOf(inner.type.name, bare.expression.name.text, 'method', scope)
        : undefined
    if (link?.cf.returnsThis === true) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `"${shown}" changes its object, and inside this expression it would change the copy ` +
          `"${bare.getText(sourceFile)}" hands back. Make the chain a statement of its own, ` +
          `or call each method on the object itself.`,
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
  // The method writes into its receiver, which is then the place however it is reached.
  return lowerLValue(obj, sourceFile, scope, diagnostics, true)
}

/** A call statement of a method that changes its object, `r.advance(2.)`: the receiver is
 *  lowered as the place the method writes through, `Ray_advance(&r, 2.0)`, and a value the
 *  method returns is dropped. Returns the marker for any other call statement, which takes the
 *  ordinary path. A receiver that is not a place a function may write (a `const`, a parameter,
 *  a value that is dropped) is refused with the fix. */
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
  const found = memberFunctionOf(name, member, 'method', scope)
  if (found === undefined || !found.cf.mutates || found.cf.kind === 'static') {
    return 'not-a-mutating-call'
  }
  const { decl, cf } = found
  if (!checkPrivateAccess(member, declaringClassOf(cf), name, callee.name, sourceFile, diagnostics))
    return undefined
  if (!checkFunctionAccess(cf, name, callee.name, sourceFile, scope, diagnostics)) return undefined
  const shown = cf.shown
  const target = mutatingReceiver(node, obj, shown, sourceFile, scope, diagnostics)
  if (!target) return undefined
  const call = lowerUserCall(node, decl!, sourceFile, scope, diagnostics, {
    shown,
    leading: [target],
  })
  if (!call) return undefined
  // The call writes through its receiver, so there is nothing to write back: what used to be
  // here was `r = Ray_advance(r, 2.)`, a read and a store around a function that had already
  // done the work.
  return { s: 'call', expr: call }
}
