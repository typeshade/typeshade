export type T = 'k' | 'i32' | 'u32' | 'f32' | 'bool';
export interface V {
  readonly t: T;
  readonly v: number;
}
export class Skip extends Error {}

export const inRange = (t: 'i32' | 'u32', x: number): boolean =>
  t === 'u32' ? x >= 0 && x <= 4294967295 : x >= -(2 ** 31) && x <= 2 ** 31 - 1;
export const wrap = (t: T, x: number): number => {
  if (!Number.isFinite(x)) throw new Skip('not finite');
  if (t === 'f32' && Math.abs(x) > 2 ** 24 && Math.fround(x) !== x) throw new Skip('f32 precision');
  return t === 'i32' ? x | 0 : t === 'u32' ? x >>> 0 : t === 'f32' ? Math.fround(x) : x;
};
export function convert(to: 'i32' | 'u32' | 'f32', x: V): number {
  if (to === 'f32') return Math.fround(x.v);
  if ((x.t === 'f32' || !Number.isInteger(x.v)) && !inRange(to, Math.trunc(x.v))) {
    throw new Skip('float conversion out of range');
  }
  if (x.t === 'k' && !inRange(to, x.v)) throw new Skip('untyped value out of range');
  return to === 'i32' ? Math.trunc(x.v) | 0 : Math.trunc(x.v) >>> 0;
}
export function store(to: 'i32' | 'u32', x: V): number {
  if (x.t !== 'k') return convert(to, x);
  const v = Math.trunc(x.v);
  if (inRange(to, v)) return to === 'i32' ? v | 0 : v >>> 0;
  if (to === 'u32' && v < 0 && v >= -(2 ** 31)) return v >>> 0;
  if (to === 'i32' && v > 2 ** 31 - 1 && v <= 2 ** 32 - 1) return v | 0;
  throw new Skip('stored value out of range');
}
export const popcount = (x: number): number => {
  let n = x >>> 0;
  let c = 0;
  while (n !== 0) {
    c += n & 1;
    n >>>= 1;
  }
  return c;
};
export function unify(a: V, b: V): T {
  if (a.t === 'bool' || b.t === 'bool') throw new Skip('bool operand');
  if (a.t === 'k') return b.t;
  if (b.t === 'k' || a.t === b.t) return a.t;
  throw new Skip('two declared types');
}

export const COMPARE = new Set(['<', '<=', '>', '>=', '==', '!=']);

export function binary(op: string, a: V, b: V): V {
  if (COMPARE.has(op)) {
    unify(a, b);
    const [x, y] = [a.v, b.v];
    const r =
      op === '<'
        ? x < y
        : op === '<='
          ? x <= y
          : op === '>'
            ? x > y
            : op === '>='
              ? x >= y
              : op === '=='
                ? x === y
                : x !== y;
    return { t: 'bool', v: r ? 1 : 0 };
  }
  if (op === '>>>') throw new Skip('>>> is refused');
  const t = op === '<<' || op === '>>' ? a.t : unify(a, b);
  if (t === 'bool') throw new Skip('bool');
  const [x, y] = [a.v, b.v];
  if (t === 'f32' && ['&', '|', '^', '<<', '>>'].includes(op)) throw new Skip('f32 bits');
  const integer = (t === 'i32' || t === 'u32') && Number.isInteger(x) && Number.isInteger(y);
  const out: T = (t === 'i32' || t === 'u32') && !integer ? 'k' : t;
  let r: number;
  switch (op) {
    case '+':
      r = x + y;
      break;
    case '-':
      r = x - y;
      break;
    case '*':
      r = integer ? Math.imul(x | 0, y | 0) : x * y;
      break;
    case '/':
      if (y === 0) throw new Skip('zero');
      r = integer ? Math.trunc(x / y) : x / y;
      break;
    case '%':
      if (y === 0) throw new Skip('zero');
      if (t === 'f32' && !(Number.isInteger(x) && Number.isInteger(y))) {
        throw new Skip('f32 remainder');
      }
      r = x % y;
      break;
    case '&':
      r = x & y;
      break;
    case '|':
      r = x | y;
      break;
    case '^':
      r = x ^ y;
      break;
    case '<<':
      r = x << (y & 31);
      break;
    default:
      r = t === 'u32' ? (x >>> 0) >>> (y & 31) : x >> (y & 31);
  }
  if (out === 'k' && Number.isInteger(r) && !inRange('i32', r) && !inRange('u32', r)) {
    throw new Skip('untyped integer past both types');
  }
  return { t: out, v: wrap(out, r) };
}
