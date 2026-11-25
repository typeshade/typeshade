import type { Expr } from '../../../core/ir/nodes.js';
import type { LoweringScope } from '../context.js';
import { BUILTINS } from '../../../core/cpu-runtime.js';
import { isConstEvaluableMathFn } from '../math-alias.js';
import { foldIntLit, intElemOf, wrapInt } from '../../../core/passes/opt/expr-utils.js';

export function foldConstNumber(expr: Expr, scope: LoweringScope): number | undefined {
  if (expr.op === 'lit' && typeof expr.value === 'number') return expr.value;
  if (expr.op === 'unop') {
    const x = foldConstNumber(expr.a, scope);
    if (x === undefined) return undefined;
    const int = intElemOf(expr.type);
    return int === undefined ? -x : wrapInt(-x, int);
  }
  if (expr.op === 'constref') {
    const b = scope.resolveIr(expr.name);
    if (b && typeof b.constValue === 'number') return b.constValue;
    return undefined;
  }
  if (expr.op === 'varref' || expr.op === 'param') {
    const b = scope.resolveIr(expr.name);
    if (b && !b.mutable && typeof b.constValue === 'number') return b.constValue;
    return undefined;
  }
  if (expr.op === 'binop') {
    const a = foldConstNumber(expr.a, scope);
    const b = foldConstNumber(expr.b, scope);
    if (a === undefined || b === undefined) return undefined;
    const int = intElemOf(expr.type);
    if (int !== undefined) return foldIntLit(expr.bop, a, b, int);
    switch (expr.bop) {
      case '+':
        return a + b;
      case '-':
        return a - b;
      case '*':
        return a * b;
      case '/':
        return b === 0 ? undefined : a / b;
      case '%':
        return b === 0 ? undefined : a % b;
      case '<<':
      case '>>':
      case '&':
      case '|':
      case '^': {
        if (!Number.isInteger(a) || !Number.isInteger(b)) return undefined;
        if ((expr.bop === '<<' || expr.bop === '>>') && (b < 0 || b > 31)) return undefined;
        switch (expr.bop) {
          case '<<':
            return a << b;
          case '>>':
            return a >> b;
          case '&':
            return a & b;
          case '|':
            return a | b;
          default:
            return a ^ b;
        }
      }
      default:
        return undefined;
    }
  }
  if (expr.op === 'call' && expr.fn === '~' && expr.declRef === undefined && expr.args[0]) {
    const int = intElemOf(expr.type);
    const x = foldConstNumber(expr.args[0], scope);
    return int === undefined || x === undefined || !Number.isInteger(x)
      ? undefined
      : wrapInt(~x, int);
  }
  if (
    expr.op === 'call' &&
    (expr.fn === 'i32' || expr.fn === 'u32' || expr.fn === 'f32') &&
    expr.args[0]
  ) {
    const x = foldConstNumber(expr.args[0], scope);
    if (x === undefined) return undefined;
    return expr.fn === 'f32' ? x : wrapInt(Math.trunc(x), expr.fn);
  }
  if (expr.op === 'call' && expr.declRef === undefined && isConstEvaluableMathFn(expr.fn)) {
    const f = BUILTINS[expr.fn];
    if (!f) return undefined;
    const args: number[] = [];
    for (const a of expr.args) {
      const x = foldConstNumber(a, scope);
      if (x === undefined) return undefined;
      args.push(x);
    }
    const v = f(...args);
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  }
  return undefined;
}

export function foldConstBool(expr: Expr, scope: LoweringScope): boolean | undefined {
  if (expr.op === 'lit' && typeof expr.value === 'boolean') return expr.value;
  if (expr.op === 'varref' || expr.op === 'param') {
    const b = scope.resolveIr(expr.name);
    if (b && !b.mutable && typeof b.constValue === 'boolean') return b.constValue;
  }
  return undefined;
}

export function foldConstValue(expr: Expr, scope: LoweringScope): number | boolean | undefined {
  const n = foldConstNumber(expr, scope);
  if (n !== undefined) return n;
  return foldConstBool(expr, scope);
}
