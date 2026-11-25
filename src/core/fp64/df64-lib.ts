// Why: the guarded EFT formulation is luma.gl's (via DSFUN90, the CUDA SDK dsadd/dsmul and
// Thall's twoSum / quickTwoSum / Veltkamp split / twoProd). WGSL §15.7.5 permits reassociation
// and fusion, Metal defaults to fast-math, and ANGLE's D3D compiler reassociates, and neither
// WGSL nor GLSL ES 3.00 has a `precise` qualifier. Each error term of twoSum, quickTwoSum and the
// Veltkamp split carries one guard factor, a runtime-opaque 1.0 (the `f64Guard` texel fetch).
// It is a texture and not a uniform because drivers specialize pipelines on observed uniform
// values and hot-swap re-optimized variants (seen on Windows/NVIDIA); none folds a texel.

// Why: the ~48 bits rest on f32 `+ - *` rounding to nearest, ties to even. GLSL ES 3.00 §4.5.1
// leaves the rounding mode undefined and lets any operation flush a subnormal, and WGSL fixes
// no rounding mode, so the claim rests on hardware practice, not on either spec. A flushed
// subnormal costs the low word of a result below about 2^-102.

// Why: twoProd is split-based, not FMA-based, because WGSL fma() accuracy is "inherited from
// x*y+z" and fusion is not guaranteed.

// Why: the emit optimizer keeps calls to these helpers opaque through `opaque: true`, which
// fp64-lower stamps, and not through a name test: `mangle` renames this library on purpose, so
// a name test held or not depending on plugin order (X-GIS #1926).

import {
  fn,
  Let,
  Var,
  vec2,
  sqrt,
  floor,
  abs,
  member,
  construct,
  structT,
  f32T,
  vec2fT,
  vec3fT,
  vec4fT,
  vec2bT,
  vec3bT,
  vec4bT,
  texture2dfT,
  f64GuardOne,
  type Node,
  type ReadonlyNode,
  type StructDecl,
  type BindingDecl,
  type FuncDecl,
  type ShaderType,
} from '../ir/index.js';

/** Split a JavaScript double into the high and low f32 pair an {@link f64T} value carries on
 *  the GPU. `hi` is `Math.fround(x)` and `lo` is `Math.fround(x - hi)`, so `hi + lo`
 *  reconstructs `x` to about 48 significand bits.
 *
 *  This is the host side of the packing. An f64 uniform field or vertex attribute occupies one
 *  plain `vec2<f32>` slot, size 8 and align 8, and the host writes `splitF64(value)` into it.
 *
 *  A vertex attribute cannot be a `vecN<f64>`. Pass a vector as two `vecN<f32>` locations, one
 *  carrying every high part and one every low part, and rebuild the components in the shader
 *  with {@link f64FromParts}.
 *
 *  Exported from `typeshade`.
 *
 *  @param x - the double to pack.
 *  @returns the `[hi, lo]` pair, both exactly representable as f32.
 *
 *  @example
 *  ```ts
 *  import { splitF64 } from 'typeshade'
 *
 *  const [hi, lo] = splitF64(originLon)
 *  uniformData.set([hi, lo], offsetOfOrigin / 4)
 *  ```
 *
 *  @see {@link f64T} for the type this packs for.
 */
export function splitF64(x: number): [hi: number, lo: number] {
  const hi = Math.fround(x);
  const lo = Math.fround(x - hi);
  return [hi, lo];
}

/** The fixed name (`'_fp64'`) of the guard texture binding that {@link fp64Lower} adds to
 *  every module whose lowered code calls a guarded df64 helper. A module whose only f64 work is
 *  comparisons, widening and narrowing, negation, or scaling by a power-of-two literal calls
 *  none, and gets no binding. The binding is a 1×1 `texture_2d<f32>` whose
 *  single texel reads exactly 1.0; the emulated arithmetic multiplies its error terms by
 *  that texel so a fast-math compiler cannot fold them away. See {@link fp64Guard} for
 *  why it is a texture.
 *
 *  Use this constant to recognise the binding without hardcoding the string: check
 *  whether a module already declares it (`bindings.find(b => b.name === FP64_GUARD_NAME)`),
 *  or pick the matching binding out of {@link reflect} to know which resource the host must
 *  supply the 1×1 texture for.
 *
 *  Exported from `typeshade`.
 */
export const FP64_GUARD_NAME = '_fp64';
export const FP64_GUARD_TYPE: ShaderType = texture2dfT;

/** The value {@link fp64Guard} returns: a binding declaration for the `_fp64` guard
 *  texture, pinned to the caller's chosen `(group, binding)`. Pass it inside a
 *  module's `uses: [...]` only when the host's bind-group layout is fixed and needs
 *  the guard at a specific slot. Leaving it out is the common case: {@link fp64Lower}
 *  adds the binding at group 0, in the first free slot, to any module whose lowered code
 *  calls a guarded df64 helper. A module that pins a slot here but also declares a
 *  conflicting `_fp64` binding elsewhere (a different type or space) fails emit with `SD0042`.
 *
 *  Exported from `typeshade`.
 */
export interface Fp64GuardHandle {
  /** The binding's shader type: a 2D `f32` texture. */
  readonly type: ShaderType;
  /** The binding declaration, ready for a module's `uses: [...]`. */
  readonly binding: BindingDecl;
}

/** Pin the slot of the fp64 guard texture. Most modules never call this: the guard is
 *  injected for you, and this exists for a fixed bind-group layout that needs it at a chosen
 *  `(group, binding)`.
 *
 *  Every module whose lowered code calls a guarded df64 helper gets a `texture_2d<f32>` binding
 *  named `_fp64` added by {@link fp64Lower}, deterministically at group 0 in the first free
 *  binding. A module whose only f64 work is comparisons, widening and narrowing, negation, or
 *  scaling by a power-of-two literal calls none and gets no binding; a host that binds `_fp64`
 *  unconditionally should look for it in `reflect()` first. The
 *  host must bind a 1 by 1 texture whose single texel reads back exactly 1.0, an RGBA8 white
 *  texel or an R32F 1.0, and the shader multiplies the error-compensation terms by that texel.
 *
 *  It is a texture for a reason. WGSL permits reassociation, and Metal
 *  defaults to fast math, so without a value the compiler cannot see through, a downstream
 *  compiler can legally fold the emulation's terms back to f32 precision. A uniform is not
 *  enough either: some drivers specialize pipelines on observed uniform values and hot-swap a
 *  re-optimized variant that folds the terms anyway. No compiler treats a texel as a
 *  compile-time constant.
 *
 *  Either way the binding appears in {@link reflect} as an ordinary 2D texture, so a host
 *  building its bind group from the reflection creates it without special-casing.
 *
 *  The names around it are reserved. A module declaring its own `_fp64` binding with a
 *  different type or space fails emit with `SD0042`, and a declaration whose name starts with
 *  `df64_` or is one of the emitted `DF64Vec2`, `DF64Vec3`, `DF64Vec4` structs collides with
 *  the emulation and fails with `SD0043`.
 *
 *  Exported from `typeshade`.
 *
 *  @param at - the `group` and `binding` to pin the guard texture to.
 *  @returns the {@link Fp64GuardHandle}: `.binding` for `module({ uses })`, and `.type`.
 *
 *  @example
 *  ```ts
 *  import { fp64Guard } from 'typeshade'
 *  import { module } from 'typeshade/core/ir'
 *
 *  // Only needed when the host's bind-group layout fixes the slot.
 *  const m = module({ uses: [U, fp64Guard({ group: 0, binding: 3 })], funcs: [k] })
 *  ```
 *
 *  @see {@link f64T} for what needs the guard.
 *  @see {@link FP64_GUARD_NAME} for recognising the binding by name.
 */
export function fp64Guard(at: { group: number; binding: number }): Fp64GuardHandle {
  return {
    type: FP64_GUARD_TYPE,
    binding: {
      group: at.group,
      binding: at.binding,
      name: FP64_GUARD_NAME,
      space: 'uniform',
      type: FP64_GUARD_TYPE,
      precision: 'highp',
    },
  };
}

const one = f64GuardOne() as ReadonlyNode<'f32'>;

const df64_twoSum = fn('df64_twoSum', { a: f32T, b: f32T }, (p) => {
  const s = Let(p.a.add(p.b));
  const v = Let(s.mul(one).sub(p.a).mul(one));
  const e = Let(p.a.sub(s.sub(v).mul(one)).mul(one).add(p.b.sub(v)));
  return vec2(s, e);
});

const df64_quickTwoSum = fn('df64_quickTwoSum', { a: f32T, b: f32T }, (p) => {
  const s = Let(p.a.add(p.b).mul(one));
  const e = Let(p.b.sub(s.sub(p.a).mul(one)));
  return vec2(s, e);
});

const df64_split = fn('df64_split', { a: f32T }, (p) => {
  const t = Let(p.a.mul(one.mul(4097.0)));
  const hi = Let(t.mul(one).sub(t.sub(p.a)));
  const lo = Let(p.a.mul(one).sub(hi));
  return vec2(hi, lo);
});

const df64_twoProd = fn('df64_twoProd', { a: f32T, b: f32T }, (p) => {
  const prod = Let(p.a.mul(p.b));
  const aS = Let(df64_split({ a: p.a }));
  const bS = Let(df64_split({ a: p.b }));
  const e = Let(
    aS.x.mul(bS.x).sub(prod).add(aS.x.mul(bS.y)).add(aS.y.mul(bS.x)).add(aS.y.mul(bS.y)),
  );
  return vec2(prod, e);
});

const df64_twoSqr = fn('df64_twoSqr', { a: f32T }, (p) => {
  const prod = Let(p.a.mul(p.a));
  const aS = Let(df64_split({ a: p.a }));
  const e = Let(
    aS.x
      .mul(aS.x)
      .sub(prod)
      .mul(one)
      .add(aS.x.mul(aS.y).mul(2.0).mul(one))
      .add(aS.y.mul(aS.y).mul(one)),
  );
  return vec2(prod, e);
});

const df64_add = fn('df64_add', { a: vec2fT, b: vec2fT }, (p) => {
  const s = Var(df64_twoSum({ a: p.a.x, b: p.b.x }));
  const t = Let(df64_twoSum({ a: p.a.y, b: p.b.y }));
  s.y.assign(s.y.add(t.x));
  s.assign(df64_quickTwoSum({ a: s.x, b: s.y }));
  s.y.assign(s.y.add(t.y));
  s.assign(df64_quickTwoSum({ a: s.x, b: s.y }));
  return s;
});

const df64_sub = fn('df64_sub', { a: vec2fT, b: vec2fT }, (p) =>
  df64_add({ a: p.a, b: p.b.neg() }),
);

const df64_mul = fn('df64_mul', { a: vec2fT, b: vec2fT }, (p) => {
  const prod = Var(df64_twoProd({ a: p.a.x, b: p.b.x }));
  prod.y.assign(prod.y.add(p.a.x.mul(p.b.y)));
  prod.assign(df64_quickTwoSum({ a: prod.x, b: prod.y }));
  prod.y.assign(prod.y.add(p.a.y.mul(p.b.x)));
  return df64_quickTwoSum({ a: prod.x, b: prod.y });
});

const df64_sqr = fn('df64_sqr', { a: vec2fT }, (p) => {
  const prod = Var(df64_twoSqr({ a: p.a.x }));
  prod.y.assign(prod.y.add(p.a.x.mul(p.a.y).mul(2.0)));
  return df64_quickTwoSum({ a: prod.x, b: prod.y });
});

const df64_div = fn('df64_div', { a: vec2fT, b: vec2fT }, (p) => {
  const xn = Let(one.div(p.b.x));
  const yn = Let(p.a.mul(xn));
  const diff = Let(df64_sub({ a: p.a, b: df64_mul({ a: p.b, b: yn }) }).x);
  const prod = Let(df64_twoProd({ a: xn, b: diff }));
  return df64_add({ a: yn, b: prod });
});

const df64_sqrt = fn(
  'df64_sqrt',
  { a: vec2fT },
  (p) => {
    const x = Let(one.div(sqrt(p.a.x)));
    const yn = Let(p.a.x.mul(x));
    const ynSqr = Let(df64_twoSqr({ a: yn }).mul(one));
    const diff = Let(df64_sub({ a: p.a, b: ynSqr }).x);
    const prod = Let(df64_twoProd({ a: x.mul(0.5), b: diff }));
    const res = Let(df64_add({ a: vec2(yn, 0.0), b: prod }));
    return p.a.x.eq(0.0).select(vec2(0.0, 0.0), res);
  },
  { lintDisable: ['no-float-eq'] }, // exact ==0 zero-guard, not a tolerance bug
);

const df64_lt = fn(
  'df64_lt',
  { a: vec2fT, b: vec2fT },
  (p) => p.a.x.lt(p.b.x).or(p.a.x.eq(p.b.x).and(p.a.y.lt(p.b.y))),
  { lintDisable: ['no-float-eq'] },
);
const df64_gt = fn(
  'df64_gt',
  { a: vec2fT, b: vec2fT },
  (p) => p.a.x.gt(p.b.x).or(p.a.x.eq(p.b.x).and(p.a.y.gt(p.b.y))),
  { lintDisable: ['no-float-eq'] },
);
const df64_le = fn(
  'df64_le',
  { a: vec2fT, b: vec2fT },
  (p) => p.a.x.lt(p.b.x).or(p.a.x.eq(p.b.x).and(p.a.y.le(p.b.y))),
  { lintDisable: ['no-float-eq'] },
);
const df64_ge = fn(
  'df64_ge',
  { a: vec2fT, b: vec2fT },
  (p) => p.a.x.gt(p.b.x).or(p.a.x.eq(p.b.x).and(p.a.y.ge(p.b.y))),
  { lintDisable: ['no-float-eq'] },
);
const df64_eq = fn(
  'df64_eq',
  { a: vec2fT, b: vec2fT },
  (p) => p.a.x.eq(p.b.x).and(p.a.y.eq(p.b.y)),
  { lintDisable: ['no-float-eq'] },
);
const df64_ne = fn(
  'df64_ne',
  { a: vec2fT, b: vec2fT },
  (p) => p.a.x.ne(p.b.x).or(p.a.y.ne(p.b.y)),
  { lintDisable: ['no-float-eq'] },
);

const df64_abs = fn('df64_abs', { a: vec2fT }, (p) => p.a.x.lt(0.0).select(p.a.neg(), p.a));

const df64_min = fn('df64_min', { a: vec2fT, b: vec2fT }, (p) =>
  df64_lt({ a: p.a, b: p.b }).select(p.a, p.b),
);
const df64_max = fn('df64_max', { a: vec2fT, b: vec2fT }, (p) =>
  df64_gt({ a: p.a, b: p.b }).select(p.a, p.b),
);

const df64_mix = fn('df64_mix', { a: vec2fT, b: vec2fT, t: f32T }, (p) =>
  df64_add({ a: p.a, b: df64_mul({ a: df64_sub({ a: p.b, b: p.a }), b: vec2(p.t, 0.0) }) }),
);

const df64_floor = fn(
  'df64_floor',
  { a: vec2fT },
  (p) => {
    const fhi = Let(floor(p.a.x));
    return fhi.eq(p.a.x).select(df64_quickTwoSum({ a: fhi, b: floor(p.a.y) }), vec2(fhi, 0.0));
  },
  { lintDisable: ['no-float-eq'] }, // exact integrality test, not a tolerance bug
);

const df64_fract = fn('df64_fract', { a: vec2fT }, (p) =>
  df64_sub({ a: p.a, b: df64_floor({ a: p.a }) }),
);

const parityF32 = (x: ReadonlyNode<'f32'>): Node<'f32'> => x.sub(floor(x.mul(0.5)).mul(2.0));

const df64_round = fn(
  'df64_round',
  { a: vec2fT },
  (p) => {
    const f = Let(df64_floor({ a: p.a }));
    const d = Let(df64_sub({ a: p.a, b: f }));
    const half = vec2(0.5, 0.0);
    const odd = Let(parityF32(f.x).add(parityF32(f.y)).eq(1.0));
    return df64_gt({ a: d, b: half })
      .or(df64_eq({ a: d, b: half }).and(odd))
      .select(df64_add({ a: f, b: vec2(1.0, 0.0) }), f);
  },
  { lintDisable: ['no-float-eq'] }, // exact tie and parity tests, not tolerances
);

const df64_narrow = fn('df64_narrow', { a: vec2fT }, (p) => p.a.x.add(p.a.y));

export const DF64_TRIG_CONSTANTS = {
  TWO_PI: 2 * Math.PI,
  PI_2: Math.PI / 2,
  PI_16: Math.PI / 16,
  INV_FACT_3: 1 / 6,
  INV_FACT_4: 1 / 24,
  INV_FACT_5: 1 / 120,
  INV_FACT_6: 1 / 720,
  COS_TABLE: [1, 2, 3, 4].map((k) => Math.cos((k * Math.PI) / 16)),
  SIN_TABLE: [1, 2, 3, 4].map((k) => Math.sin((k * Math.PI) / 16)),
} as const;

const dfLit = (x: number): ReadonlyNode<'vec2<f32>'> =>
  vec2(...splitF64(x)) as ReadonlyNode<'vec2<f32>'>;

const TWO_PI = dfLit(DF64_TRIG_CONSTANTS.TWO_PI);
const PI_2 = dfLit(DF64_TRIG_CONSTANTS.PI_2);
const PI_16 = dfLit(DF64_TRIG_CONSTANTS.PI_16);
const INV_FACT_3 = dfLit(DF64_TRIG_CONSTANTS.INV_FACT_3);
const INV_FACT_4 = dfLit(DF64_TRIG_CONSTANTS.INV_FACT_4);
const INV_FACT_5 = dfLit(DF64_TRIG_CONSTANTS.INV_FACT_5);
const INV_FACT_6 = dfLit(DF64_TRIG_CONSTANTS.INV_FACT_6);
const COS_TABLE = DF64_TRIG_CONSTANTS.COS_TABLE.map(dfLit);
const SIN_TABLE = DF64_TRIG_CONSTANTS.SIN_TABLE.map(dfLit);
const PI_2_HI = Math.fround(DF64_TRIG_CONSTANTS.PI_2);
const PI_16_HI = Math.fround(DF64_TRIG_CONSTANTS.PI_16);

const nintF32 = (x: ReadonlyNode<'f32'>): ReadonlyNode<'f32'> => floor(x.add(0.5));

const df64_nint = fn(
  'df64_nint',
  { a: vec2fT },
  (p) => {
    const hi = Let(nintF32(p.a.x));
    const loArm = df64_quickTwoSum({ a: hi, b: nintF32(p.a.y) });
    const tie = Let(abs(hi.sub(p.a.x)).eq(0.5).and(p.a.y.lt(0.0)).select(hi.sub(1.0), hi));
    return hi.eq(p.a.x).select(loArm, vec2(tie, 0.0));
  },
  { lintDisable: ['no-float-eq'] }, // exact integrality / x.5-tie tests
);

const df64_sin_taylor = fn('df64_sin_taylor', { a: vec2fT }, (p) => {
  const x = Let(df64_mul({ a: p.a, b: p.a }).neg());
  const r1 = Let(df64_mul({ a: p.a, b: x }));
  const s1 = Let(df64_add({ a: p.a, b: df64_mul({ a: r1, b: INV_FACT_3 }) }));
  const r2 = Let(df64_mul({ a: r1, b: x }));
  return df64_add({ a: s1, b: df64_mul({ a: r2, b: INV_FACT_5 }) });
});

const df64_cos_taylor = fn('df64_cos_taylor', { a: vec2fT }, (p) => {
  const x = Let(df64_mul({ a: p.a, b: p.a }).neg());
  const s0 = Let(df64_add({ a: dfLit(1), b: df64_mul({ a: x, b: dfLit(0.5) }) }));
  const r1 = Let(df64_mul({ a: x, b: x }));
  const s1 = Let(df64_add({ a: s0, b: df64_mul({ a: r1, b: INV_FACT_4 }) }));
  const r2 = Let(df64_mul({ a: r1, b: x }));
  return df64_add({ a: s1, b: df64_mul({ a: r2, b: INV_FACT_6 }) });
});

const pickByAbsK = (
  kk: ReadonlyNode<'f32'>,
  table: readonly ReadonlyNode<'vec2<f32>'>[],
  zero: ReadonlyNode<'vec2<f32>'>,
): ReadonlyNode<'vec2<f32>'> =>
  kk
    .eq(1.0)
    .select(
      table[0]!,
      kk
        .eq(2.0)
        .select(table[1]!, kk.eq(3.0).select(table[2]!, kk.eq(4.0).select(table[3]!, zero))),
    );

const reduceSinCos = (
  a: ReadonlyNode<'vec2<f32>'>,
): {
  qj: ReadonlyNode<'f32'>;
  sinPhi: ReadonlyNode<'vec2<f32>'>;
  cosPhi: ReadonlyNode<'vec2<f32>'>;
} => {
  const z = Let(df64_nint({ a: df64_div({ a, b: TWO_PI }) }));
  const r = Let(df64_sub({ a, b: df64_mul({ a: TWO_PI, b: z }) }));
  const qj = Let(floor(r.x.div(PI_2_HI).add(0.5)));
  const t1 = Let(df64_sub({ a: r, b: df64_mul({ a: PI_2, b: vec2(qj, 0.0) }) }));
  const qk = Let(floor(t1.x.div(PI_16_HI).add(0.5)));
  const t = Let(df64_sub({ a: t1, b: df64_mul({ a: PI_16, b: vec2(qk, 0.0) }) }));
  const sinT = Let(df64_sin_taylor({ a: t }));
  const cosT = Let(df64_cos_taylor({ a: t }));
  const kk = Let(abs(qk));
  const u = Let(pickByAbsK(kk, COS_TABLE, dfLit(1)));
  const vAbs = Let(pickByAbsK(kk, SIN_TABLE, dfLit(0)));
  const v = Let(qk.ge(0.0).select(vAbs, vAbs.neg()));
  const sinPhi = Let(df64_add({ a: df64_mul({ a: u, b: sinT }), b: df64_mul({ a: v, b: cosT }) }));
  const cosPhi = Let(df64_sub({ a: df64_mul({ a: u, b: cosT }), b: df64_mul({ a: v, b: sinT }) }));
  return { qj, sinPhi, cosPhi };
};

const df64_sin = fn(
  'df64_sin',
  { a: vec2fT },
  (p) => {
    const { qj, sinPhi, cosPhi } = reduceSinCos(p.a);
    return qj
      .eq(0.0)
      .select(sinPhi, qj.eq(1.0).select(cosPhi, qj.eq(-1.0).select(cosPhi.neg(), sinPhi.neg())));
  },
  { lintDisable: ['no-float-eq'] }, // exact integer-quadrant tests
);

const df64_cos = fn(
  'df64_cos',
  { a: vec2fT },
  (p) => {
    const { qj, sinPhi, cosPhi } = reduceSinCos(p.a);
    return qj
      .eq(0.0)
      .select(cosPhi, qj.eq(1.0).select(sinPhi.neg(), qj.eq(-1.0).select(sinPhi, cosPhi.neg())));
  },
  { lintDisable: ['no-float-eq'] },
);

const VEC_F32_T = { 2: vec2fT, 3: vec3fT, 4: vec4fT } as const;
const VEC_BOOL_T = { 2: vec2bT, 3: vec3bT, 4: vec4bT } as const;

export const DF64_VEC_STRUCTS: ReadonlyMap<2 | 3 | 4, StructDecl> = new Map(
  ([2, 3, 4] as const).map((n) => [
    n,
    {
      name: `DF64Vec${n}`,
      fields: [
        { name: 'hi', type: VEC_F32_T[n] },
        { name: 'lo', type: VEC_F32_T[n] },
      ],
    },
  ]),
);

function defVecHelpers(n: 2 | 3 | 4): FuncDecl[] {
  const vT: ShaderType = VEC_F32_T[n];
  const sT = structT(`DF64Vec${n}`);
  type V = ReadonlyNode<'vec2<f32>'>;
  const asV = (x: ReadonlyNode): V => x as unknown as V;
  const pair = (hi: ReadonlyNode, lo: ReadonlyNode) => construct(sT, [hi, lo]);
  const hi = (x: ReadonlyNode): V => asV(member(x, 'hi', vT));
  const lo = (x: ReadonlyNode): V => asV(member(x, 'lo', vT));

  const twoSum = fn(`df64_v${n}_twoSum`, { a: vT, b: vT }, (raw) => {
    const [a, b] = [asV(raw.a), asV(raw.b)];
    const s = Let(a.add(b));
    const v = Let(s.mul(one).sub(a).mul(one));
    const e = Let(a.sub(s.sub(v).mul(one)).mul(one).add(b.sub(v)));
    return pair(s, e);
  });
  const quickTwoSum = fn(`df64_v${n}_quickTwoSum`, { a: vT, b: vT }, (raw) => {
    const [a, b] = [asV(raw.a), asV(raw.b)];
    const s = Let(a.add(b).mul(one));
    const e = Let(b.sub(s.sub(a).mul(one)));
    return pair(s, e);
  });
  const split = fn(`df64_v${n}_split`, { a: vT }, (raw) => {
    const a = asV(raw.a);
    const t = Let(a.mul(one.mul(4097.0)));
    const h = Let(t.mul(one).sub(t.sub(a)));
    const l = Let(a.mul(one).sub(h));
    return pair(h, l);
  });
  const twoProd = fn(`df64_v${n}_twoProd`, { a: vT, b: vT }, (raw) => {
    const [a, b] = [asV(raw.a), asV(raw.b)];
    const prod = Let(a.mul(b));
    const aS = Let(split({ a }));
    const bS = Let(split({ a: b }));
    const e = Let(
      hi(aS)
        .mul(hi(bS))
        .sub(prod)
        .add(hi(aS).mul(lo(bS)))
        .add(lo(aS).mul(hi(bS)))
        .add(lo(aS).mul(lo(bS))),
    );
    return pair(prod, e);
  });
  const add = fn(`df64_v${n}_add`, { a: sT, b: sT }, (p) => {
    const s1 = Let(twoSum({ a: hi(p.a), b: hi(p.b) }));
    const t = Let(twoSum({ a: lo(p.a), b: lo(p.b) }));
    const s2 = Let(lo(s1).add(hi(t)));
    const r1 = Let(quickTwoSum({ a: hi(s1), b: s2 }));
    const s3 = Let(lo(r1).add(lo(t)));
    return quickTwoSum({ a: hi(r1), b: s3 });
  });
  const sub = fn(`df64_v${n}_sub`, { a: sT, b: sT }, (p) =>
    add({ a: p.a, b: pair(hi(p.b).neg(), lo(p.b).neg()) }),
  );
  const mul = fn(`df64_v${n}_mul`, { a: sT, b: sT }, (p) => {
    const p0 = Let(twoProd({ a: hi(p.a), b: hi(p.b) }));
    const r1 = Let(quickTwoSum({ a: hi(p0), b: lo(p0).add(hi(p.a).mul(lo(p.b))) }));
    return quickTwoSum({ a: hi(r1), b: lo(r1).add(lo(p.a).mul(hi(p.b))) });
  });
  const div = fn(`df64_v${n}_div`, { a: sT, b: sT }, (p) => {
    const xn = Let(one.div(hi(p.b)));
    const yn = Let(pair(hi(p.a).mul(xn), lo(p.a).mul(xn)));
    const diff = Let(hi(sub({ a: p.a, b: mul({ a: p.b, b: yn }) })));
    const prod = Let(twoProd({ a: xn, b: diff }));
    return add({ a: yn, b: prod });
  });

  const LANES = 'xyzw'.slice(0, n).split('');
  type P = ReadonlyNode<'vec2<f32>'>;
  const laneOf = (x: ReadonlyNode, c: string): P =>
    vec2(member(member(x, 'hi', vT), c, f32T), member(member(x, 'lo', vT), c, f32T)) as P;
  const gather = (ls: readonly ReadonlyNode[]): Node =>
    pair(
      construct(
        vT,
        ls.map((l) => member(l, 'x', f32T)),
      ),
      construct(
        vT,
        ls.map((l) => member(l, 'y', f32T)),
      ),
    );

  const vAbs = fn(`df64_v${n}_abs`, { a: sT }, (p) =>
    gather(LANES.map((c) => Let(df64_abs({ a: laneOf(p.a, c) })))),
  );
  const vMin = fn(`df64_v${n}_min`, { a: sT, b: sT }, (p) =>
    gather(LANES.map((c) => Let(df64_min({ a: laneOf(p.a, c), b: laneOf(p.b, c) })))),
  );
  const vMax = fn(`df64_v${n}_max`, { a: sT, b: sT }, (p) =>
    gather(LANES.map((c) => Let(df64_max({ a: laneOf(p.a, c), b: laneOf(p.b, c) })))),
  );
  const vMix = fn(`df64_v${n}_mix`, { a: sT, b: sT, t: f32T }, (p) =>
    gather(LANES.map((c) => Let(df64_mix({ a: laneOf(p.a, c), b: laneOf(p.b, c), t: p.t })))),
  );
  const vFloor = fn(`df64_v${n}_floor`, { a: sT }, (p) =>
    gather(LANES.map((c) => Let(df64_floor({ a: laneOf(p.a, c) })))),
  );
  const vFract = fn(`df64_v${n}_fract`, { a: sT }, (p) =>
    gather(LANES.map((c) => Let(df64_fract({ a: laneOf(p.a, c) })))),
  );
  const vRound = fn(`df64_v${n}_round`, { a: sT }, (p) =>
    gather(LANES.map((c) => Let(df64_round({ a: laneOf(p.a, c) })))),
  );
  const vSin = fn(`df64_v${n}_sin`, { a: sT }, (p) =>
    gather(LANES.map((c) => Let(df64_sin({ a: laneOf(p.a, c) })))),
  );
  const vCos = fn(`df64_v${n}_cos`, { a: sT }, (p) =>
    gather(LANES.map((c) => Let(df64_cos({ a: laneOf(p.a, c) })))),
  );
  const vNormalize = fn(`df64_v${n}_normalize`, { a: sT }, (p) => {
    const ls = LANES.map((c) => Let(laneOf(p.a, c)));
    let sq = df64_mul({ a: ls[0]!, b: ls[0]! });
    for (let i = 1; i < n; i++) sq = df64_add({ a: sq, b: df64_mul({ a: ls[i]!, b: ls[i]! }) });
    const len = Let(df64_sqrt({ a: sq }));
    return gather(ls.map((l) => Let(df64_div({ a: l, b: len }))));
  });

  const compareLanes = (name: string, lane: typeof df64_lt) =>
    fn(`df64_v${n}_${name}`, { a: sT, b: sT }, (p) =>
      construct(
        VEC_BOOL_T[n],
        LANES.map((c) => lane({ a: laneOf(p.a, c), b: laneOf(p.b, c) })),
      ),
    );
  const vLt = compareLanes('lt', df64_lt);
  const vGt = compareLanes('gt', df64_gt);
  const vLe = compareLanes('le', df64_le);
  const vGe = compareLanes('ge', df64_ge);
  const vEq = compareLanes('eq', df64_eq);
  const vNe = compareLanes('ne', df64_ne);

  return [
    twoSum.decl,
    quickTwoSum.decl,
    split.decl,
    twoProd.decl,
    add.decl,
    sub.decl,
    mul.decl,
    div.decl,
    vAbs.decl,
    vMin.decl,
    vMax.decl,
    vMix.decl,
    vFloor.decl,
    vFract.decl,
    vRound.decl,
    vSin.decl,
    vCos.decl,
    vNormalize.decl,
    vLt.decl,
    vGt.decl,
    vLe.decl,
    vGe.decl,
    vEq.decl,
    vNe.decl,
  ];
}

export const DF64_MAT_STRUCTS: ReadonlyMap<2 | 3 | 4, StructDecl> = new Map(
  ([2, 3, 4] as const).map((n) => [
    n,
    {
      name: `DF64Mat${n}`,
      fields: Array.from({ length: n }, (_, j) => ({
        name: `c${j}`,
        type: structT(`DF64Vec${n}`),
      })),
    },
  ]),
);

function defMatHelpers(n: 2 | 3 | 4): FuncDecl[] {
  const mT = structT(`DF64Mat${n}`);
  const vT = structT(`DF64Vec${n}`);
  const vecFT: ShaderType = VEC_F32_T[n];
  const LANES = 'xyzw'.slice(0, n).split('');
  type P = ReadonlyNode<'vec2<f32>'>;
  const col = (m: ReadonlyNode, j: number) => member(m, `c${j}`, vT);
  const laneOf = (v: ReadonlyNode, c: string): P =>
    vec2(member(member(v, 'hi', vecFT), c, f32T), member(member(v, 'lo', vecFT), c, f32T)) as P;
  const gatherVec = (ls: readonly ReadonlyNode[]) =>
    construct(vT, [
      construct(
        vecFT,
        ls.map((l) => member(l, 'x', f32T)),
      ),
      construct(
        vecFT,
        ls.map((l) => member(l, 'y', f32T)),
      ),
    ]);

  const matVec = fn(`df64_m${n}_matvec`, { m: mT, v: vT }, (p) => {
    const cols = LANES.map((_, j) => Let(col(p.m, j)));
    const vl = LANES.map((c) => Let(laneOf(p.v, c)));
    const out = LANES.map((ci) => {
      let acc: P = df64_mul({ a: laneOf(cols[0]!, ci), b: vl[0]! });
      for (let j = 1; j < n; j++)
        acc = df64_add({ a: acc, b: df64_mul({ a: laneOf(cols[j]!, ci), b: vl[j]! }) });
      return Let(acc);
    });
    return gatherVec(out);
  });
  const matMul = fn(`df64_m${n}_matmul`, { a: mT, b: mT }, (p) =>
    construct(
      mT,
      LANES.map((_, k) => Let(matVec({ m: p.a, v: col(p.b, k) }))),
    ),
  );
  const transpose = fn(`df64_m${n}_transpose`, { m: mT }, (p) =>
    construct(
      mT,
      LANES.map((_, i) => gatherVec(LANES.map((_, j) => Let(laneOf(col(p.m, j), LANES[i]!))))),
    ),
  );
  return [matVec.decl, matMul.decl, transpose.decl];
}

export const DF64_ORDER: readonly FuncDecl[] = [
  df64_twoSum.decl,
  df64_quickTwoSum.decl,
  df64_split.decl,
  df64_twoProd.decl,
  df64_twoSqr.decl,
  df64_add.decl,
  df64_sub.decl,
  df64_mul.decl,
  df64_sqr.decl,
  df64_div.decl,
  df64_sqrt.decl,
  df64_lt.decl,
  df64_gt.decl,
  df64_le.decl,
  df64_ge.decl,
  df64_eq.decl,
  df64_ne.decl,
  df64_abs.decl,
  df64_min.decl,
  df64_max.decl,
  df64_mix.decl,
  df64_floor.decl,
  df64_fract.decl,
  df64_round.decl,
  df64_narrow.decl,
  df64_nint.decl,
  df64_sin_taylor.decl,
  df64_cos_taylor.decl,
  df64_sin.decl,
  df64_cos.decl,
  ...defVecHelpers(2),
  ...defVecHelpers(3),
  ...defVecHelpers(4),
  ...defMatHelpers(2),
  ...defMatHelpers(3),
  ...defMatHelpers(4),
];

export const DF64_FNS: ReadonlyMap<string, FuncDecl> = new Map(DF64_ORDER.map((d) => [d.name, d]));

export const DF64_CALLS = {
  twoSum: df64_twoSum,
  quickTwoSum: df64_quickTwoSum,
  twoProd: df64_twoProd,
  twoSqr: df64_twoSqr,
  add: df64_add,
  sub: df64_sub,
  mul: df64_mul,
  div: df64_div,
} as const;
