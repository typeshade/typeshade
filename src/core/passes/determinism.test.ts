// ═══ Determinism report (roadmap 0.7 item 22) ═══
//
// Three things are pinned. The report lists exactly the operations WGSL §15.7.4 lets differ by
// driver (and the ones the GLSL ES 3.00 spelling may answer differently), with the spec's
// bound, count and sites, in first-appearance order, and nothing for a module whose every
// operation has one answer. Emulated doubles are their own kind and integer arithmetic is
// never listed. And `accuracyOf` places EVERY id the compiler can emit, so a new builtin
// cannot be added without deciding which column it belongs in.
//
// Verifies: Rule 1.3, Rule 11.2 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compile } from '../../compiler/ts/compile.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';
import { INTRINSICS, PORTABLE_INTRINSICS } from '../intrinsics.js';
import { BUILTINS } from '../cpu-runtime.js';
import { accuracyOf, determinismReport } from './determinism.js';

function moduleOf(source: string) {
  const r = compile(source);
  const errors = r.diagnostics.filter((d) => d.category === 'error');
  expect(errors, errors.map((d) => `${d.line}:${d.character} ${d.message}`).join('\n')).toEqual([]);
  return r;
}

const rows = (r: ReturnType<typeof compile>) =>
  r.determinism.map((e) => [e.op, e.elem, e.kind, e.count, e.where]);

describe('determinismReport', () => {
  it('is empty for a module whose every operation is correctly rounded or exact', () => {
    const r = moduleOf(`"use typeshade";
export function f(a: f32, b: f32, n: i32, v: vec3): f32 {
  const q: i32 = n / 3;
  const w: vec3 = v * 2. + abs(v);
  return abs(a) + floor(b) * 2. - min(a, b) + clamp(a, 0., 1.) + f32(q) + w.x + step(0.5, a);
}`);
    expect(r.determinism).toEqual([]);
    expect(determinismReport(r.module)).toEqual([]);
  });

  it('lists each bounded operation once with the spec bound, its count and its sites, in first-appearance order', () => {
    const r = moduleOf(`"use typeshade";
declare const tex: texture_2d<f32>;
declare const smp: sampler;

class Color {
  @location(0) color: vec4;
}

function shade(x: f32, y: f32): f32 {
  return sin(x) / y + fma(x, y, 1.);
}

@fragment
export function fs(@location(0) uv: vec2): Color {
  const s: f32 = shade(uv.x, uv.y) + Math.sin(uv.x);
  const d: f32 = dpdx(uv.x);
  const t: vec4 = textureSample(tex, smp, uv);
  return { color: t * s + d };
}`);
    // Pre-order over each statement's expression: the outer `/` is met before the `sin`
    // inside it, and `shade` (a call to the module's own helper) is not a row.
    expect(rows(r)).toEqual([
      ['/', 'f32', 'ulp', 1, ['shade']],
      ['sin', 'f32', 'absolute', 2, ['shade', 'fs']],
      ['fma', 'f32', 'inherited', 1, ['shade']],
      ['dpdx', 'f32', 'unbounded', 1, ['fs']],
      ['textureSample', 'f32', 'filtered', 1, ['fs']],
    ]);
    const by = (op: string) => r.determinism.find((e) => e.op === op)!;
    expect(by('sin').accuracy).toBe('2^-11 absolute error for x in [-π, π]');
    expect(by('/').accuracy).toBe('2.5 ULP for a divisor with magnitude in [2^-126, 2^126]');
    expect(by('fma').accuracy).toBe('inherited from x * y + z');
    expect(by('fma').note).toMatch(/GLSL ES 3\.00 has no fma/);
    expect(by('sin').note).toBeUndefined();
    expect(by('textureSample').accuracy).toMatch(/implementation-defined/);
  });

  it('counts every occurrence, in a condition, a loop header or an assignment as much as in a let', () => {
    const r = moduleOf(`"use typeshade";
export function f(a: f32, b: f32): f32 {
  let x: f32 = sin(a) + sin(b);
  if (sin(a) > 0.) {
    x = exp(a) + sqrt(a);
  }
  for (let i: i32 = 0; i < 4; i++) {
    x += pow(a, 2.);
  }
  return x;
}`);
    expect(rows(r)).toEqual([
      ['sin', 'f32', 'absolute', 3, ['f']],
      ['exp', 'f32', 'ulp', 1, ['f']],
      ['sqrt', 'f32', 'inherited', 1, ['f']],
      ['pow', 'f32', 'inherited', 1, ['f']],
    ]);
  });

  it('lists a vector builtin and the matrix products, which are sums of products and not the component-wise star', () => {
    const r = moduleOf(`"use typeshade";
export function xform(m: mat4, p: vec4, n: vec3, k: f32): vec4 {
  const unit: vec3 = normalize(n);
  const twice: mat4 = m * m;
  return twice * p + vec4(unit, 1.) * k;
}`);
    expect(rows(r)).toEqual([
      ['normalize', 'f32', 'inherited', 1, ['xform']],
      ['mat * mat', 'f32', 'inherited', 1, ['xform']],
      ['mat * vec', 'f32', 'inherited', 1, ['xform']],
    ]);
    expect(r.determinism[1]!.accuracy).toBe(
      'inherited from the matrix product, each element a sum of products',
    );
    expect(r.determinism[2]!.accuracy).toBe(
      'inherited from dot(transpose(m)[i], v) for component i',
    );
  });

  it('reads a module constant initializer, attributed to the constant', () => {
    const r = moduleOf(`"use typeshade";
const K: f32 = sin(1.);
export function f(a: f32): f32 {
  return a * K;
}`);
    expect(rows(r)).toEqual([['sin', 'f32', 'absolute', 1, ['K']]]);
  });

  it('lists emulated f64 arithmetic, floor and the bounded builtins as their own kind, and keeps abs exact on a double', () => {
    const r = moduleOf(`"use typeshade";
export function g(a: f32, b: f32): f32 {
  const x: f64 = f64(a);
  const y: f64 = f64(b);
  const z: f64 = floor(x) + fract(y);
  return f32(abs(x * y + sqrt(x)) + z);
}`);
    expect(rows(r).map((row) => row.slice(0, 3))).toEqual([
      ['+', 'f64', 'emulated'],
      ['floor', 'f64', 'emulated'],
      ['fract', 'f64', 'emulated'],
      ['*', 'f64', 'emulated'],
      ['sqrt', 'f64', 'emulated'],
    ]);
    for (const e of r.determinism) expect(e.accuracy).toMatch(/^emulated double/);
  });

  it('separates the f32 and f64 uses of one operation into two rows', () => {
    const r = moduleOf(`"use typeshade";
export function h(a: f32, b: f32): f32 {
  const x: f64 = f64(a);
  return a / b + f32(x / f64(b));
}`);
    expect(rows(r).map((row) => row.slice(0, 3))).toEqual([
      ['/', 'f32', 'ulp'],
      ['/', 'f64', 'emulated'],
    ]);
  });

  it('lists fract as inherited, with the tiny negative case in the bound', () => {
    const r = moduleOf(`"use typeshade";
export function f(a: f32): f32 {
  return fract(a);
}`);
    expect(rows(r)).toEqual([['fract', 'f32', 'inherited', 1, ['f']]]);
    expect(r.determinism[0]!.accuracy).toMatch(/1 - 2\^-24 for a tiny negative x/);
  });

  it('lists a gather as filtered, and no longer lists ldexp at all', () => {
    // `ldexp` WAS a `target` row here, on a GLSL spelling that built 2^e from one biased
    // exponent and gave +Inf at e = 128 (#141). The spelling now builds it in two halves, and
    // a sweep of every legal exponent, -149 to 128, found the GLSL and WGSL answers identical
    // for x = 1.0 and x = 0.75 — 278 of 278, where the old one missed 22. An operation with one
    // answer on both targets does not belong in this report, so the row is gone and the gather
    // is the only one left.
    const r = moduleOf(`"use typeshade";
declare const tex: texture_2d<f32>;
declare const smp: sampler;
export function f(uv: vec2, c: vec4): vec4 {
  const scaled: f32 = ldexp(c.x, 3);
  return textureGather(0, tex, smp, uv) * scaled;
}`);
    expect(rows(r).map((row) => row.slice(0, 3))).toEqual([['textureGather', 'f32', 'filtered']]);
    expect(r.determinism[0]!.accuracy).toMatch(/which four/);
  });

  it("never lists integer arithmetic, comparisons or a call to the module's own helper", () => {
    const r = moduleOf(`"use typeshade";
function twice(n: u32): u32 {
  return n * 2;
}
export function k(a: i32, b: i32, n: u32): i32 {
  const m: u32 = (twice(n) / 3) % 5;
  return select(a / b, a % b, a < b) + i32(m);
}`);
    expect(r.determinism).toEqual([]);
  });

  it("lists a kernel function's float reduction as order, after the function's own operations, and not an exact one", () => {
    const r = moduleOf(`"use typeshade";
export function stats(xs: array<f32>, ns: array<i32>): f32 {
  let sum = 0.;
  let prod = 1.;
  let lo = 0.;
  let n: i32 = 0;
  for (let i: u32 = 0; i < xs.length; i++) {
    sum += xs[i] / 2.;
    prod *= xs[i];
    lo = min(lo, xs[i]);
    n += ns[i];
  }
  return sum + prod + lo + f32(n);
}`);
    const bound =
      "one answer on every tier: the 256-wide tree of Rule 7.2, which may differ from the loop's sequential order in the last places";
    expect(r.determinism).toEqual([
      expect.objectContaining({ op: '/', elem: 'f32', kind: 'ulp', count: 1 }),
      { op: '+', elem: 'f32', kind: 'order', accuracy: bound, count: 1, where: ['stats'] },
      { op: '*', elem: 'f32', kind: 'order', accuracy: bound, count: 1, where: ['stats'] },
    ]);
  });

  it('lists no order row for a loop that stays on the CPU, or for a function that is not a kernel', () => {
    const r = moduleOf(`"use typeshade";
export function prefix(xs: array<f32>): f32 {
  let sum = 0.;
  for (let i: u32 = 0; i < xs.length; i++) {
    sum += xs[i];
    xs[i] = sum;
  }
  return sum;
}
export function local(a: f32): f32 {
  let s = 0.;
  for (let i: i32 = 0; i < 4; i++) s += a;
  return s;
}`);
    expect(r.determinism.filter((e) => e.kind === 'order')).toEqual([]);
  });

  it('is computed on the partial module when the front end reports an error', () => {
    const r = compile(`"use typeshade";
export function ok(a: f32): f32 {
  return sin(a);
}
export function bad(a: f32): f32 {
  return nonsense(a);
}`);
    expect(r.diagnostics.some((d) => d.category === 'error')).toBe(true);
    expect(r.wgsl).toBeUndefined();
    expect(r.determinism.map((e) => e.op)).toContain('sin');
  });
});

describe('accuracyOf', () => {
  const everyId = [
    ...Object.keys(INTRINSICS),
    ...PORTABLE_INTRINSICS,
    ...Object.keys(BUILTINS),
    '+',
    '-',
    '*',
    '/',
    '%',
    '&',
    '|',
    '^',
    '<<',
    '>>',
    'mat * vec',
    'vec * mat',
    'mat * mat',
  ];

  it('places every id the compiler can emit in the exact column or in the table (a new builtin must choose)', () => {
    const unplaced = everyId.filter((id) => accuracyOf(id) === undefined);
    expect(
      unplaced,
      'add each to F32_ACCURACY, EXACT_OPS or EXACT_PREFIXES in determinism.ts',
    ).toEqual([]);
  });

  it('answers exact for the operations const-fold folds except fract, and a bound for the rest', () => {
    for (const op of [
      'abs',
      'floor',
      'ceil',
      'trunc',
      'round',
      'sign',
      'min',
      'max',
      'clamp',
      'saturate',
      'step',
      '+',
      '-',
      '*',
    ]) {
      expect(accuracyOf(op), op).toEqual({ kind: 'exact' });
    }
    expect(accuracyOf('fract')?.kind).toBe('inherited');
    expect(accuracyOf('sin')?.kind).toBe('absolute');
    expect(accuracyOf('exp')?.kind).toBe('ulp');
    expect(accuracyOf('pow')?.kind).toBe('inherited');
    expect(accuracyOf('mat * vec')?.kind).toBe('inherited');
    expect(accuracyOf('determinant')?.kind).toBe('unbounded');
    expect(accuracyOf('textureSampleCompareLevelArray')?.kind).toBe('filtered');
    expect(accuracyOf('textureGather')?.kind).toBe('filtered');
    // `ldexp` left the `target` column with #141: the GLSL scale is built in two halves now,
    // and a sweep of every legal exponent found the two targets identical on all 278.
    expect(accuracyOf('ldexp')?.kind).toBe('exact');
    expect(accuracyOf('pack2x16snorm')?.kind).toBe('target');
    expect(accuracyOf('pack2x16float')?.kind).toBe('exact');
    expect(accuracyOf('textureLoad')?.kind).toBe('exact');
    expect(accuracyOf('atomicAdd')?.kind).toBe('exact');
    expect(accuracyOf('no-such-builtin')).toBeUndefined();
  });
});

// The rows #150 added, pinned by VALUE rather than only by "is placed somewhere": both are
// load-bearing claims in §44 and the CHANGELOG, and the structural test above only forces a new
// id into one column or the other, not into the right one.
describe('the pack and quantize rows say what the emitted code actually does', () => {
  it('quantizeToF16 is a target row at every width, with the reason in the note', () => {
    for (const id of [
      'quantizeToF16',
      'quantizeToF16Vec2',
      'quantizeToF16Vec3',
      'quantizeToF16Vec4',
    ]) {
      const a = accuracyOf(id)!;
      expect(a.kind, id).toBe('target');
      // WGSL settles the conversion; the GLSL half round trip does not pin its rounding.
      expect('note' in a && a.note, id).toMatch(/packHalf2x16/);
      // The three measured divergences, not just the tie.
      expect('note' in a && a.note, id).toMatch(/halfway/);
      expect('note' in a && a.note, id).toMatch(/NaN/);
      expect('note' in a && a.note, id).toMatch(/subnormal/);
    }
  });

  it('places every bitcast width in the exact column (change 0044)', () => {
    for (const id of [
      'bitcastU32',
      'bitcastF32',
      'bitcastVec2U32',
      'bitcastVec3U32',
      'bitcastVec4U32',
      'bitcastVec2F32',
      'bitcastVec3F32',
      'bitcastVec4F32',
    ])
      expect(accuracyOf(id)?.kind, id).toBe('exact');
  });

  it('lists a pack, whose float kind is the one it READS', () => {
    // Every `pack` row was unreachable. The walk takes a node's float kind from its RESULT
    // type, and a pack answers a `u32` of bytes, so `floatElemOf` returned `undefined` and the
    // node was dropped before `accuracyOf` was asked — four `target` rows, two of them older
    // than the 4x8 pair, describing a divergence the report could not report. Measured before
    // the fix, this module reported an EMPTY list.
    const r = moduleOf(`"use typeshade";
declare const out: storage<array<u32>, "read_write">;
@compute([1, 1, 1])
export function cs(@builtin("global_invocation_id") gid: vec3u): void {
  out[0] = pack4x8unorm(vec4(0.5, 0.5, 0.5, 0.5));
  out[1] = pack4x8snorm(vec4(0.5, 0.5, 0.5, 0.5));
  out[2] = pack2x16unorm(vec2(0.5, 0.5));
  out[3] = pack2x16snorm(vec2(0.5, 0.5));
}`);
    expect(r.determinism.map((e) => [e.op, e.elem, e.kind])).toEqual([
      ['pack4x8unorm', 'f32', 'target'],
      ['pack4x8snorm', 'f32', 'target'],
      ['pack2x16unorm', 'f32', 'target'],
      ['pack2x16snorm', 'f32', 'target'],
    ]);
    // `every` on the list above would be vacuously true on an empty one, and `toEqual` already
    // pins the whole list, so the claim worth adding here is the one the list cannot make: the
    // INTEGER work beside the packs — the `u32` stores and the index arithmetic — is still not
    // listed, which is what keeps this from being "report anything with a float argument".
    expect(r.determinism.map((e) => e.op)).not.toContain('*');
    expect(r.determinism.map((e) => e.op)).not.toContain('+');
  });

  // #175: the same "the result type hides the row" drop the packs left behind, on the operation
  // whose result has no float at all. `accuracyOf` gives every `textureGather*` id the
  // `filtered` row, and that row is about WHICH four texels the footprint selects — which is
  // implementation-defined whatever the texture's element. But a gather on a `texture_2d<u32>`
  // answers a `vec4<u32>`, so `floatElemOf` returned `undefined` and the node was dropped before
  // `accuracyOf` was asked. Measured before the fix: the f32 texture listed the row, the u32 and
  // i32 ones listed nothing. This was an `it.fails` while the fix looked like it needed a wider
  // `DeterminismEntry.elem`. It needs none: a gather READS an `f32` coordinate, and the
  // coordinate is what the row is about, the way a pack's argument is for the packs. Every shape
  // and both integer kinds are the next describe's.
  it('#175: a gather on an integer texture is filtered too, and is listed under the float it reads', () => {
    const r = moduleOf(`"use typeshade";
declare const tex: texture_2d<u32>;
declare const smp: sampler;
declare const out: storage<array<u32>, "read_write">;
@compute([1, 1, 1])
export function cs(@builtin("global_invocation_id") gid: vec3u): void {
  out[0] = textureGather(0, tex, smp, vec2(0.5, 0.5)).x;
}`);
    expect(r.determinism).toEqual([
      {
        op: 'textureGather',
        elem: 'f32',
        kind: 'filtered',
        accuracy: expect.stringMatching(/which four/),
        count: 1,
        where: ['cs'],
      },
    ]);
  });

  it('both 4x8 packs are target rows: a driver rounds the exact half to even', () => {
    // `pack4x8unorm` was promoted to `exact` on a measurement that only holds when Tint
    // CONST-EVALUATES the call. Swept at RUNTIME over 511 inputs e = i/510, a WGSL driver and
    // the GLSL inline parted on 34 of them — i = 1 packs 0 on WGSL and 1 on GLSL, i = 5 packs
    // 2 and 3 — and a WGSL-only self-check, one shader computing both the builtin and
    // `floor(0.5 + 255 * e)`, disagrees with ITSELF on the same 34. So the driver rounds the
    // tie to even while the inline, and WGSL's own written rule, round it up. The CPU oracle
    // sides with GLSL — it rounds the scale in f32, the way both targets do (see the oracle's
    // own test) — so on those 34 it answers what a WebGL2 driver answers and not what a WGSL
    // driver answers, which is exactly the oracle/GPU equality `exact` is supposed to promise
    // and cannot here.
    //
    // The lesson is the const/runtime split: a constant argument is folded by the shader
    // compiler and answers its own way, so a measurement taken on literals says nothing about
    // the instruction a driver issues. The same split was already visible in this lane on
    // `ldexp(1.0, -149)`, const-evaluated to a subnormal and flushed to zero at runtime.
    for (const id of ['pack4x8unorm', 'pack4x8snorm']) {
      const a = accuracyOf(id)!;
      expect(a.kind, id).toBe('target');
      expect('note' in a && a.note, id).toMatch(/half|even/);
    }

    // The 2x16 packs are NATIVE GLSL builtins, defined with round(), so no spelling of ours
    // can reach them and they stay `target` on the mechanism the unorm row just left behind.
    for (const id of ['pack2x16unorm', 'pack2x16snorm']) {
      const a = accuracyOf(id)!;
      expect(a.kind, id).toBe('target');
      expect('note' in a && a.note, id).toMatch(/round\(\)/);
    }
  });
});

// #175, in every shape it has. A gather READS an `f32` coordinate and answers a vector of the
// texture's element, so on an integer texture the result type has no float, and the walk used to
// drop the row: a module whose only float read was an integer cube's gather reported `[]`, which
// surface §38 says means every operation has one answer. The row is listed under the float the
// gather reads, and it is the row a float texture gets, because the four texels a footprint
// selects do not depend on what the texels hold.
//
// Each source is read by both halves. `compile()` gives the report. The language service never
// sees the report, so the half it reads is what an editor says of the same program: it draws no
// diagnostic, and it types the gather by the texture's element, which is the very fact that hid
// the row from the walk.
describe('a textureGather on an integer texture is listed under the float it reads (#175)', () => {
  /** Every colour shape a gather takes, by the id the IR names its call: a cube gathers by
   *  direction with the 2d id, the coordinate's width riding on the type, and the array forms
   *  have their own. */
  const COLOUR = [
    {
      texture: 'texture_2d',
      op: 'textureGather',
      call: 'textureGather(0, tex, smp, vec2(0.5, 0.5))',
    },
    {
      texture: 'texture_2d_array',
      op: 'textureGatherArray',
      call: 'textureGather(0, tex, smp, vec2(0.5, 0.5), 1)',
    },
    {
      texture: 'texture_cube',
      op: 'textureGather',
      call: 'textureGather(0, tex, smp, vec3(0.5, 0.5, 0.5))',
    },
    {
      texture: 'texture_cube_array',
      op: 'textureGatherArray',
      call: 'textureGather(0, tex, smp, vec3(0.5, 0.5, 0.5), 1)',
    },
  ] as const;

  /** The depth forms, comparison ones included. A depth texture answers a `vec4<f32>` and a
   *  comparison gather exists on no other, so these never had the gap; they are here so that
   *  every gather id the compiler has is read by the same test. */
  const DEPTH = [
    {
      texture: 'texture_depth_2d',
      op: 'textureGatherDepth',
      sampler: 'sampler',
      call: 'textureGather(tex, smp, vec2(0.5, 0.5))',
    },
    {
      texture: 'texture_depth_2d_array',
      op: 'textureGatherDepthArray',
      sampler: 'sampler',
      call: 'textureGather(tex, smp, vec2(0.5, 0.5), 1)',
    },
    {
      texture: 'texture_depth_cube',
      op: 'textureGatherDepth',
      sampler: 'sampler',
      call: 'textureGather(tex, smp, vec3(0.5, 0.5, 0.5))',
    },
    {
      texture: 'texture_depth_cube_array',
      op: 'textureGatherDepthArray',
      sampler: 'sampler',
      call: 'textureGather(tex, smp, vec3(0.5, 0.5, 0.5), 1)',
    },
    {
      texture: 'texture_depth_2d',
      op: 'textureGatherCompare',
      sampler: 'sampler_comparison',
      call: 'textureGatherCompare(tex, smp, vec2(0.5, 0.5), 0.5)',
    },
    {
      texture: 'texture_depth_2d_array',
      op: 'textureGatherCompareArray',
      sampler: 'sampler_comparison',
      call: 'textureGatherCompare(tex, smp, vec2(0.5, 0.5), 1, 0.5)',
    },
    {
      texture: 'texture_depth_cube',
      op: 'textureGatherCompare',
      sampler: 'sampler_comparison',
      call: 'textureGatherCompare(tex, smp, vec3(0.5, 0.5, 0.5), 0.5)',
    },
    {
      texture: 'texture_depth_cube_array',
      op: 'textureGatherCompareArray',
      sampler: 'sampler_comparison',
      call: 'textureGatherCompare(tex, smp, vec3(0.5, 0.5, 0.5), 1, 0.5)',
    },
  ] as const;

  /** A compute entry that binds the gather's result to `g` and stores a channel of it. */
  const program = (texture: string, sampler: string, elem: string, call: string): string =>
    `"use typeshade";
declare const tex: ${texture};
declare const smp: ${sampler};
declare const out: storage<array<${elem}>, "read_write">;
@compute([1, 1, 1])
export function cs(@builtin("global_invocation_id") gid: vec3u): void {
  const g = ${call};
  out[0] = g.x;
}`;

  const service = createTypeshadeLanguageService();
  let opened = 0;

  /** One program through both halves: the report `compile()` gives, and what the editor says of
   *  the same text, its diagnostics and the type it hovers for the bound result `g`. */
  function halves(source: string) {
    const report = moduleOf(source).determinism;
    const uri = `gather-${opened++}.ts`;
    service.openDocument(uri, source);
    const at = source.indexOf('const g') + 'const '.length;
    return {
      report,
      diagnostics: service.getDiagnostics(uri),
      hover: service.getHover(uri, service.positionAt(uri, at))?.contents,
    };
  }

  const row = (op: string, count = 1, where: readonly string[] = ['cs']) => ({
    op,
    elem: 'f32',
    kind: 'filtered',
    accuracy: expect.stringMatching(/which four/),
    count,
    where,
  });

  // The f32 texture is the control of each shape: the two integer kinds list the row it lists,
  // and the editor takes all three.
  for (const { texture, op, call } of COLOUR) {
    for (const elem of ['f32', 'u32', 'i32'] as const) {
      it(`${texture}<${elem}>: ${op} is one filtered row under f32`, () => {
        const h = halves(program(`${texture}<${elem}>`, 'sampler', elem, call));
        expect(h.report).toEqual([row(op)]);
        expect(h.diagnostics).toEqual([]);
        expect(h.hover).toContain(`const g: vec4<${elem}>`);
      });
    }
  }

  for (const { texture, op, sampler, call } of DEPTH) {
    it(`${texture}: ${op}, whose result was a float already, is the same row`, () => {
      const h = halves(program(texture, sampler, 'f32', call));
      expect(h.report).toEqual([row(op)]);
      expect(h.diagnostics).toEqual([]);
      expect(h.hover).toContain('const g: vec4<f32>');
    });
  }

  it('reads every gather id the compiler has, so a new one has to be placed in this table', () => {
    const emitted = Object.keys(INTRINSICS).filter((id) => id.startsWith('textureGather'));
    const read = [...COLOUR, ...DEPTH].map((c) => c.op);
    expect([...new Set(read)].sort()).toEqual(emitted.sort());
  });

  it('lists an f32 gather and an integer one as one row, since a row is per operation and float', () => {
    const r = moduleOf(`"use typeshade";
declare const colors: texture_2d<f32>;
declare const ids: texture_2d<u32>;
declare const smp: sampler;

class Color {
  @location(0) color: vec4;
}

function pick(uv: vec2): u32 {
  return textureGather(1, ids, smp, uv).y;
}

@fragment
export function fs(@location(0) uv: vec2): Color {
  const c: vec4 = textureGather(0, colors, smp, uv);
  return { color: c * f32(pick(uv)) };
}`);
    // The helper is declared first, so it is named first; the fragment stage lists too.
    expect(r.determinism).toEqual([row('textureGather', 2, ['pick', 'fs'])]);
  });

  it('lists nothing for what an integer texture has besides a gather: a texel fetch, and integer arithmetic', () => {
    // The walk reads a gather's coordinate for its float, and only a gather's. An integer texel
    // fetch takes integer coordinates, and the arithmetic on what it fetched is exact.
    const r = moduleOf(`"use typeshade";
declare const ids: texture_2d<u32>;
declare const out: storage<array<u32>, "read_write">;
@compute([1, 1, 1])
export function cs(@builtin("global_invocation_id") gid: vec3u): void {
  const t = textureLoad(ids, vec2i(0, 0), 0);
  out[0] = (t.x / 3) % 5 + dot(t.xy, vec2u(3, 4)) + u32(f32(t.z) * 0.5);
}`);
    expect(r.determinism).toEqual([]);
  });

  it('has no comparison gather on an integer texture to list: both halves refuse it', () => {
    // `textureGatherCompare` compares against a depth texture, whose result is a `vec4<f32>`, so
    // the comparison forms never needed the coordinate read above. A colour texture has no depth
    // to compare (Rule 12.5: the code and the text, in both halves).
    const source = `"use typeshade";
declare const tex: texture_2d<u32>;
declare const smp: sampler_comparison;
declare const out: storage<array<f32>, "read_write">;
@compute([1, 1, 1])
export function cs(@builtin("global_invocation_id") gid: vec3u): void {
  out[0] = textureGatherCompare(tex, smp, vec2(0.5, 0.5), 0.5).x;
}`;
    const text =
      'textureGatherCompare compares against a depth texture; "texture_2d<u32>" is a sampled colour texture with no depth to compare. textureGather reads its channels.';
    expect(
      compile(source)
        .diagnostics.filter((d) => d.category === 'error')
        .map((d) => `${d.code}: ${d.message}`),
    ).toEqual([`TS8003: ${text}`]);
    const uri = `gather-${opened++}.ts`;
    service.openDocument(uri, source);
    expect(service.getDiagnostics(uri).map((d) => `${d.source} ${d.code}: ${d.message}`)).toEqual([
      `typeshade TS8003: ${text}`,
    ]);
  });
});
