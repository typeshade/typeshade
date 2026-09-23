// Argument checks for the free math builtins (roadmap 0.2 item 9, #57, §10). Measured on
// `main` before this: every call below that is TS8036 now compiled with zero diagnostics and
// emitted a call Tint refuses ("no matching call to 'dot(vec3<f32>, vec2<f32>)'"), or died as
// a return-type mismatch on the wrong argument. What is pinned here: the shapes WGSL takes and
// the ones it does not, one diagnostic on the offending argument with the fix, the result type
// following the operand that decides the shape, and a written number in the first position
// taking an integer peer's kind.

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { compileTsSource } from './source-file.js';
import { TS_CODES } from './codes.js';
import { MATH_ARG_SPECS } from './lower/math-args.js';
import { MATH_FN_ARITY } from './math-alias.js';

const M = TS_CODES.MATH_ARGUMENT;
const fn = (params: string, ret: string, body: string) => `"use typeshade"
export function f(${params}): ${ret} {
  return ${body}
}
`;
const errorsOf = (src: string) =>
  compileTsSource(src)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => `${d.code} ${d.message}`);
/** The source text the one diagnostic of `src` points at. */
const spanOf = (src: string) => {
  const d = compileTsSource(src).diagnostics.filter((x) => x.category === 'error');
  expect(d).toHaveLength(1);
  return src.slice(d[0]!.start, d[0]!.start + d[0]!.length);
};

describe('math arguments: two shapes that had to agree', () => {
  it('dot(vec3, vec2), written plainly and through arithmetic TypeScript types as number', () => {
    const plain = fn('a: vec3, b: vec2', 'f32', 'dot(a, b)');
    expect(errorsOf(plain)).toEqual([
      `${M} dot takes arguments of one type; the first is vec3<f32>, this one vec2<f32>. Give the vectors one size.`,
    ]);
    expect(spanOf(plain)).toBe('b');
    expect(compile(plain).wgsl).toBeUndefined();
    const scaled = fn('a: vec3, b: vec2, s: f32', 'f32', 'dot(a * s, b * s)');
    expect(errorsOf(scaled)).toEqual([
      `${M} dot takes arguments of one type; the first is vec3<f32>, this one vec2<f32>. Give the vectors one size.`,
    ]);
    expect(spanOf(scaled)).toBe('b * s');
  });

  it('a scalar beside a vector, on either side, says to splat it', () => {
    expect(errorsOf(fn('v: vec3', 'vec3', 'clamp(v, 0., 1.)'))).toEqual([
      `${M} clamp takes arguments of one type; the first is vec3<f32>, this one f32. Splat the scalar to the vector's size: vec3(x).`,
    ]);
    expect(errorsOf(fn('v: vec3', 'vec3', 'min(v, 0.5)'))).toEqual([
      `${M} min takes arguments of one type; the first is vec3<f32>, this one f32. Splat the scalar to the vector's size: vec3(x).`,
    ]);
    expect(errorsOf(fn('v: vec3', 'vec3', 'pow(v, 2.)'))).toHaveLength(1);
    expect(errorsOf(fn('v: vec3', 'vec3', 'step(v, 0.5)'))).toHaveLength(1);
    // The reverse shapes were refused before, as a return-type mismatch; now the argument.
    expect(errorsOf(fn('v: vec3, s: f32', 'vec3', 'max(s, v)'))).toEqual([
      `${M} max takes arguments of one type; the first is f32, this one vec3<f32>. Splat the scalar to the vector's size: vec3(x).`,
    ]);
    expect(errorsOf(fn('v: vec3', 'vec3', 'smoothstep(0., 1., v)'))).toEqual([
      `${M} smoothstep takes arguments of one type; the first is f32, this one vec3<f32>. Splat the scalar to the vector's size: vec3(x).`,
    ]);
    expect(errorsOf(fn('v: vec3i, s: i32', 'vec3i', 'min(v, s)'))).toEqual([
      `${M} min takes arguments of one type; the first is vec3<i32>, this one i32. Splat the scalar to the vector's size: vec3i(x).`,
    ]);
    // Splatted, they compile.
    expect(errorsOf(fn('v: vec3', 'vec3', 'clamp(v, vec3(0.), vec3(1.))'))).toEqual([]);
  });

  it('two kinds of one shape say to cast one side', () => {
    expect(errorsOf(fn('a: f32, i: i32', 'f32', 'max(a, i)'))).toEqual([
      `${M} max takes arguments of one type; the first is f32, this one i32. Cast one side: f32(x) or i32(x).`,
    ]);
    expect(errorsOf(fn('a: vec2u, b: vec2i', 'vec2u', 'min(a, b)'))).toEqual([
      `${M} min takes arguments of one type; the first is vec2<u32>, this one vec2<i32>. Cast one side: vec2u(x) or vec2i(x).`,
    ]);
  });

  it('names the call as written: Math.min, and atan for the two-argument arctangent', () => {
    expect(errorsOf(fn('v: vec3', 'vec3', 'Math.min(v, 0.5)'))).toEqual([
      `${M} Math.min takes arguments of one type; the first is vec3<f32>, this one f32. Splat the scalar to the vector's size: vec3(x).`,
    ]);
    expect(errorsOf(fn('v: vec2, s: f32', 'vec2', 'atan(v, s)'))).toEqual([
      `${M} atan takes arguments of one type; the first is vec2<f32>, this one f32. Splat the scalar to the vector's size: vec2(x).`,
    ]);
  });
});

describe('math arguments: the element kinds each builtin has a form for', () => {
  it('the float builtins refuse an integer, mix among them', () => {
    expect(errorsOf(fn('v: vec3i', 'vec3i', 'sin(v)'))).toEqual([
      `${M} sin takes an f32, or a vector of them; got vec3<i32>.`,
    ]);
    expect(errorsOf(fn('a: vec3i, b: vec3i', 'vec3i', 'mix(a, b, 1)'))).toEqual([
      `${M} mix takes an f32, or a vector of them; got vec3<i32>.`,
    ]);
    expect(errorsOf(fn('a: vec3i, b: vec3i', 'vec3i', 'pow(a, b)'))).toHaveLength(1);
    expect(errorsOf(fn('x: u32', 'u32', 'fract(x)'))).toEqual([
      `${M} fract takes an f32, or a vector of them; got u32.`,
    ]);
  });

  it('abs, min, max and clamp take any number; sign takes no u32; the bit builtins take integers', () => {
    expect(errorsOf(fn('v: vec3i', 'vec3i', 'abs(v)'))).toEqual([]);
    expect(errorsOf(fn('a: vec2u, b: vec2u', 'vec2u', 'max(a, b)'))).toEqual([]);
    expect(errorsOf(fn('x: u32', 'u32', 'sign(x)'))).toEqual([
      `${M} sign takes an f32 or i32, or a vector of them; got u32.`,
    ]);
    expect(errorsOf(fn('x: f32', 'f32', 'countOneBits(x)'))).toEqual([
      `${M} countOneBits takes an i32 or u32, or a vector of them; got f32.`,
    ]);
    expect(errorsOf(fn('m: vec3b', 'vec3b', 'abs(m)'))).toEqual([
      `${M} abs takes a number, or a vector of them; got vec3<bool>.`,
    ]);
  });

  it('the vector builtins refuse a scalar; cross takes two vec3', () => {
    expect(errorsOf(fn('s: f32', 'f32', 'normalize(s)'))).toEqual([
      `${M} normalize takes vectors; got f32.`,
    ]);
    expect(errorsOf(fn('a: f32, b: f32', 'f32', 'dot(a, b)'))).toEqual([
      `${M} dot takes vectors; got f32.`,
    ]);
    expect(errorsOf(fn('a: vec2, b: vec2', 'vec2', 'cross(a, b)'))).toEqual([
      `${M} cross takes two vec3; got vec2<f32>.`,
    ]);
    // length and distance take a scalar too, as WGSL does.
    expect(errorsOf(fn('a: f32, b: f32', 'f32', 'length(a) + distance(a, b)'))).toEqual([]);
  });
});

describe('math arguments: the positions with a shape of their own', () => {
  it("mix blends by the vectors' type or a scalar of their kind", () => {
    expect(errorsOf(fn('a: vec3, b: vec3, t: f32', 'vec3', 'mix(a, b, t)'))).toEqual([]);
    expect(errorsOf(fn('a: vec3, b: vec3, t: vec3', 'vec3', 'mix(a, b, t)'))).toEqual([]);
    expect(errorsOf(fn('a: vec3, b: vec3, t: vec2', 'vec3', 'mix(a, b, t)'))).toEqual([
      `${M} mix takes this argument as vec3<f32>, the first argument's type, or as a scalar f32; got vec2<f32>.`,
    ]);
    expect(errorsOf(fn('a: vec3, c: vec2, t: f32', 'vec3', 'mix(a, c, t)'))).toEqual([
      `${M} mix takes arguments of one type; the first is vec3<f32>, this one vec2<f32>. Give the vectors one size.`,
    ]);
  });

  it('mod takes a vector against a scalar of its kind; refract a scalar eta', () => {
    expect(errorsOf(fn('v: vec3', 'vec3', 'mod(v, 2.)'))).toEqual([]);
    expect(errorsOf(fn('v: vec3, w: vec2', 'vec3', 'mod(v, w)'))).toEqual([
      `${M} mod takes this argument as vec3<f32>, the first argument's type, or as a scalar f32; got vec2<f32>.`,
    ]);
    expect(errorsOf(fn('i: vec3, n: vec3, e: vec3', 'vec3', 'refract(i, n, e)'))).toEqual([
      `${M} refract takes a scalar f32 here; got vec3<f32>.`,
    ]);
    expect(errorsOf(fn('i: vec3, n: vec3', 'vec3', 'refract(i, n, 0.75)'))).toEqual([]);
  });

  it("ldexp's exponent is an i32 of x's shape; a bit offset and count are u32", () => {
    expect(errorsOf(fn('v: vec2', 'vec2', 'ldexp(v, 2)'))).toEqual([
      `${M} ldexp takes a vec2i exponent for a vec2<f32> x, one component each; got i32.`,
    ]);
    expect(errorsOf(fn('v: vec2', 'vec2', 'ldexp(v, vec2i(1, 2))'))).toEqual([]);
    expect(errorsOf(fn('x: f32, e: u32', 'f32', 'ldexp(x, e)'))).toEqual([
      `${M} ldexp takes an i32 exponent; got u32.`,
    ]);
    expect(errorsOf(fn('k: u32, i: i32', 'u32', 'extractBits(k, i, 4)'))).toEqual([
      `${M} extractBits takes a u32 offset and count; got i32.`,
    ]);
    expect(errorsOf(fn('k: u32, n: u32', 'u32', 'insertBits(k, n, 4, 4)'))).toEqual([]);
  });

  it('transpose and determinant take a matrix', () => {
    expect(errorsOf(fn('v: vec4', 'vec4', 'transpose(v)'))).toEqual([
      `${M} transpose takes a matrix; got vec4<f32>.`,
    ]);
    expect(errorsOf(fn('v: vec4', 'f32', 'determinant(v)'))).toEqual([
      `${M} determinant takes a matrix; got vec4<f32>.`,
    ]);
  });
});

describe('math arguments: the result follows the operand deciding the shape', () => {
  it('a written number in the first position takes an integer peer: min(1, i) is an i32 call', () => {
    // Before this it typed the call f32 and emitted `min(1.0, i)`, which WGSL does not accept.
    const r = compile(fn('i: i32', 'i32', 'min(1, i)'));
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('return min(1, i);');
    const c = compile(fn('i: u32', 'u32', 'clamp(0, i, 10)'));
    expect(c.diagnostics).toEqual([]);
    expect(c.wgsl).toContain('return clamp(0u, i, 10u);');
    // A float peer changes nothing, and a builtin with no integer form keeps its f32 first
    // argument so the odd one out is the integer.
    expect(compile(fn('x: f32', 'f32', 'max(1, x)')).wgsl).toContain('return max(1.0, x);');
    expect(errorsOf(fn('i: i32', 'f32', 'pow(2, i)'))).toEqual([
      `${M} pow takes arguments of one type; the first is f32, this one i32. Cast one side: f32(x) or i32(x).`,
    ]);
  });

  it('dot of integer vectors is an integer', () => {
    const r = compile(fn('a: vec3i, b: vec3i', 'i32', 'dot(a, b)'));
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('fn f(a: vec3<i32>, b: vec3<i32>) -> i32');
    expect(errorsOf(fn('a: vec3u, b: vec3u', 'f32', 'dot(a, b)'))).toEqual([
      expect.stringContaining('TS8003'),
    ]);
  });
});

// ═══ P1-36 of #155 — the rule table IS the contract, so the suite iterates it ═══
//
// The cases above are hand-written, about twenty of the sixty-four rules. `MATH_ARG_SPECS` is
// what the compiler actually consults, so a row added to it with a typo'd element list, or a
// row whose check silently stops firing, is invisible to a suite written beside it. These
// three arms are driven BY the table: every rule must refuse a wrong element KIND, every rule
// must count its arguments, and every rule whose later argument is the first one's type again
// must refuse a wrong SHAPE.
//
// The programs are derived from the rule, not written down: the first argument takes an
// element kind the rule excludes, or a later one a different width. That is what makes a new
// row covered the moment it is added — which is the property twenty hand-written cases cannot
// have.
describe('every rule in MATH_ARG_SPECS refuses a wrong kind, a wrong count and a wrong shape', () => {
  const NAMES = ['a', 'b', 'c', 'd'] as const;

  /** A spelling of `elem` at the given width: `f32`/`i32`/`u32`/`bool`, or `vec3i` and friends. */
  const spell = (width: 'scalar' | 'vec2' | 'vec3', elem: string): string => {
    const scalar: Readonly<Record<string, string>> = {
      f32: 'f32',
      i32: 'i32',
      u32: 'u32',
      bool: 'bool',
    };
    const suffix: Readonly<Record<string, string>> = { f32: '', i32: 'i', u32: 'u', bool: 'b' };
    return width === 'scalar' ? (scalar[elem] ?? 'f32') : `${width}${suffix[elem] ?? ''}`;
  };

  /** An element kind the rule does NOT admit. Every rule excludes at least one of these three:
   *  `elems` is a subset of {f32, f64, i32, u32} and never holds `bool`. */
  const excludedElem = (elems: readonly string[]): string =>
    !elems.includes('i32') ? 'i32' : !elems.includes('f32') ? 'f32' : 'bool';

  /** An element kind the rule DOES admit, skipping `f64` — an emulated double is left to the
   *  fp64 pass, which has its own lifting rules (`math-args.ts` says so). */
  const admittedElem = (elems: readonly string[]): string =>
    elems.find((e) => e !== 'f64') ?? 'f32';

  const probe = (params: readonly string[], call: string): string => `"use typeshade"
export function probe(${params.join(', ')}): f32 {
  const r = ${call}
  return 0.
}
`;

  const ids = Object.keys(MATH_ARG_SPECS).sort();

  it('covers every rule the compiler consults, and no id that has none', () => {
    // Non-vacuity for the three arms below: if the table came back empty they would pass.
    expect(ids.length).toBeGreaterThan(50);
    for (const id of ids) expect(MATH_FN_ARITY[id], id).toBeGreaterThan(0);
  });

  /** Rules whose SECOND argument has a role of its own, so a call with every parameter at the
   *  first one's type is refused whatever the element kind is — `extractBits(x, offset, count)`
   *  wants a `u32` offset, `ldexp(x, e)` an `i32` exponent, `refract(i, n, eta)` a scalar eta.
   *  For these the wrong-kind probe cannot tell the element rule firing from the own-role rule
   *  firing (both report TS8036), so the positive control is skipped and the arm is only a
   *  "something refuses this" check. Measured 2026-09-21; shrink-only by the arm after it. */
  const OWN_ROLE_MASKS_THE_KIND = new Set(['extractBits', 'insertBits', 'ldexp', 'refract']);

  it.each(ids)('refuses a wrong element kind for `%s`, with TS8036', (id) => {
    const spec = MATH_ARG_SPECS[id]!;
    const arity = MATH_FN_ARITY[id]!;
    const width = spec.vector === true || spec.vec3 === true ? 'vec3' : 'scalar';
    const call = `${id}(${NAMES.slice(0, arity).join(', ')})`;

    // THE POSITIVE CONTROL FIRST. Without it the arm says nothing: a rule that refused EVERY
    // call of its shape — because a later argument has its own role, or because the check
    // broke into always-refuse — would pass the wrong-kind probe just as happily.
    if (!OWN_ROLE_MASKS_THE_KIND.has(id)) {
      const admitted = spell(width, admittedElem(spec.elems));
      const clean = errorsOf(
        probe(
          NAMES.slice(0, arity).map((n) => `${n}: ${admitted}`),
          call,
        ),
      );
      expect(clean, `${id} refuses its OWN admitted element kind`).toEqual([]);
    }

    const type = spell(width, excludedElem(spec.elems));
    const params = NAMES.slice(0, arity).map((n) => `${n}: ${type}`);
    const errors = errorsOf(probe(params, call));
    expect(
      errors.some((e) => e.startsWith(M)),
      errors.join(' | '),
    ).toBe(true);
  });

  it('loses the OWN_ROLE_MASKS_THE_KIND entry of a rule whose admitted shape now compiles', () => {
    const clean: string[] = [];
    for (const id of OWN_ROLE_MASKS_THE_KIND) {
      const spec = MATH_ARG_SPECS[id]!;
      const arity = MATH_FN_ARITY[id]!;
      const width = spec.vector === true || spec.vec3 === true ? 'vec3' : 'scalar';
      const admitted = spell(width, admittedElem(spec.elems));
      const call = `${id}(${NAMES.slice(0, arity).join(', ')})`;
      const params = NAMES.slice(0, arity).map((n) => `${n}: ${admitted}`);
      if (errorsOf(probe(params, call)).length === 0) clean.push(id);
    }
    expect(clean).toEqual([]);
  });

  it.each(ids)('counts the arguments of `%s`, with TS8019', (id) => {
    const errors = errorsOf(probe([], `${id}()`));
    expect(
      errors.some((e) => e.startsWith(TS_CODES.ARITY_MISMATCH)),
      errors.join(' | '),
    ).toBe(true);
  });

  it('refuses a wrong shape wherever a later argument repeats the first one type', () => {
    // A rule whose second argument has its OWN role — `mod`'s scalar divisor, `ldexp`'s
    // integer exponent, `extractBits`' u32 offset — is not a shape case, and saying so here
    // keeps the three of them visible rather than silently skipped.
    const ownRole: string[] = [];
    const missed: string[] = [];
    for (const id of ids) {
      const spec = MATH_ARG_SPECS[id]!;
      const arity = MATH_FN_ARITY[id]!;
      if (arity < 2) continue;
      if ((spec.roles?.[1] ?? 'same') !== 'same') {
        ownRole.push(id);
        continue;
      }
      const elem = admittedElem(spec.elems);
      const params = NAMES.slice(0, arity).map(
        (n, i) => `${n}: ${spell(i === 1 ? 'vec2' : 'vec3', elem)}`,
      );
      const errors = errorsOf(probe(params, `${id}(${NAMES.slice(0, arity).join(', ')})`));
      if (!errors.some((e) => e.startsWith(M))) missed.push(`${id}: ${errors.join(' | ')}`);
    }
    expect(missed).toEqual([]);
    // `extractBits(x, offset, count)` takes a u32 offset, `ldexp(x, e)` an integer exponent
    // of x's shape, `mod(x, y)` a scalar divisor. `mix` and `insertBits` are NOT here: their
    // own roles sit at index 2, so their second argument is still the first one's type.
    expect(ownRole).toEqual(['extractBits', 'ldexp', 'mod']);
  });
});
