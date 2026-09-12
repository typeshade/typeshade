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
 * Mutable scope for lowering a function body.
 * Phase 3 only needs resolve(); later phases push locals on const/let.
 */
export class LoweringScope {
  private readonly map = new Map<string, Binding>()

  define(binding: Binding): void {
    this.map.set(binding.name, binding)
  }

  resolve(name: string): Binding | undefined {
    return this.map.get(name)
  }

  /** Snapshot of all bindings (for tests / debugging). */
  entries(): readonly Binding[] {
    return [...this.map.values()]
  }
}
