// The types of a core.def row, as far as TypeShade reads them today (0017).
//
// A row is generic over its type parameters: `fn dot<N: num, T: fiu32_f16>(vec<N, T>,
// vec<N, T>) -> T`. The forms read here are a scalar and a vector of one, each concrete
// (`u32`, `vec4<f32>`) or generic (`T`, `vec<N, T>`); a row that names any other type (a
// matrix, a pointer, a texture, a result struct) has no form here yet, and the family that
// needs one adds it. The editor's generated declarations (`builtin-signatures.ts`) and the
// both-halves witness (`coredef-witness.ts`) read rows through this one parse.
import type { CoreDefRow } from './coredef-types.js';

/** The scalar types TypeShade has, which an instance of a row may bind a type parameter to. */
export const TYPESHADE_SCALARS = ['f32', 'i32', 'u32', 'bool'] as const;
export type TypeshadeScalar = (typeof TYPESHADE_SCALARS)[number];

/** A scalar, or a vector of one, as a row writes it: `s` and `n` may name a type parameter. */
export type RowType =
  | { readonly k: 'scalar'; readonly s: string }
  | { readonly k: 'vec'; readonly n: string; readonly s: string };

export function parseRowType(t: string): RowType | undefined {
  let m = /^vec<(\w+),\s*(\w+)>$/.exec(t);
  if (m) return { k: 'vec', n: m[1]!, s: m[2]! };
  m = /^vec([234])<(\w+)>$/.exec(t);
  if (m) return { k: 'vec', n: m[1]!, s: m[2]! };
  if (/^\w+$/.test(t)) return { k: 'scalar', s: t };
  return undefined;
}

export const isTypeshadeScalar = (s: string): s is TypeshadeScalar =>
  (TYPESHADE_SCALARS as readonly string[]).includes(s);

/**
 * The parameter and result types of `row`, or undefined when it names a type this parse has no
 * form for, returns nothing, or binds a parameter to something other than a length or a scalar.
 */
export function rowTypes(
  row: CoreDefRow,
): { readonly params: readonly RowType[]; readonly ret: RowType } | undefined {
  if (row.ret === '') return undefined;
  const params = row.params.map((p) => parseRowType(p.type));
  const ret = parseRowType(row.ret);
  if (ret === undefined || params.some((p) => p === undefined)) return undefined;
  for (const t of [...(params as RowType[]), ret]) {
    if (!(t.s in row.implicit) && !isTypeshadeScalar(t.s)) return undefined;
    if (t.k === 'vec' && !/^[234]$/.test(t.n) && !(t.n in row.implicit)) return undefined;
  }
  // A result whose type parameter no argument binds is chosen by an explicit type argument
  // (`bitcast<f32>(u)`), a form neither the generator nor the resolver reads yet.
  const bound = new Set((params as RowType[]).flatMap((p) => (p.k === 'vec' ? [p.s, p.n] : [p.s])));
  for (const name of ret.k === 'vec' ? [ret.s, ret.n] : [ret.s]) {
    if (name in row.implicit && !bound.has(name)) return undefined;
  }
  return { params: params as RowType[], ret };
}

/** The TypeShade scalars a type parameter's constraint admits: `fiu32_f16` gives `f32`, `i32`
 *  and `u32`; a concrete scalar gives itself. Empty for `num` and for anything else. */
export function scalarDomain(
  constraint: string,
  matchers: Readonly<Record<string, readonly string[]>>,
): TypeshadeScalar[] {
  const alternatives = matchers[constraint] ?? [constraint];
  return alternatives.filter(isTypeshadeScalar);
}
