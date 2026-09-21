// ═══ Shader DSL — neutral intrinsic registry (the spelling SoT) ═══
//
// #3a — invert ownership. The IR no longer bakes the WGSL spelling into a call:
// builtins carry a NEUTRAL id (e.g. `bitcastU32`, `atan2`, `select`) and EACH
// backend maps id -> its own spelling here. Previously the id WAS the WGSL string
// and the GLSL writer had to UN-rename it (a WGSL leak at the core). Now the
// registry is the single source of truth; the WGSL writer is just one consumer.
//
// Only the DIVERGENT intrinsics need an entry — anything absent is spelled
// identically by both targets (`name(args)`), which also covers user-defined
// function calls (they flow through the same `call` op and pass through).

/** The emit target that {@link spellIntrinsic} and the {@link INTRINSICS} table spell for:
 *  `'wgsl'` or `'glsl'`. The value names a column of the registry only; a backend identifies
 *  itself separately through `Backend.id`, and the GLSL backend's id is `'glsl-es300'`. A third
 *  writer (SPIR-V, MSL) would add a new column to every registry entry and a new case in
 *  `spellIntrinsic`.
 *
 *  Exported from `typeshade`.
 */
export type IntrinsicTarget = 'wgsl' | 'glsl'

type Spelling = {
  readonly wgsl: (args: readonly string[]) => string
  readonly glsl: (args: readonly string[]) => string
  /** Set when the spelling RE-EMBEDS an argument in a position that binds TIGHTER than a
   *  plain argument slot — an operand of an inlined operator, or the base of a `.field`
   *  postfix (X-GIS #2350). The emit walk renders a normal argument at the loosest precedence
   *  (it sits inside `(…)` or after a `,`, so anything parses), which under
   *  `parens: 'minimal'` hands the template a BARE `a + b`; spliced into `a + b / c` or
   *  `vv * s.x` that is a different parse — silently wrong arithmetic, or not even legal
   *  source. Marking the entry makes `core/emit.ts` render every argument as a PRIMARY
   *  instead, which is safe in any re-embedding position. Target-free on purpose: the
   *  neutral walk knows no target, and over-parenthesizing the column that does not
   *  re-embed costs bytes, never meaning. A new template that splices an argument
   *  anywhere but a plain argument slot MUST set this. */
  readonly atomArgs?: true
}

const join = (args: readonly string[]): string => args.join(', ')

// The storage-emulation fetch, shared by the f32/u32/i32 ids below (X-GIS #1703). The 2D-tiled
// index math is element-INDEPENDENT — only the sampler type the binding declares and the
// component type it fetches change. One authority so the three ids cannot drift into
// three different tilings.
//
// Spelled as a CALL to a helper the GLSL writer emits, NOT as an inline expansion (X-GIS #1878).
// A template that substitutes `${a[0]}` three times and `${a[1]}` twice duplicates its
// arguments AFTER every optimizer pass has run: cse/cseLocal/gvn/licm walk the IR, and
// this text does not exist until the writer produces it, so the repetition is invisible
// to all of them by construction. It reached the baked corpus as `textureSize(t, 0).x`
// 998 times — exactly twice per fetch site — and a fetch nested inside `unpack4x8unorm`
// (itself 4x `${a[0]}`) multiplied out to four identical texelFetches in ONE expression.
// Binding the width once inside a helper is the same value with none of the repetition:
// -8.1% raw / -4.6% gzip / -3.5% brotli over the baked GLSL.
//
// Sampler-as-parameter is GLSL ES 3.00 §4.1.7, and §6.1 requires the argument to resolve
// to a uniform or another sampler parameter — so the driver must specialize the helper
// and there is no dynamic call to pay for.
//
// The index parameter is `int`, and the CALL keeps the `int(...)` cast the old template
// wrote: the lane is `u32T` on every path the storage lowering builds, but the writer is
// handed whatever Expr the caller indexed with, and a FLOAT index has no implicit
// conversion to an integer type in GLSL ES 3.00 §4.1.10 — it is a compile error, which
// is what a `uint i` parameter turned `data[uv.x * 3.0]` into. Casting once at the call
// site is both the old semantics exactly (`int(-1.5)` is -1, where `uint(-1.5)` is
// undefined) and still one cast instead of the template's two.
const storageFetchDef = (ret: string, samp: string, fn: string): string =>
  `${ret} ${fn}(${samp} t, int i) {\n  int w = textureSize(t, 0).x;\n  return texelFetch(t, ivec2(i % w, i / w), 0).r;\n}`

const storageFetchGlsl =
  (fn: string) =>
  (a: readonly string[]): string =>
    `${fn}(${a[0]}, int(${a[1]}))`

/** The atomic builtins (roadmap 0.2 item 4), with the arity and result of each: `atomicLoad`
 *  takes the location alone and returns its value; `atomicStore` takes a value and returns
 *  nothing; the eight read-modify-write forms take a value and return the value the location
 *  held BEFORE the update. Every one takes its first argument as a LOCATION (`xs[i]`, a storage
 *  struct field, a bare atomic binding), which WGSL spells as a pointer, `&xs[i]`, and which the
 *  CPU backends resolve once and write back through. GLSL ES 3.00 has no atomics.
 *
 *  Exported from `typeshade`.
 */
export const ATOMIC_INTRINSICS: Readonly<
  Record<string, { readonly arity: 1 | 2; readonly returns: 'value' | 'void' }>
> = {
  atomicLoad: { arity: 1, returns: 'value' },
  atomicStore: { arity: 2, returns: 'void' },
  atomicAdd: { arity: 2, returns: 'value' },
  atomicSub: { arity: 2, returns: 'value' },
  atomicMin: { arity: 2, returns: 'value' },
  atomicMax: { arity: 2, returns: 'value' },
  atomicAnd: { arity: 2, returns: 'value' },
  atomicOr: { arity: 2, returns: 'value' },
  atomicXor: { arity: 2, returns: 'value' },
  atomicExchange: { arity: 2, returns: 'value' },
}

/** The barriers (roadmap 0.2 item 5, #82): `workgroupBarrier()` and `storageBarrier()`,
 *  statements with no value that every invocation of a workgroup reaches before any runs on.
 *  WGSL spells them bare; GLSL ES 3.00 has no compute stage and no barrier. The CPU oracle runs
 *  them through `dispatch`, which holds each invocation of a workgroup at the barrier until
 *  all have arrived.
 *
 *  Exported from `typeshade`.
 */
export const BARRIER_INTRINSICS: ReadonlySet<string> = new Set([
  'workgroupBarrier',
  'storageBarrier',
])

/** Whether `name` is one of the {@link BARRIER_INTRINSICS}.
 *
 *  Exported from `typeshade`.
 */
export const isBarrierIntrinsic = (name: string): boolean => BARRIER_INTRINSICS.has(name)

/** The error every CPU path throws when a barrier runs outside a `dispatch`: a barrier waits
 *  for the other invocations of the workgroup, and one invocation run alone, by a direct
 *  `fns` call or by a debug session, has none. The values after it would be ones no workgroup
 *  produces, so the run refuses and names the fix.
 *
 *  Exported from `typeshade`.
 */
export const barrierOutsideDispatch = (fn: string): Error =>
  new Error(
    `typeshade/cpu: ${fn}() waits for the other invocations of the workgroup, which a direct call has none of; run the entry with dispatch(name, workgroups)`,
  )

/** Whether `name` is one of the {@link ATOMIC_INTRINSICS}.
 *
 *  Exported from `typeshade`.
 */
export const isAtomicIntrinsic = (name: string): boolean =>
  Object.prototype.hasOwnProperty.call(ATOMIC_INTRINSICS, name)

const atomicSpellings = (): Record<string, Spelling> =>
  Object.fromEntries(
    Object.entries(ATOMIC_INTRINSICS).map(([name, sig]): [string, Spelling] => [
      name,
      {
        wgsl: (a) => (sig.arity === 1 ? `${name}(&${a[0]})` : `${name}(&${a[0]}, ${a[1]})`),
        glsl: () => {
          throw new Error(
            `glsl-es300: ${name} has no GLSL ES 3.00 spelling (no storage buffers, no atomics)`,
          )
        },
      },
    ]),
  )

/** The cube-array sampling ids (roadmap 0.4 item 12): WGSL spells each as the base builtin; GLSL
 *  ES 3.00 has no cube-array sampler, so every column throws. */
function cubeArraySpellings(): Record<string, Spelling> {
  const out: Record<string, Spelling> = {}
  for (const base of [
    'textureSample',
    'textureSampleLevel',
    'textureSampleBias',
    'textureSampleGrad',
    'textureSampleCompare',
    'textureSampleCompareLevel',
  ]) {
    out[`${base}CubeArray`] = {
      wgsl: (a) => `${base}(${join(a)})`,
      glsl: () => {
        throw new Error(
          `glsl-es300: ${base} on a cube array has no GLSL ES 3.00 spelling (no samplerCubeArray)`,
        )
      },
    }
  }
  return out
}

/** The neutral ids a `textureGather` / `textureGatherCompare` call lowers to, one per WGSL
 *  argument structure (roadmap 0.4 item 12). Exported so the capability pass can derive
 *  `textureGather` from a call without a second list. */
export const TEXTURE_GATHER_IDS: ReadonlySet<string> = new Set([
  'textureGather',
  'textureGatherArray',
  'textureGatherDepth',
  'textureGatherDepthArray',
  'textureGatherCompare',
  'textureGatherCompareArray',
])

/** The eight packed 4x8 integer builtins (#152, wgsl.txt:21906/21920). Exported so the
 *  capability pass derives `packed4x8Dot` from a call without a second list, and so
 *  reflection can name the WGSL language feature they belong to.
 *
 *  Exported from `typeshade`.
 */
export const PACKED_4X8_IDS: ReadonlySet<string> = new Set([
  'dot4U8Packed',
  'dot4I8Packed',
  'pack4xU8',
  'pack4xI8',
  'pack4xU8Clamp',
  'pack4xI8Clamp',
  'unpack4xU8',
  'unpack4xI8',
])

/** The WGSL LANGUAGE feature a module using {@link PACKED_4X8_IDS} depends on, as
 *  `navigator.gpu.wgslLanguageFeatures` names it. Not an extension: measured on Tint,
 *  `enable packed_4x8_integer_dot_product;` is refused ("expected extension") while the calls
 *  compile bare, so there is no directive to emit and the check belongs at the host.
 *
 *  Exported from `typeshade`.
 */
export const PACKED_4X8_LANGUAGE_FEATURE = 'packed_4x8_integer_dot_product'

function gatherSpellings(): Record<string, Spelling> {
  const out: Record<string, Spelling> = {}
  for (const id of TEXTURE_GATHER_IDS) {
    const wgslName = id.startsWith('textureGatherCompare')
      ? 'textureGatherCompare'
      : 'textureGather'
    out[id] = {
      wgsl: (a) => `${wgslName}(${join(a)})`,
      glsl: () => {
        throw new Error(
          `glsl-es300: ${wgslName} has no GLSL ES 3.00 spelling (textureGather is ES 3.10)`,
        )
      },
    }
  }
  return out
}

/** A builtin WGSL spells natively and GLSL ES 3.00 has no form of at all. The GLSL column
 *  throws rather than inventing one, which is the same shape the storage-texture rows use: a
 *  module reaching it has already slipped past the capability gate, and a throw from the writer
 *  is better than emitted source no driver accepts. */
const wgslOnly = (name: string): Spelling => ({
  wgsl: (a) => `${name}(${join(a)})`,
  glsl: () => {
    throw new Error(`glsl-es300: ${name} has no GLSL ES 3.00 form`)
  },
})

/** The spelling of each builtin id on each target, keyed by id. Only builtins whose spelling
 *  differs between WGSL and GLSL ES 3.00 have an entry; a builtin with no entry is spelled the
 *  same way on both targets, as `name(args)`. The wgsl and glsl members of an entry each take
 *  the rendered argument expressions and return the call as source text.
 *
 *  Exported from `typeshade`.
 */
export const INTRINSICS: Readonly<Record<string, Spelling>> = {
  // Scalar conversions — toF32/toI32/toU32 (node.ts) emit calls named f32/i32/u32 (the WGSL
  // cast spelling). GLSL spells the same cast `float(x)`/`int(x)`/`uint(x)`; without these
  // entries the writer would leak `f32(...)` verbatim into GLSL (no such GLSL function — a
  // hard compile error). Vector conversions go through `construct` (typeName-spelled), not here.
  f32: { wgsl: (a) => `f32(${join(a)})`, glsl: (a) => `float(${join(a)})` },
  i32: { wgsl: (a) => `i32(${join(a)})`, glsl: (a) => `int(${join(a)})` },
  u32: { wgsl: (a) => `u32(${join(a)})`, glsl: (a) => `uint(${join(a)})` },
  // select(falseVal, trueVal, cond) — WGSL builtin vs GLSL ternary.
  select: { wgsl: (a) => `select(${join(a)})`, glsl: (a) => `(${a[2]} ? ${a[1]} : ${a[0]})` },
  // textureSample(tex, samp, uv) — GLSL fuses tex+samp, so drop the sampler arg.
  textureSample: {
    wgsl: (a) => `textureSample(${join(a)})`,
    glsl: (a) => `texture(${a[0]}, ${a[2]})`,
  },
  // textureSampleLevel(tex, samp, uv, level) — explicit-LOD sample; same tex+samp
  // fusion as textureSample, so the sampler arg (a[1]) is dropped on GLSL.
  // LOAD-BEARING (X-GIS #1650 decision): the array / offset / bias variants must each take
  // a NEW neutral id (X-GIS #1651 adds textureSampleLevelArray) — NEVER an arity branch on
  // this entry. A spelling that switches on args.length makes the id's meaning depend
  // on the call site, which is exactly the WGSL leak the registry exists to prevent.
  textureSampleLevel: {
    wgsl: (a) => `textureSampleLevel(${join(a)})`,
    glsl: (a) => `textureLod(${a[0]}, ${a[2]}, ${a[3]})`,
  },
  // ── 2d-array sampling (X-GIS #1651) — DISTINCT ids, never an arity branch above ──
  //
  // textureSampleArray(tex, samp, uv, layer). WGSL keeps the ARRAY as a separate
  // argument (`textureSample(t, s, uv, layer)`); GLSL ES 3.00 has no array-specific
  // spelling at all — the layer rides in the coordinate's THIRD component
  // (`texture(sampler2DArray, vec3(uv, layer))`), which is exactly why this cannot be
  // an args.length branch on textureSample: the two ids restructure the arguments
  // differently, they do not merely add one.
  textureSampleArray: {
    wgsl: (a) => `textureSample(${join(a)})`,
    // a[1] (the sampler) fuses away; float() because GLSL ES has no implicit
    // int→float at a constructor component (the registry's existing cast convention).
    glsl: (a) => `texture(${a[0]}, vec3(${a[2]}, float(${a[3]})))`,
  },
  // textureSampleLevelArray(tex, samp, uv, layer, level) — the any-stage array read
  // (an explicit LOD needs no derivatives, so it is legal in vertex/compute too).
  textureSampleLevelArray: {
    wgsl: (a) => `textureSampleLevel(${join(a)})`,
    glsl: (a) => `textureLod(${a[0]}, vec3(${a[2]}, float(${a[3]})), ${a[4]})`,
  },
  // textureLoadArray(tex, coord, layer, level) — unfiltered texel fetch. GLSL folds
  // the layer into an ivec3 coordinate; the lod arg is `int` (WGSL passes u32).
  textureLoadArray: {
    wgsl: (a) => `textureLoad(${join(a)})`,
    glsl: (a) => `texelFetch(${a[0]}, ivec3(${a[1]}, int(${a[2]})), int(${a[3]}))`,
  },
  // ── bias and gradient sampling (roadmap 0.4 item 12) — DISTINCT ids, never an arity branch ──
  //
  // textureSampleBias(tex, samp, coord, bias): the implicit level of detail shifted by a bias.
  // It needs the derivatives only a fragment quad has, so it is fragment-only on BOTH targets —
  // Tint: "built-in cannot be used by compute pipeline stage"; a WebGL2 driver refuses
  // `texture(s, uv, bias)` in a vertex stage with "no matching overloaded function" (measured).
  // The coordinate's width rides on the IR type (a vec2 on a 2d, a vec3 on a cube or 3d), so
  // ONE id covers every dim, as it does for textureSample; the array form is its own id because
  // it restructures the arguments — the layer folds into the coordinate on GLSL.
  textureSampleBias: {
    wgsl: (a) => `textureSampleBias(${join(a)})`,
    glsl: (a) => `texture(${a[0]}, ${a[2]}, ${a[3]})`,
  },
  textureSampleBiasArray: {
    wgsl: (a) => `textureSampleBias(${join(a)})`,
    glsl: (a) => `texture(${a[0]}, vec3(${a[2]}, float(${a[3]})), ${a[4]})`,
  },
  // textureSampleGrad(tex, samp, coord, ddx, ddy): explicit gradients, so no derivative is
  // taken and the read is legal in ANY stage on both targets (measured in a compute stage on
  // Tint and in a vertex stage on a WebGL2 driver). The gradients have the coordinate's width.
  textureSampleGrad: {
    wgsl: (a) => `textureSampleGrad(${join(a)})`,
    glsl: (a) => `textureGrad(${a[0]}, ${a[2]}, ${a[3]}, ${a[4]})`,
  },
  textureSampleGradArray: {
    wgsl: (a) => `textureSampleGrad(${join(a)})`,
    glsl: (a) => `textureGrad(${a[0]}, vec3(${a[2]}, float(${a[3]})), ${a[4]}, ${a[5]})`,
  },
  // ── cube-array sampling (roadmap 0.4 item 12, WGSL-only) ──
  //
  // WGSL spells each as the base builtin with the layer after the direction. GLSL ES 3.00 has
  // no `samplerCubeArray` at all (a WebGL2 driver refuses the extension), so the column fails
  // closed; the `textureCubeArray` capability refuses the module first. Their own ids rather
  // than the 2d-array ones because the 2d-array spellings fold the layer into a `vec3(uv,
  // layer)`, which would be well-formed and WRONG for a cube array: an id's text must never
  // depend on the texture it happens to be called on.
  ...cubeArraySpellings(),
  // ── textureGather (roadmap 0.4 item 12, WGSL-only) ──
  //
  // The four texels a linear filter would blend, one channel each, in any stage. WGSL takes the
  // component FIRST on a colour texture and none on a depth texture (one channel), the layer
  // after the coordinate on an array, and the reference after that on the compare form. One id
  // per argument structure. GLSL ES 3.00 has no gather (`textureGather` is ES 3.10), so the
  // column fails closed; the `textureGather` capability refuses the module first.
  ...gatherSpellings(),
  atan2: { wgsl: (a) => `atan2(${join(a)})`, glsl: (a) => `atan(${join(a)})` },
  // round(x) — ties-to-EVEN on both targets. WGSL's round IS roundEven; GLSL ES
  // 3.00's own round() leaves the 0.5 case IMPLEMENTATION-CHOSEN (§8.3 "the
  // fraction 0.5 will round in a direction chosen by the implementation"), so
  // the identity spelling was a latent cross-backend divergence on exact halves.
  // roundEven (also ES 3.00 §8.3) is the one GLSL spelling whose semantics are
  // guaranteed to agree with WGSL — and with the CPU oracle's roundTiesToEven.
  round: { wgsl: (a) => `round(${join(a)})`, glsl: (a) => `roundEven(${join(a)})` },
  // saturate(x) — clamp to [0,1], component-wise. WGSL has the dedicated
  // builtin; GLSL ES 3.00 has none, so it inlines as the clamp both specs
  // define saturate to be. The scalar 0.0/1.0 bounds broadcast over vector x
  // (GLSL's clamp(genType, float, float) overload).
  saturate: { wgsl: (a) => `saturate(${join(a)})`, glsl: (a) => `clamp(${a[0]}, 0.0, 1.0)` },
  // Screen-space partial derivatives (X-GIS #846) — WGSL dpdx/dpdy, GLSL dFdx/dFdy.
  // (fwidth is spelled identically on both targets and stays portable.)
  dpdx: { wgsl: (a) => `dpdx(${join(a)})`, glsl: (a) => `dFdx(${join(a)})` },
  dpdy: { wgsl: (a) => `dpdy(${join(a)})`, glsl: (a) => `dFdy(${join(a)})` },
  // The coarse and fine derivatives (roadmap 0.2 item 8): GLSL ES 3.00 has one derivative of
  // each kind and lets the implementation pick its granularity, so the hint is dropped there.
  dpdxCoarse: { wgsl: (a) => `dpdxCoarse(${join(a)})`, glsl: (a) => `dFdx(${join(a)})` },
  dpdxFine: { wgsl: (a) => `dpdxFine(${join(a)})`, glsl: (a) => `dFdx(${join(a)})` },
  dpdyCoarse: { wgsl: (a) => `dpdyCoarse(${join(a)})`, glsl: (a) => `dFdy(${join(a)})` },
  dpdyFine: { wgsl: (a) => `dpdyFine(${join(a)})`, glsl: (a) => `dFdy(${join(a)})` },
  fwidthCoarse: { wgsl: (a) => `fwidthCoarse(${join(a)})`, glsl: (a) => `fwidth(${join(a)})` },
  fwidthFine: { wgsl: (a) => `fwidthFine(${join(a)})`, glsl: (a) => `fwidth(${join(a)})` },
  // faceForward(n, i, nref): GLSL spells the name in lower case.
  faceForward: { wgsl: (a) => `faceForward(${join(a)})`, glsl: (a) => `faceforward(${join(a)})` },
  // Bit builtins (roadmap 0.2 item 8). GLSL ES 3.10 has bitCount, findMSB and the rest; GLSL
  // ES 3.00, which WebGL2 compiles, has none of them, so each is a small helper function the
  // GLSL emitter defines when a module calls it, overloaded per argument type (glsl-bits.ts).
  // The spelling is therefore the same whatever the type.
  countOneBits: { wgsl: (a) => `countOneBits(${join(a)})`, glsl: (a) => `_popcnt(${join(a)})` },
  reverseBits: { wgsl: (a) => `reverseBits(${join(a)})`, glsl: (a) => `_brev(${join(a)})` },
  countLeadingZeros: {
    wgsl: (a) => `countLeadingZeros(${join(a)})`,
    glsl: (a) => `_clz(${join(a)})`,
  },
  countTrailingZeros: {
    wgsl: (a) => `countTrailingZeros(${join(a)})`,
    glsl: (a) => `_ctz(${join(a)})`,
  },
  firstLeadingBit: { wgsl: (a) => `firstLeadingBit(${join(a)})`, glsl: (a) => `_msb(${join(a)})` },
  firstTrailingBit: {
    wgsl: (a) => `firstTrailingBit(${join(a)})`,
    glsl: (a) => `_lsb(${join(a)})`,
  },
  extractBits: { wgsl: (a) => `extractBits(${join(a)})`, glsl: (a) => `_xbits(${join(a)})` },
  insertBits: { wgsl: (a) => `insertBits(${join(a)})`, glsl: (a) => `_ibits(${join(a)})` },
  // ldexp(x, e) = x * 2^e. GLSL ES 3.00 has no ldexp (ES 3.10 added it); the power of two is
  // built from its bits, which is exact for every exponent from -126 to 127, where exp2 need
  // not be. `e` is an i32 or a vector of them, so the shift broadcasts.
  ldexp: {
    wgsl: (a) => `ldexp(${join(a)})`,
    glsl: (a) => `(${a[0]} * intBitsToFloat((${a[1]} + 127) << 23))`,
    // Both operands land inside operators — see `atomArgs` above.
    atomArgs: true,
  },
  // mod(x, y) — FLOOR-mod with identical semantics on both targets (X-GIS #839).
  // Float `%` is TRUNC-mod on WGSL and integer-only (invalid on floats) in
  // GLSL ES 3.00; GLSL's mod() IS floor-mod. Spelling WGSL inline as
  // x − y·⌊x/y⌋ makes the targets agree on negative operands (domain
  // repetition, polar folds). Named after GLSL/TSL `mod` — deliberately NOT
  // `fmod`, which in C/HLSL is TRUNC-mod (the opposite semantics). The WGSL
  // spelling repeats each operand's text — operands are pure expressions
  // (CSE hoists shared work), so this costs characters, not semantics.
  mod: {
    wgsl: (a) => `(${a[0]} - ${a[1]} * floor(${a[0]} / ${a[1]}))`,
    glsl: (a) => `mod(${join(a)})`,
    // Both operands land inside the `/` (and the divisor under a `*`), so both must
    // arrive as primaries — see `atomArgs` above.
    atomArgs: true,
  },
  inverseSqrt: { wgsl: (a) => `inverseSqrt(${join(a)})`, glsl: (a) => `inversesqrt(${join(a)})` },
  // fma(a,b,c) = a·b+c. WGSL has a fused hardware fma — a SINGLE rounding, atomic:
  // a driver's fast-math cannot distribute or reassociate it (unlike a·b then +c).
  // GLSL ES 3.00 (WebGL2) has NO fma (it is ES 3.10 / GLSL 4.00), so emit the
  // NON-fused `(a*b+c)` fallback there. DIVERGENT (not portable): only the WGSL
  // target gets the unfoldable single-rounding, which is the entire point — it is
  // the one form Apple/Metal cannot fold back into a plain f32 product when
  // building df64 twoProd error terms (aHi·bLo etc.). Diagnostic use for now.
  fma: { wgsl: (a) => `fma(${join(a)})`, glsl: (a) => `((${a[0]}) * (${a[1]}) + (${a[2]}))` },
  // ── 2×16 pack/unpack — NATIVE on both targets, divergent NAME only ──
  // WGSL pack2x16float/unorm/snorm ↔ GLSL ES 3.00 packHalf2x16 / packUnorm2x16 /
  // packSnorm2x16 (§8.4): identical bit layout (component 0 in the 16 LOW bits)
  // and identical quantisation formulas, so unlike the 4×8 pair below (ES 3.10-
  // only, hand-inlined) these six are straight renames.
  pack2x16float: {
    wgsl: (a) => `pack2x16float(${join(a)})`,
    glsl: (a) => `packHalf2x16(${join(a)})`,
  },
  unpack2x16float: {
    wgsl: (a) => `unpack2x16float(${join(a)})`,
    glsl: (a) => `unpackHalf2x16(${join(a)})`,
  },
  pack2x16unorm: {
    wgsl: (a) => `pack2x16unorm(${join(a)})`,
    glsl: (a) => `packUnorm2x16(${join(a)})`,
  },
  unpack2x16unorm: {
    wgsl: (a) => `unpack2x16unorm(${join(a)})`,
    glsl: (a) => `unpackUnorm2x16(${join(a)})`,
  },
  pack2x16snorm: {
    wgsl: (a) => `pack2x16snorm(${join(a)})`,
    glsl: (a) => `packSnorm2x16(${join(a)})`,
  },
  unpack2x16snorm: {
    wgsl: (a) => `unpack2x16snorm(${join(a)})`,
    glsl: (a) => `unpackSnorm2x16(${join(a)})`,
  },
  // GLSL ES 3.00 (WebGL2) has NO packUnorm4x8/unpackUnorm4x8 — those are GLSL 4.00 /
  // ES 3.10 only. Inline the WGSL semantics by hand (round(clamp(v,0,1)*255), byte 0 in
  // the low bits). Verified against the CPU oracle on a real WebGL2 GPU.
  pack4x8unorm: {
    wgsl: (a) => `pack4x8unorm(${join(a)})`,
    glsl: (a) =>
      `(uint(round(clamp(${a[0]}.x, 0.0, 1.0) * 255.0)) | (uint(round(clamp(${a[0]}.y, 0.0, 1.0) * 255.0)) << 8) | (uint(round(clamp(${a[0]}.z, 0.0, 1.0) * 255.0)) << 16) | (uint(round(clamp(${a[0]}.w, 0.0, 1.0) * 255.0)) << 24))`,
    // The argument is a `.x`/`.y`/`.z`/`.w` postfix BASE — see `atomArgs` above.
    atomArgs: true,
  },
  unpack4x8unorm: {
    wgsl: (a) => `unpack4x8unorm(${join(a)})`,
    glsl: (a) =>
      `(vec4(uvec4(${a[0]}, ${a[0]} >> 8, ${a[0]} >> 16, ${a[0]} >> 24) & 0xFFu) / 255.0)`,
  },
  // 4×8 SNORM, the signed twin of the pair above (#150). GLSL ES 3.00 has no
  // packSnorm4x8/unpackSnorm4x8 either (ES 3.10 / GLSL 4.00), so both are inlined by hand.
  //
  // WGSL §17.10: pack4x8snorm quantises each component as ⌊0.5 + 127 × clamp(e, -1, 1)⌋ and
  // keeps the low 8 bits of the two's complement; component 0 is the LOW byte. `floor(0.5 + x)`
  // is not `round(x)` on this half: GLSL's `round` is implementation-chosen at an exact half
  // and `roundEven` goes to even, while WGSL rounds -0.5 toward +∞ to 0. Written as the floor
  // form so the two targets agree on -0.5/127 and 0.5/127, which is the divergence #141 records
  // for the UNORM twin above.
  pack4x8snorm: {
    wgsl: (a) => `pack4x8snorm(${join(a)})`,
    glsl: (a) =>
      `(uint(int(floor(0.5 + clamp(${a[0]}.x, -1.0, 1.0) * 127.0)) & 0xFF) | ` +
      `(uint(int(floor(0.5 + clamp(${a[0]}.y, -1.0, 1.0) * 127.0)) & 0xFF) << 8) | ` +
      `(uint(int(floor(0.5 + clamp(${a[0]}.z, -1.0, 1.0) * 127.0)) & 0xFF) << 16) | ` +
      `(uint(int(floor(0.5 + clamp(${a[0]}.w, -1.0, 1.0) * 127.0)) & 0xFF) << 24))`,
    // The argument is a `.x`/`.y`/`.z`/`.w` postfix BASE — see `atomArgs` above.
    atomArgs: true,
  },
  // The inverse: sign-extend each byte, then `max(v / 127, -1)` (WGSL §17.11 — the -128
  // pattern would give -1.0079, which the max clamps). Sign extension is a 24-bit left shift
  // into an ivec4 followed by an ARITHMETIC right shift, which is what `>>` is on a signed
  // integer in GLSL ES 3.00 §5.9.
  unpack4x8snorm: {
    wgsl: (a) => `unpack4x8snorm(${join(a)})`,
    glsl: (a) =>
      `max(vec4(ivec4(uvec4(${a[0]}, ${a[0]} >> 8, ${a[0]} >> 16, ${a[0]} >> 24) << 24) >> 24) ` +
      `/ 127.0, vec4(-1.0))`,
    // `${a[0]} >> 8` re-embeds the argument as an operator operand.
    atomArgs: true,
  },
  // `quantizeToF16(e)` (#150, wgsl.txt:23036): round to what an IEEE-754 binary16 can hold and
  // come back as an f32, so a shader can see the precision an f16 pipeline would give it
  // without the shader-f16 extension. GLSL ES 3.00 has no such builtin, but it has the pair
  // that does exactly this: pack a half and unpack it again.
  //
  // One id per WIDTH, as the texture reads do, because the registry spells argument STRINGS
  // and has no type to switch on: WGSL's overload takes an f32 or a vecN<f32>, and the GLSL
  // round trip is two components at a time.
  quantizeToF16: {
    wgsl: (a) => `quantizeToF16(${join(a)})`,
    glsl: (a) => `unpackHalf2x16(packHalf2x16(vec2(${a[0]}, 0.0))).x`,
  },
  // ONE COMPONENT AT A TIME, never two per round trip. A paired `packHalf2x16(v)` was the
  // obvious spelling and is wrong: measured on a real driver, the half-encode of a component
  // that overflows binary16 yields a 17-bit value whose carry lands in the OTHER half
  // (`0x3C00` became `0x3C02` beside an infinite neighbour), so one component silently
  // corrupted the next. WGSL's `quantizeToF16` is per-component and cannot do that, so neither
  // does this.
  quantizeToF16Vec2: {
    wgsl: (a) => `quantizeToF16(${join(a)})`,
    glsl: (a) =>
      `vec2(${['x', 'y'].map((c) => `unpackHalf2x16(packHalf2x16(vec2(${a[0]}.${c}, 0.0))).x`).join(', ')})`,
    atomArgs: true,
  },
  quantizeToF16Vec3: {
    wgsl: (a) => `quantizeToF16(${join(a)})`,
    glsl: (a) =>
      `vec3(${['x', 'y', 'z'].map((c) => `unpackHalf2x16(packHalf2x16(vec2(${a[0]}.${c}, 0.0))).x`).join(', ')})`,
    atomArgs: true,
  },
  quantizeToF16Vec4: {
    wgsl: (a) => `quantizeToF16(${join(a)})`,
    glsl: (a) =>
      `vec4(${['x', 'y', 'z', 'w'].map((c) => `unpackHalf2x16(packHalf2x16(vec2(${a[0]}.${c}, 0.0))).x`).join(', ')})`,
    atomArgs: true,
  },
  // The two PORTABLE lies the spec audit found (#154): `abs` and `dot` are spelled identically
  // on both targets for every element kind, and GLSL ES 3.00 has neither an unsigned `abs` nor
  // an integer `dot`. Measured on a WebGL2 driver: `abs(uvec3)`, `abs(uint)`, `dot(ivec3,
  // ivec3)` and `dot(uvec3, uvec3)` are each "no matching overloaded function found", while
  // `abs(ivec3)` and `dot(vec3, vec3)` compile. So the float `abs`/`dot` and the SIGNED `abs`
  // keep the portable spelling and only these three ids are divergent.
  //
  // `abs` on an unsigned value is the IDENTITY (wgsl.txt:21450: "Returns e" for u32), so the
  // GLSL column is the argument itself rather than a call.
  absU: {
    wgsl: (a) => `abs(${join(a)})`,
    glsl: (a) => `${a[0]}`,
    // The GLSL column IS the argument, with no call or constructor around it — the most
    // extreme re-embedding in this table, and the emit walk never wraps a leaf. Without this,
    // `parens: 'minimal'` turned `abs(u.k - 1) * u.k` into `u.k - 1u * u.k`: different
    // arithmetic, no diagnostic, measured as different pixels on a real driver.
    atomArgs: true,
  },
  // The integer dot goes through the `_idot` helper glsl-bits.ts writes, one overload per
  // vector type the module uses. Not an inline sum: that would splice both arguments once per
  // component, after every optimizer pass has run.
  dotI: { wgsl: (a) => `dot(${join(a)})`, glsl: (a) => `_idot(${join(a)})` },
  dotU: { wgsl: (a) => `dot(${join(a)})`, glsl: (a) => `_idot(${join(a)})` },
  // bitcast<u32>(f) on WGSL; floatBitsToUint(f) on GLSL. The neutral id drops the
  // WGSL generic-call syntax that used to live in the IR.
  bitcastU32: {
    wgsl: (a) => `bitcast<u32>(${join(a)})`,
    glsl: (a) => `floatBitsToUint(${join(a)})`,
  },
  // bitcast<f32>(u) on WGSL; uintBitsToFloat(u) on GLSL. Inverse of bitcastU32 —
  // an f32↔u32 round-trip is a fast-math optimization barrier (the integer domain
  // is not subject to float reassociation/contraction).
  bitcastF32: {
    wgsl: (a) => `bitcast<f32>(${join(a)})`,
    glsl: (a) => `uintBitsToFloat(${join(a)})`,
  },
  // GLSL texelFetch's lod/sample arg is `int` (WGSL passes a u32 level) → wrap the
  // 3rd arg in int(); GLSL has no implicit u32→int here. (2-arg form passes through.)
  textureLoad: {
    wgsl: (a) => `textureLoad(${join(a)})`,
    glsl: (a) =>
      a.length >= 3 ? `texelFetch(${a[0]}, ${a[1]}, int(${a[2]}))` : `texelFetch(${join(a)})`,
  },
  // WGSL's texel coordinate is "i32, or u32" (wgsl.txt:24129); GLSL's `texelFetch` takes a
  // SIGNED one only. Measured on a WebGL2 driver: `texelFetch(t, uvec2(0u, 0u), 0)` is "no
  // matching overloaded function found", while `texelFetch(t, ivec2(uvec2(0u, 0u)), 0)`
  // compiles. So an UNSIGNED coordinate gets its own ids, which wrap it in the signed
  // constructor of the texture's own width; the signed ids above are untouched, and no emit
  // that already worked moves a byte. The width is the texture's and the registry sees
  // argument STRINGS, which is why it is an id per width — as `textureDimensions3d` is.
  textureLoadU: {
    wgsl: (a) => `textureLoad(${join(a)})`,
    glsl: (a) =>
      a.length >= 3
        ? `texelFetch(${a[0]}, ivec2(${a[1]}), int(${a[2]}))`
        : `texelFetch(${a[0]}, ivec2(${a[1]}), 0)`,
  },
  textureLoad3dU: {
    wgsl: (a) => `textureLoad(${join(a)})`,
    glsl: (a) =>
      a.length >= 3
        ? `texelFetch(${a[0]}, ivec3(${a[1]}), int(${a[2]}))`
        : `texelFetch(${a[0]}, ivec3(${a[1]}), 0)`,
  },
  textureLoadArrayU: {
    wgsl: (a) => `textureLoad(${join(a)})`,
    glsl: (a) => `texelFetch(${a[0]}, ivec3(ivec2(${a[1]}), int(${a[2]})), int(${a[3]}))`,
  },
  // GLSL textureSize REQUIRES an int lod (WGSL textureDimensions(t) defaults to base
  // level 0); supply 0 when absent, else cast the given level to int. WGSL
  // textureDimensions returns vec2<u32> but GLSL textureSize returns a SIGNED ivec2 —
  // wrap in uvec2() so the GLSL type matches the IR's u32 type. Without this the
  // mismatch is masked while the call is inlined into an int context, but breaks the
  // moment the optimizer's CSE hoists it into a typed `uvec2 _cse = …` local.
  // 2d-array (X-GIS #1651) needs NO array-specific id here: WGSL textureDimensions returns
  // vec2<u32> for an array texture too (the layer count is textureNumLayers), and
  // GLSL's textureSize(sampler2DArray, lod) returns an ivec3 whose extra component the
  // uvec2() constructor legally DROPS (GLSL ES 3.00 §5.4.2). Escape hatch if a driver
  // ever objects: spell the truncation explicitly as `uvec2(textureSize(t, l).xy)`.
  // arrayLength(&x) — the runtime length of a storage array (#46). WGSL takes a POINTER to a
  // runtime-sized array in the storage space: the binding itself or a trailing struct member,
  // and nothing else (Tint refuses `arrayLength(src)` and `arrayLength(&src[0])`). The front
  // end restricts the operand to exactly that shape, so `&` before the rendered argument is
  // always a pointer to what the builtin accepts. GLSL ES 3.00 has no storage buffer and no
  // runtime-sized array, so there is no `.length()` to spell (that is GLSL ES 3.10); a module
  // carrying one never reaches this column, since the capability gate refuses it first, and
  // the spelling fails closed rather than inventing text ANGLE cannot parse.
  arrayLength: {
    wgsl: (a) => `arrayLength(&${a[0]})`,
    glsl: () => {
      throw new Error(
        'glsl-es300: arrayLength has no GLSL ES 3.00 spelling (no storage buffers, no runtime-sized arrays)',
      )
    },
  },
  // atomicLoad(&x), atomicAdd(&x, v), ... — the location argument is a pointer on WGSL, and
  // the front end restricts it to what the builtins accept (an atomic in storage). GLSL ES
  // 3.00 has no atomic memory functions; the column fails closed like arrayLength's.
  ...atomicSpellings(),
  // The depth comparisons (roadmap 0.4 item 11). Each shape takes its OWN neutral id, never an
  // arity branch on one entry — the rule `textureSampleArray` is written under, and for the
  // same reason: the ids restructure their arguments differently rather than merely adding one.
  //
  // On WGSL the sampler is an argument and the reference follows the coordinate. On GLSL the
  // sampler FUSES into the combined `sampler2DShadow` and the reference folds INTO the
  // coordinate — `vec3(uv, ref)`, and `vec4(uv, layer, ref)` on the array form, where the layer
  // folds in too. Measured on a WebGL2 driver, which takes all four.
  //
  // `textureSampleCompare` needs implicit derivatives, so Tint allows it in a fragment stage
  // only ("built-in cannot be used by compute pipeline stage"); `textureSampleCompareLevel`
  // samples at level 0 and is legal anywhere, which is what `textureLod(..., 0.0)` is — on the
  // 2D form. GLSL ES 3.00 has NO `textureLod` overload for `sampler2DArrayShadow` ("no matching
  // overloaded function found", measured on a WebGL2 driver after the compile gate caught it),
  // so the array form spells level 0 as `textureGrad` with zero gradients, which the same
  // driver takes in a fragment AND a vertex stage. A zero gradient is a level of detail of
  // -infinity, clamped to the base level: level 0, said the one way the target has to say it.
  textureSampleCompare: {
    wgsl: (a) => `textureSampleCompare(${join(a)})`,
    glsl: (a) => `texture(${a[0]}, vec3(${a[2]}, ${a[3]}))`,
  },
  textureSampleCompareArray: {
    wgsl: (a) => `textureSampleCompare(${join(a)})`,
    glsl: (a) => `texture(${a[0]}, vec4(${a[2]}, float(${a[3]}), ${a[4]}))`,
  },
  textureSampleCompareLevel: {
    wgsl: (a) => `textureSampleCompareLevel(${join(a)})`,
    glsl: (a) => `textureLod(${a[0]}, vec3(${a[2]}, ${a[3]}), 0.0)`,
  },
  textureSampleCompareLevelArray: {
    wgsl: (a) => `textureSampleCompareLevel(${join(a)})`,
    glsl: (a) =>
      `textureGrad(${a[0]}, vec4(${a[2]}, float(${a[3]}), ${a[4]}), vec2(0.0), vec2(0.0))`,
  },
  // The cube forms (roadmap 0.4 item 12): the coordinate is a vec3 DIRECTION, so the reference
  // folds into a vec4 — their own ids, since `vec3(dir, ref)` would be a constructor with a
  // component too many. `textureLod` has no `samplerCubeShadow` overload either (measured, the
  // same gap as the 2d array's), so level 0 is again `textureGrad` with zero gradients, three
  // wide this time because the gradients have the coordinate's width.
  textureSampleCompareCube: {
    wgsl: (a) => `textureSampleCompare(${join(a)})`,
    glsl: (a) => `texture(${a[0]}, vec4(${a[2]}, ${a[3]}))`,
  },
  textureSampleCompareLevelCube: {
    wgsl: (a) => `textureSampleCompareLevel(${join(a)})`,
    glsl: (a) => `textureGrad(${a[0]}, vec4(${a[2]}, ${a[3]}), vec3(0.0), vec3(0.0))`,
  },
  // textureStore(tex, coord, value) and its array form (roadmap 0.4 item 10). WGSL spells
  // both `textureStore`, with the layer between the coordinate and the value on the array one,
  // which is exactly the argument order the front end builds. GLSL ES 3.00 has no image
  // load/store at all — that is ES 3.10, and a WebGL2 driver refuses both the `image2D` type
  // and the extension that would bring it — so the column fails closed like the barriers'. A
  // module reaching it has slipped past the `storageTexture` capability, which is the gate.
  textureStore: {
    wgsl: (a) => `textureStore(${join(a)})`,
    glsl: () => {
      throw new Error(
        'glsl-es300: textureStore has no GLSL ES 3.00 spelling (image load/store is ES 3.10)',
      )
    },
  },
  // The barriers take no argument and return nothing; GLSL ES 3.00 has no compute stage.
  workgroupBarrier: {
    wgsl: () => 'workgroupBarrier()',
    glsl: () => {
      throw new Error(
        'glsl-es300: workgroupBarrier has no GLSL ES 3.00 spelling (no compute stage)',
      )
    },
  },
  storageBarrier: {
    wgsl: () => 'storageBarrier()',
    glsl: () => {
      throw new Error('glsl-es300: storageBarrier has no GLSL ES 3.00 spelling (no compute stage)')
    },
  },
  textureDimensions: {
    wgsl: (a) => `textureDimensions(${join(a)})`,
    glsl: (a) =>
      a.length >= 2
        ? `uvec2(textureSize(${a[0]}, int(${a[1]})))`
        : `uvec2(textureSize(${a[0]}, 0))`,
  },
  // textureDimensions3d(t) — a 3d texture's size is THREE wide (roadmap 0.4 item 12), so the
  // uvec2() wrapper above would drop its depth: its own id, for the reason textureNumLayers
  // is one. A cube's size is two wide on both targets (the size of one face), so a cube keeps
  // the entry above.
  textureDimensions3d: {
    wgsl: (a) => `textureDimensions(${join(a)})`,
    glsl: (a) =>
      a.length >= 2
        ? `uvec3(textureSize(${a[0]}, int(${a[1]})))`
        : `uvec3(textureSize(${a[0]}, 0))`,
  },
  // The multisampled reads (roadmap 0.4 item 13, WGSL-only under msaaTextureLoad). WGSL spells
  // them textureLoad / textureDimensions / textureNumSamples; GLSL ES 3.00 has no sampler2DMS
  // at all (ES 3.10), so every column fails closed. Their own ids rather than the 2d ones:
  // `texelFetch(t, c, int(s))` would be well-formed, wrong text for a sample index, and the
  // 2d wrapper's `textureSize(t, 0)` takes a level a multisampled texture has none of.
  textureLoadMs: {
    wgsl: (a) => `textureLoad(${join(a)})`,
    glsl: () => {
      throw new Error(
        'glsl-es300: a multisampled load has no GLSL ES 3.00 spelling (sampler2DMS is ES 3.10)',
      )
    },
  },
  textureLoadDepthMs: {
    wgsl: (a) => `textureLoad(${join(a)})`,
    glsl: () => {
      throw new Error(
        'glsl-es300: a multisampled depth load has no GLSL ES 3.00 spelling (sampler2DMS is ES 3.10)',
      )
    },
  },
  textureDimensionsMs: {
    wgsl: (a) => `textureDimensions(${join(a)})`,
    glsl: () => {
      throw new Error(
        'glsl-es300: textureDimensions on a multisampled texture has no GLSL ES 3.00 spelling',
      )
    },
  },
  textureNumSamples: {
    wgsl: (a) => `textureNumSamples(${join(a)})`,
    glsl: () => {
      throw new Error(
        'glsl-es300: textureNumSamples has no GLSL ES 3.00 spelling (textureSamples is ES 3.10)',
      )
    },
  },
  // textureDimensions1d(t) — ONE wide, a `u32` (roadmap 0.4 item 12); its own id for the reason
  // the 3d one is. GLSL ES 3.00 has no 1d texture, so the column fails closed.
  textureDimensions1d: {
    wgsl: (a) => `textureDimensions(${join(a)})`,
    glsl: () => {
      throw new Error('glsl-es300: textureDimensions on a texture_1d has no GLSL ES 3.00 spelling')
    },
  },
  // textureNumLayers(t) — the layer COUNT of a 2d-array texture (X-GIS #1658), i.e. the
  // ivec3 component the entry above deliberately DROPS. Its own id, not an overload
  // of textureDimensions: WGSL has a dedicated function, GLSL ES 3.00 has none and
  // reads `.z` off textureSize. GLSL's textureSize REQUIRES a lod argument, and the
  // layer count is LOD-INVARIANT (a mip reduces width/height only — depth stays N),
  // so 0 is always correct here regardless of the level the caller cares about. The
  // uint() wrap matches the IR's u32 type, same reason as the uvec2() above: the
  // signed ivec3 would be an int/uint compile error once CSE hoists the call into a
  // typed `uint _cse = …` local.
  textureNumLayers: {
    wgsl: (a) => `textureNumLayers(${join(a)})`,
    glsl: (a) => `uint(textureSize(${a[0]}, 0).z)`,
  },
  // The layer count of a STORAGE array (#147, wgsl.txt:24360; measured accepted on Tint). Its
  // own id because a storage texture has no mip levels: GLSL's `imageSize` takes no level and
  // is ES 3.10 anyway, so the whole storage family fails closed on GLSL through the
  // `storageTexture` capability and this column is never reached.
  textureNumLayersStorage: {
    wgsl: (a) => `textureNumLayers(${join(a)})`,
    glsl: () => {
      throw new Error(
        'glsl-es300: a storage texture has no GLSL ES 3.00 spelling (image load/store is ES 3.10)',
      )
    },
  },
  // ── The packed 4x8 integer family (#152, wgsl.txt:21906/21920) ──
  //
  // Eight builtins that read a `u32` as four packed bytes, or write four back. They are WGSL's
  // and WGSL's alone: GLSL ES 3.00 has no dot-product-of-packed-bytes and no byte pack, so every
  // GLSL column here throws and the `packed4x8Dot` capability is what fails a module closed on
  // that target before any writer is asked to spell one.
  //
  // Measured on Tint, with a broken shader fed to the same instrument first: all eight compile
  // with NO directive. `enable packed_4x8_integer_dot_product;` is refused — "expected
  // extension | Possible values: 'clip_distances', 'dual_source_blending', 'f16',
  // 'primitive_index', 'subgroups'" — because it is a LANGUAGE feature, not an extension. A
  // `requires packed_4x8_integer_dot_product;` is accepted and changes nothing, and the browser
  // reports the name in `navigator.gpu.wgslLanguageFeatures`. So the emitted module carries no
  // directive and `reflect().requiredLanguageFeatures` is where a host learns to check.
  dot4U8Packed: wgslOnly('dot4U8Packed'),
  dot4I8Packed: wgslOnly('dot4I8Packed'),
  pack4xU8: wgslOnly('pack4xU8'),
  pack4xI8: wgslOnly('pack4xI8'),
  pack4xU8Clamp: wgslOnly('pack4xU8Clamp'),
  pack4xI8Clamp: wgslOnly('pack4xI8Clamp'),
  unpack4xU8: wgslOnly('unpack4xU8'),
  unpack4xI8: wgslOnly('unpack4xI8'),
  // The fp64 anti-fast-math guard VALUE (runtime 1.0), spelled as a texel
  // fetch from the injected `_fp64` 1×1 texture (passes/fp64-lower.ts owns
  // the binding; the name is reserved). A UBO-sourced guard is defeated by
  // drivers that SPECIALIZE pipelines on observed uniform values and hot-swap
  // re-optimized variants (seen in the field: Windows/NVIDIA folding the df64
  // error-free-transformation terms mid-session) — no driver constant-folds
  // texel values. Zero-arg; the CPU oracle evaluates it as exactly 1.
  f64Guard: {
    wgsl: () => 'textureLoad(_fp64, vec2<i32>(0, 0), 0).x',
    glsl: () => 'texelFetch(_fp64, ivec2(0, 0), 0).x',
  },
  // Storage-buffer emulation (WebGL2 has no SSBO): GLSL-only synthetic. A storage read
  // data[i] lowers to a fetch from a DATA TEXTURE — a[0]=the sampler, a[1]=the element index.
  // 2D-TILED: the linear index maps to (i % W, i / W) where W = the texture's own width
  // (textureSize(t,0).x), so an array wider than one texture row (>maxTextureSize) wraps
  // across rows AND the 1-row case is unchanged (W=N → i%N=i, i/N=0). The shader reads the
  // device-chosen width, so no compile-time width constant needs syncing. Only the GLSL
  // backend sees this call (the pre-pass creates it); the wgsl spelling is unused.
  storageFetchF32: {
    wgsl: (a) => `storageFetchF32(${join(a)})`,
    glsl: storageFetchGlsl('_sfetch'),
  },
  // The INTEGER twins (X-GIS #1703) — the TYPED-texture leg of the same emulation, for a
  // top-level array<u32> / array<i32>. The index math is identical (hence the shared
  // spelling above); what differs is the sampler the binding declares — usampler2D /
  // isampler2D over an R32UI / R32I data texture — and therefore the type of the
  // fetched vec. That difference rides a DISTINCT ID rather than a type branch on one
  // id, the same rule the textureSample/textureSampleArray split follows.
  //
  // Why typed textures and not u32-lanes-bitcast-through-R32F: GLSL ES 3.00 §2.1.1
  // permits flushing ANY denormal to zero, and small integers are denormal f32 bit
  // patterns (1u is 1.4e-45), so the bitcast route can legally lose values. Exactness
  // is the entire point of an integer array.
  storageFetchU32: {
    wgsl: (a) => `storageFetchU32(${join(a)})`,
    glsl: storageFetchGlsl('_sfetchU'),
  },
  storageFetchI32: {
    wgsl: (a) => `storageFetchI32(${join(a)})`,
    glsl: storageFetchGlsl('_sfetchI'),
  },
}

// ── Spelling-embedded binding references ──
//
// Bindings an intrinsic's SPELLING references TEXTUALLY, with no Expr arg
// carrying them (f64Guard is zero-arg; its fetch names `_fp64` directly).
// Reference collection over the IR (ir/collect-refs) cannot see these — any
// consumer that decides "is this binding used?" (the GLSL per-stage emit
// scope) must also keep every binding listed here for each intrinsic it
// calls. An intrinsic that gains a hardcoded binding name MUST register it
// here, or per-stage emit drops the binding while the spelling still names it
// (a GPU compile error, caught by the compile gates).
/** The binding names an intrinsic's emitted text reads directly, keyed by intrinsic id, for
 *  the intrinsics whose spelling names a binding with no argument carrying it. Today that is
 *  `f64Guard`, whose fetch reads the `_fp64` texture. Reference collection over the IR walks
 *  argument nodes, so it cannot see these names. A consumer that trims a shader stage down to
 *  the bindings it uses must also keep every binding listed here for each intrinsic call it
 *  keeps; otherwise the emitted GLSL reads a sampler the shader never declares, and the driver
 *  rejects it at compile time. Any intrinsic that hardcodes a binding name into its spelling
 *  needs a row here.
 *
 *  Exported from `typeshade`.
 */
export const INTRINSIC_BINDING_REFS: Readonly<Record<string, readonly string[]>> = {
  f64Guard: ['_fp64'],
}

// ── Spelling-provided helper functions ──
//
// The sibling of the table above: there, an intrinsic's spelling REFERENCES a name the
// unit must declare anyway; here, it references a name the unit must DEFINE, and the
// definition ships with the spelling so the two cannot drift.
//
// Each entry is a leaf — it calls only builtins — so a consumer may emit the definitions
// in any order at the top of its function section with no prototype and no dependency
// sort. `fn` is the name the spelling calls, exposed so a consumer can assert the pairing
// rather than re-derive it from the definition text.
/** The helper functions an intrinsic's GLSL spelling calls, keyed by intrinsic id. `fn` is the
 *  name the spelling calls and `def` is the GLSL definition of that function. A GLSL writer must
 *  emit `def` for every listed intrinsic that a reachable function calls; otherwise the spelling
 *  calls a function the shader never defines. Each definition calls only GLSL builtins, so the
 *  definitions can be emitted in any order at the top of the function section, with no
 *  prototype. A helper that nothing calls compiles but adds bytes, so key the emit off the calls
 *  actually collected.
 *
 *  Only the GLSL target has helpers: WGSL indexes storage buffers directly. Exported from
 *  `typeshade`.
 */
export const INTRINSIC_HELPERS: Readonly<
  Record<string, { readonly fn: string; readonly def: string }>
> = {
  storageFetchF32: { fn: '_sfetch', def: storageFetchDef('float', 'sampler2D', '_sfetch') },
  storageFetchU32: { fn: '_sfetchU', def: storageFetchDef('uint', 'usampler2D', '_sfetchU') },
  storageFetchI32: { fn: '_sfetchI', def: storageFetchDef('int', 'isampler2D', '_sfetchI') },
}

/** Spells a call for one target. When `name` has an {@link INTRINSICS} entry, returns that
 *  entry's spelling for `target` applied to `args`; otherwise returns `name(args)` with the
 *  arguments joined by `, `, which covers portable builtins and user-defined function calls
 *  alike.
 *
 *  @param target The target to spell for, `'wgsl'` or `'glsl'`.
 *  @param name The builtin id or function name.
 *  @param args The argument expressions, already rendered as source text.
 *  @returns The call as source text for `target`.
 *  @example
 *  spellIntrinsic('glsl', 'atan2', ['y', 'x']) // 'atan(y, x)'
 *  spellIntrinsic('wgsl', 'dot', ['a', 'b'])   // 'dot(a, b)'
 */
export function spellIntrinsic(
  target: IntrinsicTarget,
  name: string,
  args: readonly string[],
): string {
  const entry = INTRINSICS[name]
  if (entry) return entry[target](args)
  return `${name}(${join(args)})`
}

/** Returns true when `name`'s spelling splices an argument into a position that binds tighter
 *  than a plain argument slot, such as an operand of an inlined operator or the base of a
 *  `.field` postfix. In that case the caller must render every argument as a primary expression
 *  (parenthesized unless it is already a single token), because a bare `a + b` spliced into
 *  `a + b / c` parses as different arithmetic. Returns false for an id with no entry.
 *
 *  @param name The builtin id.
 */
export const intrinsicNeedsAtomArgs = (name: string): boolean => INTRINSICS[name]?.atomArgs === true

// ── Portable builtins (the EXPLICIT identity-spelled set) ──
//
// The DSL's free-function builtins (core/ir/node.ts) emit a `call` whose `fn` id is spelled
// IDENTICALLY in WGSL and GLSL ES 3.00 — so they need no INTRINSICS entry and fall through
// `spellIntrinsic` as `name(args)`. The risk that makes the registry a silent agreement
// surface: a NEW builtin whose spelling actually DIVERGES, added without an INTRINSICS entry,
// also falls through — emitting the same (wrong-on-one-target) string, caught only at GPU
// compile time. Listing the portable ids EXPLICITLY here turns "absent = assume identity" into
// "absent = unclassified", which the catalogue test (intrinsic-coverage.test.ts) flags: every
// builtin id the surface emits must be in INTRINSICS (divergent) OR here (asserted identical).
/** The builtin ids that spell identically on both targets, such as `sin`, `dot` and `clamp`.
 *  These carry no {@link INTRINSICS} entry and fall through {@link spellIntrinsic} as the plain
 *  `name(args)` form. `spellIntrinsic` never reads this set; it exists so that
 *  {@link isKnownIntrinsic} can tell a builtin known to be identical from an id nobody has
 *  classified, a distinction {@link fp64Lower} relies on when it checks which builtins may be
 *  applied to `f64` values. Add a builtin here only when its spelling is the same in WGSL and
 *  GLSL ES 3.00; a builtin whose spelling differs belongs in `INTRINSICS`, since listing it here
 *  would emit the same text on both targets and one of them would be wrong.
 *
 *  Exported from `typeshade`.
 */
export const PORTABLE_INTRINSICS: ReadonlySet<string> = new Set([
  // Reductions of a vector of bools (roadmap 0.2 item 7) — same name in WGSL + GLSL ES 3.00.
  'any',
  'all',
  // Geometry and matrices (roadmap 0.2 item 8) — same name on both.
  'reflect',
  'refract',
  'transpose',
  'determinant',
  // genType1 (component-wise unary) — same name in WGSL + GLSL ES 3.00.
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  // Hyperbolics — WGSL §17.5 and GLSL ES 3.00 §8.1 both spell all six natively.
  'sinh',
  'cosh',
  'tanh',
  'asinh',
  'acosh',
  'atanh',
  'exp',
  'log',
  'log2',
  'exp2',
  'floor',
  'ceil',
  'abs',
  'sqrt',
  'fract',
  'trunc',
  // 'round' moved to INTRINSICS: GLSL ES 3.00's round() is implementation-chosen
  // at exact halves, so it now spells roundEven there (see the registry entry).
  'sign',
  'radians',
  'degrees',
  'normalize',
  'fwidth',
  // multi-arg math — identical spelling on both targets.
  'min',
  'max',
  'pow',
  'clamp',
  'mix',
  'smoothstep',
  'step',
  'length',
  'dot',
  'distance',
  'cross',
])

// ── Pre-emit-consumed builtins (the THIRD classification) ──
//
// Ids the authoring surface emits that are consumed ENTIRELY by a pre-emit
// pass and must NEVER reach spellIntrinsic on any target: the fp64 widen
// `'f64'` (toF64 / the implicit f32→f64 widen), `'f64FromParts'` (hi/lo lane
// pair → f64), and `'f64Parts'` (f64 → its vec2 pair) are rewritten by
// fp64Lower into constructs / the identity. The CPU oracle evaluates them
// natively (BUILTINS); if one leaked to a backend the emitted call is invalid
// GLSL — the wgslType/glslType SD0040 backstops make the leak loud.
/** The builtin ids that {@link fp64Lower} rewrites away before any backend runs: `'f64'` (the
 *  widen from `f32` to `f64`), `'f64FromParts'` (an `f64` assembled from its high and low `f32`
 *  parts) and `'f64Parts'` (an `f64` split into that pair). Ids in {@link PORTABLE_INTRINSICS}
 *  do reach {@link spellIntrinsic}; these must not. {@link isKnownIntrinsic} excludes them, so
 *  if one survives to a backend, that backend throws `SD0040` when it is asked to spell the
 *  `f64` type the call carries, and the failure is reported before the driver sees invalid
 *  source.
 *
 *  Exported from `typeshade`.
 */
export const PRE_EMIT_INTRINSICS: ReadonlySet<string> = new Set(['f64', 'f64FromParts', 'f64Parts'])

/** Returns true when `name` is a builtin the registry can spell on every target: either an id
 *  with an {@link INTRINSICS} entry or a member of {@link PORTABLE_INTRINSICS}. An id that is
 *  neither is a user-defined or external function, which spells the same everywhere, or a
 *  builtin nobody has classified yet. Ids in {@link PRE_EMIT_INTRINSICS} return false: they are
 *  removed before emit and have no spelling.
 *
 *  @param name The `call` id to test.
 */
export const isKnownIntrinsic = (name: string): boolean =>
  Object.prototype.hasOwnProperty.call(INTRINSICS, name) || PORTABLE_INTRINSICS.has(name)
