// === The ambient declarations for the TypeShade globals (design doc §4, §6) ===
//
// `SHADE_DTS` is loaded by `host.ts` as a virtual library file so a TypeScript program over a
// `"use typeshade"` file sees `f32`, `vec4`, `uniform<T>`, `@vertex`, and the rest of the
// authoring vocabulary with zero false positives on a valid program (§6). The vocabulary is
// derived from the compiler's own tables — `SUPPORTED_TYPE_NAMES` and `SCALAR_CAST` from
// `compiler/ts/type-map.ts`/`numeric.ts`, and the Math aliases from `compiler/ts/math-alias.ts`
// — rather than retyped by hand, so the two cannot drift silently. `WGSL_BUILTIN_NAMES` below is
// re-exported straight from `core/sot.ts`'s own runtime array, next to the `WgslBuiltinName`
// type it mirrors; `ambient.test.ts` additionally cross-checks that array against the type
// itself by parsing `core/sot.ts` with the TypeScript compiler API.
//
// GPU scalar types are branded nominal types: `type f32 = number & { readonly [tag]: true }`,
// with a REQUIRED (not optional) unique-symbol property, so `f32` and `u32` are not assignable
// to each other while a plain numeric literal — which every "use typeshade" program passes to
// `vec4(...)`, an `if`, or a `let` with no annotation — still widens to `number` and flows
// anywhere a `number` is accepted. Vector types are branded the same way, keyed by a
// `[elementKind, arity]` tuple so `vec2`/`vec3`/`vec4` and their `i`/`u`/`f64` variants are all
// distinct, and additionally carry real `x`/`y`/`z`/`w`/`r`/`g`/`b`/`a` component fields (plus
// the `xy`/`xyz`/`xyzw` and `rg`/`rgb`/`rgba` prefix swizzles) so member access type-checks;
// see the "Known limitation" note below `VecOf` for what this does not cover.

import { SUPPORTED_TYPE_NAMES } from '../compiler/ts/type-map.js';
import { F64_VEC_TWIN_KIND } from '../core/fp64/twins.js';
import { SCALAR_CAST } from '../compiler/ts/numeric.js';
import { MATH_FN_ARITY, MATH_EXPAND_ALIAS, LANG_CONST } from '../compiler/ts/math-alias.js';
import { WGSL_BUILTIN_NAMES as SOT_WGSL_BUILTIN_NAMES } from '../core/sot.js';
import { ATTRIBUTE_NAMES as COMPILER_ATTRIBUTE_NAMES } from '../compiler/ts/builtin-check.js';
import { FUNCTION_DOCS, CONSTANT_DOCS, ATTRIBUTE_DOCS, MATH_MEMBER_DOCS } from './docs.js';

// Renders a documentation string as a JSDoc block. Single line (single-line JSDoc) when
// it fits in 100 columns, otherwise a multi-line block with ` * ` prefixes. Throws if the
// text contains the string `*/`.
function renderJSDoc(text: string): string {
  if (text.includes('*/'))
    throw new Error(`JSDoc text contains '*/' which is not allowed: ${text}`);
  const singleLine = `/** ${text} */`;
  if (singleLine.length <= 100) return singleLine;
  const lines = text.split('\n');
  return `/**\n${lines.map((line) => ` * ${line}`).join('\n')}\n */`;
}

type VecElem = 'f32' | 'i32' | 'u32' | 'f64' | 'bool';

/** Every `vecN`/`vecNf`/`vecNi`/`vecNu`/`vecNf64` name in `SUPPORTED_TYPE_NAMES`, mapped to its
 * element kind — derived by pattern, not retyped, so a new vector alias in `type-map.ts` is
 * picked up automatically (and `ambient.test.ts` asserts every `SUPPORTED_TYPE_NAMES` entry is
 * accounted for by this map or the scalar/mat handling below, so a name that fits no pattern is
 * never silently skipped). `vecNd` is a bare alias for the same `vecNf64` brand, not a
 * constructor name — see `VEC_CTOR_NAMES` below. */
const VEC_TYPE_ELEM = new Map<string, VecElem>();
for (const name of SUPPORTED_TYPE_NAMES) {
  const m = /^vec([234])(f64|f|i|u|d|b)?$/.exec(name);
  if (!m) continue;
  const suffix = m[2];
  const elem: VecElem =
    suffix === undefined || suffix === 'f'
      ? 'f32'
      : suffix === 'i'
        ? 'i32'
        : suffix === 'u'
          ? 'u32'
          : suffix === 'b'
            ? 'bool'
            : 'f64';
  VEC_TYPE_ELEM.set(name, elem);
}

/** The subset of `VEC_TYPE_ELEM` keys that are also valid *constructor* call names — the
 * compiler's `VEC_CTOR` table in `lower/expression-call.ts` (private; not re-derived here
 * because it carries no vocabulary `type-map.ts` does not already have) accepts `vec2`/`vec3`/
 * `vec4` and their `f`/`i`/`u`/`f64` suffixes but never the bare `d` suffix — `vec2d(...)` is
 * not a function, only a type name. */
const VEC_CTOR_NAMES = [...VEC_TYPE_ELEM.keys()].filter((name) => !/d$/.test(name));

/** WGSL builtin ids `@builtin(...)` accepts — `core/sot.ts`'s own runtime array (the compiler
 * front end's `@builtin(...)` allow-list check reads the same one), re-exported here as a
 * completion/hover data source too — see `completions.ts`. */
export const WGSL_BUILTIN_NAMES: readonly string[] = SOT_WGSL_BUILTIN_NAMES;

/**
 * The attribute names the compiler parses as decorators, per `lower/function.ts`'s
 * `parseStage`/`builtinDecoratorArg`/`numberDecorator` and `structs.ts`'s field decorators.
 * `align`/`size`/`ignore` are NOT included: `structs.ts` only ever *rejects* `@align`
 * (`"@align on a field is not applied"`) and neither the struct nor the function lowering
 * recognizes `size` or `ignore` at all. `interpolate`, `invariant` and `blend_src` joined
 * the list in §53, where the struct collector gained real readers for all three. See the
 * phase report for the original deviation from the design doc's speculative list.
 * Re-exported from `compiler/ts/builtin-check.ts`
 * rather than retyped here, the same way `WGSL_BUILTIN_NAMES` below re-exports `core/sot.ts`'s
 * array: that module also uses this exact list to flag a misspelled attribute (`checkAttributeName`),
 * so the language service and the compiler's own diagnostics can never name two different
 * vocabularies.
 */
export const ATTRIBUTE_NAMES: readonly string[] = COMPILER_ATTRIBUTE_NAMES;

/** The nine \`matCxR\` aliases plus the \`matN\` shorthand for a square one, each taking the
 * element as an optional type argument — the same names `type-map.ts` maps and
 * `expression-call.ts` builds, generated from one pair of loops so the three cannot drift.
 * Only a SQUARE matrix takes `f64`: the fp64 pass has one df64 body per dimension. */
const MAT_ARITIES = [2, 3, 4] as const;
const matTypeAliases = MAT_ARITIES.flatMap((cols) =>
  MAT_ARITIES.flatMap((rows) => {
    const elem = cols === rows ? "T extends f64 ? 'f64' : 'f32'" : "'f32'";
    const param = cols === rows ? '<T extends f32 | f64 = f32>' : '';
    const body = `Mat<${elem}, ${cols}, ${rows}>`;
    const lines = [`type mat${cols}x${rows}${param} = ${body}`];
    if (cols === rows) lines.push(`type mat${cols}${param} = mat${cols}x${rows}<T>`);
    return lines;
  }),
).join('\n');

/** Every matrix constructor: from columns, from components, from a larger matrix, and the
 * zero form — the four `lowerMatrixCtor` accepts, in the same order. */
const matCtorOverloads = MAT_ARITIES.flatMap((cols) =>
  MAT_ARITIES.flatMap((rows) => {
    const name = `mat${cols}x${rows}`;
    const t = `mat${cols}x${rows}`;
    const columns = Array.from({ length: cols }, (_, i) => `c${i}: vec${rows}`).join(', ');
    const comps = Array.from({ length: cols * rows }, (_, i) => `e${i}: number`).join(', ');
    // Every source at least this size, the EQUAL one included: `lowerMatrixCtor` refuses only
    // `src.cols < cols || src.rows < rows`, so `mat3(m3)` is a legal identity construction and
    // the editor has to agree (it reported "No overload matches this call" on a program the
    // compiler accepts).
    const bigger = MAT_ARITIES.flatMap((c2) =>
      MAT_ARITIES.flatMap((r2) =>
        c2 >= cols && r2 >= rows ? [`declare function NAME(m: mat${c2}x${r2}): ${t}`] : [],
      ),
    );
    const forms = [
      `declare function NAME(): ${t}`,
      `declare function NAME(${columns}): ${t}`,
      `declare function NAME(${comps}): ${t}`,
      ...bigger,
    ];
    const names = cols === rows ? [name, `mat${cols}`] : [name];
    // Every `declare function` carries JSDoc — `docs.test.ts` requires it, and an editor
    // with no hover text on a constructor is the gap that rule exists to close.
    return names.flatMap((n) => {
      const doc = FUNCTION_DOCS[n];
      return forms.map((f) => {
        const line = f.replace(/NAME/g, n);
        return doc ? `${renderJSDoc(doc)}\n${line}` : line;
      });
    });
  }),
).join('\n');

const vecCtorOverloads = (name: string, elem: VecElem): string => {
  const n = Number(name.match(/\d/)![0]) as 2 | 3 | 4;
  // The PLAIN `vecN` names take WGSL's type argument, `vec3<u32>(1, 2, 3)` (#150). The short
  // names (`vec3u`) name their element already and the compiler refuses a second one, so they
  // stay ungeneric and the editor's "Expected 0 type arguments" is the right answer for them.
  const generic = /^vec[234]$/.test(name);
  const type = generic ? `VecFor${n}<T>` : vecTypeName(elem, n);
  const head = generic ? `declare function ${name}<T = f32>` : `declare function ${name}`;
  // A component of a bool vector (§27) is a bool; of every other vector, a number.
  //
  // PARAMETER types stay concrete even on the generic names, and only the RETURN rides on T.
  // A conditional in a parameter position defeats `diagnostics.ts`'s vector-arithmetic filter
  // (issue #43): that rule reads the brand off the resolved parameter type to decide whether
  // the shape the arithmetic erased would have fitted, and an unresolved `VecFor3<T>` carries
  // no brand, so `vec4(c * 2., 1.)` — a shape every example uses — started reporting TS2345.
  // The bool components get overloads of their own below instead of widening this one, which
  // would stop `vec3(1., true, 2.)` reporting.
  const c = elem === 'bool' ? 'bool' : 'number';
  const shorter = (k: 2 | 3): string => vecTypeName(elem, k);
  const lines: string[] = [];
  // `vec3()` is the ZERO value (wgsl.txt:20015-20030). Not on the emulated double, whose zero
  // is a pair the fp64 pass assembles rather than a literal the constructor can write — the
  // compiler refuses `vec3f64()` for the same reason.
  if (elem !== 'f64') lines.push(`${head}(): ${type}`);
  if (n === 2) {
    lines.push(`${head}(x: ${c}, y: ${c}): ${type}`);
  } else if (n === 3) {
    lines.push(`${head}(x: ${c}, y: ${c}, z: ${c}): ${type}`);
    lines.push(`${head}(v: ${shorter(2)}, z: ${c}): ${type}`);
    // The composition WGSL allows in the other order (wgsl.txt:20889/20987). Only the
    // vector-FIRST forms were declared, so `vec3(x, v2)` was red in the editor and green in
    // the compiler — the editor reading the vector as the scalar the first parameter names
    // ("Argument of type 'f32' is not assignable to parameter of type 'vec2'"). #157.
    lines.push(`${head}(x: ${c}, v: ${shorter(2)}): ${type}`);
  } else {
    lines.push(`${head}(x: ${c}, y: ${c}, z: ${c}, w: ${c}): ${type}`);
    lines.push(`${head}(v: ${shorter(3)}, w: ${c}): ${type}`);
    lines.push(`${head}(v: ${shorter(2)}, z: ${c}, w: ${c}): ${type}`);
    // The same gap at width 4, for the THREE-argument compositions.
    lines.push(`${head}(x: ${c}, v: ${shorter(2)}, w: ${c}): ${type}`);
    lines.push(`${head}(x: ${c}, y: ${c}, v: ${shorter(2)}): ${type}`);
    // NOT declared, and the omission is measured rather than an oversight: `vec4(x, v3)` and
    // `vec4(v2, v2)` are real WGSL and the compiler accepts both, but adding a SECOND
    // two-argument overload costs TypeScript the contextual type it uses to infer through
    // vector arithmetic. With one candidate, `vec4(mix(c * 0.5, d, 0.5), 1.)` contextually
    // types its first argument `vec3` and `mix` infers `vec3`; with two, the context is gone,
    // `mix` infers from the `number` the arithmetic erased `c * 0.5` to, and the call reports
    // TS2769 on a program that compiles. `vec4(c * 0.5, 1.)` is a far more common spelling
    // than either of the two, so the editor is better off without them until the #43 filter
    // can restore a shape through a NESTED call. Tracked on #157.
    // The same gap at width 4: a vec2 or a vec3 anywhere but first, and the two-vector form.
  }
  lines.push(`${head}(scalar: ${c}): ${type}`);
  // `vec3<bool>(true, false, true)` and `vec3<bool>(true)`. Generic with NO default, so the
  // type argument has to be written: an inferable `T` here would make the bare
  // `vec3(true, false, true)` legal in the editor, which the compiler refuses.
  if (generic) {
    const bools = Array.from({ length: n }, (_, i) => `${'xyzw'[i]!}: bool`).join(', ');
    lines.push(`declare function ${name}<T>(${bools}): VecFor${n}<T>`);
    lines.push(`declare function ${name}<T>(scalar: bool): VecFor${n}<T>`);
  }
  // The element-CONVERTING form (#8 A8): one whole vector of this constructor's own size and
  // a different element kind. The compiler's rule (`isConvertibleVector`) is exactly "native
  // vec, same n, different elem", so the overloads are the two other native kinds — and an
  // `f64` constructor gets none, because an emulated-double vector is a pair of f32 lanes the
  // fp64 pass assembles rather than a component list to reinterpret.
  if (elem !== 'f64') {
    for (const other of NATIVE_VEC_ELEMS) {
      if (other === elem) continue;
      lines.push(`${head}(v: ${vecTypeName(other, n)}): ${type}`);
    }
  }
  // The NARROWING form (§39): `vec3(v)` on a `vec3f64` takes each lane's (hi, lo) pair down
  // to one f32, which is `f32(lane)` per lane. Only the f32 constructor of the vector's own
  // width has it — the compiler refuses the integer and bool ones, since the fp64 pass has no
  // f64 → i32 body at all.
  if (elem === 'f32') {
    // The return is spelled CONCRETELY rather than as `${type}`, and not by accident. `${type}`
    // is `VecFor${n}<T>` on the plain `vecN` names, which carry a `<T = f32>` type argument
    // since #150 — so writing it here left `T` unbound in a declaration with no type parameter
    // ("Cannot find name 'T'", caught by the d.ts self-check when the two lanes merged). The
    // narrowing always yields the FLOAT vector whatever the constructor is called, so naming
    // that is both correct and the reason the overload needs no type parameter of its own.
    lines.push(`declare function ${name}(v: ${vecTypeName('f64', n)}): ${vecTypeName('f32', n)}`);
  }
  return lines.join('\n');
};

/** The element kinds a converting constructor accepts on either side. `f64` is deliberately
 *  absent — see {@link vecCtorOverloads}. */
const NATIVE_VEC_ELEMS: readonly VecElem[] = ['f32', 'i32', 'u32', 'bool'];

/** The canonical brand-type name for one (element, arity) pair — `vec2`/`vec3`/`vec4` for
 * `f32` (the default element every bare `vecN` name maps to), `vecNi`/`vecNu`/`vecNf64`
 * otherwise. Used both to declare the type aliases and to reference them from constructor
 * and swizzle signatures, so the two can never name two different types for one pair. */
function vecTypeName(elem: VecElem, n: 2 | 3 | 4): string {
  if (elem === 'f32') return `vec${n}`;
  if (elem === 'f64') return `vec${n}f64`;
  if (elem === 'bool') return `vec${n}b`;
  return `vec${n}${elem === 'i32' ? 'i' : 'u'}`;
}

/** Math free functions callable without a `Math.` prefix (GLSL-style), from `MATH_FN_ARITY` —
 * every key except `f32` (that key exists only because `Math.fround` aliases to the `f32`
 * scalar cast id; the callable name `f32` is the cast declared separately below, and the
 * compiler's own call lowering checks `SCALAR_CAST` before it ever reaches the canonical-math
 * path, so a second `f32` overload here would be dead vocabulary, never a real ambiguity). */
const FREE_MATH_NAMES = Object.keys(MATH_FN_ARITY).filter((name) => name !== 'f32');

/** The vector arities every native GPU vector type comes in, in order. */
const VEC_ARITIES: readonly (2 | 3 | 4)[] = [2, 3, 4];

/** The two vector families `mix` declares a vector-with-scalar overload for, and nothing else.
 *
 * WHICH SHAPES ARE REAL, measured by emitting one module per shape: `mix(vecN<f32>, vecN<f32>,
 * f32)` is the only vector-beside-scalar call in this vocabulary that both Tint and ANGLE's GLSL
 * ES 3.00 translator accept, and `mix(vecNf64, vecNf64, f32)` is the one the fp64 emitter
 * lowers, which is why the `f64` vectors are here too (`core/passes/fp64-lower.ts` refuses every
 * other vec64 form itself, with "mix() on vec64 needs a scalar f32 interpolant"). The `i32` and
 * `u32` vectors get none, since WGSL's and GLSL's `mix` are float only, and neither do
 * `clamp(vecN, s, s)`, `min`/`max(vecN, s)`, `pow(vecN, s)` or `step(vecN, s)`: the front end
 * lowers all of those to a call Tint rejects with "no matching call", so declaring them here
 * would make the editor green on a program that does not reach the GPU.
 *
 * WHAT THE DECLARATION ADMITS is wider than the shape it is named for, knowingly. `t: number`
 * takes any scalar, and narrowing it to `f32` closes nothing, measured: the scalar brands are
 * OPTIONAL (see `scalarBrands` below), so an `i32`, a `u32` and an `f64` are each assignable to
 * `f32` as well. `mix(vec3, vec3, i32)`, the `u32` form and the `f64` form are therefore accepted
 * here while Tint refuses them ("no matching call to 'mix(vec3<f32>, vec3<f32>, i32)'"), and a
 * blend factor whose vector brand arithmetic already erased, `mix(a, b, c * 2.)` with a `vec2`
 * `c`, is a fourth: it types as `number` and matches this overload outright, so the TS2769 rule
 * in `diagnostics.ts` is never consulted about it. Nothing on the declaration side can close any
 * of the four; the front-end argument check for the math builtins is where they belong (#57).
 * `ambient.test.ts` pins all four as known silent, so a later fix flips them deliberately. */
const F32_VEC_TYPE_NAMES: readonly string[] = VEC_ARITIES.map((n) => vecTypeName('f32', n));

/** The `f64` vector names, the second family {@link mixSignature} declares an overload for. */
const VEC64_TYPE_NAMES: readonly string[] = VEC_ARITIES.map((n) => vecTypeName('f64', n));

/**
 * `mix(a, b, t)`, whose `t` is a BLEND FACTOR rather than a third value of `a`'s type: WGSL
 * spells it `mix(e1: vecN<T>, e2: vecN<T>, e3: T)` and GLSL ES 3.00 `mix(genType, genType,
 * float)`, and the compiler lowers `mix(u.bottom.rgb, u.top.rgb, t)` with a scalar `t` to
 * exactly that call. The generic `mix<T extends Numeric>(a: T, b: T, t: T)` this vocabulary had
 * before demanded a vector there, so the line every gradient, hillshade and ocean shader is
 * written in drew TS2345 in the editor while it compiled, emitted and ran.
 *
 * Declared as CONCRETE overloads, one per vector arity in each of the two families
 * {@link F32_VEC_TYPE_NAMES} and {@link VEC64_TYPE_NAMES} name, ahead of the generic same-shape
 * one. Concrete is the point: a parameter TypeScript does not have to infer cannot collapse `T`,
 * so neither the vector arguments nor `t` are measured against a type another argument settled,
 * which is where the second-hand messages inside these calls came from (`'0.55' is not
 * assignable to '0.3'`). The same-shape generic overload stays last and still carries
 * `mix(vecN, vecN, vecN)`, `mix(f32, f32, f32)` and the `i32`/`u32` vectors, so nothing this
 * lib accepted before is rejected now.
 *
 * The `f64` arm is the one the generic overload could never have carried: `Numeric` does not
 * include the `vec64` family at all, so `mix(a, b, t)` on three `vec3f64` reported TS2741
 * ("Property '[vec64Tag]' is missing in type 'vec2'") beside its TS2769, on a program
 * `compileTsSource` lowers and the fp64 emitter turns into a `df64_v3_mix` call.
 */
/** The cross-lane reductions on an emulated-double vector (§39). The fp64 pass composes each
 * one from the SCALAR df64 error-free transforms and hands back an `f64`, which is what
 * `mathResultType` types them — so the signature has to answer `f64` and not the `number` the
 * `Numeric` form returns, or the editor would call a correct `const l: f64 = length(v)` a
 * mismatch. `Numeric` itself stays f32/i32/u32-only: widening it would let every componentwise
 * builtin take a `vec64` in the editor, and the pass has a body for ten of them
 * (fp64/twins.ts), not all of them.
 *
 * ONE signature with a widened constraint and a conditional result, not an overload SET: a
 * second overload turns every genuinely wrong shape from a TS2345 that names the argument into
 * a TS2769 that says only "no overload matches", and `diagnostics.test.ts` pins the TS2345 on
 * `dot(vec3, vec2)` as the diagnostic an author can act on. */
function vec64Reduction(name: string, arity: 1 | 2): string {
  const params = Array.from({ length: arity }, (_, i) => `a${i}: T`).join(', ');
  return (
    `declare function ${name}<T extends Numeric | Vec64Any>(${params}): ` +
    `T extends Vec64Any ? f64 : number`
  );
}

function mixSignature(): string {
  const vectorWithScalar = (v: string): string =>
    `declare function mix(a: ${v}, b: ${v}, t: number): ${v}`;
  return [
    ...F32_VEC_TYPE_NAMES.map(vectorWithScalar),
    ...VEC64_TYPE_NAMES.map(vectorWithScalar),
    scalarMathOverload('mix', 3),
    'declare function mix<T extends Numeric>(a: T, b: T, t: T): T',
  ].join('\n');
}

/**
 * The all-scalar shape of one math function, declared ahead of its generic overload.
 *
 * `T extends Numeric` has a PRIMITIVE constraint (`Numeric` includes `number`), which is exactly
 * the condition under which TypeScript keeps a literal argument's literal type as an inference
 * candidate instead of widening it. With no scalar overload to resolve to, `smoothstep(0.3,
 * 0.55, h)` on an `f32` `h` therefore settled `T` to `0.3` and reported the perfectly good
 * `0.55` against it, and `step(horizon, y)` on a `const horizon = 0.58` reported `y`. A concrete
 * `(a0: number, a1: number, ...) => number` matches first for every all-scalar call, infers
 * nothing, and returns `number` rather than a literal type. A vector argument is not a `number`,
 * so the overload cannot swallow a vector call: those still resolve to the generic one.
 */
function scalarMathOverload(name: string, arity: number): string {
  const params = Array.from({ length: arity }, (_, i) => `a${i}: number`).join(', ');
  return `declare function ${name}(${params}): number`;
}

/** Real GLSL semantics for the handful of free math functions whose signature is not simply
 * "same numeric type in, same numeric type out": `dot`/`distance`/`length` reduce a vector to
 * a scalar, `cross` is vec3-only, `normalize` preserves its vector's shape, and `mix` takes a
 * scalar blend factor beside two vectors (see {@link mixSignature}). Declared by hand because
 * `MATH_FN_ARITY` records arity only, not shape. An entry here replaces the generated pair
 * outright, so a name listed must declare its own all-scalar overload too when it wants one. */
const SPECIAL_MATH_SIGNATURES: Readonly<Record<string, string>> = {
  dot: vec64Reduction('dot', 2),
  distance: vec64Reduction('distance', 2),
  length: vec64Reduction('length', 1),
  normalize: 'declare function normalize<T extends Numeric | Vec64Any>(a: T): T',
  cross: 'declare function cross(a: vec3, b: vec3): vec3',
  mix: mixSignature(),
  // Roadmap 0.2 item 8: the shapes the generated "same type in, same type out" pair misses.
  // transpose(matCxR) -> matRxC on every shape (wgsl.txt:23397); determinant is square-only
  // (wgsl.txt:21842), so the non-square shapes get no overload and `tsc` says so first.
  transpose: MAT_ARITIES.flatMap((cols) =>
    MAT_ARITIES.map(
      (rows) => `declare function transpose(m: mat${cols}x${rows}): mat${rows}x${cols}`,
    ),
  ).join('\n'),
  determinant: MAT_ARITIES.map((n) => `declare function determinant(m: mat${n}x${n}): number`).join(
    '\n',
  ),
  refract: 'declare function refract<T extends Numeric>(i: T, n: T, eta: number): T',
  ldexp: 'declare function ldexp<T extends Numeric>(x: T, e: Numeric): T',
  extractBits:
    'declare function extractBits<T extends Numeric>(e: T, offset: number, count: number): T',
  insertBits:
    'declare function insertBits<T extends Numeric>(e: T, newbits: T, offset: number, count: number): T',
};

function freeMathSignature(name: string): string {
  const special = SPECIAL_MATH_SIGNATURES[name];
  if (special) return special;
  const arity = MATH_FN_ARITY[name]!;
  const params = Array.from({ length: arity }, (_, i) => `a${i}: T`).join(', ');
  // A componentwise builtin the fp64 pass has a `df64_vN_*` body for takes an emulated-double
  // vector too, and the editor has to say so or it red-squiggles a program the compiler
  // accepts — `abs(v)`, `round(v)`, `min(a, b)` on a `vec3f64` were eight such shapes. The set
  // is read from the pass's own table, so the editor cannot drift from it: a builtin with NO
  // body keeps the `Numeric` constraint and stays refused here, exactly as
  // `checkMathArgs` refuses it (§39).
  const constraint = F64_VEC_TWIN_KIND[name] === undefined ? 'Numeric' : 'Numeric | Vec64Any';
  return `${scalarMathOverload(name, arity)}\ndeclare function ${name}<T extends ${constraint}>(${params}): T`;
}

const EXPAND_NAMES = Object.keys(MATH_EXPAND_ALIAS);
const LANG_CONST_NAMES = Object.keys(LANG_CONST);
const SCALAR_CAST_NAMES = Object.keys(SCALAR_CAST);

// The brand property is OPTIONAL, not required: a required unique-symbol brand made a bare
// number literal (returned from an `f32`-annotated function, assigned to an `f32`-typed local,
// passed to a `dot`/`length` result typed `number`) a TS2322 false positive on ordinary valid
// "use typeshade" programs, because nothing in the authoring surface ever produces a literal
// value already carrying the brand. An optional brand keeps `f32`/`u32`/... mutually
// unassignable (the tradeoff §6 already makes for swizzles: false negatives over false
// positives) while letting a plain `number` widen into any scalar type, matching how these
// values actually flow through a real program.
const scalarBrands = ['f32', 'i32', 'u32', 'f64']
  .map(
    (name) =>
      `declare const ${name}Tag: unique symbol\ntype ${name} = number & { readonly [${name}Tag]?: true }`,
  )
  .join('\n');

const vecTypeAliases = [...VEC_TYPE_ELEM.entries()]
  .map(([name, elem]) => {
    const n = Number(name.match(/\d/)![0]) as 2 | 3 | 4;
    const canonical = vecTypeName(elem, n);
    return name === canonical ? '' : `type ${name} = ${canonical}`;
  })
  .filter(Boolean)
  .join('\n');

const vecCtors = VEC_CTOR_NAMES.map((name) => {
  const overloads = vecCtorOverloads(name, VEC_TYPE_ELEM.get(name)!);
  const doc = FUNCTION_DOCS[name];
  if (!doc) return overloads;
  // Add JSDoc before every overload
  return overloads
    .split('\n')
    .map((line) => {
      const match = line.match(/^declare function (\w+)/);
      if (!match) return line;
      return `${renderJSDoc(doc)}\n${line}`;
    })
    .join('\n');
}).join('\n');

const scalarCasts = SCALAR_CAST_NAMES.map((name) => {
  // A conversion, and — for every name but `f64`, whose zero is the pair the fp64 pass
  // assembles — the ZERO-value form WGSL also spells (#150): `f32()`, `i32()`, `u32()`,
  // `bool()`. `bool` converts from a number and returns a boolean, so its argument is not
  // `number` in the general case; the generated line below is the numeric one it already had.
  const zero = name === 'f64' ? '' : `declare function ${name}(): ${name}\n`;
  // A cast takes a `bool` too (wgsl.txt:20207): `u32(b)` is 1 or 0, and the compiler has
  // always lowered it. The editor read `f32(true)` as "Argument of type 'boolean' is not
  // assignable to parameter of type 'number'", which is the false POSITIVE this file exists to
  // prevent. `f64` is the exception: it WIDENS an f32 and the compiler refuses anything else,
  // so admitting a bool there would be the opposite mistake (#157).
  const arg = name === 'f64' ? 'number' : 'number | bool';
  const line = `${zero}declare function ${name}(x: ${arg}): ${name}`;
  const doc = FUNCTION_DOCS[name];
  if (!doc) return line;
  return line
    .split('\n')
    .map((l) => `${renderJSDoc(doc)}\n${l}`)
    .join('\n');
}).join('\n');

const freeMath = FREE_MATH_NAMES.map((name) => {
  const sig = freeMathSignature(name);
  return sig
    .split('\n')
    .map((line) => {
      const match = line.match(/^declare function (\w+)/);
      if (!match) return line;
      const doc = FUNCTION_DOCS[match[1]];
      if (!doc) return line;
      return `${renderJSDoc(doc)}\n${line}`;
    })
    .join('\n');
}).join('\n');

const expandFns = EXPAND_NAMES.map((name) => {
  const line = `declare function ${name}<T extends Numeric>(...args: T[]): T`;
  const doc = FUNCTION_DOCS[name];
  if (!doc) return line;
  return `${renderJSDoc(doc)}\n${line}`;
}).join('\n');

// Add the random function declaration with JSDoc
const randomDeclaration = FUNCTION_DOCS.random
  ? `${renderJSDoc(FUNCTION_DOCS.random)}\ndeclare function random(seed: f32 | vec2 | vec3): f32`
  : 'declare function random(seed: f32 | vec2 | vec3): f32';

const langConsts = LANG_CONST_NAMES.map((name) => {
  const line = `declare const ${name}: number`;
  const doc = CONSTANT_DOCS[name];
  if (!doc) return line;
  return `${renderJSDoc(doc)}\n${line}`;
}).join('\n');

// Build MathObject interface members with JSDoc
const mathMethodNames = [
  'abs',
  'acos',
  'acosh',
  'asin',
  'asinh',
  'atan',
  'atanh',
  'ceil',
  'cos',
  'cosh',
  'exp',
  'floor',
  'fround',
  'log',
  'log2',
  'round',
  'sign',
  'sin',
  'sinh',
  'sqrt',
  'tan',
  'tanh',
  'trunc',
];
const mathMethods = mathMethodNames
  .map((name) => {
    const line = `  ${name}(x: number): number`;
    const doc = MATH_MEMBER_DOCS[name];
    if (!doc) return line;
    return `  ${renderJSDoc(doc).split('\n').join('\n  ')}\n${line}`;
  })
  .join('\n');

const mathSpecialMethods = [
  `  ${renderJSDoc(MATH_MEMBER_DOCS.atan2).split('\n').join('\n  ')}\n  atan2(y: number, x: number): number`,
  `  ${renderJSDoc(MATH_MEMBER_DOCS.max).split('\n').join('\n  ')}\n  max(a: number, b: number): number`,
  `  ${renderJSDoc(MATH_MEMBER_DOCS.min).split('\n').join('\n  ')}\n  min(a: number, b: number): number`,
  `  ${renderJSDoc(MATH_MEMBER_DOCS.pow).split('\n').join('\n  ')}\n  pow(base: number, exponent: number): number`,
  `  ${renderJSDoc(MATH_MEMBER_DOCS.random).split('\n').join('\n  ')}\n  random(): number`,
].join('\n');

const mathConstants = ['E', 'LN10', 'LN2', 'LOG10E', 'LOG2E', 'PI', 'SQRT1_2', 'SQRT2']
  .map((name) => {
    const line = `  readonly ${name}: number`;
    const doc = MATH_MEMBER_DOCS[name];
    if (!doc) return line;
    return `  ${renderJSDoc(doc).split('\n').join('\n  ')}\n${line}`;
  })
  .join('\n');

/**
 * The unique-symbol tags `SHADE_DTS` brands the vector and matrix types with: `vecTag` on the
 * `vec2`/`vec3`/`vec4` family, `vec64Tag` on the `f64` vectors, `matTag` on the matrices.
 * The scalar tags (`f32Tag` and friends) and `arrayTag` are deliberately not listed. This is
 * the set of types whose arithmetic TypeScript's checker rejects, because a branded object
 * type is not a `number` (so `v * s` draws TS2362), and which `diagnostics.ts` therefore has
 * to recognize structurally to drop that false positive (design doc §6). A scalar is already
 * a `number` to TypeScript and indexing an `array` is not arithmetic, so neither needs the
 * same treatment. `diagnostics.test.ts` asserts this list against the tags `SHADE_DTS`
 * actually declares, so a new brand cannot appear without a decision about its arithmetic.
 */
export const GPU_BRAND_TAGS: readonly string[] = ['vecTag', 'vec64Tag', 'matTag'];

/**
 * The ambient declarations for every TypeShade global: the GPU scalar and vector/matrix types,
 * `array`/`uniform`/`storage`, the attribute decorators, the vector constructors, the scalar
 * casts, and the GLSL-style free math functions plus `Math.*`. Loaded by `host.ts` as a virtual
 * library file (`compilerOptions.lib: []`, this file supplying everything a `"use typeshade"`
 * program needs) so the editor and the compiler agree on one vocabulary (design doc §9).
 *
 * KNOWN LIMITATION (swizzles): the compiler accepts any 1-4-letter combination from one
 * component family (`.xyzw` or `.rgba`), including repeats and non-prefix orders (`.yx`,
 * `.xx`). Typing that fully needs a template-literal-generated key domain; this file instead
 * declares the components individually (`x`/`y`/`z`/`w`/`r`/`g`/`b`/`a`) plus the common
 * prefix swizzles (`xy`/`xyz`/`xyzw`, `rg`/`rgb`/`rgba`), which covers ordinary authoring and
 * every span this phase's examples and tests exercise. A swizzle outside that set is still
 * compiled correctly — it is only unseen by the *editor's* type-checking, which stays a false
 * negative (no red squiggle on invalid input) rather than the false positive §6 forbids.
 */
export const SHADE_DTS = `// Generated ambient declarations for TypeShade authoring — see ambient.ts.

${scalarBrands}
type bool = boolean

// A local stand-in for the standard-lib \`Pick\` helper: this program is compiled with \`lib: []\`
// (design doc §6), so \`lib.es5.d.ts\` — and every helper it declares, \`Pick\` included — is never
// part of the program. Without this, \`VecOf\` below silently resolved to an error type and every
// vector type collapsed to \`any\` (no false positives, but no real checking either).
type Pick<T, K extends keyof T> = { [P in K]: T[P] }

// The constructor type a mixin takes (surface document §29): any class, whatever its fields.
// TypeScript needs a base of this shape to accept \`class extends Base\`, and the compiler
// never reads it — the mixin runs when the file is compiled. Declaring your own, as the
// TypeScript handbook does, works just as well; this is here so a shader author does not have
// to know the incantation.
type AnyClass = new (...args: any[]) => object

declare const vecTag: unique symbol
type ScalarOf<S extends 'f32' | 'i32' | 'u32' | 'bool'> = S extends 'f32'
  ? f32
  : S extends 'i32'
    ? i32
    : S extends 'u32'
      ? u32
      : bool
type ComponentKeys<N extends 2 | 3 | 4> = N extends 2
  ? 'x' | 'y' | 'r' | 'g' | 'xy' | 'rg'
  : N extends 3
    ? 'x' | 'y' | 'z' | 'r' | 'g' | 'b' | 'xy' | 'rg' | 'xyz' | 'rgb'
    : 'x' | 'y' | 'z' | 'w' | 'r' | 'g' | 'b' | 'a' | 'xy' | 'rg' | 'xyz' | 'rgb' | 'xyzw' | 'rgba'
// The lanes an emulated-double vector may be indexed by, as NUMERIC LITERAL keys rather than
// an index signature. That is the compiler's rule exactly (§39): \`v[1]\` is a swizzle of the
// hi and lo planes and lowers, \`v[i]\` with a variable \`i\` would have to swizzle by a value
// and is refused, and \`v[2]\` on a \`vec2f64\` is out of range. An index signature would admit
// all three; leaving them out would admit none.
type LaneKeys<N extends 2 | 3 | 4> = N extends 2 ? 0 | 1 : N extends 3 ? 0 | 1 | 2 : 0 | 1 | 2 | 3
type VecOf<S extends 'f32' | 'i32' | 'u32' | 'bool', N extends 2 | 3 | 4> = {
  readonly [vecTag]: readonly [S, N]
} & Pick<
  {
    x: ScalarOf<S>
    y: ScalarOf<S>
    z: ScalarOf<S>
    w: ScalarOf<S>
    r: ScalarOf<S>
    g: ScalarOf<S>
    b: ScalarOf<S>
    a: ScalarOf<S>
    xy: VecOf<S, 2>
    rg: VecOf<S, 2>
    xyz: VecOf<S, 3>
    rgb: VecOf<S, 3>
    xyzw: VecOf<S, 4>
    rgba: VecOf<S, 4>
  },
  ComponentKeys<N>
>
type vec2 = VecOf<'f32', 2>
type vec3 = VecOf<'f32', 3>
type vec4 = VecOf<'f32', 4>
type vec2i = VecOf<'i32', 2>
type vec3i = VecOf<'i32', 3>
type vec4i = VecOf<'i32', 4>
type vec2u = VecOf<'u32', 2>
type vec3u = VecOf<'u32', 3>
type vec4u = VecOf<'u32', 4>
/** Vectors of bools (§27): what a comparison of two vectors yields, componentwise. Not
 * \`Numeric\`: no arithmetic, only \`any\`, \`all\`, \`select\` and \`!\`. */
type vec2b = VecOf<'bool', 2>
type vec3b = VecOf<'bool', 3>
type vec4b = VecOf<'bool', 4>
type BoolVec = vec2b | vec3b | vec4b

declare const vec64Tag: unique symbol
/** An \`f64\` vector swizzles like any other (§39): the fp64 pass rebuilds the picked lanes
 * out of the hi and lo planes it lowers the vector into, so \`v.x\` is an \`f64\` and \`v.xy\` a
 * \`vec2f64\`. A one-component pick and a multi-component one are the two shapes WGSL gives,
 * and the colour aliases name the same lanes. \`v[i]\` is the same pick by a CONSTANT index;
 * the index signature is not declared, because a dynamic one has no lowering. */
type Vec64<N extends 2 | 3 | 4> = { readonly [vec64Tag]: N } & Pick<
  {
    x: f64
    y: f64
    z: f64
    w: f64
    r: f64
    g: f64
    b: f64
    a: f64
    xy: Vec64<2>
    rg: Vec64<2>
    xyz: Vec64<3>
    rgb: Vec64<3>
    xyzw: Vec64<4>
    rgba: Vec64<4>
  },
  ComponentKeys<N>
> &
  Pick<{ 0: f64; 1: f64; 2: f64; 3: f64 }, LaneKeys<N>>
type vec2f64 = Vec64<2>
type vec3f64 = Vec64<3>
type vec4f64 = Vec64<4>
/** The emulated-double vectors as one union — what the cross-lane reductions widen to (§39).
 * Kept apart from \`Numeric\`, which is the set every componentwise builtin takes. */
type Vec64Any = vec2f64 | vec3f64 | vec4f64

${vecTypeAliases}

/** The vector a \`vecN<T>(...)\` call builds, from the type argument the author wrote (#150).
 *
 * Keyed on \`keyof\`, not on assignability. The scalar brands are OPTIONAL properties (see the
 * note above \`scalarBrands\`), which keeps a plain \`number\` flowing into any of them but also
 * makes \`f32\` and \`u32\` mutually ASSIGNABLE — so \`T extends u32\` matches every scalar and
 * cannot tell them apart. \`keyof\` sees a declared key whether or not it is optional, so
 * \`typeof u32Tag extends keyof T\` is exactly "T is the u32 brand". \`bool\` is \`boolean\` and
 * carries no tag, so it is discriminated by assignability, where it is genuinely disjoint. */
type VecElemOf<T, U, I, D, B, F> = T extends boolean
  ? B
  : typeof u32Tag extends keyof T
    ? U
    : typeof i32Tag extends keyof T
      ? I
      : typeof f64Tag extends keyof T
        ? D
        : F
/** What \`bitcast<T>\` reads: the OTHER 32-bit type. Keyed on \`keyof\` for the same reason
 * \`VecElemOf\` is — the scalar brands are optional properties, so \`f32 extends u32\` is true
 * and a conditional written on assignability collapses to one arm for both instantiations. */
type BitcastArg<T> = typeof u32Tag extends keyof T ? f32 : u32
type VecFor2<T> = VecElemOf<T, vec2u, vec2i, vec2f64, vec2b, vec2>
type VecFor3<T> = VecElemOf<T, vec3u, vec3i, vec3f64, vec3b, vec3>
type VecFor4<T> = VecElemOf<T, vec4u, vec4i, vec4f64, vec4b, vec4>

type Numeric = number | vec2 | vec3 | vec4 | vec2i | vec3i | vec4i | vec2u | vec3u | vec4u

/** JavaScript Console API surface exposed by the \`"use typeshade"\` authoring environment.
 * The source spelling is the standard \`console.*\` API; the compiler currently lowers the
 * logging-level methods below. Other Console methods remain visible to TypeScript only when
 * they are added here deliberately, so editor completion never advertises an unsupported
 * shader operation. */
interface Console {
  log(...data: (Numeric | boolean)[]): void
  info(...data: (Numeric | boolean)[]): void
  debug(...data: (Numeric | boolean)[]): void
  warn(...data: (Numeric | boolean)[]): void
  error(...data: (Numeric | boolean)[]): void
}
/** The standard console. Its logging methods are the ones declared on Console above; a
 * call to one is delivered to the host's console sink when the program runs on the CPU. */
declare const console: Console

declare const matTag: unique symbol
/** A matrix of \`C\` columns and \`R\` rows (§40), column-major as both targets are: \`m[j]\` is
 * column j, a \`vecR\`. The tag carries the element and BOTH dimensions, so \`mat2x3\` and
 * \`mat3x2\` are not interchangeable — they transpose into each other rather than being the
 * same type. The lane keys are numeric literals for the reason \`Vec64\`'s are: they accept
 * \`m[1]\` and refuse \`m[7]\`. */
type Mat<E extends string, C extends 2 | 3 | 4, R extends 2 | 3 | 4> = {
  readonly [matTag]: readonly [E, C, R]
} & Pick<
  { 0: MatColumn<E, R>; 1: MatColumn<E, R>; 2: MatColumn<E, R>; 3: MatColumn<E, R> },
  LaneKeys<C>
>
/** A column of a matrix: a \`vecR\` of its element. An emulated-double matrix has no column
 * type an author can hold — the compiler refuses indexing one — so it resolves to \`never\`
 * rather than quietly reading as a vector of f32. */
type MatColumn<E extends string, R extends 2 | 3 | 4> = E extends 'f32' ? VecOf<'f32', R> : never
${matTypeAliases}

declare const arrayTag: unique symbol
// The index signature is WRITABLE. \`out[gid.x] = value\` is the shape of every compute kernel
// (examples/compute-reduction-twin.shade.ts), and the compiler lowers it to a storage store, so a
// \`readonly\` here reported TS2542 ("Index signature ... only permits reading") on a program that
// compiles. The tag and \`length\` stay readonly: neither is assignable in the source language.
//
// The tag is OPTIONAL so a list can initialize an array (#8 A16): \`const xs: array<f32, 3> =
// [1., 2., 3.]\` compiles, and with a required tag the editor reported TS2322 ("Property
// '[arrayTag]' is missing") on a program the compiler accepts. \`length\` stays required and
// stays \`N\`, which is what still separates the sizes — a three-element list is not an
// \`array<f32, 2>\` in the editor either.
// Iterable, so \`for (const x of xs)\` type-checks (Rule 7.5): the compiler lowers it to a counted
// loop over the indices. The iterator's shape is written inline so it adds no global name.
type array<T, N extends number = number> = { readonly [arrayTag]?: readonly [T, N]; readonly length: N } & {
  [index: number]: T
  [Symbol.iterator](): { next(): { done: false; value: T } | { done: true; value: undefined } }
}
${renderJSDoc(FUNCTION_DOCS.array)}
declare function array<T, N extends number>(...values: readonly T[]): array<T, N>
${renderJSDoc(FUNCTION_DOCS.fill)}
declare function fill<T, N extends number>(value: T): array<T, N>

/** Transparent: a binding's declared value type IS \`T\` everywhere it is referenced in a
 * function body (\`bindings.ts\` unwraps the wrapper once when collecting the binding), so the
 * type alias is an identity rather than an opaque wrapper. */
type uniform<T> = T
type storage<T> = T
${renderJSDoc(FUNCTION_DOCS.uniform)}
declare function uniform<T>(): T
${renderJSDoc(FUNCTION_DOCS.storage)}
declare function storage<T>(): T

/** Specialization constants (#8 A7). Transparent for the same reason as \`uniform<T>\`: a
 * function body reads the override as a plain value of its type. */
type override<T> = T

declare const atomicTag: unique symbol
/** An atomic integer in storage memory (roadmap 0.2 item 4). Opaque, like a texture handle:
 * the value is reached only through \`atomicLoad\`, \`atomicStore\` and the read-modify-write
 * builtins, which is what the compiler enforces. It is declared inside a storage binding
 * (\`declare let bins: storage<array<atomic<u32>>>\`), never as a local or a parameter. */
type atomic<T extends u32 | i32 = u32> = { readonly [atomicTag]: T }

/** Workgroup memory (roadmap 0.2 item 5, #82). \`let tile: workgroup<array<f32, 64>>\` is one
 * workgroup's shared memory, zero at the start of each workgroup and shared by its invocations.
 * Transparent like \`storage<T>\`: a function body reads and writes the value as \`T\`. The other
 * module-variable space, a value each invocation owns, is a plain top-level \`let\`
 * (\`let seed: u32 = 7\`) and has no wrapper (§24). */
type workgroup<T> = T

declare const textureTag: unique symbol
declare const samplerTag: unique symbol
/** The texture and sampler HANDLES. Opaque tags, not identities: a texture is not a value
 * you can do arithmetic on, and the only things that accept one are the texture reads below,
 * which is exactly what the compiler enforces. \`E\` is the sampled element kind and
 * \`A\` whether the view is an array, so \`textureNumLayers\` can refuse a plain 2D texture in
 * the editor the way the compiler refuses it. */
/** What a sampled texture's element may be: "T must be f32, i32, or u32" (wgsl.txt:7047-7048).
 * It was unconstrained, so \`texture_2d<bool>\` typechecked in the editor while the compiler
 * refused it. */
type TextureElem = f32 | i32 | u32
/** The \`vec4\` a texel fetch yields, by the texture's element: WGSL's \`textureLoad\` returns
 * \`vec4<T>\` (wgsl.txt:24137-24176), and every overload used to say \`vec4\`, so a fetch from a
 * \`texture_2d<u32>\` read as an f32 vector in the editor. Keyed on \`keyof\` for the reason
 * \`VecElemOf\` is: the scalar brands are optional properties and so are mutually assignable. */
type Vec4OfElem<E> = typeof u32Tag extends keyof E
  ? vec4u
  : typeof i32Tag extends keyof E
    ? vec4i
    : vec4
/** A texel coordinate: WGSL takes "i32, or u32" (wgsl.txt:24129) and the ambient overloads took
 * the signed one alone, so \`textureLoad(t, vec2u(...), 0)\` — which Tint accepts, measured —
 * was red in the editor and green in the compiler. NOT called \`IVecN\`: that reads like GLSL's
 * \`ivec2\`, which is not a name this surface has, and the union is both signednesses. */
type TexelCoord2 = vec2i | vec2u
type TexelCoord3 = vec3i | vec3u
type texture_2d<E extends TextureElem = f32> = { readonly [textureTag]: readonly [E, false] }
type texture_2d_array<E extends TextureElem = f32> = { readonly [textureTag]: readonly [E, true] }
/** A cube texture is six faces looked up by a DIRECTION, and a 3D texture a volume addressed
 * by a \`vec3\` coordinate. A cube's element is not \`f32\` alone: \`textureGather\` reads an
 * integer cube, so the element is the same \`TextureElem\` every sampled texture takes, and it
 * is SAMPLING that is float-only — which the compiler says at the call rather than at the
 * declaration. */
type texture_cube<E extends TextureElem = f32> = { readonly [textureTag]: readonly [E, 'cube'] }
type texture_3d<E extends TextureElem = f32> = { readonly [textureTag]: readonly [E, '3d'] }
/** WebGPU-only (roadmap 0.4 item 12): a 1D texture is a row of texels addressed by ONE number,
 * and a cube array is N cube maps addressed by a direction and a layer. GLSL ES 3.00 has
 * neither, so a module using one emits WGSL alone. */
type texture_1d<E extends TextureElem = f32> = { readonly [textureTag]: readonly [E, '1d'] }
type texture_cube_array<E extends TextureElem = f32> = { readonly [textureTag]: readonly [E, 'cube-array'] }
/** A multisampled colour texture (roadmap 0.4 item 13): read one sample at a time with
 * \`textureLoad(t, coords, sampleIndex)\`, never sampled. WebGPU-only. */
type texture_multisampled_2d<E extends TextureElem = f32> = { readonly [textureTag]: readonly [E, '2d-ms'] }
type sampler = { readonly [samplerTag]: true }

declare const storageTextureTag: unique symbol
/** The texel formats a storage texture may carry: the sixteen every WebGPU device stores to
 * with no feature requested, plus \`"bgra8unorm"\`, which needs the \`bgra8unorm-storage\`
 * feature and stores only. Measured against a real device, not read off a spec — a format
 * outside them compiles and then fails when the host builds the bind group. */
type StorageFormat =
  | 'rgba8unorm'
  | 'rgba8snorm'
  | 'rgba8uint'
  | 'rgba8sint'
  | 'rgba16uint'
  | 'rgba16sint'
  | 'rgba16float'
  | 'r32uint'
  | 'r32sint'
  | 'r32float'
  | 'rg32uint'
  | 'rg32sint'
  | 'rg32float'
  | 'rgba32uint'
  | 'rgba32sint'
  | 'rgba32float'
  | 'bgra8unorm'
/** How a shader may touch a storage texture. \`"read_write"\` is the three single-channel
 * 32-bit formats only, which {@link texture_storage_2d} enforces. */
type StorageAccess = 'write' | 'read' | 'read_write'
/** The formats a device stores AND loads through one binding. Every other format is
 * \`"write"\` or \`"read"\`, one at a time. */
type ReadWriteStorageFormat = 'r32uint' | 'r32sint' | 'r32float'
/** The formats a device stores to and never loads from, which is \`"bgra8unorm"\` alone.
 * Measured: a bind group layout for it at \`read-only\` or \`read-write\` is refused with
 * "does not support storage texture access", on a device that requested the feature. */
type WriteOnlyStorageFormat = 'bgra8unorm'
/** The texel a format's channel kind decides: a \`"…uint"\` format is a \`vec4u\`, a
 * \`"…sint"\` one a \`vec4i\`, and every other one — unorm, snorm and float — a \`vec4\`.
 * Written as a conditional type so the editor refuses a mismatched store the way the compiler
 * does, rather than leaving it to the compile step. */
type StorageTexel<F extends StorageFormat> = F extends \`\${string}uint\`
  ? vec4u
  : F extends \`\${string}sint\`
    ? vec4i
    : vec4
/** A storage texture HANDLE: an image read and written by texel coordinate, with no sampler
 * and no filtering. The format and the access mode are part of its TYPE, as they are in WGSL,
 * so a binding says what it is and every call against it is checked against that. An access
 * mode of \`"read_write"\` is admitted only for the formats a device allows it for. */
type texture_storage_2d<
  F extends StorageFormat,
  A extends StorageAccess = 'write',
> = A extends 'write'
  ? { readonly [storageTextureTag]: readonly [F, A, false] }
  : F extends WriteOnlyStorageFormat
    ? never
    : A extends 'read_write'
      ? F extends ReadWriteStorageFormat
        ? { readonly [storageTextureTag]: readonly [F, A, false] }
        : never
      : { readonly [storageTextureTag]: readonly [F, A, false] }
type texture_storage_2d_array<
  F extends StorageFormat,
  A extends StorageAccess = 'write',
> = A extends 'write'
  ? { readonly [storageTextureTag]: readonly [F, A, true] }
  : F extends WriteOnlyStorageFormat
    ? never
    : A extends 'read_write'
      ? F extends ReadWriteStorageFormat
        ? { readonly [storageTextureTag]: readonly [F, A, true] }
        : never
      : { readonly [storageTextureTag]: readonly [F, A, true] }

declare const depthTextureTag: unique symbol
declare const samplerComparisonTag: unique symbol
/** A depth texture, the texture a shadow map is: single-channel float with no element type of
 * its own, read by COMPARISON through a \`sampler_comparison\`. \`A\` is whether the view is
 * an array. A plain read of one is not admitted yet, so no \`textureSample\` or
 * \`textureLoad\` overload takes it. */
type texture_depth_2d = { readonly [depthTextureTag]: false }
type texture_depth_2d_array = { readonly [depthTextureTag]: true }
/** The shadow map of a point light, compared by the direction from the light. */
type texture_depth_cube = { readonly [depthTextureTag]: 'cube' }
/** The shadow maps of N point lights in one binding; WebGPU-only, like \`texture_cube_array\`. */
type texture_depth_cube_array = { readonly [depthTextureTag]: 'cube-array' }
/** The depth attachment of an MSAA target, read one sample at a time and never compared. */
type texture_depth_multisampled_2d = { readonly [depthTextureTag]: '2d-ms' }
/** The sampler a depth comparison takes. Not interchangeable with \`sampler\` in either
 * direction, which the overloads below make the editor say before the compiler does. */
type sampler_comparison = { readonly [samplerComparisonTag]: true }

${renderJSDoc(FUNCTION_DOCS.textureSampleCompare)}
declare function textureSampleCompare(
  tex: texture_depth_2d,
  smp: sampler_comparison,
  uv: vec2,
  ref: number,
): f32
${renderJSDoc(FUNCTION_DOCS.textureSampleCompare)}
declare function textureSampleCompare(
  tex: texture_depth_2d_array,
  smp: sampler_comparison,
  uv: vec2,
  layer: number,
  ref: number,
): f32
${renderJSDoc(FUNCTION_DOCS.textureSampleCompareLevel)}
declare function textureSampleCompareLevel(
  tex: texture_depth_2d,
  smp: sampler_comparison,
  uv: vec2,
  ref: number,
): f32
${renderJSDoc(FUNCTION_DOCS.textureSampleCompareLevel)}
declare function textureSampleCompareLevel(
  tex: texture_depth_2d_array,
  smp: sampler_comparison,
  uv: vec2,
  layer: number,
  ref: number,
): f32
${renderJSDoc(FUNCTION_DOCS.textureSampleCompare)}
declare function textureSampleCompare(
  tex: texture_depth_cube,
  smp: sampler_comparison,
  dir: vec3,
  ref: number,
): f32
${renderJSDoc(FUNCTION_DOCS.textureSampleCompareLevel)}
declare function textureSampleCompareLevel(
  tex: texture_depth_cube,
  smp: sampler_comparison,
  dir: vec3,
  ref: number,
): f32
${renderJSDoc(FUNCTION_DOCS.textureSampleCompare)}
declare function textureSampleCompare(
  tex: texture_depth_cube_array,
  smp: sampler_comparison,
  dir: vec3,
  layer: number,
  ref: number,
): f32
${renderJSDoc(FUNCTION_DOCS.textureSampleCompareLevel)}
declare function textureSampleCompareLevel(
  tex: texture_depth_cube_array,
  smp: sampler_comparison,
  dir: vec3,
  layer: number,
  ref: number,
): f32
${renderJSDoc(FUNCTION_DOCS.textureGather)}
declare function textureGather<E extends TextureElem = f32>(
  component: number,
  tex: texture_2d<E>,
  smp: sampler,
  uv: vec2,
): Vec4OfElem<E>
${renderJSDoc(FUNCTION_DOCS.textureGather)}
declare function textureGather<E extends TextureElem = f32>(
  component: number,
  tex: texture_2d_array<E>,
  smp: sampler,
  uv: vec2,
  layer: number,
): Vec4OfElem<E>
${renderJSDoc(FUNCTION_DOCS.textureGather)}
declare function textureGather<E extends TextureElem = f32>(
  component: number,
  tex: texture_cube<E>,
  smp: sampler,
  dir: vec3,
): Vec4OfElem<E>
${renderJSDoc(FUNCTION_DOCS.textureGather)}
declare function textureGather<E extends TextureElem = f32>(
  component: number,
  tex: texture_cube_array<E>,
  smp: sampler,
  dir: vec3,
  layer: number,
): Vec4OfElem<E>
${renderJSDoc(FUNCTION_DOCS.textureGather)}
declare function textureGather(tex: texture_depth_2d, smp: sampler, uv: vec2): vec4
${renderJSDoc(FUNCTION_DOCS.textureGather)}
declare function textureGather(tex: texture_depth_2d_array, smp: sampler, uv: vec2, layer: number): vec4
${renderJSDoc(FUNCTION_DOCS.textureGather)}
declare function textureGather(tex: texture_depth_cube, smp: sampler, dir: vec3): vec4
${renderJSDoc(FUNCTION_DOCS.textureGather)}
declare function textureGather(tex: texture_depth_cube_array, smp: sampler, dir: vec3, layer: number): vec4
${renderJSDoc(FUNCTION_DOCS.textureGatherCompare)}
declare function textureGatherCompare(
  tex: texture_depth_2d,
  smp: sampler_comparison,
  uv: vec2,
  ref: number,
): vec4
${renderJSDoc(FUNCTION_DOCS.textureGatherCompare)}
declare function textureGatherCompare(
  tex: texture_depth_2d_array,
  smp: sampler_comparison,
  uv: vec2,
  layer: number,
  ref: number,
): vec4
${renderJSDoc(FUNCTION_DOCS.textureGatherCompare)}
declare function textureGatherCompare(
  tex: texture_depth_cube,
  smp: sampler_comparison,
  dir: vec3,
  ref: number,
): vec4
${renderJSDoc(FUNCTION_DOCS.textureGatherCompare)}
declare function textureGatherCompare(
  tex: texture_depth_cube_array,
  smp: sampler_comparison,
  dir: vec3,
  layer: number,
  ref: number,
): vec4
${renderJSDoc(FUNCTION_DOCS.textureSample)}
declare function textureSample(tex: texture_2d<f32>, smp: sampler, uv: vec2): vec4
${renderJSDoc(FUNCTION_DOCS.textureSample)}
declare function textureSample(
  tex: texture_2d_array<f32>,
  smp: sampler,
  uv: vec2,
  layer: number,
): vec4
${renderJSDoc(FUNCTION_DOCS.textureSample)}
declare function textureSample(tex: texture_cube<f32>, smp: sampler, dir: vec3): vec4
${renderJSDoc(FUNCTION_DOCS.textureSample)}
declare function textureSample(tex: texture_3d<f32>, smp: sampler, coord: vec3): vec4
${renderJSDoc(FUNCTION_DOCS.textureSample)}
declare function textureSample(tex: texture_1d<f32>, smp: sampler, coord: number): vec4
${renderJSDoc(FUNCTION_DOCS.textureSample)}
declare function textureSample(
  tex: texture_cube_array<f32>,
  smp: sampler,
  dir: vec3,
  layer: number,
): vec4
${renderJSDoc(FUNCTION_DOCS.textureSampleLevel)}
declare function textureSampleLevel(
  tex: texture_2d<f32>,
  smp: sampler,
  uv: vec2,
  level: number,
): vec4
${renderJSDoc(FUNCTION_DOCS.textureSampleLevel)}
declare function textureSampleLevel(
  tex: texture_2d_array<f32>,
  smp: sampler,
  uv: vec2,
  layer: number,
  level: number,
): vec4
${renderJSDoc(FUNCTION_DOCS.textureSampleLevel)}
declare function textureSampleLevel(
  tex: texture_cube<f32>,
  smp: sampler,
  dir: vec3,
  level: number,
): vec4
${renderJSDoc(FUNCTION_DOCS.textureSampleLevel)}
declare function textureSampleLevel(
  tex: texture_3d<f32>,
  smp: sampler,
  coord: vec3,
  level: number,
): vec4
${renderJSDoc(FUNCTION_DOCS.textureSampleLevel)}
declare function textureSampleLevel(tex: texture_1d<f32>, smp: sampler, coord: number, level: number): vec4
${renderJSDoc(FUNCTION_DOCS.textureSampleLevel)}
declare function textureSampleLevel(
  tex: texture_cube_array<f32>,
  smp: sampler,
  dir: vec3,
  layer: number,
  level: number,
): vec4
${renderJSDoc(FUNCTION_DOCS.textureSampleBias)}
declare function textureSampleBias(tex: texture_2d<f32>, smp: sampler, uv: vec2, bias: number): vec4
${renderJSDoc(FUNCTION_DOCS.textureSampleBias)}
declare function textureSampleBias(
  tex: texture_2d_array<f32>,
  smp: sampler,
  uv: vec2,
  layer: number,
  bias: number,
): vec4
${renderJSDoc(FUNCTION_DOCS.textureSampleBias)}
declare function textureSampleBias(
  tex: texture_cube<f32>,
  smp: sampler,
  dir: vec3,
  bias: number,
): vec4
${renderJSDoc(FUNCTION_DOCS.textureSampleBias)}
declare function textureSampleBias(
  tex: texture_3d<f32>,
  smp: sampler,
  coord: vec3,
  bias: number,
): vec4
${renderJSDoc(FUNCTION_DOCS.textureSampleBias)}
declare function textureSampleBias(
  tex: texture_cube_array<f32>,
  smp: sampler,
  dir: vec3,
  layer: number,
  bias: number,
): vec4
${renderJSDoc(FUNCTION_DOCS.textureSampleGrad)}
declare function textureSampleGrad(
  tex: texture_2d<f32>,
  smp: sampler,
  uv: vec2,
  ddx: vec2,
  ddy: vec2,
): vec4
${renderJSDoc(FUNCTION_DOCS.textureSampleGrad)}
declare function textureSampleGrad(
  tex: texture_2d_array<f32>,
  smp: sampler,
  uv: vec2,
  layer: number,
  ddx: vec2,
  ddy: vec2,
): vec4
${renderJSDoc(FUNCTION_DOCS.textureSampleGrad)}
declare function textureSampleGrad(
  tex: texture_cube<f32>,
  smp: sampler,
  dir: vec3,
  ddx: vec3,
  ddy: vec3,
): vec4
${renderJSDoc(FUNCTION_DOCS.textureSampleGrad)}
declare function textureSampleGrad(
  tex: texture_3d<f32>,
  smp: sampler,
  coord: vec3,
  ddx: vec3,
  ddy: vec3,
): vec4
${renderJSDoc(FUNCTION_DOCS.textureSampleGrad)}
declare function textureSampleGrad(
  tex: texture_cube_array<f32>,
  smp: sampler,
  dir: vec3,
  layer: number,
  ddx: vec3,
  ddy: vec3,
): vec4
${renderJSDoc(FUNCTION_DOCS.textureLoad)}
declare function textureLoad<E extends TextureElem = f32>(
  tex: texture_2d<E>,
  coord: TexelCoord2,
  level: number,
): Vec4OfElem<E>
${renderJSDoc(FUNCTION_DOCS.textureLoad)}
declare function textureLoad<E extends TextureElem = f32>(
  tex: texture_2d_array<E>,
  coord: TexelCoord2,
  layer: number,
  level: number,
): Vec4OfElem<E>
${renderJSDoc(FUNCTION_DOCS.textureLoad)}
declare function textureLoad<E extends TextureElem = f32>(
  tex: texture_3d<E>,
  coord: TexelCoord3,
  level: number,
): Vec4OfElem<E>
${renderJSDoc(FUNCTION_DOCS.textureLoad)}
declare function textureLoad<E extends TextureElem = f32>(
  tex: texture_1d<E>,
  coord: number,
  level: number,
): Vec4OfElem<E>
${renderJSDoc(FUNCTION_DOCS.textureLoad)}
declare function textureLoad<E extends TextureElem = f32>(
  tex: texture_multisampled_2d<E>,
  coord: TexelCoord2,
  sampleIndex: number,
): Vec4OfElem<E>
${renderJSDoc(FUNCTION_DOCS.textureLoad)}
declare function textureLoad(tex: texture_depth_multisampled_2d, coord: TexelCoord2, sampleIndex: number): f32
${renderJSDoc(FUNCTION_DOCS.textureLoad)}
declare function textureLoad<F extends StorageFormat, A extends 'read' | 'read_write'>(
  tex: texture_storage_2d<F, A>,
  coord: TexelCoord2,
): StorageTexel<F>
${renderJSDoc(FUNCTION_DOCS.textureLoad)}
declare function textureLoad<F extends StorageFormat, A extends 'read' | 'read_write'>(
  tex: texture_storage_2d_array<F, A>,
  coord: TexelCoord2,
  layer: number,
): StorageTexel<F>
${renderJSDoc(FUNCTION_DOCS.textureStore)}
declare function textureStore<F extends StorageFormat, A extends 'write' | 'read_write'>(
  tex: texture_storage_2d<F, A>,
  coord: TexelCoord2,
  value: StorageTexel<F>,
): void
${renderJSDoc(FUNCTION_DOCS.textureStore)}
declare function textureStore<F extends StorageFormat, A extends 'write' | 'read_write'>(
  tex: texture_storage_2d_array<F, A>,
  coord: TexelCoord2,
  layer: number,
  value: StorageTexel<F>,
): void
${renderJSDoc(FUNCTION_DOCS.textureDimensions)}
declare function textureDimensions<E extends TextureElem = f32>(
  tex: texture_2d<E> | texture_2d_array<E>,
  level?: number,
): vec2u
${renderJSDoc(FUNCTION_DOCS.textureDimensions)}
declare function textureDimensions<E extends TextureElem = f32>(
  tex: texture_cube<E> | texture_cube_array<E>,
  level?: number,
): vec2u
${renderJSDoc(FUNCTION_DOCS.textureDimensions)}
declare function textureDimensions<E extends TextureElem = f32>(
  tex: texture_3d<E>,
  level?: number,
): vec3u
${renderJSDoc(FUNCTION_DOCS.textureDimensions)}
declare function textureDimensions<E extends TextureElem = f32>(tex: texture_1d<E>, level?: number): u32
${renderJSDoc(FUNCTION_DOCS.textureDimensions)}
declare function textureDimensions<E extends TextureElem = f32>(tex: texture_multisampled_2d<E>): vec2u
${renderJSDoc(FUNCTION_DOCS.textureNumSamples)}
declare function textureNumSamples<E extends TextureElem = f32>(
  tex: texture_multisampled_2d<E> | texture_depth_multisampled_2d,
): u32
${renderJSDoc(FUNCTION_DOCS.textureDimensions)}
declare function textureDimensions(
  tex:
    | texture_depth_2d
    | texture_depth_2d_array
    | texture_depth_cube
    | texture_depth_cube_array
    | texture_depth_multisampled_2d,
  level?: number,
): vec2u
${renderJSDoc(FUNCTION_DOCS.textureNumLayers)}
declare function textureNumLayers<E extends TextureElem = f32>(tex: texture_cube_array<E>): u32
${renderJSDoc(FUNCTION_DOCS.textureNumLayers)}
declare function textureNumLayers(tex: texture_depth_cube_array): u32
${renderJSDoc(FUNCTION_DOCS.textureNumLayers)}
declare function textureNumLayers(tex: texture_depth_2d_array): u32
${renderJSDoc(FUNCTION_DOCS.textureDimensions)}
declare function textureDimensions<F extends StorageFormat, A extends StorageAccess>(
  tex: texture_storage_2d<F, A> | texture_storage_2d_array<F, A>,
): vec2u
${renderJSDoc(FUNCTION_DOCS.textureNumLayers)}
declare function textureNumLayers<E extends TextureElem = f32>(tex: texture_2d_array<E>): u32
${renderJSDoc(FUNCTION_DOCS.textureNumLayers)}
declare function textureNumLayers<F extends StorageFormat, A extends StorageAccess>(
  tex: texture_storage_2d_array<F, A>,
): u32
${renderJSDoc(FUNCTION_DOCS.arrayLength)}
declare function arrayLength<T>(xs: array<T>): u32
${renderJSDoc(FUNCTION_DOCS.quantizeToF16)}
declare function quantizeToF16(e: f32): f32
${renderJSDoc(FUNCTION_DOCS.quantizeToF16)}
declare function quantizeToF16<T extends vec2 | vec3 | vec4>(e: T): T
${renderJSDoc(FUNCTION_DOCS.pack4x8unorm)}
declare function pack4x8unorm(e: vec4): u32
${renderJSDoc(FUNCTION_DOCS.pack4x8snorm)}
declare function pack4x8snorm(e: vec4): u32
${renderJSDoc(FUNCTION_DOCS.unpack4x8unorm)}
declare function unpack4x8unorm(e: u32): vec4
${renderJSDoc(FUNCTION_DOCS.unpack4x8snorm)}
declare function unpack4x8snorm(e: u32): vec4
${renderJSDoc(FUNCTION_DOCS.pack2x16float)}
declare function pack2x16float(e: vec2): u32
${renderJSDoc(FUNCTION_DOCS.pack2x16unorm)}
declare function pack2x16unorm(e: vec2): u32
${renderJSDoc(FUNCTION_DOCS.pack2x16snorm)}
declare function pack2x16snorm(e: vec2): u32
${renderJSDoc(FUNCTION_DOCS.unpack2x16float)}
declare function unpack2x16float(e: u32): vec2
${renderJSDoc(FUNCTION_DOCS.unpack2x16unorm)}
declare function unpack2x16unorm(e: u32): vec2
${renderJSDoc(FUNCTION_DOCS.unpack2x16snorm)}
declare function unpack2x16snorm(e: u32): vec2
${renderJSDoc(FUNCTION_DOCS.atomicCompareExchangeWeak)}
declare function atomicCompareExchangeWeak<T extends u32 | i32>(
  location: atomic<T>,
  compare: T,
  value: T,
): { old_value: T; exchanged: bool }
${renderJSDoc(FUNCTION_DOCS.textureBarrier)}
declare function textureBarrier(): void
${renderJSDoc(FUNCTION_DOCS.workgroupUniformLoad)}
declare function workgroupUniformLoad<T>(w: T): T
${renderJSDoc(FUNCTION_DOCS.dot4U8Packed)}
declare function dot4U8Packed(a: u32, b: u32): u32
${renderJSDoc(FUNCTION_DOCS.dot4I8Packed)}
declare function dot4I8Packed(a: u32, b: u32): i32
${renderJSDoc(FUNCTION_DOCS.pack4xU8)}
declare function pack4xU8(e: vec4u): u32
${renderJSDoc(FUNCTION_DOCS.pack4xU8Clamp)}
declare function pack4xU8Clamp(e: vec4u): u32
${renderJSDoc(FUNCTION_DOCS.pack4xI8)}
declare function pack4xI8(e: vec4i): u32
${renderJSDoc(FUNCTION_DOCS.pack4xI8Clamp)}
declare function pack4xI8Clamp(e: vec4i): u32
${renderJSDoc(FUNCTION_DOCS.unpack4xU8)}
declare function unpack4xU8(e: u32): vec4u
${renderJSDoc(FUNCTION_DOCS.unpack4xI8)}
declare function unpack4xI8(e: u32): vec4i
${renderJSDoc(FUNCTION_DOCS.bitcast)}
declare function bitcast<T extends u32 | f32>(e: BitcastArg<T>): T
${renderJSDoc(FUNCTION_DOCS.atomicLoad)}
declare function atomicLoad<T extends u32 | i32>(location: atomic<T>): T
${renderJSDoc(FUNCTION_DOCS.atomicStore)}
declare function atomicStore<T extends u32 | i32>(location: atomic<T>, value: T): void
${renderJSDoc(FUNCTION_DOCS.atomicAdd)}
declare function atomicAdd<T extends u32 | i32>(location: atomic<T>, value: T): T
${renderJSDoc(FUNCTION_DOCS.atomicSub)}
declare function atomicSub<T extends u32 | i32>(location: atomic<T>, value: T): T
${renderJSDoc(FUNCTION_DOCS.atomicMin)}
declare function atomicMin<T extends u32 | i32>(location: atomic<T>, value: T): T
${renderJSDoc(FUNCTION_DOCS.atomicMax)}
declare function atomicMax<T extends u32 | i32>(location: atomic<T>, value: T): T
${renderJSDoc(FUNCTION_DOCS.atomicAnd)}
declare function atomicAnd<T extends u32 | i32>(location: atomic<T>, value: T): T
${renderJSDoc(FUNCTION_DOCS.atomicOr)}
declare function atomicOr<T extends u32 | i32>(location: atomic<T>, value: T): T
${renderJSDoc(FUNCTION_DOCS.atomicXor)}
declare function atomicXor<T extends u32 | i32>(location: atomic<T>, value: T): T
${renderJSDoc(FUNCTION_DOCS.atomicExchange)}
declare function atomicExchange<T extends u32 | i32>(location: atomic<T>, value: T): T
${renderJSDoc(FUNCTION_DOCS.workgroupBarrier)}
declare function workgroupBarrier(): void
${renderJSDoc(FUNCTION_DOCS.storageBarrier)}
declare function storageBarrier(): void

${vecCtors}
${matCtorOverloads}

${scalarCasts}

${freeMath}

${expandFns}

${randomDeclaration}

${langConsts}

// ── Spellings whose shape the generated tables above cannot express (#8 A6) ──
// Each of these IS accepted by the compiler and documented in §10 of the surface document;
// without a declaration here the editor red-squiggles valid source, which is the false
// POSITIVE §6 forbids. They are written by hand because the generators derive a signature
// from an arity alone: \`select\`'s third argument is a bool, \`atan\` has two arities, \`bool\`
// takes a bool as well as a number, and \`discard\` is a statement, not a call.
${renderJSDoc(FUNCTION_DOCS.select)}
declare function select<T extends Numeric | bool | BoolVec | Vec64Any | f64>(
  falseValue: T,
  trueValue: T,
  cond: bool | BoolVec,
): T
${renderJSDoc(FUNCTION_DOCS.any)}
declare function any(v: bool | BoolVec): bool
${renderJSDoc(FUNCTION_DOCS.all)}
declare function all(v: bool | BoolVec): bool
${renderJSDoc(FUNCTION_DOCS.atan2)}
declare function atan<T extends Numeric>(y: T, x: T): T
${renderJSDoc(FUNCTION_DOCS.bool)}
declare function bool(x: number | bool): bool
${renderJSDoc(CONSTANT_DOCS.discard)}
declare const discard: void

interface MathObject {
${mathMethods}
${mathSpecialMethods}
${mathConstants}
}
declare const Math: MathObject

${renderJSDoc(ATTRIBUTE_DOCS.builtin)}
declare function builtin(name: string): (target: unknown, context?: unknown) => void
${renderJSDoc(ATTRIBUTE_DOCS.location)}
declare function location(n: number): (target: unknown, context?: unknown) => void
${renderJSDoc(ATTRIBUTE_DOCS.interpolate)}
declare function interpolate(type: string, sampling?: string): (target: unknown, context?: unknown) => void
${renderJSDoc(ATTRIBUTE_DOCS.invariant)}
declare function invariant(target: unknown, context?: unknown): void
${renderJSDoc(ATTRIBUTE_DOCS.blend_src)}
declare function blend_src(n: number): (target: unknown, context?: unknown) => void
${renderJSDoc(ATTRIBUTE_DOCS.diagnostic)}
declare function diagnostic(severity: string, rule: string): (target: Function, context?: unknown) => void
${renderJSDoc(ATTRIBUTE_DOCS.vertex)}
declare function vertex(target: Function, context?: unknown): void
${renderJSDoc(ATTRIBUTE_DOCS.fragment)}
declare function fragment(target: Function, context?: unknown): void
${renderJSDoc(ATTRIBUTE_DOCS.compute)}
declare function compute(workgroupSize: readonly number[]): (target: Function, context?: unknown) => void
${renderJSDoc(ATTRIBUTE_DOCS.compute)}
declare function compute(target: Function, context?: unknown): void

interface Array<T> {
  readonly length: number
  [n: number]: T
  // A list literal is an \`Array\` here, and it has to stay assignable to an iterable \`array<T, N>\`.
  [Symbol.iterator](): { next(): { done: false; value: T } | { done: true; value: undefined } }
}
// What \`[Symbol.iterator]\` above resolves through. \`Symbol\` itself stays a host API: the
// compiler refuses it as a value (TS8012), so declaring it here gives an author nothing to write.
interface SymbolConstructor {
  readonly iterator: unique symbol
}
declare var Symbol: SymbolConstructor
interface Boolean {}
interface Function {}
interface CallableFunction extends Function {}
interface NewableFunction extends Function {}
interface IArguments {}
interface Number {}
interface Object {}
interface RegExp {}
interface String {}
`;
