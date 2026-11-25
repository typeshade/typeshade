// Implements: Rule 11.5 (docs/language-design.md; traced in reqs/).

import type { Expr, ModuleDecl, ShaderType } from '../ir/index.js';
import { eachExpr, eachStmtExpr } from '../ir/visit.js';
import { proveKernels } from './parallel-loop.js';
import { SUBGROUP_FOLDS, SUBGROUP_LANE_READS } from '../intrinsics.js';

/** Why an operation's result may differ by driver, in WGSL §15.7.4's own categories plus
 *  four of TypeShade's. `ulp` and `absolute` are the spec's numeric bounds (`absolute` also
 *  covers `acos`, `asin` and `tanh`, which the spec bounds by the worse of an absolute error
 *  and an inherited formula); `inherited` is an operation the spec defines by a formula the
 *  driver may reassociate or fuse, the matrix products included; `unbounded` is a derivative
 *  or `determinant`, where the spec asks only for a pragmatically useful result; `filtered` is
 *  a texture read whose footprint, filtering and level selection are implementation-defined,
 *  a gather included; `target` is an operation WGSL settles that the GLSL ES 3.00 spelling may
 *  answer differently on some input; `emulated` is an `f64` operation, computed in f32 pairs
 *  whose error terms a driver may fold; `order` is a floating-point reduction of a kernel
 *  function's loop, which every tier folds in Rule 7.2's tree, so it has one answer on every
 *  tier but not the one the loop's sequential reading gives.
 *
 *  Exported from `typeshade`.
 */
export type DeterminismKind =
  'ulp' | 'absolute' | 'inherited' | 'unbounded' | 'filtered' | 'target' | 'emulated' | 'order';

/** What {@link accuracyOf} says about one operation: `exact` when WGSL gives it one answer
 *  (a correct or correctly rounded result, with the rounding-mode assumption the module header
 *  states) and both targets agree, otherwise the kind of room left and its bound in words,
 *  with a `note` where the GLSL ES 3.00 spelling matters. An `exact` answer carries a `note`
 *  where the one answer holds only for some inputs: a `bitcast` of a NaN or a subnormal `f32`
 *  (change 0045).
 *
 *  Exported from `typeshade`.
 */
export type DeterminismAccuracy =
  | { readonly kind: 'exact'; readonly note?: string }
  | {
      readonly kind: Exclude<DeterminismKind, 'emulated' | 'order'>;
      readonly bound: string;
      readonly note?: string;
    };

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
  readonly op: string;
  /** The float the operation computes in: native `f32`, or emulated `f64`. An operation whose
   *  result is not a float is listed under the float it reads: a `pack`'s argument, and the
   *  coordinate of a `textureGather` on an integer texture, which is `f32`. */
  readonly elem: 'f32' | 'f64';
  /** Why the result may differ. */
  readonly kind: DeterminismKind;
  /** The bound in words, from WGSL §15.7.4 for `f32`, from the emulation for `f64`, and from
   *  Rule 7.2's tree for an `order` row. */
  readonly accuracy: string;
  /** How many times the operation occurs in the module. */
  readonly count: number;
  /** Where it occurs: the module constants, module variables and functions whose initializer
   *  or body holds it, by name, in declaration order, each once. */
  readonly where: readonly string[];
  /** What the GLSL ES 3.00 spelling does differently, when that matters. */
  readonly note?: string;
}

const ulp = (bound: string): DeterminismAccuracy => ({ kind: 'ulp', bound });
const absolute = (bound: string): DeterminismAccuracy => ({ kind: 'absolute', bound });
const inherited = (from: string, note?: string): DeterminismAccuracy =>
  note === undefined
    ? { kind: 'inherited', bound: `inherited from ${from}` }
    : { kind: 'inherited', bound: `inherited from ${from}`, note };
const target = (bound: string, note: string): DeterminismAccuracy => ({
  kind: 'target',
  bound,
  note,
});
const UNBOUNDED: DeterminismAccuracy = {
  kind: 'unbounded',
  bound: 'no bound: the spec asks only for a pragmatically useful result',
};
const FILTERED: DeterminismAccuracy = {
  kind: 'filtered',
  bound: 'texture filtering and level of detail selection are implementation-defined',
};
const GATHERED: DeterminismAccuracy = {
  kind: 'filtered',
  bound:
    'the four texel values are read unfiltered, but which four the level 0 footprint selects, and the edge and cube corner handling, follow texture sampling',
};
const EXACT: DeterminismAccuracy = { kind: 'exact' };

const POW_NOTE =
  "outside WGSL's domain (x < 0; x = 1 with y infinite; x infinite with y = 0), on GLSL ES 3.00 also at x = 0 with y <= 0, at an infinite result, which the bound inherited from exp2(y * log2(x)) does not hold, and in the sign of a zero, which no target is held to, a driver may give another value than the CPU tiers, which give ECMA-262's: measured on Tint and on WebGL2 over SwiftShader, eleven special pairs part: (-2)^3 was 8 (CPU -8), (-2)^0.5 was 1.4142138 (CPU NaN), 1^Infinity, 1^-Infinity, 1^NaN and (-1)^Infinity were +Infinity (CPU NaN), Infinity^0 was +Infinity (CPU 1), (-0)^3 was +0 (CPU -0), 0^-1 and (-0)^-1 were 2^127 (CPU +Infinity and -Infinity), and (-Infinity)^3 was +Infinity (CPU -Infinity)";

const BITCAST_EXACT: DeterminismAccuracy = {
  kind: 'exact',
  note:
    'one answer for a finite, normal f32; a NaN or subnormal bit pattern has no fixed answer ' +
    '(WGSL §15.7.2, GLSL ES 3.00 §2.1.1), so keep an integer word in a storage<array<u32>> binding',
};

const EMULATED_BOUND =
  'emulated double: f32 pairs whose error terms hold while the driver neither reassociates nor fuses them, which WGSL §15.7.5 allows and the _fp64 guard texture prevents';

const HALF_NOTE =
  'GLSL ES 3.00 rounds the scaled value with round(), whose exact half goes in an implementation-chosen direction; WGSL takes floor(0.5 + x), so an input that lands on a half may pack one step apart';

const UNORM_HALF_NOTE =
  'the GLSL ES 3.00 spelling is hand-inlined as floor(0.5 + 255 * clamp(e, 0, 1)), which is the rule WGSL states, while a WGSL driver rounds the same exact half to EVEN; swept at runtime over 511 inputs e = f32(i) / 510, both e and the f32 product clamp(e, 0, 1) * 255 come back bit-identical from the two targets, so nothing upstream of the rounding differs; 66 of those products land exactly on k + 0.5, and on the 34 with an even k the builtin answers k while the GLSL inline AND a WGSL inline of the same formula answer k + 1 (i = 1 packs 0 against 1, i = 5 packs 2 against 3)';

const SNORM_HALF_NOTE =
  'the GLSL ES 3.00 spelling is hand-inlined as floor(0.5 + 127 * clamp(e, -1, 1)), which is the rule WGSL states, while a WGSL driver rounds the same exact half to EVEN; swept at runtime over 509 inputs e = (f32(i) - 254) / 254, both e and the f32 product come back bit-identical from the two targets, 244 products land exactly on a half and 122 of them part — at a product of -125.5 the builtin packs the byte 130, which is -126, the even one, and both inlines pack 131, which is -125';

const QUANTIZE_NOTE =
  'GLSL ES 3.00 has no such builtin and the backend spells it as packHalf2x16 then unpackHalf2x16, one component at a time; measured against a WGSL driver, the two part in three places — a value exactly halfway between two binary16 neighbours (the GLSL round trip rounds to nearest even, the driver moved), a magnitude above the largest finite binary16 (WGSL gives an infinity, the GLSL round trip a NaN), and a magnitude below the smallest normal one (the driver flushed it to zero, the GLSL round trip kept the subnormal)';

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
  ldexp: EXACT,
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
  pack4x8unorm: target('correct result', UNORM_HALF_NOTE),
  pack4x8snorm: target('correct result', SNORM_HALF_NOTE),
  quantizeToF16: target('correct result', QUANTIZE_NOTE),
  quantizeToF16Vec2: target('correct result', QUANTIZE_NOTE),
  quantizeToF16Vec3: target('correct result', QUANTIZE_NOTE),
  quantizeToF16Vec4: target('correct result', QUANTIZE_NOTE),
  pow: inherited('exp2(y * log2(x))', POW_NOTE),
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
};

const MATRIX_PRODUCT: Readonly<Record<string, DeterminismAccuracy>> = {
  'mat * vec': inherited('dot(transpose(m)[i], v) for component i'),
  'vec * mat': inherited('dot(v, m[i]) for component i'),
  'mat * mat': inherited('the matrix product, each element a sum of products'),
};

const EXACT_PREFIXES: readonly string[] = [
  'subgroup',
  'textureLoad',
  'textureDimensions',
  'textureNum',
  'textureStore',
  'atomic',
  'storageFetch',
  'bitcast',
  'f64',
];

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
  '__f64Hi',
  '__f64Lo',
  '__f64FromWords',
  '__f64ToI32',
  'pack2x16float',
  'unpack2x16float',
  'absU',
  'dotI',
  'dotU',
  'dot4U8Packed',
  'dot4I8Packed',
  'pack4xU8',
  'pack4xI8',
  'pack4xU8Clamp',
  'pack4xI8Clamp',
  'unpack4xU8',
  'unpack4xI8',
  'countOneBits',
  '~',
  'reverseBits',
  'countLeadingZeros',
  'countTrailingZeros',
  'firstLeadingBit',
  'firstTrailingBit',
  'extractBits',
  'insertBits',
  'arrayLength',
  ...['push', 'pushCount', 'pushedReadAt', 'pushedStoreAt'],
  'collectionAdd',
  'collectionSet',
  'collectionHas',
  'collectionGet',
  'collectionSize',
  'workgroupBarrier',
  'storageBarrier',
  'textureBarrier',
  'atomicCompareExchangeWeak',
  'workgroupUniformLoad',
]);

const isGather = (op: string): boolean => op.startsWith('textureGather');

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
  const row = F32_ACCURACY[op] ?? MATRIX_PRODUCT[op];
  if (row !== undefined) return row;
  if (op.startsWith('textureSample')) return FILTERED;
  if (isGather(op)) return GATHERED;
  if (op.startsWith('bitcast')) return BITCAST_EXACT;
  if (EXACT_PREFIXES.some((p) => op.startsWith(p))) return EXACT;
  return EXACT_OPS.has(op) ? EXACT : undefined;
}

function floatElemOf(t: ShaderType): 'f32' | 'f64' | undefined {
  switch (t.kind) {
    case 'scalar':
      return t.scalar === 'f32' ? 'f32' : undefined;
    case 'vec':
      return t.elem === 'f32' ? 'f32' : undefined;
    case 'f64':
    case 'vec64':
      return 'f64';
    case 'mat':
      return t.elem;
    default:
      return undefined;
  }
}

const isMat = (t: ShaderType): boolean => t.kind === 'mat';
const isVector = (t: ShaderType): boolean => t.kind === 'vec' || t.kind === 'vec64';

function binopName(e: Extract<Expr, { op: 'binop' }>): string {
  if (e.bop !== '*') return e.bop;
  const a = e.a.type;
  const b = e.b.type;
  if (isMat(a) && isMat(b)) return 'mat * mat';
  if (isMat(a) && isVector(b)) return 'mat * vec';
  if (isVector(a) && isMat(b)) return 'vec * mat';
  return '*';
}

type Hit = Omit<DeterminismEntry, 'count' | 'where'>;

const F64_EMULATED: ReadonlySet<string> = new Set(['+', '-', '*', '/', '%', 'floor']);

const PACK_FLOAT_ARG: ReadonlySet<string> = new Set([
  'pack4x8unorm',
  'pack4x8snorm',
  'pack2x16unorm',
  'pack2x16snorm',
]);

function floatReadOf(op: string, e: Extract<Expr, { op: 'call' }>): ShaderType {
  if (PACK_FLOAT_ARG.has(op)) return e.args[0]?.type ?? e.type;
  if (isGather(op) && floatElemOf(e.type) === undefined)
    return e.args.find((a) => floatElemOf(a.type) !== undefined)?.type ?? e.type;
  return e.type;
}

function hitOf(e: Expr): Hit | undefined {
  let op: string;
  if (e.op === 'binop') op = binopName(e);
  else if (e.op === 'call' && e.declRef === undefined) op = e.fn;
  else return undefined;
  const elem = floatElemOf(e.op === 'call' ? floatReadOf(op, e) : e.type);
  if (elem === undefined) return undefined;
  if (SUBGROUP_FOLDS.has(op)) return { op, elem, kind: 'order', accuracy: SUBGROUP_ORDER_BOUND };
  if (SUBGROUP_LANE_READS.has(op) && e.op === 'call') {
    const lane = e.args[1];
    if (lane === undefined || (lane.op === 'lit' && lane.value === 0)) return undefined;
    return { op, elem, kind: 'target', accuracy: SUBGROUP_LANE_BOUND, note: SUBGROUP_LANE_NOTE };
  }
  const acc = accuracyOf(op);
  if (elem === 'f64') {
    const listed =
      F64_EMULATED.has(op) ||
      op.startsWith('mat') ||
      op.startsWith('vec * ') ||
      (acc !== undefined && acc.kind !== 'exact');
    return listed ? { op, elem, kind: 'emulated', accuracy: EMULATED_BOUND } : undefined;
  }
  if (acc === undefined || acc.kind === 'exact') return undefined;
  return acc.note === undefined
    ? { op, elem, kind: acc.kind, accuracy: acc.bound }
    : { op, elem, kind: acc.kind, accuracy: acc.bound, note: acc.note };
}

const SUBGROUP_ORDER_BOUND =
  "the order the device folds its subgroup in, which differs by device and by subgroup size; on the CPU oracle and on GLSL ES 3.00 a subgroup is one invocation (Rule 11.21), so the fold is the lane's own value";
const SUBGROUP_LANE_BOUND =
  "the named lane's value on WebGPU; on the CPU oracle and on GLSL ES 3.00 a subgroup is one invocation (Rule 11.21), so the call gives the lane's own value";
const SUBGROUP_LANE_NOTE =
  'a program that reads another lane computes something else on a subgroup of one; a read of lane 0 is not listed, since that is the lane the two tiers have, and an integer read differs the same way and is not listed, since this report is by float kind';

const ORDER_BOUND =
  "one answer on every tier: the 256-wide tree of Rule 7.2, which may differ from the loop's sequential order in the last places";

const SCATTER_BOUND =
  "one answer on the CPU tier: the 256-wide tree of Rule 7.2 over the iterations, which may differ from the loop's sequential order in the last places; no GPU tier lowers it yet, so the answer holds only where it runs";

function orderHits(m: ModuleDecl): ReadonlyMap<string, readonly Hit[]> {
  const out = new Map<string, Hit[]>();
  for (const proof of proveKernels(m, { cpuScatterF32: true }))
    for (const loop of proof.loops) {
      if (!loop.ok) continue;
      const hits = out.get(proof.fn) ?? [];
      for (const r of loop.reductions) {
        if (r.op !== '+' && r.op !== '*') continue;
        const elem = floatElemOf(r.type);
        if (elem === undefined) continue;
        hits.push({ op: r.op, elem, kind: 'order', accuracy: ORDER_BOUND });
      }
      for (const w of loop.writes)
        if (w.kind === 'scatter' && w.float === true)
          hits.push({ op: '+', elem: 'f32', kind: 'order', accuracy: SCATTER_BOUND });
      if (hits.length > 0) out.set(proof.fn, hits);
    }
  return out;
}

/** The operations in `m` whose result may differ by driver, one entry per operation and float
 *  kind, in order of first appearance over the module constants, the module variables and the
 *  functions: a builtin with a ULP or absolute bound (`sin`, `exp`, `atan2`, `/`), one
 *  inherited from a formula the driver may reassociate or fuse (`pow`, `mix`, `normalize`,
 *  `fma`, `fract`, the matrix products), a derivative or `determinant`, a filtered texture read
 *  or gather, an operation the GLSL ES 3.00 spelling may answer differently (the `pack`
 *  builtins, `quantizeToF16`), every emulated `f64` arithmetic operator and bounded builtin,
 *  and each floating-point reduction of a kernel function's loop, which runs in the tree order
 *  (`order`, after the function's own operations). Empty
 *  when every operation in the module has one answer under the assumption the module header
 *  states, which is when a GPU result and the CPU oracle can differ only by the oracle's own
 *  rounding and never by the driver's choice. A `raw` statement is opaque and contributes
 *  nothing; a call to the module's own helper is not listed itself, its body is.
 *  {@link accuracyOf} answers for a single operation.
 *
 *  Exported from `typeshade`; `compile()` returns it as `determinism`.
 */
export function determinismReport(m: ModuleDecl): readonly DeterminismEntry[] {
  const rows = new Map<string, { hit: Hit; count: number; where: Set<string> }>();
  const add = (hit: Hit, site: string) => {
    const key = `${hit.kind === 'order' ? 'order ' : ''}${hit.elem} ${hit.op}`;
    const row = rows.get(key);
    if (row === undefined) rows.set(key, { hit, count: 1, where: new Set([site]) });
    else {
      row.count++;
      row.where.add(site);
    }
  };
  const visitorFor = (site: string) => (e: Expr) => {
    const hit = hitOf(e);
    if (hit !== undefined) add(hit, site);
  };
  const orders = orderHits(m);
  for (const c of m.consts)
    if (c.valueExpr !== undefined) eachExpr(c.valueExpr, visitorFor(c.name));
  for (const v of m.vars ?? []) if (v.init !== undefined) eachExpr(v.init, visitorFor(v.name));
  for (const fn of m.funcs) {
    const visit = visitorFor(fn.name);
    for (const s of fn.body) eachStmtExpr(s, (e) => eachExpr(e, visit));
    for (const hit of orders.get(fn.name) ?? []) add(hit, fn.name);
  }
  return [...rows.values()].map(({ hit, count, where }) => ({ ...hit, count, where: [...where] }));
}
