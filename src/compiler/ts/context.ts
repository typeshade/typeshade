// === Lowering context / symbol table ===

import type ts from 'typescript'
import type { ShaderType } from '../../core/ir/types.js'
import type { AddressSpace } from '../../core/ir/nodes.js'
import type { FuncDecl, StructDecl } from '../../core/ir/nodes.js'
import { recordDeclaration, type DeclaredSymbol, type DeclaredSymbolSink } from './symbols.js'

/** What a name in scope refers to.
 *
 *  `module` and `binding` were one kind until #14, and conflating them is what broke stage
 *  reachability: a resource binding lowered to `Expr.constref`, the shape the IR reserves for
 *  a module-scope CONSTANT, and every consumer that asks "which bindings does this stage
 *  reach" looks for `Expr.varref`. So no stage reached any binding in a source-compiled
 *  module — the GLSL writer dropped the uniform block while keeping the uses, and
 *  `reflect()` reported no stages for anything. A binding is a module-scope `var`, not a
 *  const, and it now says so. */
export type BindingKind = 'param' | 'local' | 'module' | 'binding' | 'override'

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
    case 'param':
    case 'local':
      return 'declared with const'
    default: {
      const never: never = kind
      throw new Error(`unhandled binding kind ${String(never)}`)
    }
  }
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
  readonly space?: AddressSpace
}

export class LoweringScope {
  private readonly frames: Map<string, Binding>[] = [new Map()]
  private readonly callees: Map<string, FuncDecl>
  private readonly structs = new Map<string, StructDecl>()
  private readonly symbols: DeclaredSymbolSink | undefined
  private loopDepth = 0
  private switchDepth = 0

  constructor(callees?: Map<string, FuncDecl>, symbols?: DeclaredSymbolSink) {
    this.callees = callees ?? new Map()
    this.symbols = symbols
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

  inLoop(): boolean {
    return this.loopDepth > 0
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
    for (const s of list) this.structs.set(s.name, s)
  }

  fieldType(structName: string, field: string): ShaderType | undefined {
    return this.structs.get(structName)?.fields.find((f) => f.name === field)?.type
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

  defineCallee(fn: FuncDecl): void {
    this.callees.set(fn.name, fn)
  }

  resolveCallee(name: string): FuncDecl | undefined {
    return this.callees.get(name)
  }

  calleeTable(): Map<string, FuncDecl> {
    return this.callees
  }

  define(binding: Binding): void {
    const top = this.frames[this.frames.length - 1]!
    if (top.has(binding.name)) {
      throw new Error(`Duplicate binding "${binding.name}" in current scope frame`)
    }
    top.set(binding.name, binding)
  }

  resolve(name: string): Binding | undefined {
    for (let i = this.frames.length - 1; i >= 0; i--) {
      const hit = this.frames[i]!.get(name)
      if (hit) return hit
    }
    return undefined
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
