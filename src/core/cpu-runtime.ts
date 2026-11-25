import type { BinOp, ShaderType, StructDecl } from './ir/index.js';
import type { CmpOp } from './ir/nodes.js';
import {
  EXACT_BUILTINS,
  intDiv,
  intRem,
  maxNum,
  minNum,
  roundTiesToEven,
  scalarBin,
  wrapInt,
  type NumKind,
} from './scalar-arith.js';
import { makeLibm, type Libm } from './libm/index.js';
import { PUSHED_BUILTINS, pushOnto } from './pushed-index.js';

export { atomicStep, intDiv, intRem, scalarBin, wrapInt, type NumKind } from './scalar-arith.js';

/** A value as the CPU backends ({@link compileModule} and {@link compileModuleJs})
 *  represent it: a plain JavaScript value, never a typed array or a GPU buffer. A scalar
 *  of any kind (f32, f64, i32, u32, bool) is a `number` or `boolean`, computed in double
 *  precision; {@link CpuPrecision} says how the arithmetic rounds. A vector or matrix is a
 *  flat `number[]`, mutable and shared by reference: a field write such as `p.x = …`
 *  inside a shader function changes the caller's array in place. A struct is a
 *  {@link CpuStruct}. This is the value type the functions of a {@link CpuModule} take
 *  and return, and the one its `setBinding` accepts.
 *
 *  Exported from `typeshade`.
 */
export type CpuValue = number | boolean | number[] | boolean[] | CpuStruct;
/** A struct value on the CPU: a plain object keyed by field name, holding one
 *  {@link CpuValue} per field. Calling a struct constructor in shader code
 *  (`MyStruct(a, b, …)`) produces one with its fields in declaration order; a struct-typed
 *  `var` starts as an empty object and gains fields as they are assigned. The type carries
 *  no struct identity of its own: the field set is whatever the declaring struct listed,
 *  and the caller checks it structurally.
 *
 *  Exported from `typeshade`.
 */
export interface CpuStruct {
  [k: string]: CpuValue;
}

export const FIELD_IDX: Record<string, number> = { x: 0, y: 1, z: 2, w: 3, r: 0, g: 1, b: 2, a: 3 };

export const isArr = Array.isArray;

export type ElemKind = NumKind | 'f64' | 'bool';

export const numKindOf = (t: ShaderType): NumKind => {
  if (t.kind === 'scalar') return t.scalar === 'i32' || t.scalar === 'u32' ? t.scalar : 'f32';
  if (t.kind === 'vec') return t.elem === 'i32' || t.elem === 'u32' ? t.elem : 'f32';
  if (t.kind === 'atomic') return t.elem;
  return 'f32';
};

export const wrapValue = (v: CpuValue, kind: NumKind): CpuValue =>
  kind === 'f32'
    ? v
    : isArr(v)
      ? (v as number[]).map((x) => wrapInt(x, kind))
      : wrapInt(v as number, kind);

export function applyBin(bop: BinOp, a: CpuValue, b: CpuValue, kind: NumKind = 'f32'): CpuValue {
  if (isArr(a) && isArr(b))
    return a.map((x, i) => scalarBin(bop, x as number, b[i] as number, kind));
  if (isArr(a)) return a.map((x) => scalarBin(bop, x as number, b as number, kind));
  if (isArr(b)) return b.map((y) => scalarBin(bop, a as number, y as number, kind));
  return scalarBin(bop, a as number, b as number, kind);
}

const clampNum = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

type Builtin = (...args: CpuValue[]) => CpuValue;
const map1 =
  (f: (x: number) => number): Builtin =>
  (x) =>
    isArr(x) ? x.map((v) => f(v as number)) : f(x as number);

const _bitcastView = new DataView(new ArrayBuffer(4));
const _f64View = new DataView(new ArrayBuffer(8));

const f32BitsAsU32 = (x: number): number => {
  _bitcastView.setFloat32(0, Math.fround(x), true);
  return _bitcastView.getUint32(0, true);
};
const u32BitsAsF32 = (x: number): number => {
  _bitcastView.setUint32(0, x >>> 0, true);
  return _bitcastView.getFloat32(0, true);
};

const f32ToF16Bits = (x: number): number => {
  _bitcastView.setFloat32(0, Math.fround(x), true);
  const bits = _bitcastView.getUint32(0, true);
  const sign = (bits >>> 16) & 0x8000;
  const exp = (bits >>> 23) & 0xff;
  const mant = bits & 0x7fffff;
  if (exp === 0xff) return sign | 0x7c00 | (mant !== 0 ? 0x200 : 0);
  const e = exp - 127 + 15;
  if (e >= 0x1f) return sign | 0x7c00;
  if (e <= 0) {
    if (e < -10) return sign;
    const m = mant | 0x800000;
    const shift = 14 - e;
    const half = m >>> shift;
    const rem = m & ((1 << shift) - 1);
    const halfway = 1 << (shift - 1);
    if (rem > halfway || (rem === halfway && (half & 1) !== 0)) return sign | (half + 1);
    return sign | half;
  }
  const half = sign | (e << 10) | (mant >>> 13);
  const rem = mant & 0x1fff;
  if (rem > 0x1000 || (rem === 0x1000 && (half & 1) !== 0)) return half + 1;
  return half;
};
const f16BitsToF32 = (h: number): number => {
  const sign = (h & 0x8000) << 16;
  const exp = (h >>> 10) & 0x1f;
  const mant = h & 0x3ff;
  let bits: number;
  if (exp === 0) {
    if (mant === 0) bits = sign;
    else {
      let e = 0;
      let m = mant;
      while ((m & 0x400) === 0) {
        m <<= 1;
        e++;
      }
      bits = sign | ((127 - 15 - e + 1) << 23) | ((m & 0x3ff) << 13);
    }
  } else if (exp === 0x1f) {
    bits = sign | 0x7f800000 | (mant << 13);
  } else {
    bits = sign | ((exp - 15 + 127) << 23) | (mant << 13);
  }
  _bitcastView.setUint32(0, bits >>> 0, true);
  return _bitcastView.getFloat32(0, true);
};

const quantizeF16 = (x: CpuValue): CpuValue =>
  isArr(x)
    ? (x as number[]).map((c) => f16BitsToF32(f32ToF16Bits(c)))
    : f16BitsToF32(f32ToF16Bits(x as number));

export const comparesAsF32 = (t: ShaderType): boolean =>
  (t.kind === 'scalar' && t.scalar === 'f32') || (t.kind === 'vec' && t.elem === 'f32');

function compareScalars(cop: CmpOp, a: number, b: number, f32: boolean): boolean {
  switch (cop) {
    case '<':
      return a < b;
    case '>':
      return a > b;
    case '<=':
      return a <= b;
    case '>=':
      return a >= b;
    case '==':
      return f32 ? Math.fround(a) === Math.fround(b) : a === b;
    case '!=':
      return f32 ? Math.fround(a) !== Math.fround(b) : a !== b;
  }
}

export function compareValues(cop: CmpOp, a: CpuValue, b: CpuValue, f32: boolean): CpuValue {
  if (isArr(a) && isArr(b)) {
    return a.map((v, i) => compareScalars(cop, v as number, b[i] as number, f32));
  }
  return compareScalars(cop, a as number, b as number, f32);
}

export function selectComponents(
  cond: readonly CpuValue[],
  ifTrue: CpuValue,
  ifFalse: CpuValue,
): CpuValue {
  const t = ifTrue as CpuValue[];
  const f = ifFalse as CpuValue[];
  return cond.map((c, i) => (c ? t[i]! : f[i]!)) as unknown as CpuValue;
}

const zip2 =
  (f: (a: number, b: number) => number): Builtin =>
  (a, b) => {
    const at = (v: CpuValue, i: number): number => (isArr(v) ? (v[i] as number) : (v as number));
    return isArr(a) ? (a as number[]).map((x, i) => f(x, at(b, i))) : f(a as number, at(b, 0));
  };
const dotOf = (a: CpuValue, b: CpuValue): number =>
  isArr(a)
    ? (a as number[]).reduce((s, v, i) => s + v * ((b as number[])[i] as number), 0)
    : (a as number) * (b as number);
const scale = (v: CpuValue, k: number): CpuValue =>
  isArr(v) ? (v as number[]).map((x) => x * k) : (v as number) * k;
const sub = zip2((a, b) => a - b);

export const TYPED_BIT_BUILTINS: ReadonlySet<string> = new Set([
  '~',
  'reverseBits',
  'firstLeadingBit',
  'firstTrailingBit',
  'extractBits',
  'insertBits',
]);
const asKind = (v: number, kind: 'u32' | 'i32'): number => (kind === 'i32' ? v | 0 : v >>> 0);
const bitOne = (fn: string, kind: 'u32' | 'i32', x: number, more: number[]): number => {
  const u = x >>> 0;
  switch (fn) {
    case '~':
      return asKind(~u, kind);
    case 'reverseBits': {
      let r = 0;
      for (let i = 0; i < 32; i++) r = ((r << 1) | ((u >>> i) & 1)) >>> 0;
      return asKind(r, kind);
    }
    case 'firstLeadingBit': {
      if (kind === 'i32') {
        const s = x | 0;
        if (s === 0 || s === -1) return -1;
        return 31 - Math.clz32(s < 0 ? ~s : s);
      }
      return u === 0 ? 0xffffffff : 31 - Math.clz32(u);
    }
    case 'firstTrailingBit': {
      if (u === 0) return kind === 'i32' ? -1 : 0xffffffff;
      return 31 - Math.clz32(u & -u);
    }
    case 'extractBits': {
      const o = Math.min(more[0]! >>> 0, 32);
      const c = Math.min(more[1]! >>> 0, 32 - o);
      if (c === 0) return 0;
      const shifted = u >>> o;
      const field = c === 32 ? shifted : shifted & ((2 ** c - 1) >>> 0);
      if (kind === 'i32' && c < 32 && (field >>> (c - 1)) & 1) return (field - 2 ** c) | 0;
      return asKind(field, kind);
    }
    case 'insertBits': {
      const nb = more[0]! >>> 0;
      const o = Math.min(more[1]! >>> 0, 32);
      const c = Math.min(more[2]! >>> 0, 32 - o);
      if (c === 0) return asKind(u, kind);
      const mask = c === 32 ? 0xffffffff : (((2 ** c - 1) >>> 0) << o) >>> 0;
      const r = (((nb << o) >>> 0) & mask) | (u & ~mask);
      return asKind(r >>> 0, kind);
    }
  }
  throw new Error(`typeshade/cpu: unknown bit builtin ${fn}`);
};
export function bitBuiltin(fn: string, args: readonly CpuValue[], kind: 'u32' | 'i32'): CpuValue {
  const x = args[0]!;
  const rest = args.slice(1);
  const at = (v: CpuValue, i: number): number => (isArr(v) ? (v[i] as number) : (v as number));
  if (isArr(x)) {
    return (x as number[]).map((v, i) =>
      bitOne(
        fn,
        kind,
        v,
        rest.map((r) => at(r, i)),
      ),
    );
  }
  return bitOne(
    fn,
    kind,
    x as number,
    rest.map((r) => at(r, 0)),
  );
}
function matDeterminant(m: number[]): number {
  const n = Math.round(Math.sqrt(m.length));
  if (n === 1) return m[0]!;
  if (n === 2) return m[0]! * m[3]! - m[2]! * m[1]!;
  let det = 0;
  for (let col = 0; col < n; col++) {
    const minor: number[] = [];
    for (let c = 0; c < n; c++) {
      if (c === col) continue;
      for (let r = 1; r < n; r++) minor.push(m[c * n + r]!);
    }
    det += (col % 2 === 0 ? 1 : -1) * m[col * n]! * matDeterminant(minor);
  }
  return det;
}

export interface Componentwise {
  readonly lane: (...xs: number[]) => number;
  readonly vector: number | 'any';
}

export const COMPONENTWISE = {
  sin: { lane: (x: number): number => LIBM.sinF64(x), vector: 0 },
  cos: { lane: (x: number): number => LIBM.cosF64(x), vector: 0 },
  tan: { lane: (x: number): number => LIBM.tanF64(x), vector: 0 },
  asin: { lane: (x: number): number => LIBM.asinF64(x), vector: 0 },
  acos: { lane: (x: number): number => LIBM.acosF64(x), vector: 0 },
  atan: { lane: (x: number): number => LIBM.atanF64(x), vector: 0 },
  sinh: { lane: (x: number): number => LIBM.sinhF64(x), vector: 0 },
  cosh: { lane: (x: number): number => LIBM.coshF64(x), vector: 0 },
  tanh: { lane: (x: number): number => LIBM.tanhF64(x), vector: 0 },
  asinh: { lane: (x: number): number => LIBM.asinhF64(x), vector: 0 },
  acosh: { lane: (x: number): number => LIBM.acoshF64(x), vector: 0 },
  atanh: { lane: (x: number): number => LIBM.atanhF64(x), vector: 0 },
  exp: { lane: (x: number): number => LIBM.expF64(x), vector: 0 },
  log: { lane: (x: number): number => LIBM.logF64(x), vector: 0 },
  log2: { lane: (x: number): number => LIBM.log2F64(x), vector: 0 },
  sqrt: { lane: Math.sqrt, vector: 0 },
  exp2: { lane: (x: number): number => LIBM.exp2F64(x), vector: 0 },
  inverseSqrt: { lane: (x: number): number => 1 / Math.sqrt(x), vector: 0 },
  trunc: { lane: Math.trunc, vector: 0 },
  round: { lane: roundTiesToEven, vector: 0 },
  floor: { lane: Math.floor, vector: 0 },
  ceil: { lane: Math.ceil, vector: 0 },
  abs: { lane: Math.abs, vector: 0 },
  sign: { lane: Math.sign, vector: 0 },
  radians: { lane: (d: number): number => (d * Math.PI) / 180, vector: 0 },
  degrees: { lane: (r: number): number => (r * 180) / Math.PI, vector: 0 },
  fract: { lane: EXACT_BUILTINS.fract, vector: 0 },
  saturate: { lane: EXACT_BUILTINS.saturate, vector: 0 },
  atan2: { lane: (y: number, x: number): number => LIBM.atan2F64(y, x), vector: 0 },
  mod: { lane: (a: number, b: number): number => a - b * Math.floor(a / b), vector: 0 },
  pow: { lane: (x: number, y: number): number => LIBM.powF64(x, y), vector: 0 },
  ldexp: { lane: (x: number, e: number): number => LIBM.ldexpF64(x, e), vector: 0 },
  fma: { lane: (x: number, y: number, z: number): number => Math.fround(x * y + z), vector: 0 },
  min: { lane: minNum, vector: 'any' },
  max: { lane: maxNum, vector: 'any' },
  clamp: { lane: EXACT_BUILTINS.clamp, vector: 0 },
  mix: { lane: (a: number, b: number, t: number): number => a + (b - a) * t, vector: 'any' },
  smoothstep: {
    lane: (a: number, b: number, v: number): number => {
      const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
      return t * t * (3 - 2 * t);
    },
    vector: 2,
  },
  step: { lane: EXACT_BUILTINS.step, vector: 1 },
} as const satisfies Readonly<Record<string, Componentwise>>;

const CW = COMPONENTWISE;

export const BUILTINS: Record<string, Builtin> = {
  reflect: (i, nrm) => sub(i, scale(nrm, 2 * dotOf(nrm, i))),
  refract: (i, nrm, eta) => {
    const e = eta as number;
    const d = dotOf(nrm, i);
    const k = 1 - e * e * (1 - d * d);
    if (k < 0) return isArr(i) ? (i as number[]).map(() => 0) : 0;
    return sub(scale(i, e), scale(nrm, e * d + Math.sqrt(k)));
  },
  faceForward: (nrm, i, nref) => (dotOf(nref, i) < 0 ? nrm : scale(nrm, -1)),
  determinant: (m) => matDeterminant(m as number[]),
  ldexp: zip2(CW.ldexp.lane),
  countOneBits: map1((x) => {
    let u = x >>> 0;
    let c = 0;
    while (u !== 0) {
      u &= u - 1;
      c++;
    }
    return c;
  }),
  countLeadingZeros: map1((x) => Math.clz32(x >>> 0)),
  countTrailingZeros: map1((x) => {
    const u = x >>> 0;
    return u === 0 ? 32 : 31 - Math.clz32(u & -u);
  }),
  '~': (x) => bitBuiltin('~', [x], 'u32'),
  reverseBits: (x) => bitBuiltin('reverseBits', [x], 'u32'),
  firstLeadingBit: (x) => bitBuiltin('firstLeadingBit', [x], 'u32'),
  firstTrailingBit: (x) => bitBuiltin('firstTrailingBit', [x], 'u32'),
  extractBits: (e, o, c) => bitBuiltin('extractBits', [e, o, c], 'u32'),
  insertBits: (e, nb, o, c) => bitBuiltin('insertBits', [e, nb, o, c], 'u32'),
  any: (v) => (v as boolean[]).some((x) => x === true),
  all: (v) => (v as boolean[]).every((x) => x === true),
  __fround: map1(Math.fround),
  sin: map1(CW.sin.lane),
  cos: map1(CW.cos.lane),
  tan: map1(CW.tan.lane),
  asin: map1(CW.asin.lane),
  acos: map1(CW.acos.lane),
  atan: map1(CW.atan.lane),
  sinh: map1(CW.sinh.lane),
  cosh: map1(CW.cosh.lane),
  tanh: map1(CW.tanh.lane),
  asinh: map1(CW.asinh.lane),
  acosh: map1(CW.acosh.lane),
  atanh: map1(CW.atanh.lane),
  exp: map1(CW.exp.lane),
  log: map1(CW.log.lane),
  log2: map1(CW.log2.lane),
  sqrt: map1(CW.sqrt.lane),
  exp2: map1(CW.exp2.lane),
  inverseSqrt: map1(CW.inverseSqrt.lane),
  trunc: map1(CW.trunc.lane),
  round: map1(CW.round.lane),
  floor: map1(CW.floor.lane),
  ceil: map1(CW.ceil.lane),
  abs: map1(CW.abs.lane),
  sign: map1(CW.sign.lane),
  radians: map1(CW.radians.lane),
  degrees: map1(CW.degrees.lane),
  atan2: (y, x) =>
    isArr(y)
      ? (y as number[]).map((v, i) =>
          CW.atan2.lane(v as number, isArr(x) ? ((x as number[])[i] as number) : (x as number)),
        )
      : CW.atan2.lane(y as number, x as number),
  mod: (x, y) => {
    const fm = CW.mod.lane;
    return isArr(x)
      ? (x as number[]).map((v, i) =>
          fm(v as number, isArr(y) ? ((y as number[])[i] as number) : (y as number)),
        )
      : fm(x as number, y as number);
  },
  min: (a, b) =>
    isArr(a) || isArr(b) ? applyMinMax(CW.min.lane, a, b) : CW.min.lane(a as number, b as number),
  max: (a, b) =>
    isArr(a) || isArr(b) ? applyMinMax(CW.max.lane, a, b) : CW.max.lane(a as number, b as number),
  clamp: (x, lo, hi) => clampVal(x, lo, hi),
  saturate: map1(CW.saturate.lane),
  mix: (a, b, t) => mixVal(a, b, t),
  smoothstep: (e0, e1, x) => {
    const ss = CW.smoothstep.lane;
    return isArr(x)
      ? (x as number[]).map((v, i) =>
          ss(
            isArr(e0) ? ((e0 as number[])[i] as number) : (e0 as number),
            isArr(e1) ? ((e1 as number[])[i] as number) : (e1 as number),
            v as number,
          ),
        )
      : ss(e0 as number, e1 as number, x as number);
  },
  step: (edge, x) => {
    const s = CW.step.lane;
    return isArr(x)
      ? (x as number[]).map((v, i) =>
          s(isArr(edge) ? (edge[i] as number) : (edge as number), v as number),
        )
      : s(edge as number, x as number);
  },
  length: (v) =>
    isArr(v)
      ? Math.sqrt((v as number[]).reduce((s, c) => s + (c as number) * (c as number), 0))
      : Math.abs(v as number),
  dot: (a, b) =>
    (a as number[]).reduce((s, c, i) => s + (c as number) * ((b as number[])[i] as number), 0),
  distance: (a, b) =>
    isArr(a)
      ? Math.sqrt(
          (a as number[]).reduce((s, c, i) => {
            const d = (c as number) - ((b as number[])[i] as number);
            return s + d * d;
          }, 0),
        )
      : Math.abs((a as number) - (b as number)),
  normalize: (v) => {
    const a = v as number[];
    const l = Math.sqrt(a.reduce((s, c) => s + (c as number) * (c as number), 0));
    return a.map((c) => (c as number) / l);
  },
  cross: (a, b) => {
    const u = a as number[],
      w = b as number[];
    return [
      u[1]! * w[2]! - u[2]! * w[1]!,
      u[2]! * w[0]! - u[0]! * w[2]!,
      u[0]! * w[1]! - u[1]! * w[0]!,
    ];
  },
  transpose: (m) => matTranspose(m as number[]),
  f32: (x) => Number(x),
  f64: (x) => Number(x),
  f64Guard: () => 1,
  f64FromParts: (hi, lo) => (hi as number) + (lo as number),
  f64Parts: (x) => {
    const hi = Math.fround(x as number);
    return [hi, Math.fround((x as number) - hi)];
  },
  i32: (x) => Math.trunc(x as number) | 0,
  u32: (x) => Math.trunc(x as number) >>> 0,
  pow: (a, b) =>
    isArr(a)
      ? (a as number[]).map((x, i) =>
          CW.pow.lane(x as number, isArr(b) ? ((b as number[])[i] as number) : (b as number)),
        )
      : CW.pow.lane(a as number, b as number),
  fract: map1(CW.fract.lane),
  fma: (a, b, c) => {
    const f = CW.fma.lane;
    const at = (v: CpuValue, i: number): number => (isArr(v) ? (v[i] as number) : (v as number));
    return isArr(a)
      ? (a as number[]).map((x, i) => f(x as number, at(b, i), at(c, i)))
      : f(a as number, b as number, c as number);
  },
  unpack4x8unorm: (u) => {
    const n = (u as number) >>> 0;
    return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff].map((b) => b / 255);
  },
  workgroupUniformLoad: (x) => x,
  unpack4xU8: (e) => {
    const n = (e as number) >>> 0;
    return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
  },
  unpack4xI8: (e) => {
    const n = (e as number) >>> 0;
    return [0, 8, 16, 24].map((sh) => (((n >>> sh) & 0xff) << 24) >> 24);
  },
  pack4xU8: (v) => (v as number[]).reduce((acc, x, i) => acc | ((x & 0xff) << (8 * i)), 0) >>> 0,
  pack4xI8: (v) => (v as number[]).reduce((acc, x, i) => acc | ((x & 0xff) << (8 * i)), 0) >>> 0,
  pack4xU8Clamp: (v) =>
    (v as number[]).reduce((acc, x, i) => acc | (clampNum(x, 0, 255) << (8 * i)), 0) >>> 0,
  pack4xI8Clamp: (v) =>
    (v as number[]).reduce((acc, x, i) => acc | ((clampNum(x, -128, 127) & 0xff) << (8 * i)), 0) >>>
    0,
  dot4U8Packed: (a, b) => {
    const x = (a as number) >>> 0;
    const y = (b as number) >>> 0;
    let acc = 0;
    for (const sh of [0, 8, 16, 24]) acc = (acc + ((x >>> sh) & 0xff) * ((y >>> sh) & 0xff)) >>> 0;
    return acc >>> 0;
  },
  dot4I8Packed: (a, b) => {
    const x = (a as number) >>> 0;
    const y = (b as number) >>> 0;
    let acc = 0;
    for (const sh of [0, 8, 16, 24]) {
      const p = Math.imul((((x >>> sh) & 0xff) << 24) >> 24, (((y >>> sh) & 0xff) << 24) >> 24);
      acc = (acc + p) | 0;
    }
    return acc | 0;
  },
  subgroupAdd: (x) => x,
  subgroupMul: (x) => x,
  subgroupMin: (x) => x,
  subgroupMax: (x) => x,
  subgroupAnd: (x) => x,
  subgroupOr: (x) => x,
  subgroupXor: (x) => x,
  subgroupInclusiveAdd: (x) => x,
  subgroupInclusiveMul: (x) => x,
  subgroupExclusiveAdd: (x) => (isArr(x) ? (x as number[]).map(() => 0) : 0),
  subgroupExclusiveMul: (x) => (isArr(x) ? (x as number[]).map(() => 1) : 1),
  subgroupAll: (p) => p,
  subgroupAny: (p) => p,
  subgroupBallot: (p) => [p ? 1 : 0, 0, 0, 0],
  subgroupElect: () => true,
  subgroupBroadcast: (x) => x,
  subgroupBroadcastFirst: (x) => x,
  subgroupShuffle: (x) => x,
  subgroupShuffleDown: (x) => x,
  subgroupShuffleUp: (x) => x,
  subgroupShuffleXor: (x) => x,
  absU: (x) => x,
  dotI: (a, b) => {
    const xs = a as number[];
    const ys = b as number[];
    return xs.reduce((acc, v, i) => (acc + Math.imul(v, ys[i] as number)) | 0, 0);
  },
  dotU: (a, b) => {
    const xs = a as number[];
    const ys = b as number[];
    return xs.reduce((acc, v, i) => (acc + Math.imul(v, ys[i] as number)) >>> 0, 0) >>> 0;
  },
  bitcastVec2U32: map1(f32BitsAsU32),
  bitcastVec3U32: map1(f32BitsAsU32),
  bitcastVec4U32: map1(f32BitsAsU32),
  bitcastVec2F32: map1(u32BitsAsF32),
  bitcastVec3F32: map1(u32BitsAsF32),
  bitcastVec4F32: map1(u32BitsAsF32),
  bitcastU32: (x) => {
    _bitcastView.setFloat32(0, Math.fround(x as number), true);
    return _bitcastView.getUint32(0, true);
  },
  bitcastF32: (x) => {
    _bitcastView.setUint32(0, (x as number) >>> 0, true);
    return _bitcastView.getFloat32(0, true);
  },
  __f64Hi: (x) => {
    _f64View.setFloat64(0, x as number, true);
    return _f64View.getUint32(4, true);
  },
  __f64Lo: (x) => {
    _f64View.setFloat64(0, x as number, true);
    return _f64View.getUint32(0, true);
  },
  __f64FromWords: (hi, lo) => {
    _f64View.setUint32(4, (hi as number) >>> 0, true);
    _f64View.setUint32(0, (lo as number) >>> 0, true);
    return _f64View.getFloat64(0, true);
  },
  __f64ToI32: (x) => {
    const v = x as number;
    return Number.isNaN(v) ? 0 : Math.min(2147483647, Math.max(-2147483648, Math.trunc(v)));
  },
  arrayLength: (xs) => (xs as readonly CpuValue[]).length,
  push: (xs, v) => pushOnto(xs as CpuValue[], v),
  ...PUSHED_BUILTINS,
  collectionAdd: (s, k) => {
    (s as unknown as Set<number>).add(k as number);
    return undefined as unknown as CpuValue;
  },
  collectionSet: (m, k, v) => {
    (m as unknown as Map<number, CpuValue>).set(k as number, cloneValue(v));
    return undefined as unknown as CpuValue;
  },
  collectionHas: (c, k) => (c as unknown as Set<number>).has(k as number),
  collectionGet: (m, k) => cloneValue((m as unknown as Map<number, CpuValue>).get(k as number)!),
  collectionSize: (c) => (c as unknown as Set<number>).size,
  pack4x8unorm: (v) => {
    const a = v as number[];
    const q = (x: number): number =>
      Math.round(Math.fround(Math.max(0, Math.min(1, x)) * 255)) & 0xff;
    return (q(a[0]) | (q(a[1]) << 8) | (q(a[2]) << 16) | (q(a[3]) << 24)) >>> 0;
  },
  pack4x8snorm: (v) => {
    const a = v as number[];
    const q = (x: number): number => Math.round(Math.fround(maxNum(-1, minNum(1, x)) * 127)) & 0xff;
    return (q(a[0]) | (q(a[1]) << 8) | (q(a[2]) << 16) | (q(a[3]) << 24)) >>> 0;
  },
  unpack4x8snorm: (u) => {
    const n = (u as number) >>> 0;
    return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff].map((b) =>
      Math.max(((b << 24) >> 24) / 127, -1),
    );
  },
  quantizeToF16: quantizeF16,
  quantizeToF16Vec2: quantizeF16,
  quantizeToF16Vec3: quantizeF16,
  quantizeToF16Vec4: quantizeF16,
  pack2x16float: (v) => {
    const a = v as number[];
    return (f32ToF16Bits(a[0] as number) | (f32ToF16Bits(a[1] as number) << 16)) >>> 0;
  },
  unpack2x16float: (u) => {
    const n = (u as number) >>> 0;
    return [f16BitsToF32(n & 0xffff), f16BitsToF32(n >>> 16)];
  },
  pack2x16unorm: (v) => {
    const a = v as number[];
    const q = (x: number): number =>
      Math.round(Math.fround(Math.max(0, Math.min(1, x)) * 65535)) & 0xffff;
    return (q(a[0] as number) | (q(a[1] as number) << 16)) >>> 0;
  },
  unpack2x16unorm: (u) => {
    const n = (u as number) >>> 0;
    return [(n & 0xffff) / 65535, (n >>> 16) / 65535];
  },
  pack2x16snorm: (v) => {
    const a = v as number[];
    const q = (x: number): number =>
      Math.round(Math.fround(Math.max(-1, Math.min(1, x)) * 32767)) & 0xffff;
    return (q(a[0] as number) | (q(a[1] as number) << 16)) >>> 0;
  },
  unpack2x16snorm: (u) => {
    const n = (u as number) >>> 0;
    const s = (bits: number): number => Math.max(((bits << 16) >> 16) / 32767, -1);
    return [s(n & 0xffff), s(n >>> 16)];
  },
};

export const LIBM: Libm = makeLibm({ B: BUILTINS, L: COMPONENTWISE, intDiv, intRem });

export const GPU_STUBS: Record<string, Builtin> = {
  textureSample: () => [0, 0, 0, 1],
  textureSampleLevel: () => [0, 0, 0, 1],
  fwidth: (x) => zeroLike(x),
  dpdx: (x) => zeroLike(x),
  dpdy: (x) => zeroLike(x),
  fwidthCoarse: (x) => zeroLike(x),
  fwidthFine: (x) => zeroLike(x),
  dpdxCoarse: (x) => zeroLike(x),
  dpdxFine: (x) => zeroLike(x),
  dpdyCoarse: (x) => zeroLike(x),
  dpdyFine: (x) => zeroLike(x),
  textureLoad: () => [0, 0, 0, 1],
  textureLoadU: () => [0, 0, 0, 1],
  textureLoad3dU: () => [0, 0, 0, 1],
  textureLoadArrayU: () => [0, 0, 0, 1],
  textureNumLayersStorage: () => 1,
  textureSampleArray: () => [0, 0, 0, 1],
  textureSampleLevelArray: () => [0, 0, 0, 1],
  textureLoadArray: () => [0, 0, 0, 1],
  textureSampleBias: () => [0, 0, 0, 1],
  textureSampleBiasArray: () => [0, 0, 0, 1],
  textureSampleGrad: () => [0, 0, 0, 1],
  textureSampleGradArray: () => [0, 0, 0, 1],
  textureSampleCubeArray: () => [0, 0, 0, 1],
  textureSampleLevelCubeArray: () => [0, 0, 0, 1],
  textureSampleBiasCubeArray: () => [0, 0, 0, 1],
  textureSampleGradCubeArray: () => [0, 0, 0, 1],
  textureGather: () => [0, 0, 0, 1],
  textureGatherArray: () => [0, 0, 0, 1],
  textureGatherDepth: () => [1, 1, 1, 1],
  textureGatherDepthArray: () => [1, 1, 1, 1],
  textureSampleCompare: () => 1,
  textureSampleCompareArray: () => 1,
  textureSampleCompareLevel: () => 1,
  textureSampleCompareLevelArray: () => 1,
  textureSampleCompareCube: () => 1,
  textureSampleCompareLevelCube: () => 1,
  textureSampleCompareCubeArray: () => 1,
  textureSampleCompareLevelCubeArray: () => 1,
  textureGatherCompare: () => [1, 1, 1, 1],
  textureGatherCompareArray: () => [1, 1, 1, 1],
  textureDimensions: () => [1, 1], // 1×1, not 0×0 — a divide-by-dimensions stays finite
  textureDimensions3d: () => [1, 1, 1], // the 3d twin: 1×1×1, for the same reason
  textureDimensions1d: () => 1, // the 1d twin: one texel wide
  textureLoadMs: () => [0, 0, 0, 1],
  textureLoadDepthMs: () => 1,
  textureDimensionsMs: () => [1, 1],
  textureNumSamples: () => 1,
  textureNumLayers: () => 1, // 1 layer, not 0 — a modulo/divide by the count stays finite
  textureStore: () => 0,
};

export function isAggregateType(t: ShaderType): boolean {
  return (
    t.kind === 'vec' ||
    t.kind === 'vec64' ||
    t.kind === 'mat' ||
    t.kind === 'array' ||
    t.kind === 'struct'
  );
}

export function cloneValue(v: CpuValue): CpuValue {
  if (Array.isArray(v)) return v.map(cloneValue) as CpuValue;
  if (typeof v === 'object' && v !== null) {
    const out: Record<string, CpuValue> = {};
    for (const [k, x] of Object.entries(v as Record<string, CpuValue>)) out[k] = cloneValue(x);
    return out as CpuValue;
  }
  return v;
}

export function copiedParams(
  params: readonly { readonly type: ShaderType; readonly mode?: 'inout' }[],
  writesAnything: boolean,
): readonly boolean[] {
  return params.map((p) => writesAnything && p.mode !== 'inout' && isAggregateType(p.type));
}

export const inoutReturn: { values: readonly CpuValue[] } = { values: [] };

export const f32ToU32Sat = (v: number): number =>
  Number.isNaN(v) ? 0 : Math.min(4294967040, Math.max(0, Math.trunc(v)));
export const f32ToI32Sat = (v: number): number =>
  Number.isNaN(v) ? 0 : Math.min(2147483520, Math.max(-2147483648, Math.trunc(v)));

const zeroLike = (v: CpuValue): CpuValue => (isArr(v) ? (v as number[]).map(() => 0) : 0);

export const convertComponent = (v: number, from: ElemKind, to: ElemKind): number => {
  if (from === to) return v;
  if (to === 'u32') return from === 'f32' || from === 'f64' ? f32ToU32Sat(v) : v >>> 0;
  if (to === 'i32') return from === 'f32' || from === 'f64' ? f32ToI32Sat(v) : v | 0;
  return Number(v);
};

export const convertComponents = (v: number[], from: ElemKind, to: ElemKind): number[] =>
  from === to ? v : v.map((c) => convertComponent(c, from, to));

export function elemKindOf(t: ShaderType): ElemKind | undefined {
  if (t.kind === 'vec') return t.elem;
  if (t.kind === 'scalar') return t.scalar;
  if (t.kind === 'f64') return 'f64';
  return undefined;
}

/** The names of every builtin function the CPU backends ({@link compileModule},
 *  {@link compileModuleJs}) evaluate with real arithmetic, as a read-only set. Meant for
 *  tests: the union of this set and {@link ORACLE_GPU_STUB_NAMES} should cover every
 *  intrinsic in {@link INTRINSICS} and {@link PORTABLE_INTRINSICS}, so a test can assert
 *  that each intrinsic a shader can emit for WGSL or GLSL also has a CPU implementation
 *  or a documented placeholder.
 *
 *  Exported from `typeshade`.
 */
export const ORACLE_BUILTIN_NAMES: ReadonlySet<string> = new Set(Object.keys(BUILTINS));
/** The names of every GPU-only intrinsic the CPU backends cannot genuinely evaluate, as a
 *  read-only set: `textureSample`, `textureSampleLevel`, `textureSampleBias`,
 *  `textureSampleGrad`, `textureLoad`, their 2d-array forms (`textureSampleArray`,
 *  `textureSampleLevelArray`, `textureSampleBiasArray`, `textureSampleGradArray`,
 *  `textureLoadArray`), the depth comparisons, `textureDimensions` (and its 3d twin),
 *  `textureNumLayers`, and the derivatives `fwidth`, `dpdx` and
 *  `dpdy`. A texture read needs the GPU's sampler and texture memory, and a derivative
 *  needs neighbouring fragments; a CPU run of a single invocation has neither. Calling
 *  one of these from a module compiled with {@link compileModule} or
 *  {@link compileModuleJs} throws, unless the module was compiled with
 *  `{ gpuStubs: true }`; then it returns a placeholder: `[0, 0, 0, 1]` for a texture
 *  read, `[1, 1]` for `textureDimensions`, `1` for `textureNumLayers` and `0` for a
 *  derivative. Meant for tests: the union of this set and {@link ORACLE_BUILTIN_NAMES}
 *  should cover every intrinsic in {@link INTRINSICS} and {@link PORTABLE_INTRINSICS},
 *  so a test can assert that each intrinsic a shader can emit has either a CPU
 *  implementation or a documented placeholder.
 *
 *  Exported from `typeshade`.
 */
export const ORACLE_GPU_STUB_NAMES: ReadonlySet<string> = new Set(Object.keys(GPU_STUBS));

function applyMinMax(f: (a: number, b: number) => number, a: CpuValue, b: CpuValue): number[] {
  if (isArr(a) && isArr(b)) return a.map((x, i) => f(x as number, b[i] as number));
  if (isArr(a)) return a.map((x) => f(x as number, b as number));
  return (b as number[]).map((y) => f(a as number, y as number));
}
function clampVal(x: CpuValue, lo: CpuValue, hi: CpuValue): CpuValue {
  const c = CW.clamp.lane;
  if (isArr(x)) {
    const loA = isArr(lo) ? (lo as number[]) : null;
    const hiA = isArr(hi) ? (hi as number[]) : null;
    return (x as number[]).map((v, i) =>
      c(
        v as number,
        loA ? (loA[i] as number) : (lo as number),
        hiA ? (hiA[i] as number) : (hi as number),
      ),
    );
  }
  return c(x as number, lo as number, hi as number);
}
function mixVal(a: CpuValue, b: CpuValue, t: CpuValue): CpuValue {
  const m = CW.mix.lane;
  if (isArr(a) || isArr(b) || isArr(t)) {
    const n = (isArr(a) ? a : isArr(b) ? b : (t as number[])).length;
    const at = (v: CpuValue, i: number): number => (isArr(v) ? (v[i] as number) : (v as number));
    return Array.from({ length: n }, (_, i) => m(at(a, i), at(b, i), at(t, i)));
  }
  return m(a as number, b as number, t as number);
}

export function zeroOf(
  type: ShaderType,
  structs?: ReadonlyMap<string, StructDecl>,
  overrides?: ReadonlyMap<string, CpuValue>,
): CpuValue {
  if (type.kind === 'vec') return new Array(type.n).fill(type.elem === 'bool' ? false : 0);
  if (type.kind === 'vec64') return new Array(type.n).fill(0);
  if (type.kind === 'mat') return new Array(type.cols * type.rows).fill(0);
  if (type.kind === 'struct') {
    const decl = structs?.get(type.name);
    if (decl === undefined) return {};
    const obj: Record<string, CpuValue> = {};
    for (const f of decl.fields) obj[f.name] = zeroOf(f.type, structs, overrides);
    return obj as CpuValue;
  }
  if (type.kind === 'array') {
    const overrideSize =
      type.sizeOverride === undefined ? undefined : overrides?.get(type.sizeOverride);
    const n = overrideSize ?? type.size ?? 0;
    if (
      typeof n !== 'number' ||
      !Number.isInteger(n) ||
      (type.sizeOverride !== undefined ? n < 1 : n < 0)
    ) {
      throw new RangeError(
        `typeshade/cpu: array-size override '${type.sizeOverride}' must be a positive integer; got ${String(n)}`,
      );
    }
    return Array.from({ length: n }, () => zeroOf(type.elem, structs, overrides)) as CpuValue;
  }
  if (type.kind === 'scalar' && type.scalar === 'bool') return false;
  return 0;
}

export function matVecShaped(m: number[], v: number[], cols: number, rows: number): number[] {
  const out = new Array<number>(rows).fill(0);
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) out[r]! += m[c * rows + r]! * v[c]!;
  return out;
}

export function vecMatShaped(v: number[], m: number[], cols: number, rows: number): number[] {
  const out = new Array<number>(cols).fill(0);
  for (let c = 0; c < cols; c++) {
    let s = 0;
    for (let r = 0; r < rows; r++) s += m[c * rows + r]! * v[r]!;
    out[c] = s;
  }
  return out;
}

export function matMulShaped(
  a: number[],
  b: number[],
  aCols: number,
  aRows: number,
  bCols: number,
): number[] {
  const out = new Array<number>(bCols * aRows).fill(0);
  for (let col = 0; col < bCols; col++)
    for (let row = 0; row < aRows; row++) {
      let s = 0;
      for (let k = 0; k < aCols; k++) s += a[k * aRows + row]! * b[col * aCols + k]!;
      out[col * aRows + row] = s;
    }
  return out;
}

export function matVec(m: number[], v: number[]): number[] {
  const n = v.length;
  return matVecShaped(m, v, n, n);
}

export function matMul(a: number[], b: number[]): number[] {
  const n = Math.round(Math.sqrt(a.length));
  return matMulShaped(a, b, n, n, n);
}

export function matColumn(m: number[], j: number, rows: number): number[] {
  return m.slice(j * rows, j * rows + rows);
}

export function setMatColumn(m: number[], j: number, rows: number, v: readonly number[]): void {
  for (let r = 0; r < rows; r++) m[j * rows + r] = v[r]!;
}

export function matTransposeShaped(m: number[], cols: number, rows: number): number[] {
  const out = new Array<number>(cols * rows).fill(0);
  for (let c = 0; c < cols; c++)
    for (let r = 0; r < rows; r++) out[r * cols + c] = m[c * rows + r]!;
  return out;
}

function matTranspose(m: number[]): number[] {
  const n = Math.round(Math.sqrt(m.length));
  return matTransposeShaped(m, n, n);
}
