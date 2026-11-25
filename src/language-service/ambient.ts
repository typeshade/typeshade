import { SUPPORTED_TYPE_NAMES } from '../compiler/ts/type-map.js';
import { F64_VEC_TWIN_KIND } from '../core/fp64/twins.js';
import { SCALAR_CAST } from '../compiler/ts/numeric.js';
import {
  MATH_FN_ALIAS,
  MATH_FN_ARITY,
  MATH_EXPAND_ALIAS,
  MATH_CONST_ALIAS,
  LANG_CONST,
} from '../compiler/ts/math-alias.js';
import { EXPAND_ARITY } from '../compiler/ts/math-expand.js';
import { isRemovedCall } from '../compiler/ts/removed-names.js';
import {
  WGSL_BUILTIN_NAMES as SOT_WGSL_BUILTIN_NAMES,
  WGSL_BUILTIN_TYPES as SOT_WGSL_BUILTIN_TYPES,
} from '../core/sot.js';
import { authorTypeText } from '../compiler/ts/context.js';
import { ATTRIBUTE_NAMES as COMPILER_ATTRIBUTE_NAMES } from '../compiler/ts/builtin-check.js';
import { STORAGE_BUFFER_ACCESS as COMPILER_STORAGE_BUFFER_ACCESS } from '../compiler/ts/bindings.js';
import {
  FUNCTION_DOCS,
  CONSTANT_DOCS,
  ATTRIBUTE_DOCS,
  MATH_MEMBER_DOCS,
  ATTRIBUTE_TYPE_DOCS,
} from './docs.js';
import { renderJSDoc, withTypeDocs } from './ambient/type-docs.js';
import { generatedOverloads, scalarOfDeclaration } from './builtin-signatures.js';
import { ARRAY_LIBRARY_DTS } from './ambient/array-library.js';

const GENERATED = new Map([...generatedOverloads()].filter(([name]) => !isRemovedCall(name)));

type VecElem = 'f32' | 'i32' | 'u32' | 'f64' | 'bool';

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

// Why: the compiler's `VEC_CTOR` table in `lower/expression-call.ts` is private, and it accepts
// `vec2`/`vec3`/`vec4` with the `f`/`i`/`u`/`f64` suffixes but never the bare `d` suffix.
const VEC_CTOR_NAMES = [...VEC_TYPE_ELEM.keys()].filter((name) => !/d$/.test(name));

/** WGSL builtin ids `@builtin(...)` accepts — `core/sot.ts`'s own runtime array (the compiler
 * front end's `@builtin(...)` allow-list check reads the same one), re-exported here as a
 * completion/hover data source too — see `completions.ts`. */
export const WGSL_BUILTIN_NAMES: readonly string[] = SOT_WGSL_BUILTIN_NAMES;

const BUILTIN_VALUE_TYPE: string =
  '(' +
  Object.entries(SOT_WGSL_BUILTIN_TYPES)
    .map(([name, type]) => `N extends '${name}' ? ${authorTypeText(type)} : `)
    .join('') +
  'never)';

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

export const STORAGE_BUFFER_ACCESS: readonly string[] = COMPILER_STORAGE_BUFFER_ACCESS;

const storageBufferAccessUnion = COMPILER_STORAGE_BUFFER_ACCESS.map((w) => `'${w}'`).join(' | ');

const MAT_ARITIES = [2, 3, 4] as const;
const matTypeAliases = MAT_ARITIES.flatMap((cols) =>
  MAT_ARITIES.flatMap((rows) => {
    const elem = cols === rows ? "typeof f64Tag extends keyof T ? 'f64' : 'f32'" : "'f32'";
    const param = cols === rows ? '<T extends f32 | f64 = f32>' : '';
    const body = `Mat<${elem}, ${cols}, ${rows}>`;
    const lines = [`type mat${cols}x${rows}${param} = ${body}`];
    if (cols === rows) lines.push(`type mat${cols}${param} = mat${cols}x${rows}<T>`);
    lines.push(`type mat${cols}x${rows}f = mat${cols}x${rows}`);
    return lines;
  }),
).join('\n');

const matCtorOverloads = MAT_ARITIES.flatMap((cols) =>
  MAT_ARITIES.flatMap((rows) => {
    const name = `mat${cols}x${rows}`;
    const t = `mat${cols}x${rows}`;
    const columns = Array.from({ length: cols }, (_, i) => `c${i}: vec${rows}`).join(', ');
    const comps = Array.from({ length: cols * rows }, (_, i) => `e${i}: number`).join(', ');
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
    const names = cols === rows ? [name, `${name}f`, `mat${cols}`] : [name, `${name}f`];
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
  const generic = /^vec[234]$/.test(name);
  const type = generic ? `VecFor${n}<T>` : vecTypeName(elem, n);
  const head = generic ? `declare function ${name}<T = f32>` : `declare function ${name}`;
  const c = elem === 'bool' ? 'bool' : 'number';
  const shorter = (k: 2 | 3): string => vecTypeName(elem, k);
  const lines: string[] = [];
  if (elem !== 'f64') lines.push(`${head}(): ${type}`);
  if (n === 2) {
    lines.push(`${head}(x: ${c}, y: ${c}): ${type}`);
  } else if (n === 3) {
    lines.push(`${head}(x: ${c}, y: ${c}, z: ${c}): ${type}`);
    lines.push(`${head}(v: ${shorter(2)}, z: ${c}): ${type}`);
    lines.push(`${head}(x: ${c}, v: ${shorter(2)}): ${type}`);
  } else {
    lines.push(`${head}(x: ${c}, y: ${c}, z: ${c}, w: ${c}): ${type}`);
    lines.push(`${head}(v: ${shorter(3)}, w: ${c}): ${type}`);
    lines.push(`${head}(v: ${shorter(2)}, z: ${c}, w: ${c}): ${type}`);
    lines.push(`${head}(x: ${c}, v: ${shorter(2)}, w: ${c}): ${type}`);
    lines.push(`${head}(x: ${c}, y: ${c}, v: ${shorter(2)}): ${type}`);
    lines.push(`${head}(x: ${c}, v: ${shorter(3)}): ${type}`);
    lines.push(`${head}(a: ${shorter(2)}, b: ${shorter(2)}): ${type}`);
  }
  lines.push(`${head}(scalar: ${c}): ${type}`);
  if (elem !== 'f64') lines.push(`${head}(v: ${vecTypeName(elem, n)}): ${type}`);
  if (generic) {
    const bools = Array.from({ length: n }, (_, i) => `${'xyzw'[i]!}: bool`).join(', ');
    lines.push(`declare function ${name}<T>(${bools}): VecFor${n}<T>`);
    lines.push(`declare function ${name}<T>(scalar: bool): VecFor${n}<T>`);
  }
  if (elem !== 'f64') {
    for (const other of NATIVE_VEC_ELEMS) {
      if (other === elem) continue;
      lines.push(`${head}(v: ${vecTypeName(other, n)}): ${type}`);
    }
  }
  if (elem === 'f32') {
    lines.push(`declare function ${name}(v: ${vecTypeName('f64', n)}): ${vecTypeName('f32', n)}`);
  }
  return lines.join('\n');
};

const NATIVE_VEC_ELEMS: readonly VecElem[] = ['f32', 'i32', 'u32', 'bool'];

function vecTypeName(elem: VecElem, n: 2 | 3 | 4): string {
  if (elem === 'f32') return `vec${n}`;
  if (elem === 'f64') return `vec${n}f64`;
  if (elem === 'bool') return `vec${n}b`;
  return `vec${n}${elem === 'i32' ? 'i' : 'u'}`;
}

const FREE_MATH_NAMES = Object.keys(MATH_FN_ARITY).filter(
  (name) => name !== 'f32' && !isRemovedCall(name),
);

const VEC_ARITIES: readonly (2 | 3 | 4)[] = [2, 3, 4];

function swizzleMembers(n: 2 | 3 | 4, lane: string, elem: VecElem): string[] {
  const out: string[] = [];
  for (const family of ['xyzw', 'rgba']) {
    const letters = [...family.slice(0, n)];
    let picks = [''];
    for (let k = 1; k <= 4; k++) {
      picks = picks.flatMap((p) => letters.map((c) => p + c));
      const type = k === 1 ? lane : vecTypeName(elem, k as 2 | 3 | 4);
      for (const p of picks) out.push(`  ${p}: ${type}`);
    }
  }
  return out;
}

const vecInterfaces = (elem: VecElem): string =>
  VEC_ARITIES.map((n) => {
    const head =
      elem === 'f64'
        ? [`  readonly [vec64Tag]: ${n}`, ...Array.from({ length: n }, (_, i) => `  ${i}: f64`)]
        : [`  readonly [vecTag]: readonly ['${elem}', ${n}]`, `  [index: number]: ${elem}`];
    return [
      `interface ${vecTypeName(elem, n)} {`,
      ...head,
      ...swizzleMembers(n, elem, elem),
      '}',
    ].join('\n');
  }).join('\n');

const F32_VEC_TYPE_NAMES: readonly string[] = VEC_ARITIES.map((n) => vecTypeName('f32', n));

const VEC64_TYPE_NAMES: readonly string[] = VEC_ARITIES.map((n) => vecTypeName('f64', n));

function vec64Reduction(name: string, arity: 1 | 2): string {
  const params = Array.from({ length: arity }, (_, i) => `a${i}: T`).join(', ');
  return (
    `declare function ${name}<T extends Numeric | Vec64Any>(${params}): ` +
    `T extends Vec64Any ? f64 : number`
  );
}

function componentwiseBroadcastSignature(name: string): string {
  const vectors = [
    ...F32_VEC_TYPE_NAMES,
    ...['i32', 'u32'].flatMap((elem) => VEC_ARITIES.map((n) => vecTypeName(elem as VecElem, n))),
  ];
  return vectors.map((v) => `declare function ${name}(a: ${v}, b: number): ${v}`).join('\n');
}

function mixSignature(): string {
  const vectorWithScalar = (v: string): string =>
    `declare function mix(a: ${v}, b: ${v}, t: number): ${v}`;
  return [
    ...F32_VEC_TYPE_NAMES.map(vectorWithScalar),
    ...VEC64_TYPE_NAMES.map(vectorWithScalar),
    ...(GENERATED.has('mix') ? [] : [scalarMathOverload('mix', 3)]),
    'declare function mix<T extends Numeric>(a: T, b: T, t: T): T',
  ].join('\n');
}

function scalarMathOverload(name: string, arity: number): string {
  const params = Array.from({ length: arity }, (_, i) => `a${i}: number`).join(', ');
  return `declare function ${name}(${params}): number`;
}

const SPECIAL_MATH_SIGNATURES: Readonly<Record<string, string>> = {
  dot: vec64Reduction('dot', 2),
  distance: vec64Reduction('distance', 2),
  length: vec64Reduction('length', 1),
  normalize: 'declare function normalize<T extends Numeric | Vec64Any>(a: T): T',
  cross: 'declare function cross(a: vec3, b: vec3): vec3',
  mix: mixSignature(),
  min: componentwiseBroadcastSignature('min'),
  max: componentwiseBroadcastSignature('max'),
  transpose: [
    ...MAT_ARITIES.flatMap((cols) =>
      MAT_ARITIES.map(
        (rows) => `declare function transpose(m: mat${cols}x${rows}): mat${rows}x${cols}`,
      ),
    ),
    ...MAT_ARITIES.map(
      (n) => `declare function transpose(m: mat${n}x${n}<f64>): mat${n}x${n}<f64>`,
    ),
  ].join('\n'),
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
  const constraint = F64_VEC_TWIN_KIND[name] === undefined ? 'Numeric' : 'Numeric | Vec64Any';
  const scalar = GENERATED.has(name) ? '' : `${scalarMathOverload(name, arity)}\n`;
  return `${scalar}declare function ${name}<T extends ${constraint}>(${params}): T`;
}

const LANG_CONST_NAMES = Object.keys(LANG_CONST);
const SCALAR_CAST_NAMES = Object.keys(SCALAR_CAST);

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
  const zero = name === 'f64' ? '' : `declare function ${name}(): ${name}\n`;
  // Why: WGSL takes a bool in a scalar cast (wgsl.txt:20207). `f64` is the exception, since the
  // compiler widens an f32 only.
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

const randomDeclaration = FUNCTION_DOCS.random
  ? `${renderJSDoc(FUNCTION_DOCS.random)}\ndeclare function random(seed: f32 | vec2 | vec3): f32`
  : 'declare function random(seed: f32 | vec2 | vec3): f32';

const langConsts = LANG_CONST_NAMES.map((name) => {
  const line = `declare const ${name}: number`;
  const doc = CONSTANT_DOCS[name];
  if (!doc) return line;
  return `${renderJSDoc(doc)}\n${line}`;
}).join('\n');

const MATH_PARAMETER_NAMES: Readonly<Record<string, readonly string[]>> = {
  atan2: ['y', 'x'],
  pow: ['base', 'exponent'],
};

const MATH_ALSO_TAKES: Readonly<Record<string, string>> = { atan: 'atan2' };

function mathParameters(form: string, fewest: number, most: number): string {
  const names =
    MATH_PARAMETER_NAMES[form] ?? (most === 1 ? ['x'] : ['a', 'b', 'c', 'd'].slice(0, most));
  return names.map((n, i) => `${n}${i < fewest ? '' : '?'}: number`).join(', ');
}

function mathMethod(name: string, form: string, parameters: string): string {
  const line = `  ${name}(${parameters}): number`;
  const doc = MATH_MEMBER_DOCS[form];
  if (!doc) return line;
  return `  ${renderJSDoc(doc).split('\n').join('\n  ')}\n${line}`;
}

const mathMethods = [
  ...Object.keys(MATH_FN_ALIAS).flatMap((name) =>
    [name, MATH_ALSO_TAKES[name]].flatMap((form) => {
      if (form === undefined) return [];
      const arity = MATH_FN_ARITY[MATH_FN_ALIAS[form]!]!;
      return [mathMethod(name, form, mathParameters(form, arity, arity))];
    }),
  ),
  ...Object.keys(MATH_EXPAND_ALIAS).map((name) => {
    const [fewest, most] = EXPAND_ARITY[MATH_EXPAND_ALIAS[name]!];
    return mathMethod(name, name, mathParameters(name, fewest, most));
  }),
  mathMethod('random', 'random', ''),
].join('\n');

const mathConstants = Object.keys(MATH_CONST_ALIAS)
  .map((name) => {
    const line = `  readonly ${name}: f32`;
    const doc = MATH_MEMBER_DOCS[name];
    if (!doc) return line;
    return `  ${renderJSDoc(doc).split('\n').join('\n  ')}\n${line}`;
  })
  .join('\n');

export const GPU_BRAND_TAGS: readonly string[] = ['vecTag', 'vec64Tag', 'matTag'];

const HAND_WRITTEN_DTS = `// Generated ambient declarations for TypeShade authoring — see ambient.ts.

${scalarBrands}
type bool = boolean

// A local stand-in for the standard-lib \`Pick\` helper: this program is compiled with \`lib: []\`
// (design doc §6), so \`lib.es5.d.ts\` — and every helper it declares, \`Pick\` included — is never
// part of the program. Without this, the vector shape that once used it silently resolved to an
// error type and every vector type collapsed to \`any\` (no false positives, but no real
// checking either); a matrix's lanes use it now.
type Pick<T, K extends keyof T> = { [P in K]: T[P] }
// A table over a closed set of keys (change 0081): the compiler takes a union of string
// literals, dense enums and integer literal domains as K, and holds the table as array<T, N>.
type Record<K extends keyof any, T> = { [P in K]: T }

// The constructor type a mixin takes (surface document §29): any class, whatever its fields.
// TypeScript needs a base of this shape to accept \`class extends Base\`, and the compiler
// never reads it — the mixin runs when the file is compiled. Declaring your own, as the
// TypeScript handbook does, works just as well; this is here so a shader author does not have
// to know the incantation.
type AnyClass = new (...args: any[]) => object

declare const vecTag: unique symbol
// The lanes an emulated-double vector may be indexed by, as NUMERIC LITERAL keys rather than
// an index signature. That is the compiler's rule exactly (§39): \`v[1]\` is a swizzle of the
// hi and lo planes and lowers, \`v[i]\` with a variable \`i\` would have to swizzle by a value
// and is refused, and \`v[2]\` on a \`vec2f64\` is out of range. An index signature would admit
// all three; leaving them out would admit none.
type LaneKeys<N extends 2 | 3 | 4> = N extends 2 ? 0 | 1 : N extends 3 ? 0 | 1 | 2 : 0 | 1 | 2 | 3
${vecInterfaces('f32')}
${vecInterfaces('i32')}
${vecInterfaces('u32')}
/** Vectors of bools (§27): what a comparison of two vectors yields, componentwise. Not
 * \`Numeric\`: no arithmetic, only \`any\`, \`all\`, \`select\` and \`!\`. */
${vecInterfaces('bool')}
type BoolVec = vec2b | vec3b | vec4b

declare const vec64Tag: unique symbol
/** An \`f64\` vector swizzles like any other (§39): the fp64 pass rebuilds the picked lanes
 * out of the hi and lo planes it lowers the vector into, so \`v.x\` is an \`f64\` and \`v.xy\` a
 * \`vec2f64\`. A one-component pick and a multi-component one are the two shapes WGSL gives,
 * and the colour aliases name the same lanes. \`v[i]\` is the same pick by a CONSTANT index;
 * the index signature is not declared, because a dynamic one has no lowering. */
${vecInterfaces('f64')}
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
/** What \`bitcast<T>\` reads: the OTHER 32-bit type, or a vector of it of the same width
 * (change 0044). The scalar arm is keyed on \`keyof\` for the same reason \`VecElemOf\` is — the
 * scalar brands are optional properties, so \`f32 extends u32\` is true and a conditional written
 * on assignability collapses to one arm for both instantiations. The vector arms can use
 * assignability: each vector's \`vecTag\` names its element and width, so no two are assignable. */
type BitcastArg<T> = T extends vec2u
  ? vec2
  : T extends vec3u
    ? vec3
    : T extends vec4u
      ? vec4
      : T extends vec2
        ? vec2u
        : T extends vec3
          ? vec3u
          : T extends vec4
            ? vec4u
            : typeof u32Tag extends keyof T
              ? f32
              : u32
type VecFor2<T> = VecElemOf<T, vec2u, vec2i, vec2f64, vec2b, vec2>
type VecFor3<T> = VecElemOf<T, vec3u, vec3i, vec3f64, vec3b, vec3>
type VecFor4<T> = VecElemOf<T, vec4u, vec4i, vec4f64, vec4b, vec4>

/** The scalar a builtin's scalar overload returns (change 0063): that of the first argument
 * that carries a brand, \`bool\` for a boolean, \`number\` when none does, which is WGSL's
 * abstract numeric (Rule 12.7). \`builtin-signatures.ts\` generates it from the brand table
 * its overloads are read by. */
${scalarOfDeclaration()}

type Numeric = number | vec2 | vec3 | vec4 | vec2i | vec3i | vec4i | vec2u | vec3u | vec4u

/** JavaScript Console API surface exposed by the \`"use typeshade"\` authoring environment.
 * The source spelling is the standard \`console.*\` API; the compiler currently lowers the
 * logging-level methods below. Other Console methods remain visible to TypeScript only when
 * they are added here deliberately, so editor completion never advertises an unsupported
 * shader operation. Each takes what the standard one does: a value of any type, or a string
 * literal, which is a label the host keeps (surface §66). What the compiler refuses among
 * them (a template with a value in it, a string that is not a literal) it says itself. */
interface Console {
  log(...data: any[]): void
  info(...data: any[]): void
  debug(...data: any[]): void
  warn(...data: any[]): void
  error(...data: any[]): void
  /** Shows one value as a table: an array by element, a struct by field, a matrix by column. */
  table(tabularData: unknown): void
}
/** The standard console. Its logging methods are the ones declared on Console above; a
 * call to one is delivered to the host's console sink when the program runs on the CPU. */
declare const console: Console

declare const matTag: unique symbol
/** A matrix of \`C\` columns and \`R\` rows (§40), column-major as both targets are: \`m[j]\` is
 * column j, a \`vecR\`. The tag carries the element and BOTH dimensions, so \`mat2x3\` and
 * \`mat3x2\` are not interchangeable — they transpose into each other rather than being the
 * same type.
 *
 * An f32 matrix takes any integer column index, a runtime one included (\`m[i]\` with an
 * \`i: u32\`), which WGSL allows and the compiler lowers, so it carries an index signature the
 * way a native vector does, and admits what that one admits (\`m[4]\` is the compiler's TS8016
 * alone). An emulated-double matrix takes none, because the compiler refuses to index one at
 * all (\`TS8003 Cannot index mat4x4<f64>.\`), so \`m[i]\` stays TS7053 on it. The literal lane
 * keys stay on both: a constant index reads through them as it always has, and they keep the
 * intersection two types wide, which is what keeps \`mat4<f64>\` its name in a message rather
 * than the bare tag it prints as without them. */
type Mat<E extends string, C extends 2 | 3 | 4, R extends 2 | 3 | 4> = {
  readonly [matTag]: readonly [E, C, R]
} & Pick<
  { 0: MatColumn<E, R>; 1: MatColumn<E, R>; 2: MatColumn<E, R>; 3: MatColumn<E, R> },
  LaneKeys<C>
> &
  (E extends 'f32' ? { [column: number]: MatColumn<E, R> } : {})
/** A column of a matrix: a \`vecR\` of its element. An emulated-double matrix has no column
 * type an author can hold — the compiler refuses indexing one — so it resolves to \`never\`
 * rather than quietly reading as a vector of f32. */
type MatColumn<E extends string, R extends 2 | 3 | 4> = E extends 'f32'
  ? R extends 2
    ? vec2
    : R extends 3
      ? vec3
      : vec4
  : never
${matTypeAliases}

declare const arrayTag: unique symbol
// The index signature is WRITABLE. \`out[gid.x] = value\` is the shape of every compute kernel
// (examples/gallery/compute-reduction-twin/compute-reduction-twin.shade.ts), and the compiler lowers it to a storage store, so a
// \`readonly\` here reported TS2542 ("Index signature ... only permits reading") on a program that
// compiles. The tag and \`length\` stay readonly: neither is assignable in the source language.
//
// The tag is OPTIONAL so a list can initialize an array (#8 A16): \`const xs: array<f32, 3> =
// [1., 2., 3.]\` compiles, and with a required tag the editor reported TS2322 ("Property
// '[arrayTag]' is missing") on a program the compiler accepts. \`length\` stays required and
// stays \`N\`, which is what still separates the sizes — a three-element list is not an
// \`array<f32, 2>\` in the editor either. A runtime-sized array leaves \`N\` at \`number\` and has
// no size to give, so its \`length\` is the \`u32\` the compiler reads from the buffer
// (WGSL's \`arrayLength\`, surface §20), and the editor shows the type \`n * 0.5\` is refused for.
//
// WHERE AN ARRAY MEMBER GOES. \`Pick<Array<T>, ArrayOps>\` is how this type takes its members
// from the \`interface Array<T>\` at the bottom of this file, the way dom.d.ts picks from the
// standard library: that interface is the standard-library declaration this file restates for a
// \`lib: []\` program (design rule 2.1(b)), and \`ArrayOps\` names the members of it an author may
// reach. A name here must be a member the interface declares: \`ArrayOps = 'filter'\` against it
// is TS2344 ("Type '\"filter\"' does not satisfy the constraint 'keyof T[]'"), measured against
// the library's OWN diagnostics under \`noLib\`, which is the mechanism working. So an array
// operation that becomes a METHOD (#177) is declared on that one interface and named here, and
// \`ReadView\`'s function-type arm carries it into a read binding's view unchanged. That is why
// the read view needs no array declaration of its own: one interface is what gets updated. The
// five an array has (surface §63) are declared there with a \`this\` of \`array<T, N>\`, which is
// how a member of \`Array<T>\` learns the size: \`map\` builds an \`array<U, N>\`.
//
// A MUTATING member must not simply ride that arm. The function arm copies a call signature
// across without reading it, so \`src.fill(0.)\` would stay green on a read binding. \`push\`
// is the first mutating member (change 0078), and the compiler refuses it everywhere but on a
// kernel function's array parameter inside a candidate loop, a read binding included; the editor
// shows that refusal, since it runs the same front end.
type ArrayOps = 'map' | 'forEach' | 'some' | 'every' | 'reduce' | 'push' | 'fill' | 'findIndex' | 'findLastIndex' | 'indexOf' | 'lastIndexOf' | 'includes' | 'slice'
// Iterable, so \`for (const x of xs)\` type-checks (Rule 7.5): the compiler lowers it to a counted
// loop over the indices. The iterator's shape is written inline so it adds no global name.
//
// \`length\` is the size \`N\` when the array has one, and a \`u32\` when it has none. \`N\` is
// two things here, the size the tag compares and the type \`length\` reads, and a runtime-sized
// array fills it with its default \`number\`: \`src.length\` hovered as \`number\` while the
// compiler reads it as \`arrayLength(&src)\`, a \`u32\` (#46), the type WGSL's \`arrayLength\`
// returns. \`number extends N\` is true only for that default, never for a literal size.
type array<T, N extends number = number> = Pick<Array<T>, ArrayOps> & { readonly [arrayTag]?: readonly [T, N]; readonly length: number extends N ? u32 : N } & {
  [index: number]: T
  [Symbol.iterator](): { next(): { done: false; value: T } | { done: true; value: undefined } }
}
// Called without type arguments, \`array(...)\` reads its element and its count off the values,
// as WGSL's does: the values are a tuple \`V\`, the element is what they share and the count
// is the tuple's length, so \`array(a, b, c)\` of \`f32\` values is an \`array<f32, 3>\`. The
// second overload is the one \`array<vec4, 2>(...)\` names. A literal among typed scalars takes
// their type, as WGSL concretizes it: the element keeps the members of \`V[number]\` that carry
// a scalar brand, read by brand key since \`number\` is assignable to every optional brand, and
// is \`V[number]\` itself when none does. Values that are all literals are \`number\`, WGSL's
// abstract numeric, as a builtin over literals is (Rule 12.7). Written inline, so no helper
// becomes a global name (Rule 9.8).
${renderJSDoc(FUNCTION_DOCS.array)}
declare function array<V extends readonly unknown[]>(...values: V): array<[(V[number] extends infer E ? (E extends number ? (typeof f32Tag extends keyof E ? E : typeof i32Tag extends keyof E ? E : typeof u32Tag extends keyof E ? E : typeof f64Tag extends keyof E ? E : never) : never) : never)] extends [never] ? V[number] : (V[number] extends infer E ? (E extends number ? (typeof f32Tag extends keyof E ? E : typeof i32Tag extends keyof E ? E : typeof u32Tag extends keyof E ? E : typeof f64Tag extends keyof E ? E : never) : never) : never), V['length']>
${renderJSDoc(FUNCTION_DOCS.array)}
declare function array<T, N extends number>(...values: readonly T[]): array<T, N>
${renderJSDoc(FUNCTION_DOCS.fill)}
declare function fill<T, N extends number>(value: T): array<T, N>

/** How a shader may touch a storage BUFFER, in WGSL's own two words: \`var<storage, read>\` and
 * \`var<storage, read_write>\`. It is not {@link StorageAccess}, a storage TEXTURE's
 * \`'write' | 'read' | 'read_write'\`: a storage buffer has no write-only mode, so the editor
 * refuses \`storage<T, "write">\` here rather than leaving it for the compiler to answer.
 * \`read\` is WGSL's own default for the address space, so it is the default here. The word list
 * is the compiler's own (\`STORAGE_BUFFER_ACCESS\` in \`bindings.ts\`, which \`ambient.ts\`
 * re-exports), so the words this union admits and the words the front end reads cannot drift. */
type StorageBufferAccess = ${storageBufferAccessUnion}

/** The READ-ONLY VIEW of a binding's value type: every named field, every numeric lane and
 * every index signature is \`readonly\`, all the way down, and the brand keys are left exactly
 * as declared.
 *
 * ONE homomorphic mapped type does the whole job. \`K in keyof T\` is what keeps it homomorphic,
 * so an index signature stays an index signature (\`array<T, N>\`'s \`[index: number]: T\` becomes
 * \`readonly [index: number]: ...\`, which is what draws TS2542 on \`src[0] = 1.\`) and an
 * optional property stays optional (\`[arrayTag]?\`, so \`const xs: array<f32, 3> = [1., 2., 3.]\`
 * still compiles). \`K extends string | number\` is what RECURSES: a named field, a numeric lane
 * and an index signature each go through \`ReadView\` again, while the SYMBOL-keyed brand
 * (\`[arrayTag]\`, \`[vecTag]\`, \`[vec64Tag]\`, \`[matTag]\`, \`[atomicTag]\`, the texture tags)
 * passes through as \`T[K]\`. Mapping a brand rewrites the tuple inside it and the view stops
 * being a view of its own type: measured, \`readonly [f32, 4]\` came back as an object with
 * \`0\`/\`1\`/\`length\` keys, \`array<f32, 4>\` stopped being assignable to \`array<f32, 4>\` and
 * \`length(p.offset)\` reported TS2345.
 *
 * The view goes ALL THE WAY DOWN because WGSL's access mode covers the whole binding: a
 * struct's array field, an array's struct element, a vector component and a matrix column are
 * each a place in the same buffer, so leaving one writable is a disagreement with the lowering
 * and not a simplification. Measured, one level deep left six writes green that the compiler
 * refuses: \`b.w[0] = 1.\`, \`xs[0].q = 1.\`, \`p.offset.x = 1.\`, \`src[0].x = 1.\`,
 * \`bs[0].w[1] = 1.\` and \`ms[0][1].y = 1.\`.
 *
 * TWO ARMS STOP THE RECURSION, and each was measured rather than assumed.
 * A scalar is a value, not a container: \`f32\` is \`number & { [f32Tag]?: true }\` and \`bool\` is
 * \`boolean\`, and a mapped type over either drops the \`number\` and takes every arithmetic
 * operator with it.
 * A method is a call signature, which no mapped type preserves. Without this arm \`cam.scaled\`
 * measured as \`{}\` with zero call signatures, and because \`lib: []\` leaves \`{}\` with no
 * "not callable" error to report, \`cam.scaled(2.)\` typed silently as \`any\`: the "no false
 * positives, but no real checking either" failure the \`Pick\` note above records. The view
 * therefore stops at the method boundary; a method body that writes \`this\` is the compiler's
 * to refuse, since the access mode belongs to the binding and not to the method. */
type ReadView<T> = T extends number | boolean
  ? T
  : T extends (...args: never[]) => unknown
    ? T
    : { readonly [K in keyof T]: K extends string | number ? ReadView<T[K]> : T[K] }

/** A uniform binding is read-only in WGSL and in the surface (\`"use typeshade"\` surface section
 * 7), so its value type is always the read view: \`u.scale = 1.\` draws TS2540 in the editor and
 * no longer waits for the compiler's TS8005. Still transparent where it matters: \`bindings.ts\`
 * unwraps the wrapper once, and every read of a field, element or component types exactly as it
 * did before. */
type uniform<T> = ReadView<T>
/** A storage binding takes its access mode as a TYPE ARGUMENT, the way WGSL spells it:
 * \`storage<T>\` is inferred from the program (change 0114, S3), and \`"read_write"\` keeps
 * \`var<storage, read_write>\`. The declaration keyword does not carry it, because a \`const\`
 * array in TypeScript forbids rebinding and permits \`arr[0] = 1\`, so \`declare let\` never meant
 * read_write to a reader. \`read_write\` hands back \`T\` itself, which is why \`out[gid.x] = 1.\`
 * in a compute kernel reports no TS2542 (ambient.test.ts, "a storage array is writable in the
 * editor, as it is in the compiler"). */
type storage<T, A extends StorageBufferAccess = 'read_write'> = A extends 'read_write' ? T : ReadView<T>
/** THE SLOT THE CALL FORM MAY NAME. \`bindings.ts\` reads a bare number as the binding, two
 * numbers as the group and the binding, and an object literal as \`{ group, binding }\`; these
 * declarations took NO parameters, so every call form that named its slot was
 * \`TS2554 Expected 0 arguments, but got 1\` in the editor on a program the compiler accepts —
 * including the line the retired-\`{ access }\` refusal quotes back. The parameters are written
 * inline rather than as a named type, because a name here is a name an author can write
 * (\`surface-names.test.ts\`) and this is a shape, not a vocabulary word. */
${renderJSDoc(FUNCTION_DOCS.uniform)}
declare function uniform<T>(slot?: number | { group?: number; binding?: number }, binding?: number): ReadView<T>
${renderJSDoc(FUNCTION_DOCS.storage)}
declare function storage<T, A extends StorageBufferAccess = 'read_write'>(slot?: number | { group?: number; binding?: number }, binding?: number): A extends 'read_write' ? T : ReadView<T>

/** Specialization constants (#8 A7). TRANSPARENT, which \`uniform<T>\` no longer is: an
 * override's value arrives when the pipeline is built and a function body reads it as a plain
 * value of its type, so there is nothing here to make read-only. A write to one is refused by
 * the compiler alone, \`TS8005 Cannot assign to "x" — it is an override constant, set by the
 * pipeline.\` */
type override<T> = T

declare const atomicTag: unique symbol
/** An atomic integer in storage memory (roadmap 0.2 item 4). Opaque, like a texture handle:
 * the value is reached only through \`atomicLoad\`, \`atomicStore\` and the read-modify-write
 * builtins, which is what the compiler enforces. It is declared inside a storage binding
 * (\`declare const bins: storage<array<atomic<u32>>, "read_write">\`), never as a local or a
 * parameter. An atomic is written through a call, so a read binding's atomic is refused by the
 * compiler and not by \`ReadView\`: the brand is a single symbol key, and the view of it is the
 * type itself. */
type atomic<T extends u32 | i32 = u32> = { readonly [atomicTag]: T }

/** Workgroup memory (roadmap 0.2 item 5, #82). \`let tile: workgroup<array<f32, 64>>\` is one
 * workgroup's shared memory, zero at the start of each workgroup and shared by its invocations.
 * TRANSPARENT, which \`storage<T>\` no longer is: workgroup memory is always read_write — WGSL
 * gives \`var<workgroup>\` no access mode to write — so the value type is \`T\` itself and a
 * write to it is clean, where \`storage<T>\` is the read view and \`storage<T, "read_write">\` is
 * the \`T\`. The other
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
/** Roadmap 0.4 item 12: a 1D texture is a row of texels addressed by ONE number, and a cube
 * array is N cube maps addressed by a direction and a layer. TypeShade emits no GLSL ES 3.00
 * form of either yet, so a module using one emits WGSL alone: not supported yet on WebGL2. */
type texture_1d<E extends TextureElem = f32> = { readonly [textureTag]: readonly [E, '1d'] }
type texture_cube_array<E extends TextureElem = f32> = { readonly [textureTag]: readonly [E, 'cube-array'] }
/** A multisampled colour texture (roadmap 0.4 item 13): read one sample at a time with
 * \`textureLoad(t, coords, sampleIndex)\`, never sampled. Not supported yet on the WebGL2 tier. */
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
/** The shadow maps of N point lights in one binding; not supported yet on the WebGL2 tier, like \`texture_cube_array\`. */
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
declare function bitcast<T extends u32 | f32 | vec2u | vec3u | vec4u | vec2 | vec3 | vec4>(e: BitcastArg<T>): T

${vecCtors}
${matCtorOverloads}

${scalarCasts}

${freeMath}

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
${renderJSDoc(FUNCTION_DOCS.structuredClone)}
declare function structuredClone<T>(value: T): T
${renderJSDoc(FUNCTION_DOCS.any)}
declare function any(v: bool | BoolVec): bool
${renderJSDoc(FUNCTION_DOCS.all)}
declare function all(v: bool | BoolVec): bool
${renderJSDoc(FUNCTION_DOCS.zip)}
declare function zip<A, B, R, N extends number>(
  xs: array<A, N>,
  ys: array<B, N>,
  f: (a: A, b: B) => R,
): array<R, N>
${renderJSDoc(FUNCTION_DOCS.min)}
declare function min<T extends Numeric>(xs: array<T>): T
${renderJSDoc(FUNCTION_DOCS.max)}
declare function max<T extends Numeric>(xs: array<T>): T
${renderJSDoc(FUNCTION_DOCS.atan2)}
declare function atan<T extends Numeric>(y: T, x: T): T
${renderJSDoc(FUNCTION_DOCS.bool)}
declare function bool(x: number | bool): bool
${renderJSDoc(CONSTANT_DOCS.discard)}
declare const discard: void

interface MathObject {
${mathMethods}
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
${renderJSDoc(ATTRIBUTE_TYPE_DOCS.builtin!)}
type builtin<N extends ${WGSL_BUILTIN_NAMES.map((n) => `'${n}'`).join(' | ')}, T = ${BUILTIN_VALUE_TYPE}, O extends { readonly invariant?: true } = {}> = T extends boolean ? T : T extends { readonly invariant?: true } ? ${BUILTIN_VALUE_TYPE} : T
${renderJSDoc(ATTRIBUTE_TYPE_DOCS.location!)}
type location<I extends number, T, O extends { readonly interpolate?: 'perspective' | 'linear' | 'flat' | readonly [type: 'perspective' | 'linear' | 'flat', sampling: 'center' | 'centroid' | 'sample' | 'first' | 'either']; readonly blend_src?: 0 | 1 } = {}> = T
${renderJSDoc(ATTRIBUTE_DOCS.vertex)}
declare function vertex(target: Function, context?: unknown): void
${renderJSDoc(ATTRIBUTE_DOCS.fragment)}
declare function fragment(target: Function, context?: unknown): void
${renderJSDoc(ATTRIBUTE_DOCS.compute)}
declare function compute(workgroupSize: readonly number[]): (target: Function, context?: unknown) => void
${renderJSDoc(ATTRIBUTE_DOCS.compute)}
declare function compute(target: Function, context?: unknown): void
${renderJSDoc(ATTRIBUTE_DOCS.workgroup_size)}
declare function workgroup_size(size: readonly [x: number]): (target: Function, context?: unknown) => void

${ARRAY_LIBRARY_DTS}
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

/**
 * The ambient library: the declarations above, with every SUPPORTED builtin row of Tint's
 * overload table generated in (`builtin-signatures.ts`, 0017). A name's generated overloads go
 * ahead of the first declaration the text above still has for it, each with the name's
 * documentation, so they are the ones TypeScript tries first. What still follows them by hand is
 * what the table has no row for yet: the `f64` family's overloads (§39), `mix`'s
 * vector-with-scalar-factor forms on the emulated doubles, and the generic fallbacks whose
 * diagnostics the tests pin.
 */
export const SHADE_DTS = withTypeDocs(withGeneratedBuiltins(HAND_WRITTEN_DTS));

function withGeneratedBuiltins(dts: string): string {
  const pending = new Map(GENERATED);
  const lines = dts.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const name = /^declare function (\w+)[<(]/.exec(line)?.[1];
    const overloads = name === undefined ? undefined : pending.get(name);
    if (name !== undefined && overloads !== undefined) {
      pending.delete(name);
      const doc = FUNCTION_DOCS[name];
      let at = out.length;
      if (out[at - 1]?.trimEnd().endsWith('*/')) {
        while (at > 0 && !out[at - 1]!.trimStart().startsWith('/**')) at--;
        at--;
      }
      out.splice(at, 0, ...overloads.flatMap((o) => [...(doc ? [renderJSDoc(doc)] : []), o]));
    }
    out.push(line);
  }
  if (pending.size > 0) {
    for (const [name, overloads] of pending) {
      const doc = FUNCTION_DOCS[name];
      for (const o of overloads) out.push(...(doc ? [renderJSDoc(doc)] : []), o);
    }
  }
  return out.join('\n');
}
