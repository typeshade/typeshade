// Implements: Rule 9.2 (docs/language-design.md; traced in reqs/).

import ts from 'typescript';
import type { Expr } from '../../../core/ir/nodes.js';
import type { ShaderType } from '../../../core/ir/types.js';
import type { TsCompilerDiagnostic } from '../source-file.js';
import { authorTypeText } from '../context.js';
import { makeDiagnostic } from '../diagnostic.js';
import { TS_CODES } from '../codes.js';
import { F64_SCALAR_TWINS, F64_VEC_REDUCTIONS, F64_VEC_TWINS } from '../../../core/fp64/twins.js';
import { COREDEF } from '../../../core/builtins/coredef.js';
import { supportedRows } from '../../../core/builtins/resolve.js';
import { scalarDomain, valueRowTypes } from '../../../core/builtins/row-types.js';
import { MATH_FN_ARITY } from '../math-alias.js';

type Elem = 'f32' | 'i32' | 'u32' | 'bool' | 'f64';

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
const SIGNED: readonly Elem[] = ['f32', 'f64', 'i32'];

type Role =
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
  readonly elems: readonly Elem[];
  readonly vector?: true;
  readonly vec3?: true;
  readonly roles?: Readonly<Record<number, Role>>;
}

const MATRIX_FNS: ReadonlySet<string> = new Set(['transpose', 'determinant']);

const UNDERIVED_SPECS: Readonly<Record<string, Spec>> = {
  min: { elems: NUMERIC, roles: { 1: 'sameOrScalar' } },
  max: { elems: NUMERIC, roles: { 1: 'sameOrScalar' } },
  mod: { elems: FLOAT, roles: { 1: 'sameOrScalar' } },
};

function canonicalElems(found: ReadonlySet<string>): readonly Elem[] {
  const key = ['f32', 'i32', 'u32'].filter((e) => found.has(e)).join(',');
  const canon: Readonly<Record<string, readonly Elem[]>> = {
    f32: FLOAT,
    'i32,u32': INT,
    'f32,i32': SIGNED,
    'f32,i32,u32': NUMERIC,
  };
  const elems = canon[key];
  if (elems === undefined) throw new Error(`math-args: no element list for {${key}}`);
  return elems;
}

function derivedSpec(name: string): Spec | undefined {
  const rows = supportedRows(name)
    .map((row) => ({ row, types: valueRowTypes(row)! }))
    .filter((r) => r.types !== undefined);
  if (rows.length === 0) return undefined;
  const found = new Set<string>();
  for (const { row, types } of rows) {
    const head = types.params[0]!;
    const domain =
      head.s in row.implicit ? scalarDomain(row.implicit[head.s]!, COREDEF.matchers) : [head.s];
    for (const e of domain) found.add(e);
  }
  const arity = rows[0]!.types.params.length;
  const roles: Record<number, Role> = {};
  for (let i = 1; i < arity; i++) {
    const seen = new Set<Role | 'scalarOfElem'>();
    for (const { row, types } of rows) {
      const head = types.params[0]!;
      const p = types.params[i]!;
      const same =
        p.k === head.k && p.s === head.s && (p.k === 'scalar' || p.n === (head as typeof p).n);
      if (same) seen.add('same');
      else if (p.k === 'scalar' && head.k === 'vec' && p.s === head.s) seen.add('scalarOfElem');
      else if (p.k === 'scalar' && p.s === 'u32') seen.add('u32');
      else if (
        p.s in row.implicit &&
        scalarDomain(row.implicit[p.s]!, COREDEF.matchers).join() === 'i32' &&
        p.k === head.k &&
        (p.k === 'scalar' || p.n === (head as typeof p).n)
      )
        seen.add('i32Of');
      else throw new Error(`math-args: no rule for argument ${String(i)} of ${row.signature}`);
    }
    const kinds = [...seen].sort().join(',');
    const role: Readonly<Record<string, Role>> = {
      same: 'same',
      'same,scalarOfElem': 'sameOrScalar',
      scalarOfElem: 'scalar',
      i32Of: 'i32Of',
      u32: 'u32',
    };
    const r = role[kinds];
    if (r === undefined) throw new Error(`math-args: arguments ${kinds} of ${name} mix rules`);
    if (r !== 'same') roles[i] = r;
  }
  const heads = rows.map((r) => r.types.params[0]!);
  return {
    elems: canonicalElems(found),
    ...(heads.every((h) => h.k === 'vec') ? { vector: true as const } : {}),
    ...(heads.every((h) => h.k === 'vec' && h.n === '3') ? { vec3: true as const } : {}),
    ...(Object.keys(roles).length > 0 ? { roles } : {}),
  };
}

export const MATH_ARG_SPECS: Readonly<Record<string, Spec>> = (() => {
  const out: Record<string, Spec> = { ...UNDERIVED_SPECS };
  for (const name of Object.keys(MATH_FN_ARITY)) {
    if (name in UNDERIVED_SPECS || MATRIX_FNS.has(name)) continue;
    const spec = derivedSpec(name);
    if (spec !== undefined) out[name] = spec;
  }
  return out;
})();

export function mathTakesElem(fn: string, elem: string): boolean {
  const spec = MATH_ARG_SPECS[fn];
  return spec === undefined || (spec.elems as readonly string[]).includes(elem);
}

const VEC_SUFFIX: Readonly<Record<string, string>> = {
  f32: '',
  i32: 'i',
  u32: 'u',
  bool: 'b',
  f64: 'f64',
};

function vectorSpelling(elem: Elem, n: number): string {
  return `vec${n}${VEC_SUFFIX[elem] ?? ''}`;
}

function classWord(elems: readonly Elem[]): string {
  if (elems === FLOAT) return 'an f32, or a vector of them';
  if (elems === INT) return 'an i32 or u32, or a vector of them';
  if (elems === SIGNED) return 'an f32 or i32, or a vector of them';
  return 'a number, or a vector of them';
}

function sameFix(first: Shape, other: Shape, elems: readonly Elem[], arg: string): string {
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
    if (!elems.includes(other.elem)) {
      const to = first.n === 1 ? first.elem : vectorSpelling(first.elem, first.n);
      return ` Cast this one: ${to}(${arg}).`;
    }
    return ` Cast one side: ${cast(first)} or ${cast(other)}.`;
  }
  return '';
}

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
    const narrow = vec ? `vec${head.n}(v)` : 'f32(x)';
    return refuse(
      0,
      `${display} has no emulated-double form; got ${authorTypeText(args[0]!.type)}. ` +
        `On ${vec ? 'a vector of doubles' : 'an f64'} the pass lowers ${listOf(twins)} — ` +
        `narrow first, e.g. ${display}(${narrow}).`,
    );
  }
  for (let i = 1; i < args.length; i++) {
    const shape = shapes[i];
    const got = authorTypeText(args[i]!.type);
    if (fn === 'mix' && i === 2) {
      if (shape !== undefined && shape.elem === 'f32' && shape.n === 1) continue;
      return refuse(
        i,
        `${display} blends emulated doubles by a plain f32 interpolant; got ${got}. ` +
          `Write f32(t).`,
      );
    }
    if (F64_VEC_REDUCTIONS.includes(fn)) {
      if (shape !== undefined && shape.elem === 'f64' && shape.n === head.n) continue;
      return refuse(
        i,
        `${display} reduces two vectors of emulated doubles of one width; the first is ` +
          `${authorTypeText(args[0]!.type)}, this one ${got}.`,
      );
    }
    if (shape !== undefined && shape.elem === 'f64' && shape.n === head.n) continue;
    if (shape !== undefined && shape.n === 1 && (shape.elem === 'f64' || shape.elem === 'f32'))
      continue;
    return refuse(
      i,
      `${display} takes arguments of one type; the first is ${authorTypeText(args[0]!.type)}, ` +
        `this one ${got}.` +
        (shape !== undefined && shape.elem === 'f32' && shape.n > 1
          ? ` A vector of f32 is not widened to a vector of doubles — build it with ` +
            `vec${head.n}f64(...), or narrow the first argument with vec${head.n}(v).`
          : ''),
    );
  }
  return true;
}

function listOf(names: readonly string[]): string {
  return names.length < 2
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]!}`;
}

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
  const argText = (index: number): string => node.arguments[index]?.getText(sourceFile) ?? 'x';
  const first = args[0];
  if (first === undefined) return true;
  if (MATRIX_FNS.has(fn)) {
    if (first.type.kind !== 'mat') {
      return refuse(0, `${display} takes a matrix; got ${authorTypeText(first.type)}.`);
    }
    if (fn === 'determinant' && first.type.cols !== first.type.rows) {
      return refuse(
        0,
        `${display} takes a square matrix; got ${authorTypeText(first.type)}. Only matN has a ` +
          `determinant — on a non-square matrix there is none to take.`,
      );
    }
    if (first.type.elem === 'f64' && fn === 'determinant') {
      return refuse(
        0,
        `${display} has no emulated-double form; got ${authorTypeText(first.type)}: the fp64 pass ` +
          `lowers only * and transpose on a matrix of doubles, so declare the matrix ` +
          `mat${first.type.cols} where you need its determinant.`,
      );
    }
    return true;
  }
  const spec = MATH_ARG_SPECS[fn];
  if (spec === undefined) return true;
  const shapes = args.map((a) => shapeOf(a.type));
  if (shapes[0]?.elem === 'f64') {
    return checkF64Args(fn, display, args, shapes, refuse);
  }
  const head = shapes[0];
  if (head === undefined || !spec.elems.includes(head.elem)) {
    return refuse(
      0,
      `${display} takes ${classWord(spec.elems)}; got ${authorTypeText(first.type)}.`,
    );
  }
  if (spec.vec3 && head.n !== 3) {
    return refuse(
      0,
      `${display} takes two ${vectorSpelling(head.elem, 3)}; got ${authorTypeText(first.type)}.`,
    );
  }
  if (spec.vector && head.n === 1) {
    return refuse(0, `${display} takes vectors; got ${authorTypeText(first.type)}.`);
  }
  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!;
    const shape = shapes[i];
    const role: Role = spec.roles?.[i] ?? 'same';
    const got = authorTypeText(arg.type);
    switch (role) {
      case 'same':
        if (shape !== undefined && shape.elem === head.elem && shape.n === head.n) break;
        return refuse(
          i,
          `${display} takes arguments of one type; the first is ${authorTypeText(first.type)}, this one ${got}.` +
            (shape === undefined ? '' : sameFix(head, shape, spec.elems, argText(i))),
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
          fn === 'min' || fn === 'max'
            ? `${display} takes arguments of one type; the first is ${authorTypeText(first.type)}, this one ${got}.` +
                (shape === undefined ? '' : sameFix(head, shape, spec.elems, argText(i)))
            : `${display} takes this argument as ${authorTypeText(first.type)}, the first argument's type, or as ` +
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
                `${authorTypeText(first.type)} x, one component each; got ${got}.`,
        );
      case 'u32':
        if (shape !== undefined && shape.elem === 'u32' && shape.n === 1) break;
        return refuse(i, `${display} takes a u32 offset and count; got ${got}.`);
    }
  }
  return true;
}
