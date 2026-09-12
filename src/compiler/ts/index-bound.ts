// Constant-index OOB. Runtime xs[i] stays UB on the GPU.

import type { Expr } from '../../core/ir/nodes.js'
import type { ShaderType } from '../../core/ir/types.js'
import type { LoweringScope } from './context.js'
import { foldConstNumber } from './loop-bound.js'

export function indexableLength(type: ShaderType): number | undefined {
  if (type.kind === 'vec') return type.n
  if (type.kind === 'array' && typeof type.size === 'number') return type.size
  return undefined
}

/** `undefined` = cannot prove (runtime index or unsized array). string = OOB. */
export function constIndexError(base: Expr, idx: Expr, scope: LoweringScope): string | undefined {
  const i = foldConstNumber(idx, scope)
  if (i === undefined) return undefined
  if (!Number.isInteger(i)) return `Index ${i} is not an integer.`
  if (i < 0) return `Index ${i} is negative.`
  const n = indexableLength(base.type)
  if (n === undefined) return undefined
  if (i >= n) {
    const name = base.type.kind === 'vec' ? `vec${n}` : `array<…, ${n}>`
    return `Index ${i} is out of range for ${name} (valid: 0..${n - 1}).`
  }
  return undefined
}
