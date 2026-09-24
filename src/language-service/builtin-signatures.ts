// === The editor's builtin declarations, generated from Tint's overload table (0017) ===
//
// Every SUPPORTED row of `core/builtins/coredef.ts` becomes one overload here, ahead of
// whatever the ambient library still declares by hand for the same name. The measurement that
// chose this encoding is in `changes/0017-builtins-from-one-table.md`: over 375 instances of 84
// builtins, it gave every call the compiler's type, and drew no error on any shipped program.
//
// THE BRANDS STAY OPTIONAL (`f32` is `number & { readonly [f32Tag]?: true }`, see
// `scalarBrands` in `ambient.ts`), so a plain overload per scalar would let TypeScript match the
// first one for every number. Each row is therefore ONE overload, generic in what it is called
// with, and its result is read off the arguments:
//
//   - A row over `vec<N, T>` is generic in the vector, `V`, bounded by the vector types of the
//     elements its constraint admits. `T` is the vector's element and `N` its length, both read
//     off the vector's `[vecTag]`.
//   - A row over a scalar `T` gives each argument its own type parameter. That is what keeps
//     `smoothstep(0.3, 0.55, h)` from settling `T` on the literal `0.3`, the reason the
//     hand-written `(…: number) => number` overload existed. The result is the scalar of the
//     first argument that carries a brand, read by brand key; an argument list of literals
//     alone has no brand to read and is `number`, which is WGSL's abstract numeric (Rule 12.7).
//
// Every conditional is written inline, so no helper type becomes a global name an author could
// write (Rules 2.2 and 9.8). A hover shows the instance, `dot<vec3u>(a0: vec3u, a1: vec3u): u32`.
import { COREDEF } from '../core/builtins/coredef.js';
import type { CoreDefRow } from '../core/builtins/coredef-types.js';
import { claimOf } from '../core/builtins/overlay.js';
import {
  rowTypes,
  scalarDomain,
  type RowType,
  type TypeshadeScalar,
} from '../core/builtins/row-types.js';

const SUFFIX: Readonly<Record<TypeshadeScalar, string>> = {
  f32: '',
  i32: 'i',
  u32: 'u',
  bool: 'b',
};
const vecName = (s: TypeshadeScalar, n: string): string => `vec${n}${SUFFIX[s]}`;
const LENGTHS = ['2', '3', '4'] as const;

/** The brand keys a scalar result is read by, in the order WGSL's scalars are tried. */
const BRANDS = [
  ['f32', 'f32Tag'],
  ['i32', 'i32Tag'],
  ['u32', 'u32Tag'],
  ['f64', 'f64Tag'],
] as const;

/** The scalar of the first of `params` that carries a brand; `number` when none does. */
function firstBrand(params: readonly string[]): string {
  if (params.length === 0) return 'number';
  const [p, ...rest] = params as [string, ...string[]];
  const arms = BRANDS.map(([s, tag]) => `typeof ${tag} extends keyof ${p} ? ${s} : `).join('');
  return `([${p}] extends [boolean] ? bool : ${arms}${firstBrand(rest)})`;
}

/** The element scalar of the vector `V`, for the elements `elems` its bound admits. */
function elementOf(elems: readonly TypeshadeScalar[]): string {
  let out: string = elems[elems.length - 1]!;
  for (let i = elems.length - 2; i >= 0; i--) {
    const s = elems[i]!;
    out = `V extends { readonly [vecTag]: readonly ['${s}', number] } ? ${s} : ${out}`;
  }
  return `(${out})`;
}

/** The vector of `s` as long as `V`. */
const sameLength = (s: TypeshadeScalar): string =>
  `(V extends { readonly [vecTag]: readonly [unknown, 2] } ? ${vecName(s, '2')} : ` +
  `V extends { readonly [vecTag]: readonly [unknown, 3] } ? ${vecName(s, '3')} : ${vecName(s, '4')})`;

/** A parameter's name: `core.def`'s own where it gives one, `a0`, `a1`, … where it does not. */
const paramName = (row: CoreDefRow, i: number): string => {
  const name = row.params[i]?.name ?? '';
  return /^p\d+$/.test(name) || name === '' ? `a${String(i)}` : name;
};

/** The one overload `row` becomes, or undefined when it has no TypeShade instance. */
export function overloadOf(
  row: CoreDefRow,
  matchers: Readonly<Record<string, readonly string[]>> = COREDEF.matchers,
): string | undefined {
  const types = rowTypes(row);
  if (types === undefined) return undefined;
  const domain = (s: string): TypeshadeScalar[] =>
    s in row.implicit ? scalarDomain(row.implicit[s]!, matchers) : [s as TypeshadeScalar];
  const all = [...types.params, types.ret];
  const anchor = all.find((t) => t.k === 'vec' && (t.n in row.implicit || t.s in row.implicit));

  if (anchor !== undefined && anchor.k === 'vec') {
    const elems = domain(anchor.s);
    if (elems.length === 0) return undefined;
    const lengths = anchor.n in row.implicit ? LENGTHS : [anchor.n];
    const bound = elems.flatMap((s) => lengths.map((n) => vecName(s, n))).join(' | ');
    // A type parameter other than the anchor's element (`ldexp`'s exponent, `I: ia_i32`) is the
    // union of what its constraint admits.
    const union = (xs: readonly string[]): string =>
      xs.length === 1 ? xs[0]! : `(${xs.join(' | ')})`;
    const spell = (t: RowType): string => {
      if (t.k === 'vec') {
        if (t.n === anchor.n && t.s === anchor.s) return 'V';
        if (t.s === anchor.s) return union(elems.map((s) => vecName(s, t.n)));
        const others = domain(t.s);
        return t.n === anchor.n
          ? union(others.map(sameLength))
          : union(others.map((s) => vecName(s, t.n)));
      }
      if (t.s === anchor.s) return elementOf(elems);
      return union(domain(t.s));
    };
    const params = types.params.map((t, i) => `${paramName(row, i)}: ${spell(t)}`).join(', ');
    return `declare function ${row.name}<V extends ${bound}>(${params}): ${spell(types.ret)}`;
  }

  const typeParams: string[] = [];
  const generic: { readonly p: string; readonly of: string }[] = [];
  const params = types.params.map((t, i) => {
    const name = paramName(row, i);
    if (t.k === 'vec') return `${name}: ${vecName(t.s as TypeshadeScalar, t.n)}`;
    if (!(t.s in row.implicit)) return `${name}: ${t.s}`;
    const elems = domain(t.s);
    const bound =
      elems.length === 1 && elems[0] === 'bool'
        ? 'boolean'
        : elems.includes('bool')
          ? 'number | boolean'
          : 'number';
    const p = `P${String(i)}`;
    typeParams.push(`${p} extends ${bound}`);
    generic.push({ p, of: t.s });
    return `${name}: ${p}`;
  });
  const ret = types.ret;
  const result =
    ret.k === 'vec'
      ? vecName(ret.s as TypeshadeScalar, ret.n)
      : ret.s in row.implicit
        ? firstBrand(generic.filter((g) => g.of === ret.s).map((g) => g.p))
        : ret.s;
  const template = typeParams.length === 0 ? '' : `<${typeParams.join(', ')}>`;
  return `declare function ${row.name}${template}(${params.join(', ')}): ${result}`;
}

/** Every SUPPORTED builtin function's generated overloads, by name, in `core.def`'s order. */
export function generatedOverloads(): ReadonlyMap<string, readonly string[]> {
  const out = new Map<string, string[]>();
  for (const row of COREDEF.rows) {
    if (row.kind !== 'fn' || claimOf(row, COREDEF.matchers)?.status !== 'SUPPORTED') continue;
    const overload = overloadOf(row);
    if (overload !== undefined) out.set(row.name, [...(out.get(row.name) ?? []), overload]);
  }
  return out;
}
