// === Lowering context / symbol table (shared by Phase 3+) ===

import type { ShaderType } from '../../core/ir/types.js'

/** Binding kind in a "use typeshade" function scope. */
export type BindingKind = 'param' | 'local'

/** One name binding visible to expression lowering. */
export interface Binding {
  readonly kind: BindingKind
  readonly name: string
  readonly type: ShaderType
}

/**
 * Nested lexical scope for lowering a function body.
 *
 * - `define` writes to the current frame only
 * - `resolve` walks parent frames (params live in the outermost frame)
 * - `push` / `pop` open and close block scopes (if/else bodies)
 */
export class LoweringScope {
  private readonly frames: Map<string, Binding>[] = [new Map()]

  /** Define a binding in the current frame. Throws if the name already exists here. */
  define(binding: Binding): void {
    const top = this.frames[this.frames.length - 1]!
    if (top.has(binding.name)) {
      throw new Error(`Duplicate binding "${binding.name}" in current scope frame`)
    }
    top.set(binding.name, binding)
  }

  /** Resolve a name by walking frames from innermost to outermost. */
  resolve(name: string): Binding | undefined {
    for (let i = this.frames.length - 1; i >= 0; i--) {
      const hit = this.frames[i]!.get(name)
      if (hit) return hit
    }
    return undefined
  }

  /** Whether the name is already defined in the *current* frame (not parents). */
  hasInCurrent(name: string): boolean {
    return this.frames[this.frames.length - 1]!.has(name)
  }

  /** Open a nested block scope. */
  push(): void {
    this.frames.push(new Map())
  }

  /** Close the innermost block scope. */
  pop(): void {
    if (this.frames.length <= 1) {
      throw new Error('Cannot pop the root scope frame')
    }
    this.frames.pop()
  }

  /** Snapshot of all visible bindings (innermost wins). */
  entries(): readonly Binding[] {
    const merged = new Map<string, Binding>()
    for (const frame of this.frames) {
      for (const [k, v] of frame) merged.set(k, v)
    }
    return [...merged.values()]
  }
}
