// Implements: Rule 7.1 (docs/language-design.md; traced in reqs/).
// === The kinds of operand an operator takes ===
//
// The lowering checks that the two operands of a binary operator have ONE type, and for a long
// time that check was the whole of it: two structs, two arrays, two bools under `<`, two floats
// under `&` or two matrices under `===` each have one type, so they passed, and the module
// reached Tint as `no matching overload for 'operator + (A, A)'` with no diagnostic on the line
// (Rule 12.6). WGSL's operator table is by KIND as well, and this file is that table for a pair
// of one type and for unary `-` and `+`, measured against Tint:
//
//   `+ - * / %`       a numeric scalar, vector or matrix (a matrix has no `/` or `%`)
//   `< <= > >=`       a numeric scalar or vector
//   `=== !==`         a scalar or a vector, a bool included
//   `& |`             an integer or a bool, scalar or vector
//   `^`               an integer, scalar or vector
//   unary `-`         a signed integer or a float, scalar or vector
//   unary `+`         a numeric scalar, vector or matrix, which it lowers to (WGSL has no `+x`)
//
// An emulated double follows the fp64 pass (surface §39): `f64` and `vecN<f64>` are numbers
// here, and a matrix of doubles takes `*` alone, whose compound form the pass does not lower
// either. What a caller already refuses with a sentence of its own is left to it: `/` and `%`
// on any matrix, `%` on a double, an ordering on a vector of bools, `-` on a `u32`, a float
// under `& | ^` (which `lowerBinary` keeps for two whole numbers the front end folds, `1 | 2`),
// and a shift, whose operands `lowerBinary` reads by element.

import type ts from 'typescript';
import type { ShaderType } from '../../../core/ir/types.js';
import type { TsCompilerDiagnostic } from '../source-file.js';
import { authorTypeText } from '../context.js';
import { makeDiagnostic } from '../diagnostic.js';
import { TS_CODES } from '../codes.js';

/** The binary operators this file answers for, by the row of WGSL's table they sit in. */
const FAMILY: Readonly<Record<string, 'arithmetic' | 'ordering' | 'equality' | 'bitwise'>> = {
  '+': 'arithmetic',
  '-': 'arithmetic',
  '*': 'arithmetic',
  '/': 'arithmetic',
  '%': 'arithmetic',
  '<': 'ordering',
  '<=': 'ordering',
  '>': 'ordering',
  '>=': 'ordering',
  '===': 'equality',
  '!==': 'equality',
  '&': 'bitwise',
  '|': 'bitwise',
  '^': 'bitwise',
};

/** What a value of `t` is, as a refusal names it, or `undefined` for a number: a native or an
 *  emulated numeric scalar or vector. A `void` is `undefined` too, since a call that returns
 *  nothing is refused as a value where it is lowered, not here. */
function kindOf(t: ShaderType): string | undefined {
  switch (t.kind) {
    case 'scalar':
      return t.scalar === 'bool' ? 'a bool' : undefined;
    case 'vec':
      return t.elem === 'bool' ? 'a vector of bools' : undefined;
    case 'f64':
    case 'vec64':
    case 'void':
      return undefined;
    case 'mat':
      return 'a matrix';
    case 'struct':
      return 'a struct';
    case 'array':
      return 'an array';
    default:
      return 'a texture or a sampler';
  }
}

/** The f32 matrix of `t`'s shape, as an author writes it. */
function f32Matrix(t: Extract<ShaderType, { kind: 'mat' }>): string {
  return authorTypeText({ kind: 'mat', cols: t.cols, rows: t.rows, elem: 'f32' });
}

/**
 * The refusal for `a op b` with both operands of type `t` (or a vector and the scalar it
 * broadcasts, `t` being the vector) when WGSL, or the fp64 pass for a double, has no such
 * operator, or `undefined` when it has. `op` is the operator as TypeScript spells it (`===`,
 * not WGSL's `==`), and `compound` says it was written `op=`, which the sentence then names.
 */
function operatorKindRefusal(op: string, t: ShaderType, compound = false): string | undefined {
  const family = FAMILY[op];
  if (family === undefined) return undefined;
  const cannot = `Cannot ${op}${compound ? '=' : ''} ${authorTypeText(t)}`;
  const kind = kindOf(t);
  switch (family) {
    case 'arithmetic': {
      if (t.kind === 'mat') {
        if (t.elem === 'f32' || op === '/' || op === '%') return undefined;
        // `m * n`, `m * v` and `transpose(m)` are the pass's whole matrix surface; `m *= n` is
        // the product too, and the pass has no compound form for it (Tint: `no matching
        // overload for 'operator *= (DF64Mat3, DF64Mat3)'`), so the refusal names the product.
        if (op === '*') {
          return compound
            ? `${cannot}: the fp64 pass lowers the product of two matrices of doubles and not ` +
                `its compound assignment. Write m = m * n.`
            : undefined;
        }
        return (
          `${cannot}: the fp64 pass lowers only * and transpose on a matrix of doubles. ` +
          `Declare the matrix ${f32Matrix(t)} where you need ${op}${compound ? '=' : ''}.`
        );
      }
      if (kind === undefined) return undefined;
      const remedy =
        t.kind === 'scalar'
          ? ' Convert it to a number first, e.g. u32(a).'
          : t.kind === 'vec'
            ? ` Convert it to numbers first, e.g. vec${String(t.n)}u(a).`
            : t.kind === 'struct'
              ? ' Write it field by field.'
              : t.kind === 'array'
                ? ' Write it element by element.'
                : '';
      return `${cannot}: WGSL has no arithmetic on ${kind}.${remedy}`;
    }
    case 'ordering': {
      if (t.kind === 'scalar' && t.scalar === 'bool') {
        return `${cannot}: a bool has no order in WGSL. Compare it with === or !==.`;
      }
      // A vector of bools has its own sentence in `lowerBinary`, which also names any() and all().
      if (kind === undefined || t.kind === 'vec') return undefined;
      const remedy =
        t.kind === 'struct'
          ? ' Compare one of its fields.'
          : t.kind === 'array'
            ? ' Compare one of its elements.'
            : '';
      return `${cannot}: WGSL orders numbers and vectors of numbers, not ${kind}.${remedy}`;
    }
    case 'equality': {
      if (kind === undefined || t.kind === 'scalar' || t.kind === 'vec') return undefined;
      // A class instance is a value here, so `a === b` cannot ask TypeScript's question (the
      // same object?) either: two `new A()` with one set of fields are one value.
      if (t.kind === 'struct') {
        return (
          `${cannot}: a struct is a value with no identity here, and WGSL compares scalars ` +
          `and vectors only. Compare its fields one by one.`
        );
      }
      // Indexing a matrix of doubles is refused (`Cannot index mat3x3<f64>.`), so a column
      // comparison is offered on an f32 matrix only.
      const remedy =
        t.kind === 'mat' && t.elem === 'f32'
          ? ' Compare it column by column, all(m[0] === n[0]).'
          : t.kind === 'array'
            ? ' Compare it element by element.'
            : '';
      return `${cannot}: WGSL compares scalars and vectors, not ${kind}.${remedy}`;
    }
    case 'bitwise': {
      // A number here is an integer, or two f32 whole numbers the front end folds, which
      // `lowerBinary` keeps; any other float it has refused already.
      if (kind === undefined) return undefined;
      // `&` and `|` on a bool are WGSL's non-short-circuiting logical operators; `^` is not.
      if (kind === 'a bool' || kind === 'a vector of bools') {
        return op === '^'
          ? `${cannot}: WGSL's ^ takes integers, not ${kind}. Write a !== b, which is the same.`
          : undefined;
      }
      const takes =
        op === '^' ? `WGSL's ^ takes integers` : `WGSL's ${op} takes integers and bools`;
      return `${cannot}: ${takes}, not ${kind}.`;
    }
  }
}

/**
 * The refusal for unary `-x` on a value of type `t` when WGSL, or the fp64 pass for a double,
 * has no negation for it, or `undefined` when it has. A `u32` is left to `lowerPrefixUnary`,
 * whose sentence names the two spellings that do work.
 */
function negationKindRefusal(t: ShaderType): string | undefined {
  const kind = kindOf(t);
  if (kind === undefined) return undefined;
  const remedy =
    t.kind === 'scalar' || t.kind === 'vec'
      ? ' Write !x for its logical not.'
      : t.kind === 'mat' && t.elem === 'f32'
        ? ' Write x * -1. to negate each entry.'
        : t.kind === 'struct'
          ? ' Negate its fields one by one.'
          : t.kind === 'array'
            ? ' Negate its elements one by one.'
            : '';
  return `Unary "-" is not defined on ${authorTypeText(t)}; WGSL has no negation for ${kind}.${remedy}`;
}

/**
 * The refusal for unary `+x` on a value of type `t` that is not a number, a vector of numbers or
 * a matrix, or `undefined` when it is one. `+x` lowers to `x`, the identity it is on a number;
 * on a struct, an array or a texture TypeScript's `+x` is `NaN`, so the program would silently
 * not be the one written. A bool and a vector of bools are left to `lowerPrefixUnary`, whose
 * sentence says the operand has to be numeric.
 */
function identityKindRefusal(t: ShaderType): string | undefined {
  const kind = kindOf(t);
  if (kind === undefined || t.kind === 'mat') return undefined;
  return (
    `Unary "+" is not defined on ${authorTypeText(t)}; it takes a number, a vector or a ` +
    `matrix, not ${kind}. Remove it.`
  );
}

/** Refuses `op` on operands of type `t` with {@link operatorKindRefusal}'s sentence, as a
 *  `TS8003` on `node`, and answers whether it did. */
export function refuseOperatorKind(
  op: string,
  t: ShaderType,
  node: ts.Node,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  compound = false,
): boolean {
  const refusal = operatorKindRefusal(op, t, compound);
  if (refusal === undefined) return false;
  diagnostics.push(makeDiagnostic(sourceFile, node, refusal, TS_CODES.TYPE_MISMATCH));
  return true;
}

/** Refuses unary `-` on a value of type `t` with {@link negationKindRefusal}'s sentence, as a
 *  `TS8003` on `node`, and answers whether it did. */
export function refuseNegationKind(
  t: ShaderType,
  node: ts.Node,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): boolean {
  const refusal = negationKindRefusal(t);
  if (refusal === undefined) return false;
  diagnostics.push(makeDiagnostic(sourceFile, node, refusal, TS_CODES.TYPE_MISMATCH));
  return true;
}

/** Refuses unary `+` on a value of type `t` with {@link identityKindRefusal}'s sentence, as a
 *  `TS8003` on `node`, and answers whether it did. */
export function refuseIdentityKind(
  t: ShaderType,
  node: ts.Node,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): boolean {
  const refusal = identityKindRefusal(t);
  if (refusal === undefined) return false;
  diagnostics.push(makeDiagnostic(sourceFile, node, refusal, TS_CODES.TYPE_MISMATCH));
  return true;
}
