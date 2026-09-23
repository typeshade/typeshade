// === Argument checks for the free math builtins (roadmap 0.2 item 9, #57, §10) ===
//
// The math builtins were lowered by arity alone: `dot(a, b)` with a `vec3` and a `vec2`, or
// `clamp(v, 0., 1.)` with a vector `v`, drew no diagnostic and emitted a call Tint refuses with
// "no matching call to 'dot(vec3<f32>, vec2<f32>)'". The editor's ambient signatures caught
// the first shape but not one whose arguments TypeScript had already typed `number`
// (`dot(a * s, b * s)`), and `compile()` caught neither. This file is the check WGSL applies,
// written once per signature shape: the componentwise builtins take arguments of one type,
// `mix` alone blends by a scalar of the vectors' element kind, `refract` takes a scalar eta,
// `ldexp` an integer exponent of its `x`'s shape, `extractBits` and `insertBits` a `u32` offset
// and count, `cross` two `vec3<f32>`, `transpose` and `determinant` a matrix, and `mod` a
// vector against a scalar of its kind as its floor-mod spelling does. Each rule names the
// offending argument and, where one exists, the fix: splat the scalar, cast one side, or give
// the vectors one size. An emulated double (`f64`, a `vec64`) is left to the fp64 pass, which
// has its own lifting rules.
//
// Implements: Rule 9.2 (docs/language-design.md; traced in reqs/).

import ts from 'typescript';
import type { Expr } from '../../../core/ir/nodes.js';
import type { ShaderType } from '../../../core/ir/types.js';
import { typeKey } from '../../../core/ir/types.js';
import type { TsCompilerDiagnostic } from '../source-file.js';
import { makeDiagnostic } from '../diagnostic.js';
import { TS_CODES } from '../codes.js';
import { F64_SCALAR_TWINS, F64_VEC_REDUCTIONS, F64_VEC_TWINS } from '../../../core/fp64/twins.js';

type Elem = 'f32' | 'i32' | 'u32' | 'bool' | 'f64';

/** A scalar (`n` 1) or vector of a numeric or bool element kind; a matrix, struct, array,
 *  texture or sampler has no shape here. */
interface Shape {
  readonly elem: Elem;
  readonly n: 1 | 2 | 3 | 4;
}

function shapeOf(t: ShaderType): Shape | undefined {
  switch (t.kind) {
    case 'scalar':
      return { elem: t.scalar, n: 1 };
    case 'f64':
      return { elem: 'f64', n: 1 };
    case 'vec':
      return { elem: t.elem, n: t.n };
    case 'vec64':
      return { elem: 'f64', n: t.n };
    default:
      return undefined;
  }
}

const FLOAT: readonly Elem[] = ['f32', 'f64'];
const INT: readonly Elem[] = ['i32', 'u32'];
const NUMERIC: readonly Elem[] = ['f32', 'f64', 'i32', 'u32'];
/** `sign` is defined for floats and signed integers; a `u32` has no sign to take. */
const SIGNED: readonly Elem[] = ['f32', 'f64', 'i32'];

/** What an argument after the first must be, measured against the first. */
type Role =
  /** The first argument's type exactly (`min(a, b)`, `clamp(x, lo, hi)`). */
  | 'same'
  /** The first argument's type, or a scalar of its element kind (`mix`'s factor, `mod`'s divisor). */
  | 'sameOrScalar'
  /** A scalar of the first argument's element kind (`refract`'s eta). */
  | 'scalar'
  /** An `i32`, or a vector of them of the first argument's size (`ldexp`'s exponent). */
  | 'i32Of'
  /** A `u32` scalar (`extractBits`' and `insertBits`' offset and count). */
  | 'u32';

interface Spec {
  /** The element kinds the first argument may have. */
  readonly elems: readonly Elem[];
  /** The first argument must be a vector. */
  readonly vector?: true;
  /** The first argument must be a `vec3` (`cross`). */
  readonly vec3?: true;
  /** The role of each later argument; `same` when not listed. */
  readonly roles?: Readonly<Record<number, Role>>;
}

const same = (elems: readonly Elem[]): Spec => ({ elems });
const FLOAT_SAME = same(FLOAT);

/** One entry per free math builtin the surface lowers as a `call`; `f32` (a cast), `select`,
 *  `any` and `all` are lowered elsewhere and are not here. A name without an entry is checked
 *  by arity alone, as before.
 *
 *  Exported for `math-args.test.ts`, which iterates it: the table is the contract, so the suite
 *  that pins the contract must be driven BY the table rather than by a second hand list beside
 *  it. Not on the public barrel. */
export const MATH_ARG_SPECS: Readonly<Record<string, Spec>> = {
  // Componentwise on floats.
  acos: FLOAT_SAME,
  acosh: FLOAT_SAME,
  asin: FLOAT_SAME,
  asinh: FLOAT_SAME,
  atan: FLOAT_SAME,
  atanh: FLOAT_SAME,
  atan2: FLOAT_SAME,
  ceil: FLOAT_SAME,
  cos: FLOAT_SAME,
  cosh: FLOAT_SAME,
  degrees: FLOAT_SAME,
  exp: FLOAT_SAME,
  exp2: FLOAT_SAME,
  floor: FLOAT_SAME,
  fma: FLOAT_SAME,
  fract: FLOAT_SAME,
  inverseSqrt: FLOAT_SAME,
  log: FLOAT_SAME,
  log2: FLOAT_SAME,
  pow: FLOAT_SAME,
  radians: FLOAT_SAME,
  round: FLOAT_SAME,
  saturate: FLOAT_SAME,
  sin: FLOAT_SAME,
  sinh: FLOAT_SAME,
  smoothstep: FLOAT_SAME,
  sqrt: FLOAT_SAME,
  step: FLOAT_SAME,
  tan: FLOAT_SAME,
  tanh: FLOAT_SAME,
  trunc: FLOAT_SAME,
  // The derivatives, on floats.
  dpdx: FLOAT_SAME,
  dpdy: FLOAT_SAME,
  fwidth: FLOAT_SAME,
  dpdxCoarse: FLOAT_SAME,
  dpdxFine: FLOAT_SAME,
  dpdyCoarse: FLOAT_SAME,
  dpdyFine: FLOAT_SAME,
  fwidthCoarse: FLOAT_SAME,
  fwidthFine: FLOAT_SAME,
  // Componentwise on any number.
  abs: same(NUMERIC),
  sign: same(SIGNED),
  min: same(NUMERIC),
  max: same(NUMERIC),
  clamp: same(NUMERIC),
  // The blends: `mix(a, b, t)` takes `t` as the vectors' type or a scalar of their kind, which
  // WGSL and GLSL both spell; `mod(x, y)` takes a scalar `y` against a vector `x`, which its
  // floor-mod spelling on WGSL and GLSL's `mod(vec, float)` both accept.
  mix: { elems: FLOAT, roles: { 2: 'sameOrScalar' } },
  mod: { elems: FLOAT, roles: { 1: 'sameOrScalar' } },
  // Lengths and products: `length` and `distance` take a scalar or a vector, `dot` vectors of
  // any numeric kind, the geometry four float vectors.
  length: FLOAT_SAME,
  distance: FLOAT_SAME,
  dot: { elems: NUMERIC, vector: true },
  normalize: { elems: FLOAT, vector: true },
  cross: { elems: FLOAT, vector: true, vec3: true },
  reflect: { elems: FLOAT, vector: true },
  refract: { elems: FLOAT, vector: true, roles: { 2: 'scalar' } },
  faceForward: { elems: FLOAT, vector: true },
  ldexp: { elems: FLOAT, roles: { 1: 'i32Of' } },
  // The bit builtins, on integers.
  countOneBits: same(INT),
  reverseBits: same(INT),
  countLeadingZeros: same(INT),
  countTrailingZeros: same(INT),
  firstLeadingBit: same(INT),
  firstTrailingBit: same(INT),
  extractBits: { elems: INT, roles: { 1: 'u32', 2: 'u32' } },
  insertBits: { elems: INT, roles: { 2: 'u32', 3: 'u32' } },
};

/** Whether the builtin `fn` has a form on the element kind `elem`: `min` on an i32, yes; `pow`,
 *  no. A name without a spec is taken to have one, as before the check existed. */
export function mathTakesElem(fn: string, elem: string): boolean {
  const spec = MATH_ARG_SPECS[fn];
  return spec === undefined || (spec.elems as readonly string[]).includes(elem);
}

/** The builtins that take a matrix, checked apart from the shapes above. */
const MATRIX_FNS: ReadonlySet<string> = new Set(['transpose', 'determinant']);

const VEC_SUFFIX: Readonly<Record<string, string>> = {
  f32: '',
  i32: 'i',
  u32: 'u',
  bool: 'b',
  // Without this an emulated-double vector printed as `vecN`, so the "cast one side" fix
  // offered the same spelling twice ("Cast one side: vec3(x) or vec3(x)").
  f64: 'f64',
};

/** How the surface writes `t`'s vector of `n` (`vec3`, `vec2i`, `vec4u`), for a fix. */
function vectorSpelling(elem: Elem, n: number): string {
  return `vec${n}${VEC_SUFFIX[elem] ?? ''}`;
}

function classWord(elems: readonly Elem[]): string {
  if (elems === FLOAT) return 'an f32, or a vector of them';
  if (elems === INT) return 'an i32 or u32, or a vector of them';
  if (elems === SIGNED) return 'an f32 or i32, or a vector of them';
  return 'a number, or a vector of them';
}

/** The fix for two shapes that had to agree, or an empty string where none is short enough
 *  to say: a scalar beside a vector of its kind is splatted, two kinds of one shape are cast,
 *  two vector sizes are a rewrite. */
function sameFix(first: Shape, other: Shape): string {
  if (first.elem === other.elem) {
    if (first.n !== 1 && other.n === 1) {
      return ` Splat the scalar to the vector's size: ${vectorSpelling(first.elem, first.n)}(x).`;
    }
    if (first.n === 1 && other.n !== 1) {
      return ` Splat the scalar to the vector's size: ${vectorSpelling(other.elem, other.n)}(x).`;
    }
    return ' Give the vectors one size.';
  }
  if (first.n === other.n && first.elem !== 'bool' && other.elem !== 'bool') {
    const cast = (s: Shape): string =>
      s.n === 1 ? `${s.elem}(x)` : `${vectorSpelling(s.elem, s.n)}(x)`;
    return ` Cast one side: ${cast(first)} or ${cast(other)}.`;
  }
  return '';
}

/** The emulated-double arm of {@link checkMathArgs}.
 *
 *  An `f64` is not a native scalar: the fp64 lowering pass rewrites it into a pair of `f32`
 *  words and a `df64_*` call, and it has a body for the ten builtins in
 *  {@link F64_SCALAR_TWINS} and no others. Everything else used to be accepted here and
 *  refused by the backend as SD0041 — a diagnostic with no source span on a call the author
 *  had already written and forgotten. This says it at the call, with the list, and names the
 *  narrow that makes the program legal (#151 F64-08).
 *
 *  What the pass DOES accept is admitted as it is: an `f32` beside a scalar `f64` (the pass
 *  widens it exactly as `vec2<f32>(x, 0.0)`, the rule `binResultType` already applies in the
 *  fn() EDSL), a SCALAR operand broadcast across a `vec64` by a componentwise twin, and
 *  `mix`'s interpolant, which stays an `f32` on both shapes because the df64 body blends by a
 *  plain float. A wider f32 operand is NOT that broadcast and is refused — see the loop. */
function checkF64Args(
  fn: string,
  display: string,
  args: readonly Expr[],
  shapes: readonly (Shape | undefined)[],
  refuse: (index: number, message: string) => false,
): boolean {
  const head = shapes[0];
  if (head === undefined) return true;
  const vec = head.n > 1;
  const twins = vec ? F64_VEC_TWINS : F64_SCALAR_TWINS;
  if (!twins.includes(fn)) {
    // The narrow NAMED here has to be one that lowers. `f32(v)` on a vec64 does not: the pass
    // raises SD0041 for it, which is the spanless failure this refusal exists to replace. The
    // vector narrow is `vecN(v)`, per lane (§39).
    const narrow = vec ? `vec${head.n}(v)` : 'f32(x)';
    return refuse(
      0,
      `${display} has no emulated-double form; got ${typeKey(args[0]!.type)}. ` +
        `On ${vec ? 'a vector of doubles' : 'an f64'} the pass lowers ${listOf(twins)} — ` +
        `narrow first, e.g. ${display}(${narrow}).`,
    );
  }
  // A reduction (dot, length, distance) takes vectors; a componentwise twin takes the head's
  // own shape. Either way an f32 operand beside the f64 one is the pass's exact widen.
  for (let i = 1; i < args.length; i++) {
    const shape = shapes[i];
    const got = typeKey(args[i]!.type);
    // mix(a, b, t): the interpolant is a plain f32 on both the scalar and the vector body
    // (fp64-lower.ts raises SD0041 for an f64 t), so it is checked here and not as an operand.
    if (fn === 'mix' && i === 2) {
      if (shape !== undefined && shape.elem === 'f32' && shape.n === 1) continue;
      return refuse(
        i,
        `${display} blends emulated doubles by a plain f32 interpolant; got ${got}. ` +
          `Write f32(t).`,
      );
    }
    // A CROSS-LANE reduction (dot, distance) needs two vectors of one width: the pass slices
    // lane i out of each operand, and a scalar pair or an f32 vector sliced that way reads
    // `.hi` off something that has no such field. `dot(v64, vec3)` compiled clean and emitted
    // `w.hi` on a `vec3<f32>` — Tint refuses it and the lowered oracle answers NaN where the
    // double oracle answers a number.
    if (F64_VEC_REDUCTIONS.includes(fn)) {
      if (shape !== undefined && shape.elem === 'f64' && shape.n === head.n) continue;
      return refuse(
        i,
        `${display} reduces two vectors of emulated doubles of one width; the first is ` +
          `${typeKey(args[0]!.type)}, this one ${got}.`,
      );
    }
    // A componentwise twin takes the head's own shape, or a SCALAR the pass broadcasts across
    // the lanes (`vecOperand`) and widens exactly if it is an f32. A WIDER f32 operand is not
    // that broadcast and is refused: the pass would walk it as if it were a DF64VecN.
    if (shape !== undefined && shape.elem === 'f64' && shape.n === head.n) continue;
    if (shape !== undefined && shape.n === 1 && (shape.elem === 'f64' || shape.elem === 'f32'))
      continue;
    return refuse(
      i,
      `${display} takes arguments of one type; the first is ${typeKey(args[0]!.type)}, ` +
        `this one ${got}.` +
        (shape !== undefined && shape.elem === 'f32' && shape.n > 1
          ? ` A vector of f32 is not widened to a vector of doubles — build it with ` +
            `vec${head.n}f64(...), or narrow the first argument with vec${head.n}(v).`
          : ''),
    );
  }
  return true;
}

/** "abs, cos, floor and sin" — the twin list of a refusal, in the house's prose form. */
function listOf(names: readonly string[]): string {
  return names.length < 2
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]!}`;
}

/** Checks the arguments of the math builtin `fn` (already at its arity) against its
 *  signature, pushing one diagnostic on the first argument that does not fit.
 *
 *  @param fn The canonical builtin id (`atan2`, not the `atan` it was written as).
 *  @param display The name as written, for the message (`Math.min`, `atan`).
 *  @returns `true` when the call is well formed. */
export function checkMathArgs(
  fn: string,
  display: string,
  args: readonly Expr[],
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): boolean {
  const refuse = (index: number, message: string): false => {
    diagnostics.push(
      makeDiagnostic(sourceFile, node.arguments[index] ?? node, message, TS_CODES.MATH_ARGUMENT),
    );
    return false;
  };
  const first = args[0];
  if (first === undefined) return true;
  if (MATRIX_FNS.has(fn)) {
    if (first.type.kind !== 'mat') {
      return refuse(0, `${display} takes a matrix; got ${typeKey(first.type)}.`);
    }
    // `transpose` on an emulated-double matrix is a reshuffle of the lanes the fp64 pass
    // lowers (df64_mN_transpose); a DETERMINANT has no df64 body at all, so it would compile
    // here and raise SD0041 from the backend after the call span is gone (#151).
    // `determinant` is defined for a SQUARE matrix only (wgsl.txt:21842, `mat<N, N, T>`), and
    // GLSL ES 3.00 likewise; a non-square one has no determinant to take.
    if (fn === 'determinant' && first.type.cols !== first.type.rows) {
      return refuse(
        0,
        `${display} takes a square matrix; got ${typeKey(first.type)}. Only matN has a ` +
          `determinant — on a non-square matrix there is none to take.`,
      );
    }
    if (first.type.elem === 'f64' && fn === 'determinant') {
      return refuse(
        0,
        `${display} has no emulated-double form; got ${typeKey(first.type)}: the fp64 pass ` +
          `lowers only * and transpose on a matrix of doubles, so declare the matrix ` +
          `mat${first.type.cols} where you need its determinant.`,
      );
    }
    return true;
  }
  const spec = MATH_ARG_SPECS[fn];
  if (spec === undefined) return true;
  const shapes = args.map((a) => shapeOf(a.type));
  // An emulated double as the FIRST argument decides the call: the fp64 pass, not the WGSL
  // signature table, says what it can be. An f64 anywhere else — `mix(vec3, vec3, t64)` — is
  // an ordinary operand mismatch against a native first argument and keeps the message the
  // integer and wrong-width factors get, since the fix is the same one (#151 F64-08).
  if (shapes[0]?.elem === 'f64') {
    return checkF64Args(fn, display, args, shapes, refuse);
  }
  const head = shapes[0];
  if (head === undefined || !spec.elems.includes(head.elem)) {
    return refuse(0, `${display} takes ${classWord(spec.elems)}; got ${typeKey(first.type)}.`);
  }
  if (spec.vec3 && head.n !== 3) {
    return refuse(
      0,
      `${display} takes two ${vectorSpelling(head.elem, 3)}; got ${typeKey(first.type)}.`,
    );
  }
  if (spec.vector && head.n === 1) {
    return refuse(0, `${display} takes vectors; got ${typeKey(first.type)}.`);
  }
  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!;
    const shape = shapes[i];
    const role: Role = spec.roles?.[i] ?? 'same';
    const got = typeKey(arg.type);
    switch (role) {
      case 'same':
        if (shape !== undefined && shape.elem === head.elem && shape.n === head.n) break;
        return refuse(
          i,
          `${display} takes arguments of one type; the first is ${typeKey(first.type)}, this one ${got}.` +
            (shape === undefined ? '' : sameFix(head, shape)),
        );
      case 'sameOrScalar':
        if (
          shape !== undefined &&
          shape.elem === head.elem &&
          (shape.n === head.n || shape.n === 1)
        ) {
          break;
        }
        return refuse(
          i,
          `${display} takes this argument as ${typeKey(first.type)}, the first argument's type, or as ` +
            `a scalar ${head.elem}; got ${got}.`,
        );
      case 'scalar':
        if (shape !== undefined && shape.elem === head.elem && shape.n === 1) break;
        return refuse(i, `${display} takes a scalar ${head.elem} here; got ${got}.`);
      case 'i32Of':
        if (shape !== undefined && shape.elem === 'i32' && shape.n === head.n) break;
        return refuse(
          i,
          head.n === 1
            ? `${display} takes an i32 exponent; got ${got}.`
            : `${display} takes a ${vectorSpelling('i32', head.n)} exponent for a ` +
                `${typeKey(first.type)} x, one component each; got ${got}.`,
        );
      case 'u32':
        if (shape !== undefined && shape.elem === 'u32' && shape.n === 1) break;
        return refuse(i, `${display} takes a u32 offset and count; got ${got}.`);
    }
  }
  return true;
}
