// The types of a core.def row, as far as TypeShade reads them today (0017).
//
// A row is generic over its type parameters: `fn dot<N: num, T: fiu32_f16>(vec<N, T>,
// vec<N, T>) -> T`. The forms read here are a scalar and a vector of one, each concrete
// (`u32`, `vec4<f32>`) or generic (`T`, `vec<N, T>`). The atomics, barriers and \`arrayLength\`
// add four: an atomic's location and a runtime-sized array, each taken by pointer in WGSL and
// written bare by an author (\`atomicAdd(bins[i], 1)\`, \`arrayLength(xs)\`), the compare-exchange's
// result struct, and no result at all. A row that names any other type (a matrix, a texture)
// has no form here yet, and the family that needs one adds it. The editor's generated declarations (`builtin-signatures.ts`) and the
// both-halves witness (`coredef-witness.ts`) read rows through this one parse.
import type { CoreDefRow } from './coredef-types.js';

/** The scalar types TypeShade has, which an instance of a row may bind a type parameter to. */
export const TYPESHADE_SCALARS = ['f32', 'i32', 'u32', 'bool'] as const;
export type TypeshadeScalar = (typeof TYPESHADE_SCALARS)[number];

/** A type as a row writes it: `s` and `n` may name a type parameter. */
export type RowType =
  | { readonly k: 'scalar'; readonly s: string }
  | { readonly k: 'vec'; readonly n: string; readonly s: string }
  /** `ptr<S, atomic<T>, read_write>`: the atomic location, an author's `bins[i]`. */
  | { readonly k: 'atomic'; readonly s: string }
  /** `ptr<AS, runtime_array<T>, A>`: the runtime-sized array, an author's `xs`. */
  | { readonly k: 'runtimeArray'; readonly s: string }
  /** `__atomic_compare_exchange_result<T>`, whose name WGSL gives the author no way to write. */
  | { readonly k: 'casResult'; readonly s: string }
  /** A row that returns nothing. */
  | { readonly k: 'void' };

/** The type parameters `t` names. */
export const namesOf = (t: RowType): readonly string[] =>
  t.k === 'void' ? [] : t.k === 'vec' ? [t.s, t.n] : [t.s];

export function parseRowType(t: string): RowType | undefined {
  let m = /^ptr<\w+,\s*atomic<(\w+)>,\s*read_write>$/.exec(t);
  if (m) return { k: 'atomic', s: m[1]! };
  m = /^ptr<\w+,\s*runtime_array<(\w+)>,\s*\w+>$/.exec(t);
  if (m) return { k: 'runtimeArray', s: m[1]! };
  m = /^__atomic_compare_exchange_result<(\w+)>$/.exec(t);
  if (m) return { k: 'casResult', s: m[1]! };
  m = /^vec<(\w+),\s*(\w+)>$/.exec(t);
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
 * form for, or binds a parameter to something other than a length or a scalar. A runtime-sized
 * array's element is the one parameter bound to any type, since \`arrayLength\` reads none of it.
 */
export function rowTypes(
  row: CoreDefRow,
): { readonly params: readonly RowType[]; readonly ret: RowType } | undefined {
  const params = row.params.map((p) => parseRowType(p.type));
  const ret: RowType | undefined = row.ret === '' ? { k: 'void' } : parseRowType(row.ret);
  if (ret === undefined || params.some((p) => p === undefined)) return undefined;
  for (const t of [...(params as RowType[]), ret]) {
    if (t.k === 'void') continue;
    if (!(t.s in row.implicit) && !isTypeshadeScalar(t.s)) return undefined;
    if (t.k === 'vec' && !/^[234]$/.test(t.n) && !(t.n in row.implicit)) return undefined;
  }
  // A result whose type parameter no argument binds is chosen by an explicit type argument
  // (`bitcast<f32>(u)`), a form neither the generator nor the resolver reads yet.
  const bound = new Set((params as RowType[]).flatMap(namesOf));
  for (const name of namesOf(ret)) {
    if (name in row.implicit && !bound.has(name)) return undefined;
  }
  return { params: params as RowType[], ret };
}

/** The TypeShade scalars a type parameter's constraint admits: `fiu32_f16` gives `f32`, `i32`
 *  and `u32`; a concrete scalar gives itself. Empty for `num` and for anything else. No
 *  constraint at all (a runtime-sized array's element) is read as the scalars a storage buffer
 *  holds, the instances a witness needs. */
export function scalarDomain(
  constraint: string,
  matchers: Readonly<Record<string, readonly string[]>>,
): TypeshadeScalar[] {
  if (constraint === '') return ['f32', 'i32', 'u32'];
  const alternatives = matchers[constraint] ?? [constraint];
  return alternatives.filter(isTypeshadeScalar);
}

/** A scalar or a vector of one: the forms the math family and its neighbours read. */
export type ValueType = Extract<RowType, { readonly k: 'scalar' | 'vec' }>;

export const isValueType = (t: RowType): t is ValueType => t.k === 'scalar' || t.k === 'vec';

/** `rowTypes(row)` when every type in it is a scalar or a vector of one, else undefined. */
export function valueRowTypes(
  row: CoreDefRow,
): { readonly params: readonly ValueType[]; readonly ret: ValueType } | undefined {
  const types = rowTypes(row);
  if (types === undefined || !types.params.every(isValueType) || !isValueType(types.ret)) {
    return undefined;
  }
  return { params: types.params as readonly ValueType[], ret: types.ret };
}
