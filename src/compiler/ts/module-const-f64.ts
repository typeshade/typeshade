// Scalar f64 module initializers (change 0123). This does not change loop-bound folding or
// the existing four scalar constant paths. The caller preserves written f32 conversions.

import type { Expr } from '../../core/ir/nodes.js';
import { BUILTINS, bitBuiltin, TYPED_BIT_BUILTINS } from '../../core/cpu-runtime.js';
import { foldIntLit, wrapInt } from '../../core/passes/opt/expr-utils.js';
import type { LoweringScope } from './context.js';
import { isConstEvaluableMathFn } from './math-alias.js';
import { logicalTypeKey as typeKey } from './optional.js';

/** Evaluate only scalar constant shapes. f32 operations round at their typed boundaries;
 *  f64 arithmetic uses the oracle's double. A prior declaration supplies its recorded scalar
 *  value, never a re-evaluation of its GPU valueExpr (0123's explicit compatibility boundary). */
export function foldF64ModuleConst(expr: Expr, scope: LoweringScope): number | undefined {
  const kind = typeKey(expr.type);
  const finish = (n: number): number =>
    kind === 'f32' ? Math.fround(n) : kind === 'i32' || kind === 'u32' ? wrapInt(n, kind) : n;
  const fold = (e: Expr): number | undefined => foldF64ModuleConst(e, scope);
  switch (expr.op) {
    case 'lit':
      return typeof expr.value === 'number' ? finish(expr.value) : undefined;
    case 'constref': {
      const value = scope.resolveIr(expr.name)?.constValue;
      return typeof value === 'number' ? finish(value) : undefined;
    }
    case 'unop': {
      const value = fold(expr.a);
      return value === undefined ? undefined : finish(-value);
    }
    case 'binop': {
      const a = fold(expr.a);
      const b = fold(expr.b);
      if (a === undefined || b === undefined) return undefined;
      if (kind === 'i32' || kind === 'u32') return foldIntLit(expr.bop, a, b, kind);
      switch (expr.bop) {
        case '+':
          return finish(a + b);
        case '-':
          return finish(a - b);
        case '*':
          return finish(a * b);
        case '/':
          return b === 0 ? undefined : finish(a / b);
        case '%':
          return kind !== 'f64' && b !== 0 ? finish(a % b) : undefined;
        default:
          return undefined;
      }
    }
    case 'call': {
      if (expr.declRef !== undefined) return undefined;
      const conversion = ['f64', 'f32', 'i32', 'u32'].includes(expr.fn);
      if (!conversion && !isConstEvaluableMathFn(expr.fn)) return undefined;
      const args: number[] = [];
      for (const arg of expr.args) {
        const value = fold(arg);
        if (value === undefined) return undefined;
        args.push(value);
      }
      if (conversion) {
        if (args.length !== 1) return undefined;
        if ((kind === 'i32' || kind === 'u32') && typeKey(expr.args[0]!.type) === 'f32') {
          const value = Math.trunc(args[0]!);
          const lo = kind === 'i32' ? -2147483648 : 0;
          const hi = kind === 'i32' ? 2147483647 : 4294967295;
          if (!Number.isFinite(value) || value < lo || value > hi) return undefined;
        }
        return finish(args[0]!);
      }
      const fn = BUILTINS[expr.fn];
      if (fn === undefined) return undefined;
      const value = TYPED_BIT_BUILTINS.has(expr.fn)
        ? bitBuiltin(expr.fn, args, typeKey(expr.args[0]!.type) === 'i32' ? 'i32' : 'u32')
        : fn(...args);
      return typeof value === 'number' ? finish(value) : undefined;
    }
    default:
      return undefined;
  }
}
