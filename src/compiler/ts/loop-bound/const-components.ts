import type { Expr } from '../../../core/ir/nodes.js';
import type { ShaderType } from '../../../core/ir/types.js';
import type { LoweringScope } from '../context.js';
import { foldConstNumber } from './fold-const.js';

/* Why: Tint checks the domain or range of these builtins when every argument is constant (#613,
 *  measured on Tint in Chromium 141.0.7390.37): `exp(89.0)`, `exp2(128.0)`, `sinh(90.0)`,
 *  `cosh(90.0)`, `degrees(1e37)`, `ldexp(1.0, 128)`, `fma(1e30, 1e30, 0.0)` and `pow(10.0, 40.0)`
 *  "cannot be represented as 'f32'". */
const CONST_CALLS: Readonly<Record<string, (...xs: number[]) => number>> = {
  pow: (a, b) => Math.pow(a!, b!),
  sqrt: (x) => Math.sqrt(x!),
  inverseSqrt: (x) => 1 / Math.sqrt(x!),
  log: (x) => (x! > 0 ? Math.log(x!) : Number.NaN),
  log2: (x) => (x! > 0 ? Math.log2(x!) : Number.NaN),
  exp: (x) => Math.exp(x!),
  exp2: (x) => Math.pow(2, x!),
  sinh: (x) => Math.sinh(x!),
  cosh: (x) => Math.cosh(x!),
  degrees: (x) => (x! * 180) / Math.PI,
  ldexp: (x, e) => x! * Math.pow(2, e!),
  fma: (a, b, c) => a! * b! + c!,
};

export const isF32Valued = (t: ShaderType): boolean =>
  (t.kind === 'scalar' && t.scalar === 'f32') || (t.kind === 'vec' && t.elem === 'f32');

export function foldConstComponents(
  e: Expr,
  scope: LoweringScope,
  valueExprs?: ReadonlyMap<string, Expr>,
  seen: ReadonlySet<string> = new Set(),
  round: (v: number) => number = (v) => v,
  calls = false,
): number[] | undefined {
  const fold = (x: Expr, s: ReadonlySet<string> = seen): number[] | undefined =>
    foldConstComponents(x, scope, valueExprs, s, round, calls);
  switch (e.op) {
    case 'lit':
      return typeof e.value === 'number' ? [round(e.value)] : undefined;
    case 'unop': {
      const a = fold(e.a);
      return a === undefined ? undefined : a.map((v) => -v);
    }
    case 'construct': {
      if (e.type.kind !== 'vec') return undefined;
      const parts: number[] = [];
      for (const a of e.args) {
        const c = fold(a);
        if (c === undefined) return undefined;
        parts.push(...c);
      }
      if (parts.length === 1 && e.type.n > 1)
        return Array.from({ length: e.type.n }, () => parts[0]!);
      return parts.length === e.type.n ? parts : undefined;
    }
    case 'constref': {
      if (seen.has(e.name)) return undefined;
      const value = valueExprs?.get(e.name) ?? scope.resolveIr(e.name)?.valueExpr;
      if (value !== undefined) return fold(value, new Set([...seen, e.name]));
      const n = foldConstNumber(e, scope);
      return n === undefined ? undefined : [round(n)];
    }
    case 'varref': {
      const n = foldConstNumber(e, scope);
      return n === undefined ? undefined : [round(n)];
    }
    case 'binop': {
      const a = fold(e.a);
      const b = fold(e.b);
      if (a === undefined || b === undefined) return undefined;
      if (a.length !== 1 && b.length !== 1 && a.length !== b.length) return undefined;
      const n = Math.max(a.length, b.length);
      const at = (xs: number[], i: number): number => xs[xs.length === 1 ? 0 : i]!;
      const out: number[] = [];
      for (let i = 0; i < n; i++) {
        const x = at(a, i);
        const y = at(b, i);
        switch (e.bop) {
          case '+':
            out.push(round(x + y));
            break;
          case '-':
            out.push(round(x - y));
            break;
          case '*':
            out.push(round(x * y));
            break;
          case '/':
            if (y === 0) return undefined;
            out.push(round(x / y));
            break;
          default:
            return undefined;
        }
      }
      return out;
    }
    case 'call': {
      const at = CONST_CALLS[e.fn];
      if (!calls || at === undefined || e.declRef !== undefined || !isF32Valued(e.type))
        return undefined;
      const args: number[][] = [];
      for (const a of e.args) {
        const c = fold(a);
        if (c === undefined) return undefined;
        args.push(c);
      }
      const n = Math.max(...args.map((c) => c.length));
      if (args.some((c) => c.length !== 1 && c.length !== n)) return undefined;
      const out: number[] = [];
      for (let i = 0; i < n; i++) {
        const v = round(at(...args.map((c) => c[c.length === 1 ? 0 : i]!)));
        if (Number.isNaN(v)) return undefined;
        out.push(v);
      }
      return out;
    }
    default:
      return undefined;
  }
}
