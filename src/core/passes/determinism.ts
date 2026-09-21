// ═══ Shader DSL — determinism report (roadmap 0.7 item 22) ═══
//
// Which operations in a module may give a different answer on a different driver, and so a
// different answer from the CPU oracle. WGSL §15.7.4 gives every floating-point operation one
// of five accuracies: a correct result, a correctly rounded result, an absolute error bound,
// a bound in ULP, or "inherited from" a formula the driver may evaluate in any way at least
// as accurate, and §15.7.5 lets it reassociate and fuse while doing so. The report treats the
// first two as one answer and lists everything else: the other three name the room two
// conforming drivers have to disagree in, with the spec's own bound in words, how often the
// operation occurs and where.
//
// "One answer" is the report's assumption, not the spec's words. WGSL fixes no rounding mode
// (a correctly rounded result may be either neighbour, §15.7.4) and lets any operation flush
// a subnormal to zero (§15.7.3); every shipping driver rounds to nearest even, so the report
// counts a correctly rounded result as one value and leaves the subnormal corners alone.
//
// GLSL ES 3.00 §4.5.1 bounds the arithmetic operators, `a * b + c`, `pow`, `exp`, `exp2`,
// `log`, `log2`, `sqrt`, `inversesqrt` and the explicit conversions with the numbers WGSL gives
// them, lets every builtin the spec defines by an equation (the geometric and common
// functions) inherit those bounds, and leaves the trigonometric functions, `determinant` and
// the derivatives with undefined precision. So the `inherited` rows mean the same on both
// targets, and the `absolute`, `ulp` and `unbounded` rows are bounded by the driver alone on
// GLSL. Where the two targets can differ on an input WGSL settles (`ldexp`, the three `pack`
// builtins) the row's kind is `target` and its `note` says on which input.
//
// The report reads the IR the front end built, before either backend lowers it, so it names
// what the author wrote: `fma`, not the `a * b + c` GLSL spells it as; `mod`, not
// `x - y * floor(x / y)`. Emulated doubles (`f64`, `vecNf64`, `matNf64`) are their own kind:
// an f64 operation lowers to f32 steps whose error terms hold only while the driver neither
// reassociates nor fuses them, which §15.7.5 allows and the `_fp64` guard texture exists to
// prevent (fp64/df64-lib.ts). A `raw` statement is opaque WGSL and is not read.
//
// `accuracyOf` answers for EVERY builtin the compiler can emit: determinism.test.ts walks
// INTRINSICS, PORTABLE_INTRINSICS and the CPU BUILTINS and fails on a name it does not place,
// so a new builtin has to be put in one column or the other. The exact column agrees with
// const-fold's EXACT_BUILTINS except for `fract`: the spec words it as inherited from
// `x - floor(x)` and its own note says `fract` of a tiny negative may be 1.0, so it has two
// allowed answers; the fold picks one of them, which is const-fold's matter, not this table's.

import type { Expr, ModuleDecl, ShaderType } from '../ir/index.js'
import { eachExpr, eachStmtExpr } from '../ir/visit.js'

/** Why an operation's result may differ by driver, in WGSL §15.7.4's own categories plus
 *  three of TypeShade's. `ulp` and `absolute` are the spec's numeric bounds (`absolute` also
 *  covers `acos`, `asin` and `tanh`, which the spec bounds by the worse of an absolute error
 *  and an inherited formula); `inherited` is an operation the spec defines by a formula the
 *  driver may reassociate or fuse, the matrix products included; `unbounded` is a derivative
 *  or `determinant`, where the spec asks only for a pragmatically useful result; `filtered` is
 *  a texture read whose footprint, filtering and level selection are implementation-defined,
 *  a gather included; `target` is an operation WGSL settles that the GLSL ES 3.00 spelling may
 *  answer differently on some input; `emulated` is an `f64` operation, computed in f32 pairs
 *  whose error terms a driver may fold.
 *
 *  Exported from `typeshade`.
 */
export type DeterminismKind =
  'ulp' | 'absolute' | 'inherited' | 'unbounded' | 'filtered' | 'target' | 'emulated'

/** What {@link accuracyOf} says about one operation: `exact` when WGSL gives it one answer
 *  (a correct or correctly rounded result, with the rounding-mode assumption the module header
 *  states) and both targets agree, otherwise the kind of room left and its bound in words,
 *  with a `note` where the GLSL ES 3.00 spelling matters.
 *
 *  Exported from `typeshade`.
 */
export type DeterminismAccuracy =
  | { readonly kind: 'exact' }
  | {
      readonly kind: Exclude<DeterminismKind, 'emulated'>
      readonly bound: string
      readonly note?: string
    }

/** One row of {@link determinismReport}: an operation the module uses whose result may differ
 *  by driver, with the spec's bound, how many times it occurs and where, in declaration order.
 *  An operation used on `f32` and on emulated `f64` is two rows.
 *
 *  Exported from `typeshade`.
 */
export interface DeterminismEntry {
  /** The operation as the IR names it: a builtin id (`sin`, `fma`, `textureSample`), a binary
   *  operator (`/`, `%`, and for `f64` every arithmetic operator), or a matrix product
   *  (`mat * vec`, `vec * mat`, `mat * mat`), which is a sum of products and not the
   *  component-wise `*`. */
  readonly op: string
  /** The float the operation computes in: native `f32`, or emulated `f64`. */
  readonly elem: 'f32' | 'f64'
  /** Why the result may differ. */
  readonly kind: DeterminismKind
  /** The bound in words, from WGSL §15.7.4 for `f32`, from the emulation for `f64`. */
  readonly accuracy: string
  /** How many times the operation occurs in the module. */
  readonly count: number
  /** Where it occurs: the module constants, module variables and functions whose initializer
   *  or body holds it, by name, in declaration order, each once. */
  readonly where: readonly string[]
  /** What the GLSL ES 3.00 spelling does differently, when that matters. */
  readonly note?: string
}

const ulp = (bound: string): DeterminismAccuracy => ({ kind: 'ulp', bound })
const absolute = (bound: string): DeterminismAccuracy => ({ kind: 'absolute', bound })
const inherited = (from: string, note?: string): DeterminismAccuracy =>
  note === undefined
    ? { kind: 'inherited', bound: `inherited from ${from}` }
    : { kind: 'inherited', bound: `inherited from ${from}`, note }
const target = (bound: string, note: string): DeterminismAccuracy => ({
  kind: 'target',
  bound,
  note,
})
const UNBOUNDED: DeterminismAccuracy = {
  kind: 'unbounded',
  bound: 'no bound: the spec asks only for a pragmatically useful result',
}
const FILTERED: DeterminismAccuracy = {
  kind: 'filtered',
  bound: 'texture filtering and level of detail selection are implementation-defined',
}
const GATHERED: DeterminismAccuracy = {
  kind: 'filtered',
  bound:
    'the four texel values are read unfiltered, but which four the level 0 footprint selects, and the edge and cube corner handling, follow texture sampling',
}
const EXACT: DeterminismAccuracy = { kind: 'exact' }

const EMULATED_BOUND =
  'emulated double: f32 pairs whose error terms hold while the driver neither reassociates nor fuses them, which WGSL §15.7.5 allows and the _fp64 guard texture prevents'

const HALF_NOTE =
  'GLSL ES 3.00 rounds the scaled value with round(), whose exact half goes in an implementation-chosen direction; WGSL takes floor(0.5 + x), so an input that lands on a half may pack one step apart'

const SNORM_HALF_NOTE =
  'the GLSL ES 3.00 spelling is hand-inlined as floor(0.5 + 127 * clamp(e, -1, 1)), which is the rule WGSL states, while a WGSL driver may round the same tie to even; the two part on the values whose f32 product with 127 lands exactly on a half'

const QUANTIZE_NOTE =
  'GLSL ES 3.00 has no such builtin and the backend spells it as packHalf2x16 then unpackHalf2x16, one component at a time; measured against a WGSL driver, the two part in three places — a value exactly halfway between two binary16 neighbours (the GLSL round trip rounds to nearest even, the driver moved), a magnitude above the largest finite binary16 (WGSL gives an infinity, the GLSL round trip a NaN), and a magnitude below the smallest normal one (the driver flushed it to zero, the GLSL round trip kept the subnormal)'

/** WGSL §15.7.4.1, the rows that are not "correctly rounded" or "correct result", keyed by the
 *  IR's name for the operation, plus the `target` rows where the GLSL ES 3.00 spelling can
 *  answer differently on an input WGSL settles. `degrees` and `radians` are inherited rows
 *  and stay: the product with the constant is not representable, and a driver may carry the
 *  constant at a precision the two-step spelling does not. */
const F32_ACCURACY: Readonly<Record<string, DeterminismAccuracy>> = {
  '/': ulp('2.5 ULP for a divisor with magnitude in [2^-126, 2^126]'),
  '%': inherited('x - y * trunc(x / y)'),
  acos: absolute('the worse of 6.77e-5 absolute error and atan2(sqrt(1 - x * x), x)'),
  acosh: inherited('log(x + sqrt(x * x - 1))'),
  asin: absolute('the worse of 6.81e-5 absolute error and atan2(x, sqrt(1 - x * x))'),
  asinh: inherited('log(x + sqrt(x * x + 1))'),
  atan: ulp('4096 ULP'),
  atan2: ulp('4096 ULP for |x| in [2^-126, 2^126] and a finite normal y'),
  atanh: inherited('log((1 + x) / (1 - x)) * 0.5'),
  cos: absolute('2^-11 absolute error for x in [-π, π]'),
  cosh: inherited('(exp(x) + exp(-x)) * 0.5'),
  cross: inherited('x[i] * y[j] - x[j] * y[i]'),
  degrees: inherited('x * 57.295779513082322865'),
  determinant: UNBOUNDED,
  distance: inherited('length(x - y)'),
  dot: inherited('the sum of x[i] * y[i]'),
  dpdx: UNBOUNDED,
  dpdxCoarse: UNBOUNDED,
  dpdxFine: UNBOUNDED,
  dpdy: UNBOUNDED,
  dpdyCoarse: UNBOUNDED,
  dpdyFine: UNBOUNDED,
  exp: ulp('3 + 2 * |x| ULP'),
  exp2: ulp('3 + 2 * |x| ULP'),
  faceForward: inherited('select(-x, x, dot(z, y) < 0)'),
  fma: inherited(
    'x * y + z',
    'GLSL ES 3.00 has no fma and the backend spells it a * b + c, which its §4.5.1 lets be one fused or two correctly rounded operations, the same room WGSL leaves fma',
  ),
  fract: {
    kind: 'inherited',
    bound:
      'inherited from x - floor(x): one value for x >= 0 and for a negative x whose fraction fits 24 bits, and 1 or 1 - 2^-24 for a tiny negative x',
  },
  fwidth: UNBOUNDED,
  fwidthCoarse: UNBOUNDED,
  fwidthFine: UNBOUNDED,
  inverseSqrt: ulp('2 ULP'),
  ldexp: target(
    'correctly rounded',
    'GLSL ES 3.00 has no ldexp and the backend builds 2^e from bits, which overflows at e = 128, where WGSL gives the finite x * 2^128',
  ),
  length: inherited('sqrt(dot(x, x)) for a vector, sqrt(x * x) for a scalar'),
  log: absolute('2^-21 absolute error for x in [0.5, 2], 3 ULP outside it'),
  log2: absolute('2^-21 absolute error for x in [0.5, 2], 3 ULP outside it'),
  mix: inherited('x * (1 - z) + y * z'),
  mod: inherited(
    'x - y * floor(x / y)',
    'spelled x - y * floor(x / y) on WGSL and mod(x, y) on GLSL ES 3.00; both inherit from that formula',
  ),
  normalize: inherited('x / length(x)'),
  pack2x16snorm: target('correct result', HALF_NOTE),
  pack2x16unorm: target('correct result', HALF_NOTE),
  pack4x8unorm: target('correct result', HALF_NOTE),
  // The signed twin (#150). It was first recorded EXACT, on the reasoning that its GLSL inline
  // spells WGSL's own `floor(0.5 + x)` where the unorm one spells `round()`. Measured on a
  // real driver, that is not enough: WGSL's `pack4x8snorm` is a native builtin there too, and
  // the driver rounded the tie to EVEN while the inline rounds it up, so the two targets part
  // on exactly the inputs the unorm row already records.
  pack4x8snorm: target('correct result', SNORM_HALF_NOTE),
  // The four `quantizeToF16` widths (#150). WGSL converts to IEEE-754 binary16 and back with
  // one rounding, and the CPU oracle implements round-to-nearest-even, the conversion real
  // GPUs do. GLSL ES 3.00 has no such builtin, so the backend spells it as the
  // packHalf2x16/unpackHalf2x16 round trip, and THAT spec does not pin the rounding of the
  // f32 → binary16 conversion. A value exactly halfway between two binary16 neighbours may
  // therefore come back one step apart on the two targets; every other value is one answer.
  quantizeToF16: target('correct result', QUANTIZE_NOTE),
  quantizeToF16Vec2: target('correct result', QUANTIZE_NOTE),
  quantizeToF16Vec3: target('correct result', QUANTIZE_NOTE),
  quantizeToF16Vec4: target('correct result', QUANTIZE_NOTE),
  pow: inherited('exp2(y * log2(x))'),
  radians: inherited('x * 0.017453292519943295474'),
  reflect: inherited('x - 2 * dot(x, y) * y'),
  refract: inherited(
    'z * x - (z * dot(y, x) + sqrt(k)) * y, k = 1 - z * z * (1 - dot(y, x) * dot(y, x))',
  ),
  sin: absolute('2^-11 absolute error for x in [-π, π]'),
  sinh: inherited('(exp(x) - exp(-x)) * 0.5'),
  smoothstep: inherited('t * t * (3 - 2 * t), t = clamp((x - edge0) / (edge1 - edge0), 0, 1)'),
  sqrt: inherited('1 / inverseSqrt(x)'),
  tan: inherited('sin(x) / cos(x)'),
  tanh: absolute('the worse of 1e-5 absolute error and sinh(x) / cosh(x)'),
  unpack2x16snorm: ulp('3 ULP'),
  unpack2x16unorm: ulp('3 ULP'),
  unpack4x8snorm: ulp('3 ULP'),
  unpack4x8unorm: ulp('3 ULP'),
}

/** The matrix products, which the IR spells as `binop '*'` like the component-wise product
 *  but which WGSL §8.8 defines through `dot`, an inherited row. */
const MATRIX_PRODUCT: Readonly<Record<string, DeterminismAccuracy>> = {
  'mat * vec': inherited('dot(transpose(m)[i], v) for component i'),
  'vec * mat': inherited('dot(v, m[i]) for component i'),
  'mat * mat': inherited('the matrix product, each element a sum of products'),
}

/** Every id whose name begins with one of these has one answer: a texel fetch, a size, a
 *  store, an atomic, the storage emulation's fetches, a bit cast and the f64 plumbing (`f64`,
 *  `f64Guard`, `f64FromParts`, `f64Parts`). `textureSample` and `textureGather` are checked
 *  first, so the `texture` prefixes here never reach a filtered read. */
const EXACT_PREFIXES: readonly string[] = [
  'textureLoad',
  'textureDimensions',
  'textureNum',
  'textureStore',
  'atomic',
  'storageFetch',
  'bitcast',
  'f64',
]

/** The correctly rounded and correct-result rows of §15.7.4.1 that the compiler can emit and
 *  both targets agree on, the integer and bit builtins (a correct result), the conversions
 *  (correctly rounded), the vector predicates, `select`, the barriers, `arrayLength`, and the
 *  arithmetic operators that are correctly rounded on `f32` (`+`, `-`, the component-wise `*`)
 *  or integral. */
const EXACT_OPS: ReadonlySet<string> = new Set([
  '+',
  '-',
  '*',
  '&',
  '|',
  '^',
  '<<',
  '>>',
  'abs',
  'ceil',
  'floor',
  'trunc',
  'round',
  'sign',
  'min',
  'max',
  'clamp',
  'saturate',
  'step',
  'transpose',
  'any',
  'all',
  'select',
  'f32',
  'i32',
  'u32',
  '__fround',
  'pack2x16float',
  'unpack2x16float',
  'countOneBits',
  'reverseBits',
  'countLeadingZeros',
  'countTrailingZeros',
  'firstLeadingBit',
  'firstTrailingBit',
  'extractBits',
  'insertBits',
  'arrayLength',
  'workgroupBarrier',
  'storageBarrier',
])

/** What WGSL §15.7.4 allows the result of one operation to be, for a builtin id, a binary
 *  operator or a matrix product (`mat * vec`, `vec * mat`, `mat * mat`) as the IR names it,
 *  computing in `f32`: `{ kind: 'exact' }` when there is one answer and both targets give it,
 *  otherwise the kind and bound {@link determinismReport} would list it with. `undefined` for a
 *  name the table does not know, which the test suite turns into a failure for every id the
 *  compiler can emit, so the answer is never `undefined` for a real one.
 *
 *  Exported from `typeshade`.
 */
export function accuracyOf(op: string): DeterminismAccuracy | undefined {
  const row = F32_ACCURACY[op] ?? MATRIX_PRODUCT[op]
  if (row !== undefined) return row
  if (op.startsWith('textureSample')) return FILTERED
  if (op.startsWith('textureGather')) return GATHERED
  if (EXACT_PREFIXES.some((p) => op.startsWith(p))) return EXACT
  return EXACT_OPS.has(op) ? EXACT : undefined
}

function floatElemOf(t: ShaderType): 'f32' | 'f64' | undefined {
  switch (t.kind) {
    case 'scalar':
      return t.scalar === 'f32' ? 'f32' : undefined
    case 'vec':
      return t.elem === 'f32' ? 'f32' : undefined
    case 'f64':
    case 'vec64':
      return 'f64'
    case 'mat':
      return t.elem
    default:
      return undefined
  }
}

const isMat = (t: ShaderType): boolean => t.kind === 'mat'
const isVector = (t: ShaderType): boolean => t.kind === 'vec' || t.kind === 'vec64'

/** The report's name for a `binop`: the operator, or the matrix product it spells. */
function binopName(e: Extract<Expr, { op: 'binop' }>): string {
  if (e.bop !== '*') return e.bop
  const a = e.a.type
  const b = e.b.type
  if (isMat(a) && isMat(b)) return 'mat * mat'
  if (isMat(a) && isVector(b)) return 'mat * vec'
  if (isVector(a) && isMat(b)) return 'vec * mat'
  return '*'
}

type Hit = Omit<DeterminismEntry, 'count' | 'where'>

/** On `f64` every arithmetic operator is an error-free transformation, and so is `floor`,
 *  whose df64 twin renormalises through one; `abs`, `min`, `max`, `select` and the casts are
 *  selections and stay exact on a double. */
const F64_EMULATED: ReadonlySet<string> = new Set(['+', '-', '*', '/', '%', 'floor'])

function hitOf(e: Expr): Hit | undefined {
  let op: string
  if (e.op === 'binop') op = binopName(e)
  else if (e.op === 'call' && e.declRef === undefined) op = e.fn
  else return undefined
  const elem = floatElemOf(e.type)
  if (elem === undefined) return undefined
  const acc = accuracyOf(op)
  if (elem === 'f64') {
    const listed =
      F64_EMULATED.has(op) ||
      op.startsWith('mat') ||
      op.startsWith('vec * ') ||
      (acc !== undefined && acc.kind !== 'exact')
    return listed ? { op, elem, kind: 'emulated', accuracy: EMULATED_BOUND } : undefined
  }
  if (acc === undefined || acc.kind === 'exact') return undefined
  return acc.note === undefined
    ? { op, elem, kind: acc.kind, accuracy: acc.bound }
    : { op, elem, kind: acc.kind, accuracy: acc.bound, note: acc.note }
}

/** The operations in `m` whose result may differ by driver, one entry per operation and float
 *  kind, in order of first appearance over the module constants, the module variables and the
 *  functions: a builtin with a ULP or absolute bound (`sin`, `exp`, `atan2`, `/`), one
 *  inherited from a formula the driver may reassociate or fuse (`pow`, `mix`, `normalize`,
 *  `fma`, `fract`, the matrix products), a derivative or `determinant`, a filtered texture read
 *  or gather, an operation the GLSL ES 3.00 spelling may answer differently (`ldexp`, the
 *  `pack` builtins), and every emulated `f64` arithmetic operator and bounded builtin. Empty
 *  when every operation in the module has one answer under the assumption the module header
 *  states, which is when a GPU result and the CPU oracle can differ only by the oracle's own
 *  rounding and never by the driver's choice. A `raw` statement is opaque and contributes
 *  nothing; a call to the module's own helper is not listed itself, its body is.
 *  {@link accuracyOf} answers for a single operation.
 *
 *  Exported from `typeshade`; `compile()` returns it as `determinism`.
 */
export function determinismReport(m: ModuleDecl): readonly DeterminismEntry[] {
  const rows = new Map<string, { hit: Hit; count: number; where: Set<string> }>()
  const visitorFor = (site: string) => (e: Expr) => {
    const hit = hitOf(e)
    if (hit === undefined) return
    const key = `${hit.elem} ${hit.op}`
    const row = rows.get(key)
    if (row === undefined) rows.set(key, { hit, count: 1, where: new Set([site]) })
    else {
      row.count++
      row.where.add(site)
    }
  }
  for (const c of m.consts) if (c.valueExpr !== undefined) eachExpr(c.valueExpr, visitorFor(c.name))
  for (const v of m.vars ?? []) if (v.init !== undefined) eachExpr(v.init, visitorFor(v.name))
  for (const fn of m.funcs) {
    const visit = visitorFor(fn.name)
    for (const s of fn.body) eachStmtExpr(s, (e) => eachExpr(e, visit))
  }
  return [...rows.values()].map(({ hit, count, where }) => ({ ...hit, count, where: [...where] }))
}
