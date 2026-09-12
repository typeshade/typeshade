// === Lowering context / symbol table ===

import type { ShaderType } from '../../core/ir/types.js'
import type { FuncDecl } from '../../core/ir/nodes.js'

export type BindingKind = 'param' | 'local' | 'module'

export interface Binding {
  readonly kind: BindingKind
  readonly name: string
  readonly type: ShaderType
  readonly mutable: boolean
  readonly constValue?: number | boolean
}

export class LoweringScope {
  private readonly frames: Map<string, Binding>[] = [new Map()]
  private readonly callees: Map<string, FuncDecl>
  private loopDepth = 0

  constructor(callees?: Map<string, FuncDecl>) {
    this.callees = callees ?? new Map()
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
