export type T = 'k' | 'i32' | 'u32' | 'f32' | 'bool';
export interface V {
  readonly t: T;
  readonly v: number;
  readonly bits?: number;
  readonly ts?: number;
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
  if (to === 'f32') return Math.fround(x.ts ?? x.v);
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

function typedBinary(op: string, a: V, b: V): V {
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

const READS_BITS = new Set(['+', '-', '*', '&', '|', '^', '<<']);
const ROOTS = new Set(['&', '|', '^', '<<']);
const isBig = (v: number): boolean => v > 2147483647 && v <= 4294967295;

function unsignedOp(op: string, x: number, y: number): number {
  switch (op) {
    case '+':
      return (x + y) >>> 0;
    case '-':
      return (x - y) >>> 0;
    case '*':
      return Math.imul(x, y) >>> 0;
    case '&':
      return (x & y) >>> 0;
    case '|':
      return (x | y) >>> 0;
    case '^':
      return (x ^ y) >>> 0;
    default:
      return (x << (y & 31)) >>> 0;
  }
}

function typeScriptOp(op: string, x: number, y: number): number {
  switch (op) {
    case '+':
      return x + y;
    case '-':
      return x - y;
    case '*':
      return x * y;
    case '&':
      return x & y;
    case '|':
      return x | y;
    case '^':
      return x ^ y;
    default:
      return x << (y & 31);
  }
}

const seen = (x: V): number => x.ts ?? x.v;

export function binary(op: string, a: V, b: V): V {
  const twoReadings = a.ts !== undefined || b.ts !== undefined;
  if (twoReadings && (COMPARE.has(op) || op === '/' || op === '%')) {
    unify(a, b);
    return typedBinary(op, { t: 'k', v: seen(a) }, { t: 'k', v: seen(b) });
  }
  const plain = typedBinary(op, a, b);
  if (!READS_BITS.has(op)) return plain;
  const carried = twoReadings || a.bits !== undefined || b.bits !== undefined;
  if (plain.t === 'u32' && carried) {
    const value = typeScriptOp(op, seen(a), seen(b));
    return value === plain.v ? plain : { ...plain, ts: value };
  }
  const root = ROOTS.has(op) && a.t === 'k' && b.t === 'k' && (isBig(a.v) || isBig(b.v));
  if (plain.t === 'k' && Number.isInteger(plain.v) && (carried || root)) {
    const u = unsignedOp(op, a.bits ?? a.v >>> 0, b.bits ?? b.v >>> 0);
    return u === plain.v ? plain : { ...plain, bits: u };
  }
  return plain;
}

export function unaryValue(op: '-' | '~', x: V): V {
  if (x.t === 'bool') throw new Skip('bool');
  if (op === '~' && x.t === 'f32') throw new Skip('f32 bits');
  if (op === '-' && x.t === 'u32') throw new Skip('negated u32');
  const v = wrap(x.t, op === '~' ? ~x.v : -x.v);
  if (x.ts !== undefined) return { t: x.t, v, ts: op === '~' ? ~x.ts : -x.ts };
  if (x.bits === undefined) return { t: x.t, v };
  const u = (op === '~' ? ~x.bits : -x.bits) >>> 0;
  return u === v ? { t: x.t, v } : { t: x.t, v, bits: u };
}

export const bitsValue = (bits: number): V => ({ t: 'k', v: bits | 0, bits });
export const bitsLit = (bits: number, text: string) => ({ text, value: () => bitsValue(bits) });
