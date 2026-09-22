// === Lowering context / symbol table ===

import type ts from 'typescript'
import type { ShaderType } from '../../core/ir/types.js'
import { CAS_RESULT_STRUCTS } from '../../core/ir/types.js'
import type { AddressSpace, Expr } from '../../core/ir/nodes.js'
import type { FuncDecl, StructDecl, StructField } from '../../core/ir/nodes.js'
import type { TsCompilerDiagnostic } from './source-file.js'
import { recordDeclaration, type DeclaredSymbol, type DeclaredSymbolSink } from './symbols.js'

/** The names a file declares as functions and could not lower, one set per callee table
 *  (roadmap 0.3 item T10, #92). It hangs off the table instead of being threaded through every
 *  scope factory because it is the other half of the same thing: what this file's calls
 *  resolve against. A call to a name in here reports nothing — the declaration said why. */
/** How one instance of a generic function is made (roadmap 0.3 item T9, #92). `argTypes` are
 *  the call's arguments as they lowered, which is what the type arguments are read off when the
 *  call site writes none. */
export type Instantiator = (
  name: string,
  node: ts.CallExpression,
  argTypes: readonly ShaderType[],
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
) => FuncDecl | undefined

/** What a file's lowering knows about its own functions, beyond the callee table itself: the
 *  names it could not lower (T10, #92) and the generic ones, with the hook that makes an
 *  instance of one (T9, #92).
 *
 *  It hangs off the callee table instead of being threaded through every scope factory because
 *  it is the rest of the same thing: what this file's calls resolve against. Every scope built
 *  from one table reads one record. */
export interface FileFunctions {
  /** A call to a name in here reports nothing — its declaration already said why. */
  readonly refused: Set<string>
  /** The generic functions, under the emitted name a call resolves to. */
  readonly generics: Set<string>
  instantiate: Instantiator | undefined
}

const FILE_FUNCTIONS = new WeakMap<Map<string, FuncDecl>, FileFunctions>()

/** The record belonging to `callees`, created on first ask. */
export function fileFunctionsOf(callees: Map<string, FuncDecl>): FileFunctions {
  const found = FILE_FUNCTIONS.get(callees)
  if (found !== undefined) return found
  const made: FileFunctions = { refused: new Set(), generics: new Set(), instantiate: undefined }
  FILE_FUNCTIONS.set(callees, made)
  return made
}

/** The refused-declaration set belonging to `callees`. */
export const refusedDeclarationsOf = (callees: Map<string, FuncDecl>): Set<string> =>
  fileFunctionsOf(callees).refused

/** What a name in scope refers to.
 *
 *  `module` and `binding` were one kind until #14, and conflating them is what broke stage
 *  reachability: a resource binding lowered to `Expr.constref`, the shape the IR reserves for
 *  a module-scope CONSTANT, and every consumer that asks "which bindings does this stage
 *  reach" looks for `Expr.varref`. So no stage reached any binding in a source-compiled
 *  module — the GLSL writer dropped the uniform block while keeping the uses, and
 *  `reflect()` reported no stages for anything. A binding is a module-scope `var`, not a
 *  const, and it now says so. */
export type BindingKind = 'param' | 'local' | 'module' | 'binding' | 'override' | 'modvar'

/** How a "cannot assign" diagnostic names what the target is. One helper because the three
 *  sites that raise it disagreed: two said "declared with const" for a resource binding, which
 *  is not what a `declare const input: storage<…>` is.
 *
 *  The parameter is a `BindingKind`, not `BindingKind | undefined`. An absent binding is not a
 *  read-only one — it is an unknown name, a different diagnostic — and while this accepted
 *  `undefined` it answered "declared with const" for a name that was never declared at all.
 *  Every caller now resolves that case first. The switch is exhaustive so that a NEW kind is a
 *  type error here rather than silently taking a default phrase that may not describe it. */
export function readOnlyPhrase(kind: BindingKind): string {
  switch (kind) {
    case 'binding':
      return 'a read-only resource'
    case 'module':
      return 'a module const'
    case 'override':
      return 'an override constant, set by the pipeline'
    // Never read-only; the arm keeps the switch exhaustive.
    case 'modvar':
      return 'a module variable'
    case 'param':
    case 'local':
      return 'declared with const'
    default: {
      const never: never = kind
      throw new Error(`unhandled binding kind ${String(never)}`)
    }
  }
}

/** The base constructor a `super(...)` runs, and the fields it decides (roadmap 0.3 item T5,
 *  #92). Declared here, where both the collector that fills it and the statement lowering that
 *  reads it can see it without either importing the other. */
export interface SuperCtor {
  /** The emitted name of the base's constructor function, `Base_new`. */
  readonly fn: string
  readonly type: ShaderType
  readonly fields: readonly StructField[]
}

export interface Binding {
  readonly kind: BindingKind
  readonly name: string
  readonly type: ShaderType
  readonly mutable: boolean
  readonly constValue?: number | boolean
  /** The address space, for `kind: 'binding'` only. Carried because a diagnostic about a
   *  runtime-sized array has to say something different for `storage` than for `uniform`:
   *  `arrayLength(&x)` is spelled `ptr<storage, array<E>, AM>` and exists for nothing else,
   *  so pointing a `uniform<array<f32>>` author at it sends them to an intrinsic Tint would
   *  refuse on their program (#46). Absent for a local, a param or a module const. */
  readonly space?: AddressSpace | 'workgroup' | 'private'
  /** For a `kind: 'local'` bound to a bare name, the name it copies: `const a = src` records
   *  `aliasOf: 'src'`, so a question about what `a` denotes (is it a storage array, for
   *  `arrayLength`) follows the chain to the binding instead of stopping at the local (#46). */
  readonly aliasOf?: string
  /** For a `kind: 'module'` const whose value is not a scalar (a vector, an array), the
   *  initializer as lowered, so a division inside a function body can be proven zero
   *  componentwise the way a module const's own initializer is (#68). A scalar const carries
   *  its value in `constValue` instead and has no need of this. */
  readonly valueExpr?: Expr
  /** The name the IR knows this binding by, when it is not the source name. The IR identifies
   *  a local by name alone within a function, and TypeScript lets two lexically disjoint
   *  blocks, or an inner block and the block around it, declare one name; `define` gives the
   *  second and later declarations of a name in a function `p_1`, `p_2`, ... so no two
   *  bindings share an IR name (#38). Absent for a first declaration, whose IR name is its
   *  source name. */
  readonly irName?: string
}

/** The name an IR node for `b` carries: its {@link Binding.irName} when the source name was
 *  already taken in the function, its source name otherwise. Every site that builds a
 *  `varref` or `param` from a binding spells the name through this. */
export const irNameOf = (b: Binding): string => b.irName ?? b.name

export class LoweringScope {
  private readonly frames: Map<string, Binding>[] = [new Map()]
  /** Every IR name a `define` in this scope has handed out, module-level names included: a
   *  local that shadows a resource binding would otherwise be `varref dst` beside the
   *  binding's own `varref dst`, one name to every pass. */
  private readonly takenIr = new Set<string>()
  private readonly byIr = new Map<string, Binding>()
  private ownerDecl: FuncDecl | undefined
  private superCtorInfo: SuperCtor | undefined
  private superMethodMap: ReadonlyMap<string, string> | undefined
  private localFns: ReadonlyMap<string, string> | undefined
  private baseNames: ReadonlyMap<string, readonly string[]> = new Map()
  private abstractNames: ReadonlySet<string> = new Set()
  private readonly callees: Map<string, FuncDecl>
  private readonly fns: FileFunctions
  private readonly refusedDecls: Set<string>
  private readonly structs = new Map<string, StructDecl>()
  /** The names the file declares as an `enum` (roadmap 0.3 item T1, #92). Its members are
   *  module constants named `Enum_Member`, so the only thing the lowering needs the name for
   *  is telling a mistyped member from an unknown identifier. */
  private readonly enums = new Set<string>()
  /** The names the file declares as a `namespace` (roadmap 0.3 item T4, #92). */
  private readonly namespaces = new Set<string>()
  private namespacePrefix: string | undefined
  private readonly symbols: DeclaredSymbolSink | undefined
  private loopDepth = 0
  private atomicOperandDepth = 0
  private branchDepth = 0
  private stage: 'vertex' | 'fragment' | 'compute' | undefined
  private retType: ShaderType | undefined
  private switchDepth = 0

  constructor(callees?: Map<string, FuncDecl>, symbols?: DeclaredSymbolSink) {
    this.callees = callees ?? new Map()
    this.symbols = symbols
    this.fns = fileFunctionsOf(this.callees)
    this.refusedDecls = this.fns.refused
  }

  /** Whether this file declares `name` as a function and the declaration was refused, so its
   *  body was never lowered and no callee exists (roadmap 0.3 item T10, #92). A call to it
   *  would otherwise say "Unknown function", which is untrue: the function is right there,
   *  and why it names no callee was already said on its own declaration. */
  /** Whether this file declares `name` as a generic function, which is what tells the call
   *  lowering to read type arguments before it looks for a callee (roadmap 0.3 item T9, #92).
   *  A name may be reached through a namespace, the same spellings `resolveCallee` tries. */
  isGenericFunction(name: string): boolean {
    return this.genericName(name) !== undefined
  }

  /** Make, or find, the instance of the generic function `name` this call needs. The hook is
   *  set by `lowerSourceFunctions`, which owns the declarations; it is called from the call
   *  lowering, which is where an instantiation is discovered. That indirection is what lets the
   *  two talk without `expression-call.ts` importing `function.ts`. Returns undefined when the
   *  instantiation was refused, having said why. */
  instantiateGeneric(
    name: string,
    node: ts.CallExpression,
    argTypes: readonly ShaderType[],
    sourceFile: ts.SourceFile,
    diagnostics: TsCompilerDiagnostic[],
  ): FuncDecl | undefined {
    const written = this.genericName(name)
    if (written === undefined) return undefined
    return this.fns.instantiate?.(written, node, argTypes, sourceFile, diagnostics)
  }

  private genericName(name: string): string | undefined {
    if (this.fns.generics.has(name)) return name
    for (const qualified of this.qualifiedNames(name)) {
      if (this.fns.generics.has(qualified)) return qualified
    }
    return undefined
  }

  declarationRefused(name: string): boolean {
    if (this.refusedDecls.has(name)) return true
    const local = this.localFns?.get(name)
    if (local !== undefined && this.refusedDecls.has(local)) return true
    // A local function refused before it was registered has no entry above, and its emitted
    // name is the owner's and its own: `scale` inside `fs` is `fs_scale`. Read through the
    // owner rather than by the written name alone, so a call to an unknown `scale` in another
    // body still says so.
    const owner = this.ownerDecl?.name
    if (owner !== undefined && this.refusedDecls.has(`${owner}_${name}`)) return true
    for (const qualified of this.qualifiedNames(name)) {
      if (this.refusedDecls.has(qualified)) return true
    }
    return false
  }

  /** Record one declaration this scope just defined into the caller's symbol table, spanning
   *  `nameNode` (see `symbols.ts`). A no-op when the caller asked for no symbols. Deliberately
   *  separate from `define`: a function's scope also defines the module consts and the bindings
   *  it can see, and those are recorded once where they are collected, not once per function. */
  recordDeclaration(
    sourceFile: ts.SourceFile,
    nameNode: ts.Node,
    symbol: Omit<DeclaredSymbol, 'start' | 'length'>,
  ): void {
    recordDeclaration(this.symbols, sourceFile, nameNode, symbol)
  }

  enterLoop(): void {
    this.loopDepth++
  }

  exitLoop(): void {
    this.loopDepth = Math.max(0, this.loopDepth - 1)
  }

  /** Raised while an `if` arm, an `else`, or a `switch` case body is lowered: the positions a
   *  barrier may not stand in (§25). A loop body is not one; a `for` with a constant bound is
   *  uniform control flow. */
  enterBranch(): void {
    this.branchDepth++
  }

  exitBranch(): void {
    this.branchDepth = Math.max(0, this.branchDepth - 1)
  }

  inBranch(): boolean {
    return this.branchDepth > 0
  }

  /** The stage of the entry whose body is being lowered, `undefined` for a helper function
   *  and outside a body. Workgroup memory is a compute entry's alone (§24). */
  setStage(s: 'vertex' | 'fragment' | 'compute' | undefined): void {
    this.stage = s
  }

  currentStage(): 'vertex' | 'fragment' | 'compute' | undefined {
    return this.stage
  }

  /** Raised while an atomic builtin's location argument is lowered: the one position in which
   *  an expression of atomic type may stand (lower/atomics.ts, rule 2). */
  enterAtomicOperand(): void {
    this.atomicOperandDepth++
  }

  exitAtomicOperand(): void {
    this.atomicOperandDepth = Math.max(0, this.atomicOperandDepth - 1)
  }

  inAtomicOperand(): boolean {
    return this.atomicOperandDepth > 0
  }

  inLoop(): boolean {
    return this.loopDepth > 0
  }

  /** The declared return type of the function whose body is being lowered, so a `return` can
   *  be checked and typed against it: `return 0` takes it (#8 A3) and `return { … }` takes the
   *  struct it names (#8 A11). Undefined outside a function body — at module-constant
   *  collection, for instance. INSIDE one it is always set, `parseSignature` supplying `voidT`
   *  for a function with no annotation, which is the distinction that decides whether a bare
   *  `return 0` is retyped. */
  setReturnType(t: ShaderType | undefined): void {
    this.retType = t
  }

  returnType(): ShaderType | undefined {
    return this.retType
  }

  enterSwitch(): void {
    this.switchDepth++
  }

  exitSwitch(): void {
    this.switchDepth = Math.max(0, this.switchDepth - 1)
  }

  /** Whether a `break` here would leave a `switch`. Tracked apart from {@link inLoop}
   *  because `continue` is a loop statement only: a `switch` that is not inside a loop
   *  takes the one and refuses the other. */
  inSwitch(): boolean {
    return this.switchDepth > 0
  }

  setStructs(list: readonly StructDecl[]): void {
    this.structs.clear()
    // The `atomicCompareExchangeWeak` result structs are always in scope (#152). They are not
    // declared by any file and not emitted by any backend — WGSL's is built in and unnameable
    // — but member access needs their field types, so the two live here beside whatever the
    // file declared. An author cannot reach them: the names begin with `__`, which this
    // surface's identifier rules refuse, and nothing but the builtin produces the type.
    for (const s of CAS_RESULT_STRUCTS) this.structs.set(s.name, s as StructDecl)
    for (const s of list) this.structs.set(s.name, s)
  }

  setEnums(names: Iterable<string>): void {
    this.enums.clear()
    for (const n of names) this.enums.add(n)
  }

  isEnum(name: string): boolean {
    return this.enums.has(name)
  }

  setNamespaces(names: Iterable<string>): void {
    this.namespaces.clear()
    for (const n of names) this.namespaces.add(n)
  }

  /** Whether `name` is a `namespace` the file declares (roadmap 0.3 item T4, #92). Its members
   *  are flattened to `Ns_member`, so this is what tells `Palette.warm()` from a call on a
   *  value. */
  isNamespace(name: string): boolean {
    return this.namespaces.has(name)
  }

  fieldType(structName: string, field: string): ShaderType | undefined {
    return this.structs.get(structName)?.fields.find((f) => f.name === field)?.type
  }

  /** The collected struct with this name, or undefined. The lookup a CONTEXTUAL type needs:
   *  a declared `vec4`-shaped `VsOut` names its struct outright, where {@link matchStruct} can
   *  only guess from the field names and cannot answer at all when two structs share a shape
   *  (#8 A11). */
  structByName(name: string): StructDecl | undefined {
    return this.structs.get(name)
  }

  matchStruct(fieldNames: readonly string[]): StructDecl | undefined {
    const set = new Set(fieldNames)
    let hit: StructDecl | undefined
    for (const s of this.structs.values()) {
      if (s.fields.length !== set.size) continue
      if (!s.fields.every((f) => set.has(f.name))) continue
      if (hit) return undefined
      hit = s
    }
    return hit
  }

  /** What `super(...)` calls in the constructor body being lowered (roadmap 0.3 item T5, #92),
   *  or undefined anywhere else, where a `super` is refused. */
  setSuperCtor(info: SuperCtor | undefined): void {
    this.superCtorInfo = info
  }

  superCtor(): SuperCtor | undefined {
    return this.superCtorInfo
  }

  /** Which structs extend which (roadmap 0.3 item T5, #92), so a type mismatch between two
   *  that are related can say what is really wrong: dispatch here is static, so a base-typed
   *  name must not hold a derived value. */
  setBases(bases: ReadonlyMap<string, readonly string[]>): void {
    this.baseNames = bases
  }

  /** The classes declared `abstract`, which are bases and never values. The semantic pass
   *  already refuses a `new` on one, with the reason; this is what keeps the lowering from
   *  saying it a second time in weaker words. */
  setAbstractStructs(names: ReadonlySet<string>): void {
    this.abstractNames = names
  }

  isAbstractStruct(name: string): boolean {
    return this.abstractNames.has(name)
  }

  /** True when `derived` extends `base`, at any depth. */
  extendsStruct(derived: string, base: string): boolean {
    const seen = new Set<string>()
    const queue = [...(this.baseNames.get(derived) ?? [])]
    while (queue.length > 0) {
      const next = queue.shift()!
      if (next === base) return true
      if (seen.has(next)) continue
      seen.add(next)
      queue.push(...(this.baseNames.get(next) ?? []))
    }
    return false
  }

  /** The sentence a mismatch between two related structs adds, or '' when they are not
   *  related. `want` is the type the place has, `got` the type of the value. */
  inheritanceNote(want: ShaderType, got: ShaderType): string {
    if (want.kind !== 'struct' || got.kind !== 'struct') return ''
    if (this.extendsStruct(got.name, want.name)) {
      return (
        ` "${got.name}" extends "${want.name}", and a name typed as the base cannot hold a ` +
        `derived value here: method dispatch is static, so a call through it would run ` +
        `"${want.name}"'s body. Write "${got.name}" as the type.`
      )
    }
    if (this.extendsStruct(want.name, got.name)) {
      return (
        ` "${want.name}" extends "${got.name}", and a "${got.name}" has none of the fields ` +
        `"${want.name}" adds.`
      )
    }
    return ''
  }

  /** `super.m(...)` in the body being lowered, to the function that carries the base's body
   *  (roadmap 0.3 item T5, #92). The collector decides it, because which base declares the
   *  method depends on the class that WROTE the body, not on the one it is lowered for. */
  setSuperMethods(map: ReadonlyMap<string, string> | undefined): void {
    this.superMethodMap = map
  }

  superMethods(): ReadonlyMap<string, string> | undefined {
    return this.superMethodMap
  }

  /** The function whose BODY is being lowered, or undefined while a signature's default is
   *  (roadmap 0.3 item T7, #92). A default filled into a call is spliced into the body that
   *  wrote the call, so the calls it carries are that body's for the recursion check; a call
   *  inside a default being lowered belongs to no body yet. */
  setOwner(decl: FuncDecl | undefined): void {
    this.ownerDecl = decl
  }

  owner(): FuncDecl | undefined {
    return this.ownerDecl
  }

  defineCallee(fn: FuncDecl): void {
    this.callees.set(fn.name, fn)
  }

  /** A local function declared in the body being lowered, from the name it is written under to
   *  the name the module emits it as (roadmap 0.3 item T7, #92): `f` inside `fs` is `fs_f`. */
  setLocalFunctions(map: ReadonlyMap<string, string> | undefined): void {
    this.localFns = map
  }

  localFunctions(): ReadonlyMap<string, string> | undefined {
    return this.localFns
  }

  resolveCallee(name: string): FuncDecl | undefined {
    const local = this.localFns?.get(name)
    if (local !== undefined) {
      const hit = this.callees.get(local)
      if (hit !== undefined) return hit
    }
    const direct = this.callees.get(name)
    if (direct !== undefined) return direct
    for (const qualified of this.qualifiedNames(name)) {
      const hit = this.callees.get(qualified)
      if (hit !== undefined) return hit
    }
    return undefined
  }

  /** The name being lowered inside `namespace A { namespace B { ... } }` is `A_B`, and a name
   *  written inside that body may be a member of `A_B`, of `A`, or of the file (roadmap 0.3
   *  item T4, #92). This yields the qualified spellings to try, innermost first, which is
   *  TypeScript's own lookup rule for a namespace body. */
  private *qualifiedNames(name: string): Generator<string> {
    let prefix = this.namespacePrefix
    while (prefix !== undefined && prefix !== '') {
      yield `${prefix}_${name}`
      const cut = prefix.lastIndexOf('_')
      prefix = cut < 0 ? '' : prefix.slice(0, cut)
    }
  }

  /** The namespace whose body is being lowered, flattened (`A_B`), or undefined at the top
   *  level of the file. */
  setNamespacePrefix(prefix: string | undefined): void {
    this.namespacePrefix = prefix
  }

  namespaceOf(): string | undefined {
    return this.namespacePrefix
  }

  /** The struct a written name means: itself when the file declares it, else the first
   *  namespace-qualified spelling that it does, so `P` inside `namespace N` is `N_P` (#107). */
  qualifiedStruct(name: string): string | undefined {
    if (this.structByName(name) !== undefined) return name
    for (const qualified of this.qualifiedNames(name)) {
      if (this.structByName(qualified) !== undefined) return qualified
    }
    return undefined
  }

  /** `name` itself when the file declares it as a namespace, else the first
   *  namespace-qualified spelling that it does: inside `namespace A`, `B` is `A_B`. */
  qualifiedNamespace(name: string): string | undefined {
    if (this.namespaces.has(name)) return name
    for (const qualified of this.qualifiedNames(name)) {
      if (this.namespaces.has(qualified)) return qualified
    }
    return undefined
  }

  calleeTable(): Map<string, FuncDecl> {
    return this.callees
  }

  /** Bind `binding.name` in the current frame and return the binding as stored, which carries
   *  an {@link Binding.irName} when the name was already taken anywhere in this function.
   *  Throws on a repeat within the current frame, TypeScript's own rule; the callers that can
   *  reach that turn it into a TS8023 on the declaration. */
  define(binding: Binding): Binding {
    const top = this.frames[this.frames.length - 1]!
    if (top.has(binding.name)) {
      throw new Error(`Duplicate binding "${binding.name}" in current scope frame`)
    }
    // A binding may ask for an IR name other than its own: `this` reads as `self_` in the
    // emitted function, since `this` and `self` are reserved words in WGSL (#86).
    const ir = this.allocIrName(binding.irName ?? binding.name)
    const stored: Binding = ir === binding.name ? binding : { ...binding, irName: ir }
    top.set(binding.name, stored)
    this.byIr.set(ir, stored)
    return stored
  }

  /** An internal local the lowering needs and the source never named: the value a
   *  destructuring declaration reads from, lowered once (roadmap 0.3 item T7, #92). It takes an
   *  IR name no other local can take and binds no source name, so two of them in one block do
   *  not collide with each other and neither collides with a name the program declares. Returns
   *  the IR name to write into the statement. */
  defineTemp(prefix: string, type: ShaderType): string {
    const ir = this.allocIrName(prefix)
    this.byIr.set(ir, { kind: 'local', name: ir, type, mutable: false })
    return ir
  }

  private allocIrName(name: string): string {
    if (!this.takenIr.has(name)) {
      this.takenIr.add(name)
      return name
    }
    for (let n = 1; ; n++) {
      const candidate = `${name}_${n}`
      if (!this.takenIr.has(candidate)) {
        this.takenIr.add(candidate)
        return candidate
      }
    }
  }

  resolve(name: string): Binding | undefined {
    for (let i = this.frames.length - 1; i >= 0; i--) {
      const hit = this.frames[i]!.get(name)
      if (hit) return hit
    }
    // Inside a namespace body a bare name may be one of its members, which the module holds
    // under the flattened name (roadmap 0.3 item T4, #92). Tried after the frames, so a local
    // and a parameter still win, which is TypeScript's order too.
    for (const qualified of this.qualifiedNames(name)) {
      for (let i = this.frames.length - 1; i >= 0; i--) {
        const hit = this.frames[i]!.get(qualified)
        if (hit) return hit
      }
    }
    return undefined
  }

  /** The binding an already-lowered IR node names. {@link resolve} answers for a SOURCE name
   *  at the point of lowering; a reader holding a `varref` has the IR name, which after a
   *  rename is no source name at all, or the source name of a different local. The map is
   *  function-wide and never popped, because an IR name is unique in the function. */
  resolveIr(name: string): Binding | undefined {
    return this.byIr.get(name)
  }

  hasInCurrent(name: string): boolean {
    return this.frames[this.frames.length - 1]!.has(name)
  }

  push(): void {
    this.frames.push(new Map())
  }

  pop(): void {
    if (this.frames.length <= 1) throw new Error('Cannot pop the root scope frame')
    this.frames.pop()
  }

  entries(): readonly Binding[] {
    const merged = new Map<string, Binding>()
    for (const frame of this.frames) {
      for (const [k, v] of frame) merged.set(k, v)
    }
    return [...merged.values()]
  }
}
