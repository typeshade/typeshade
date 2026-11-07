// Constant-index OOB. Runtime xs[i] stays UB on the GPU.

import type { ConstDecl, Expr } from '../../core/ir/nodes.js';
import type { ShaderType } from '../../core/ir/types.js';
import type { LoweringScope } from './context.js';
import { foldConstNumber } from './loop-bound.js';
import { fitsTarget, isIntScalar } from './lit-coerce.js';

/** Prove an integer index from emitted integer values, without the CPU folder's f32 values.
 * Captured parameters remain runtime inputs to their generated helper, even when their
 * source binding was constant. Floating-point subtrees deliberately carry no proof. */
export function foldIndexConst(expr: Expr, scope: LoweringScope): number | undefined {
  if (!isIntScalar(expr.type)) return undefined;
  const literal = (e: Expr): Expr | undefined => {
    const value = foldIndexConst(e, scope);
    return value === undefined ? undefined : { op: 'lit', type: e.type, value };
  };
  let candidate: Expr;
  switch (expr.op) {
    case 'lit':
      candidate = expr;
      break;
    case 'constref':
    case 'varref': {
      const binding = scope.resolveIr(expr.name);
      return binding?.mutable === false && binding.capture === undefined
        ? binding.indexConstValue
        : undefined;
    }
    case 'unop': {
      const a = literal(expr.a);
      if (a === undefined) return undefined;
      candidate = { ...expr, a };
      break;
    }
    case 'binop': {
      const a = literal(expr.a);
      const b = literal(expr.b);
      if (a === undefined || b === undefined) return undefined;
      candidate = { ...expr, a, b };
      break;
    }
    case 'call': {
      if (expr.declRef !== undefined) return undefined;
      const args = expr.args.map(literal);
      if (args.some((a) => a === undefined)) return undefined;
      candidate = { ...expr, args: args as Expr[] };
      break;
    }
    default:
      return undefined;
  }
  // Reuse the existing integer arithmetic/wrap rules; every reference was replaced by its
  // proven emitted value, so this call cannot accidentally consult a CPU-only constValue.
  const value = foldConstNumber(candidate, scope);
  return value !== undefined && fitsTarget(value, expr.type) ? value : undefined;
}

/** `valueExpr` wins over the scalar literal in both GPU writers. */
export function moduleIndexConst(
  c: Pick<ConstDecl, 'type' | 'valueExpr'> & Partial<Pick<ConstDecl, 'wgslValue'>>,
  scope: LoweringScope,
): number | undefined {
  const init =
    c.valueExpr ??
    (c.wgslValue === undefined
      ? undefined
      : { op: 'lit' as const, type: c.type, value: c.wgslValue });
  return init === undefined ? undefined : foldIndexConst(init, scope);
}

export function indexableLength(type: ShaderType): number | undefined {
  if (type.kind === 'vec') return type.n;
  if (type.kind === 'array' && typeof type.size === 'number') return type.size;
  return undefined;
}

/** `undefined` = cannot prove (runtime index or unsized array). string = OOB. */
export function constIndexError(base: Expr, idx: Expr, scope: LoweringScope): string | undefined {
  const i = foldConstNumber(idx, scope);
  if (i === undefined) return undefined;
  if (!Number.isInteger(i)) return `Index ${i} is not an integer.`;
  if (i < 0) return `Index ${i} is negative.`;
  const n = indexableLength(base.type);
  if (n === undefined) return undefined;
  if (i >= n) {
    const name = base.type.kind === 'vec' ? `vec${n}` : `array<…, ${n}>`;
    return `Index ${i} is out of range for ${name} (valid: 0..${n - 1}).`;
  }
  return undefined;
}
