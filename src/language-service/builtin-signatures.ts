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
  isValueType,
  namesOf,
  rowTypes,
  scalarDomain,
  valueRowTypes,
  type RowType,
  type TypeshadeScalar,
  type ValueType,
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

/** The names the ambient library gave the parameters of a builtin `core.def` leaves unnamed,
 *  where its documentation reads them (`FUNCTION_DOCS`: "Adds `value` to the atomic
 *  location"). Names only: every type is the row's. */
const NAMED: Readonly<Record<string, readonly string[]>> = {
  atomicCompareExchangeWeak: ['location', 'compare', 'value'],
  arrayLength: ['xs'],
  ...Object.fromEntries(
    ['Load', 'Store', 'Add', 'Sub', 'Min', 'Max', 'And', 'Or', 'Xor', 'Exchange'].map((op) => [
      `atomic${op}`,
      ['location', 'value'],
    ]),
  ),
};

/** A parameter's name: `core.def`'s own where it gives one, the ambient library's where it
 *  named one (`NAMED`), and `a0`, `a1`, … otherwise. */
const paramName = (row: CoreDefRow, i: number): string => {
  const name = row.params[i]?.name ?? '';
  if (!/^p\d+$/.test(name) && name !== '') return name;
  return NAMED[row.name]?.[i] ?? `a${String(i)}`;
};

/**
 * The overload of a row that takes or returns a location rather than a value: an atomic, a
 * runtime-sized array, the compare-exchange's result, or nothing. Each type parameter the row
 * names is one of the overload's, bounded by what its constraint admits, so `atomicAdd` on an
 * `atomic<u32>` reads its `T` off the location as the compiler does.
 */
function locationOverloadOf(
  row: CoreDefRow,
  types: { readonly params: readonly RowType[]; readonly ret: RowType },
  matchers: Readonly<Record<string, readonly string[]>>,
): string | undefined {
  const used = [...new Set([...types.params, types.ret].flatMap(namesOf))].filter(
    (n) => n in row.implicit,
  );
  const typeParams = used.map((n) => {
    if (row.implicit[n] === '') return n;
    const domain = scalarDomain(row.implicit[n]!, matchers);
    return `${n} extends ${[...domain].reverse().join(' | ')}`;
  });
  const spell = (t: RowType): string | undefined => {
    switch (t.k) {
      case 'void':
        return 'void';
      case 'scalar':
        return t.s;
      case 'atomic':
        return `atomic<${t.s}>`;
      case 'runtimeArray':
        return `array<${t.s}>`;
      case 'casResult':
        return `{ old_value: ${t.s}; exchanged: bool }`;
      case 'vec':
        return undefined;
    }
  };
  const params = types.params.map((t, i) => {
    const spelled = spell(t);
    return spelled === undefined ? undefined : `${paramName(row, i)}: ${spelled}`;
  });
  const ret = spell(types.ret);
  if (ret === undefined || params.some((p) => p === undefined)) return undefined;
  const template = typeParams.length === 0 ? '' : `<${typeParams.join(', ')}>`;
  return `declare function ${row.name}${template}(${params.join(', ')}): ${ret}`;
}

/** The one overload `row` becomes, or undefined when it has no TypeShade instance. */
export function overloadOf(
  row: CoreDefRow,
  matchers: Readonly<Record<string, readonly string[]>> = COREDEF.matchers,
): string | undefined {
  const parsed = rowTypes(row);
  if (parsed === undefined) return undefined;
  if (![...parsed.params, parsed.ret].every(isValueType))
    return locationOverloadOf(row, parsed, matchers);
  const types = valueRowTypes(row)!;
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
    const spell = (t: ValueType): string => {
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
