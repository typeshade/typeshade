// ═══ The emulated-double surface, from `"use typeshade"` source ═══
//
// The f64 type is carried by the front end and REWRITTEN before emit: the fp64 pass turns
// every f64 node into a pair of f32 words and a `df64_*` call, and it has a body for ten
// builtins and no others (core/fp64/twins.ts). What the front end accepted and what the pass
// could lower had drifted apart in both directions (#151): a reduction of a `vec64` was typed
// f32 while the pass emitted the f64 pair, a literal beside an f64 had no spelling, a lane of
// a `vec64` could not be read at all, and thirty-odd builtins were accepted here and refused
// at emit as SD0041 — a diagnostic with no source span, raised after the call the author
// wrote was gone.
//
// So these tests are written as the two halves of one claim: everything the pass CAN lower is
// accepted and the CPU agrees with the double, and everything it cannot is refused AT THE
// CALL with the list of what would have worked.
//
// Verifies: Rule 2.3, Rule 5.2 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compile } from '../../index.js';
import { compileTsSource } from './source-file.js';
import { compileModule } from '../../core/oracle.js';
import { fp64Lower } from '../../core/passes/fp64-lower.js';
import { splitF64 } from '../../core/fp64/df64-lib.js';
import { F64_SCALAR_TWINS, F64_VEC_TWINS } from '../../core/fp64/twins.js';

const errorsOf = (src: string): string[] =>
  compileTsSource(src)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => d.message);

const clean = (src: string): ReturnType<typeof compile> => {
  const r = compile(src);
  expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return r;
};

/** The value an f64-returning `k` computes, twice: once on the CPU oracle, which evaluates
 *  f64 natively as a JavaScript double (JS numbers ARE doubles — the definitional semantics),
 *  and once on the LOWERED module under an f32-rounding regime, which is the arithmetic the
 *  GPU actually runs. The two agreeing is the metamorphic gate the fp64 pass is designed
 *  around; the first agreeing with a hand-written double is what stops the oracle from being
 *  the thing that is wrong. */
function bothWays(src: string, args: readonly number[]): { double: number; emulated: number } {
  const m = clean(src).module;
  const double = compileModule(m).fns.k!(...args) as number;
  const lowered = compileModule(fp64Lower(m), { precision: 'f32' }).fns.k!(
    ...args.map((a) => splitF64(a)),
  ) as number[];
  return { double, emulated: lowered[0]! + lowered[1]! };
}

// ── What the pass lowers ──

/** One scalar case per twin: the source call, its arguments, and the double the same
 *  expression has in JavaScript. `round` is WGSL's, ties to the EVEN integer, which is why
 *  the tie cases are here rather than in a comment. */
const SCALAR_TWINS: Readonly<Record<string, { call: string; args: number[]; want: number }>> = {
  sqrt: { call: 'sqrt(a)', args: [2], want: Math.sqrt(2) },
  abs: { call: 'abs(a)', args: [-0.75], want: 0.75 },
  floor: { call: 'floor(a)', args: [-2.25], want: -3 },
  fract: { call: 'fract(a)', args: [2.25], want: 0.25 },
  round: { call: 'round(a)', args: [2.5], want: 2 },
  min: { call: 'min(a, b)', args: [0.25, -0.5], want: -0.5 },
  max: { call: 'max(a, b)', args: [0.25, -0.5], want: 0.25 },
  mix: { call: 'mix(a, b, 0.25)', args: [1, 3], want: 1.5 },
  sin: { call: 'sin(a)', args: [0.5], want: Math.sin(0.5) },
  cos: { call: 'cos(a)', args: [0.5], want: Math.cos(0.5) },
};

describe('every builtin the fp64 pass has a twin for', () => {
  it('the case table covers the twin table exactly, so a new twin cannot land untested', () => {
    // The floor that makes the it.each below mean something: without it, deleting a row here
    // silently shrinks the sweep rather than failing.
    expect(Object.keys(SCALAR_TWINS).sort()).toEqual([...F64_SCALAR_TWINS]);
  });

  it.each(Object.entries(SCALAR_TWINS))(
    'lowers %s from source on an f64 and the CPU matches the double',
    (name, { call, args, want }) => {
      const params = args.map((_, i) => `${'ab'[i]}: f64`).join(', ');
      const { double, emulated } = bothWays(
        `"use typeshade"\nexport function k(${params}): f64 { return ${call} }\n`,
        args,
      );
      expect(double, `${name} on the f64 oracle`).toBe(want);
      // The emulated pair carries ~2⁻⁴⁶ of relative headroom on the algebraic twins and the
      // ported Taylor series floors sin/cos at ~2⁻³⁶, so the comparison is relative, not
      // exact — the discriminative half is that plain f32 cannot hold `want` at all for the
      // deep-cancellation cases, which df64-known-answer.test.ts pins.
      expect(Math.abs(emulated - want), `${name} on the lowered f32 oracle`).toBeLessThan(
        Math.max(Math.abs(want), 1) * 1e-6,
      );
    },
  );

  it.each([...F64_VEC_TWINS])('accepts %s on a vec64 from source', (name) => {
    const arity = name === 'min' || name === 'max' || name === 'dot' || name === 'distance' ? 2 : 1;
    const args = ['a', 'b'].slice(0, arity).join(', ');
    const call = name === 'mix' ? 'mix(a, b, 0.25)' : `${name}(${args})`;
    const params =
      name === 'mix'
        ? 'a: vec3f64, b: vec3f64'
        : arity === 2
          ? 'a: vec3f64, b: vec3f64'
          : 'a: vec3f64';
    // A reduction yields an f64, a componentwise twin the vector itself.
    const ret = name === 'dot' || name === 'length' || name === 'distance' ? 'f64' : 'vec3f64';
    expect(
      errorsOf(`"use typeshade"\nexport function k(${params}): ${ret} { return ${call} }\n`),
      name,
    ).toEqual([]);
  });

  // The CHANGELOG and df64-lib's comment both rest on this: WGSL's `round` breaks ties to the
  // EVEN integer, and `df64_nint` — the helper the issue proposed reusing — breaks them
  // toward +infinity for the mod-2pi reduction. `round(2.5)` alone cannot tell the two apart
  // from a plain `Math.round` either, since 2 is even and Math.round(2.5) is 3. These are the
  // points where the three conventions disagree, including the two where the LOW word of the
  // pair carries the parity (an f32 at 2^30 cannot hold 2^30 + 1, so the +1 lands in lo).
  const TIES: readonly (readonly [number, number])[] = [
    [0.5, 0],
    [1.5, 2],
    [2.5, 2],
    [3.5, 4],
    [4.5, 4],
    // Written +0, not -0: IEEE's roundToIntegralTiesToEven(-0.5) is -0 and the CPU oracle
    // answers +0. The two compare equal and a shader cannot tell them apart without 1/x, so
    // this pins the VALUE and leaves the zero sign alone — it is the oracle's, and predates
    // this change.
    [-0.5, 0],
    [-1.5, -2],
    [-2.5, -2],
    [12345.5, 12346],
    [12346.5, 12346],
    [2 ** 30 + 0.5, 2 ** 30],
    [2 ** 30 + 1.5, 2 ** 30 + 2],
  ];

  it.each(TIES)('round(%f) breaks the tie to the even integer, as WGSL does', (x, want) => {
    const { double, emulated } = bothWays(
      `"use typeshade"\nexport function k(a: f64): f64 { return round(a) }\n`,
      [x],
    );
    expect(double, 'the f64 oracle').toBe(want);
    expect(emulated, 'the lowered f32 oracle').toBe(want);
    // The discriminative half: `Math.round` (ties away from zero) and `floor(x + 0.5)` (ties
    // toward +infinity, which is df64_nint's convention) disagree with WGSL on half of these.
    if (Math.round(x) !== want) expect(Math.floor(x + 0.5)).not.toBe(want);
  });

  it('lowers a vec64 reduction and the CPU matches the double', () => {
    const { double, emulated } = bothWays(
      `"use typeshade";
export function k(a: f64, b: f64, c: f64): f64 {
  const v = vec3f64(a, b, c);
  return length(v);
}
`,
      [3, 4, 12],
    );
    expect(double).toBe(13);
    expect(Math.abs(emulated - 13)).toBeLessThan(1e-9);
  });
});

// ── What it cannot ──

/** Builtins with no df64 body. Each is a real WGSL builtin the surface lowers for f32, so the
 *  refusal is about the EMULATION and not about the name being unknown. */
const NO_TWIN = ['ceil', 'trunc', 'sign', 'exp', 'log', 'pow', 'tan', 'step', 'inverseSqrt'];

describe('every builtin it has no twin for', () => {
  it('none of the NO_TWIN names is actually a twin', () => {
    // The floor SCALAR_TWINS has, in the other direction: promote one of these to a df64 body
    // and this list goes stale, asserting a refusal that no longer happens for a reason the
    // test would otherwise report as a message mismatch.
    expect(
      NO_TWIN.filter((n) => F64_SCALAR_TWINS.includes(n) || F64_VEC_TWINS.includes(n)),
    ).toEqual([]);
  });

  it.each(NO_TWIN)('refuses %s at the call span with the twin list', (name) => {
    const arity = name === 'pow' || name === 'step' ? 2 : 1;
    const params = ['a: f64', 'b: f64'].slice(0, arity).join(', ');
    const args = ['a', 'b'].slice(0, arity).join(', ');
    const errors = errorsOf(
      `"use typeshade"\nexport function k(${params}): f64 { return ${name}(${args}) }\n`,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBe(
      `${name} has no emulated-double form; got f64. On an f64 the pass lowers ` +
        `abs, cos, floor, fract, max, min, mix, round, sin and sqrt — narrow first, ` +
        `e.g. ${name}(f32(x)).`,
    );
  });

  it('names the vec64 list, reductions included, on a vector operand', () => {
    const errors = errorsOf(
      `"use typeshade"\nexport function k(a: vec3f64): vec3f64 { return ceil(a) }\n`,
    );
    expect(errors).toEqual([
      'ceil has no emulated-double form; got vec3<f64>. On a vector of doubles the pass ' +
        'lowers abs, cos, distance, dot, floor, fract, length, max, min, mix, normalize, ' +
        'round and sin — narrow first, e.g. ceil(vec3(v)).',
    ]);
    // The narrow the message names has to be one that LOWERS. `f32(v)` on a vec64 does not:
    // it is the span-less SD0041 this refusal exists to replace.
    expect(
      errorsOf(`"use typeshade"\nexport function k(p: vec3f64): f32 { return f32(p) }\n`),
    ).not.toEqual([]);
    expect(
      errorsOf(`"use typeshade"\nexport function k(p: vec3f64): vec3 { return ceil(vec3(p)) }\n`),
    ).toEqual([]);
  });

  it('refuses an f64 blend factor, which the df64 mix body takes as a plain f32', () => {
    expect(
      errorsOf(
        `"use typeshade"\nexport function k(a: f64, b: f64, t: f64): f64 { return mix(a, b, t) }\n`,
      ),
    ).toEqual(['mix blends emulated doubles by a plain f32 interpolant; got f64. Write f32(t).']);
  });
});

// ── The typing that was a lie (F64-01, the BLOCKER) ──

describe('the reductions on a vec64', () => {
  it('types length, distance and dot on a vec64 as f64 and refuses determinant', () => {
    // Each of these returns the f64 the pass emits. Before #151 the front end typed them f32
    // while `fp64-lower` handed back the (hi, lo) pair, so a correct program could not be
    // written: the declared f64 return was a mismatch against the front end's own f32.
    expect(
      errorsOf(`"use typeshade";
export function k(a: vec3f64, b: vec3f64): f64 {
  const l = length(a);
  const d = distance(a, b);
  const p = dot(a, b);
  return l + d + p;
}
`),
    ).toEqual([]);
    // `determinant` is the one reduction with no pass support at all — a mat64 carries only
    // `*` and `transpose` — so typing it f64 has to come with a refusal, or the lie would
    // simply move.
    expect(
      errorsOf(`"use typeshade"\nexport function k(m: mat4<f64>): f64 { return determinant(m) }\n`),
    ).toEqual([
      'determinant has no emulated-double form; got mat4x4<f64>: the fp64 pass lowers only ' +
        '* and transpose on a matrix of doubles, so declare the matrix mat4 where you need ' +
        'its determinant.',
    ]);
    // transpose, which it does lower, stays accepted.
    expect(
      errorsOf(
        `"use typeshade"\nexport function k(m: mat4<f64>): mat4<f64> { return transpose(m) }\n`,
      ),
    ).toEqual([]);
  });
});

// ── Literals and the exact widen ──

describe('an f64 beside a literal and beside an f32', () => {
  it('lifts a literal beside an f64 and a declared f64 const', () => {
    expect(
      errorsOf(`"use typeshade";
export function k(s: f64, t: f32): f64 {
  const declared: f64 = 0.1;
  const lifted = s * 2.5;
  const widened = s * t;
  let stepped: f64 = 0.;
  stepped *= 3.;
  return declared + lifted + widened + stepped;
}
`),
    ).toEqual([]);
  });

  it('carries the whole double of a lifted literal, not its f32 rounding', () => {
    // The point of the lift: 0.1 is not representable in f32, so widening the f32 rounding of
    // it as (x, 0.0) would lose the tail the emulation exists to keep. `0.1 + 0` under the
    // emulation must be the double 0.1, which Math.fround(0.1) is not.
    const { emulated } = bothWays(
      `"use typeshade"\nexport function k(a: f64): f64 { return a * 0. + 0.1 }\n`,
      [0],
    );
    // The pair of f32 words holds ~48 significand bits, not the double's 53, so the value is
    // not bit-identical to 0.1 — it is three orders of magnitude closer to it than the f32
    // rounding the widen would otherwise have carried, which is the whole claim.
    expect(Math.abs(emulated - 0.1)).toBeLessThan(1e-16);
    expect(Math.abs(Math.fround(0.1) - 0.1)).toBeGreaterThan(1e-9);
  });

  it('refuses % on an f64 AT THE OPERATOR, not from the backend', () => {
    // `.not.toEqual([])` would pass on the span-less TS8015/SD0041 this is meant to rule out,
    // so the code and the text are both asserted.
    for (const body of [
      'export function k(a: f64, b: f64): f64 { return a % b }',
      'export function k(a: f64): f64 { return a % 2. }',
      'export function k(a: vec3f64, b: vec3f64): vec3f64 { return a % b }',
    ]) {
      const errors = errorsOf(`"use typeshade"\n${body}\n`);
      expect(errors, body).toHaveLength(1);
      expect(errors[0], body).toMatch(
        /^Cannot % (f64|vec3<f64>): the emulated double has no remainder/,
      );
    }
    const compound = errorsOf(
      `"use typeshade"\nexport function k(a: f64): f64 { let x: f64 = a; x %= 2.; return x }\n`,
    );
    expect(compound).toHaveLength(1);
    expect(compound[0]).toMatch(/^Cannot %= f64: the emulated double has no remainder/);
  });
});

// ── Lanes ──

describe('the components of a vec64', () => {
  it('swizzles and indexes a vec64', () => {
    expect(
      errorsOf(`"use typeshade";
export function k(a: vec3f64): f64 {
  const x = a.x;
  const one = a[1];
  const pair = a.xy;
  const narrowed: vec3 = vec3(a);
  return x + one + pair.y + f64(narrowed.z);
}
`),
    ).toEqual([]);
  });

  it('reads the lane the pass reads, so the CPU agrees with the double', () => {
    const { double, emulated } = bothWays(
      `"use typeshade";
export function k(a: f64, b: f64, c: f64): f64 {
  const v = vec3f64(a, b, c);
  return v.x * 100. + v[1] * 10. + v.z;
}
`,
      [1, 2, 3],
    );
    expect(double).toBe(123);
    expect(emulated).toBe(123);
  });

  it('refuses a dynamic lane, which is a swizzle by a value neither target spells', () => {
    expect(
      errorsOf(`"use typeshade"\nexport function k(a: vec3f64, i: i32): f64 { return a[i] }\n`),
    ).toEqual([
      'A vec3<f64> is indexed by a constant lane, since an emulated double is a pair of ' +
        'hi/lo planes and a lane of it is a swizzle of both; write v.x, v.y or a whole-number ' +
        'index.',
    ]);
  });

  it('refuses a lane past the end', () => {
    expect(
      errorsOf(`"use typeshade"\nexport function k(a: vec2f64): f64 { return a[2] }\n`),
    ).toEqual(['Index 2 is out of range for length 2.']);
  });
});

// ── The f32 slots ──

describe('an f64 where the target takes an f32', () => {
  const TEXTURE = `"use typeshade";
declare const t: texture_2d<f32>;
declare const s: sampler;
class C { @location(0) color: vec4; }
`;

  // The wording moved when lane C's #145 landed beside this: `floatArg` and `vecArg` were
  // rewritten there to COERCE and write back rather than only validate, and their messages
  // gained the argument the author actually wrote (`f32(l)`, not `f32(x)`) and the
  // `TEXTURE_ARGUMENT` code. Every refusal below still happens, on the same program, for the
  // same reason; only the sentence improved, so the expectations move with it.
  it('refuses an f64 in every f32 slot naming the argument to narrow', () => {
    expect(
      errorsOf(`${TEXTURE}@fragment
export function fs(@location(0) uv: vec2): C {
  const l: f64 = 0.5
  return { color: textureSampleLevel(t, s, uv, l) }
}
`),
    ).toEqual(['textureSampleLevel level must be an f32; got f64. Write f32(l).']);

    expect(
      errorsOf(`${TEXTURE}@fragment
export function fs(@location(0) uv: vec2): C {
  const b: f64 = 0.5
  return { color: textureSampleBias(t, s, uv, b) }
}
`),
    ).toEqual(['textureSampleBias bias must be an f32; got f64. Write f32(b).']);

    expect(
      errorsOf(`"use typeshade";
declare const shadow: texture_depth_2d;
declare const cmp: sampler_comparison;
class C { @location(0) color: vec4; }
@fragment
export function fs(@location(0) uv: vec2): C {
  const d: f64 = 0.5;
  return { color: vec4(textureSampleCompare(shadow, cmp, uv, d)) };
}
`),
    ).toEqual(['textureSampleCompare depth_ref must be an f32; got f64. Write f32(d).']);
  });

  it('already refused the coordinate and the atomic value, and still does', () => {
    // Not new — `vecArg` checks the coordinate's shape and the atomic check its element — but
    // pinned here so the slot sweep is complete rather than partial. The message names the
    // ELEMENT rather than the width, because the width is the one thing this coordinate got
    // right: a `vec2<f64>` is two wide, as a 2D sample wants, and f64 where f32 is wanted.
    expect(
      errorsOf(`${TEXTURE}@fragment
export function fs(@location(0) uv: vec2): C {
  const c = vec2f64(f64(uv.x), f64(uv.y))
  return { color: textureSample(t, s, c) }
}
`),
    ).toEqual(['textureSample on a texture_2d<f32> takes an f32 coordinate; got vec2<f64>.']);
  });
});

// ── The entry boundary ──

describe('an f64 across an entry signature', () => {
  it('refuses an interpolated f64 and names an ordinary remedy', () => {
    expect(
      errorsOf(`"use typeshade";
class C { @location(0) color: vec4; }
@fragment
export function fs(@location(0) p: f64): C { return { color: vec4(f32(p), 0., 0., 1.) }; }
`),
    ).toEqual([
      'Parameter "p" carries f64: an emulated double is a pair of f32 words, and a @location ' +
        'varying interpolates each word on its own, which is not the interpolation of the ' +
        'double. Narrow it with f32(x), or compute the double in the stage that needs it — ' +
        'a uniform or storage binding carries an f64 and every stage can read one.',
    ]);
  });

  it('refuses an f64 @location field of an IO struct', () => {
    expect(
      errorsOf(`"use typeshade";
class VsOut {
  @builtin("position") pos: vec4;
  @location(0) w: f64;
}
@vertex
export function vs(@builtin("vertex_index") i: u32): VsOut {
  return { pos: vec4(f32(i), 0., 0., 1.), w: f64(1.) };
}
`)[0],
    ).toContain('a uniform or storage binding carries an f64');
  });

  it('keeps a SCALAR f64 vertex attribute, whose pair fits the one slot it has', () => {
    // A vertex @location input is a buffer read, not a varying — the pass accepts it, so the
    // front end must not be stricter than the pass in the other direction either.
    expect(
      errorsOf(`"use typeshade";
class V { @builtin("position") pos: vec4; }
@vertex
export function vs(@location(0) p: f64): V { return { pos: vec4(f32(p), 0., 0., 1.) }; }
`),
    ).toEqual([]);
  });
});

// ── The shapes that already worked, kept ──

describe('f64 surface', () => {
  it('accepts f64 and vec3<f64>', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function add(a: vec3<f64>, b: vec3d): vec3<f64> {
        return a;
      }
    `);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  });

  it('accepts mat4<f64> * vec4<f64>', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function xform(m: mat4<f64>, p: vec4<f64>): vec4<f64> {
        return m * p;
      }
    `);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  });
});
