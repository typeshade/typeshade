// ═══ The TypeShade overlay on Tint's overload table (0017) ═══
//
// `coredef.ts` is every overload Tint matches a call against. This file is what
// TypeShade says about each one: the family whose pull request will take the row over, or why
// the row is refused. `coredef-overloads.test.ts` holds every row to exactly one claim, and a
// row a re-bake adds with a name nothing here knows fails there until someone decides.
//
// A row is claimed in this order:
//
//   REFUSED    it names a type TypeShade does not have, in every instance (`f16`, `u16`, …), or
//              it is not WGSL at all: Dawn's own internal and experimental functions, which
//              `core.def` carries beside the language's.
//   SUPPORTED  its instances are held to the compiler and the editor on the same witness.
//              A family's pull request moves its rows here, and deletes that family's
//              hand-written copies (0017, "The work lands in pull requests of one family each").
//   DEFERRED   to the family that will take it over, or, for an extension TypeShade does not
//              spell yet, with the reason.

import type { CoreDefRow } from './coredef-types.js';
import { rowTypes } from './row-types.js';

/** The pull requests of 0017, in the order they land. */
export type Family =
  | 'math'
  | 'derivatives, bits and packing'
  | 'atomics, barriers and arrayLength'
  | 'textures'
  | 'constructors and conversions'
  | 'operators';

const MATH = [
  'abs',
  'acos',
  'acosh',
  'all',
  'any',
  'asin',
  'asinh',
  'atan',
  'atan2',
  'atanh',
  'ceil',
  'clamp',
  'cos',
  'cosh',
  'cross',
  'degrees',
  'determinant',
  'distance',
  'dot',
  'exp',
  'exp2',
  'faceForward',
  'floor',
  'fma',
  'fract',
  'frexp',
  'inverseSqrt',
  'ldexp',
  'length',
  'log',
  'log2',
  'max',
  'min',
  'mix',
  'modf',
  'normalize',
  'pow',
  'radians',
  'reflect',
  'refract',
  'round',
  'saturate',
  'select',
  'sign',
  'sin',
  'sinh',
  'smoothstep',
  'sqrt',
  'step',
  'tan',
  'tanh',
  'transpose',
  'trunc',
];
const DERIVATIVES_BITS_PACKING = [
  'bitcast',
  'countLeadingZeros',
  'countOneBits',
  'countTrailingZeros',
  'dot4I8Packed',
  'dot4U8Packed',
  'dpdx',
  'dpdxCoarse',
  'dpdxFine',
  'dpdy',
  'dpdyCoarse',
  'dpdyFine',
  'extractBits',
  'firstLeadingBit',
  'firstTrailingBit',
  'fwidth',
  'fwidthCoarse',
  'fwidthFine',
  'insertBits',
  'pack2x16float',
  'pack2x16snorm',
  'pack2x16unorm',
  'pack4x8snorm',
  'pack4x8unorm',
  'pack4xI8',
  'pack4xI8Clamp',
  'pack4xU8',
  'pack4xU8Clamp',
  'quantizeToF16',
  'reverseBits',
  'unpack2x16float',
  'unpack2x16snorm',
  'unpack2x16unorm',
  'unpack4x8snorm',
  'unpack4x8unorm',
  'unpack4xI8',
  'unpack4xU8',
];
const ATOMICS_BARRIERS = [
  'arrayLength',
  'atomicAdd',
  'atomicAnd',
  'atomicCompareExchangeWeak',
  'atomicExchange',
  'atomicLoad',
  'atomicMax',
  'atomicMin',
  'atomicOr',
  'atomicStore',
  'atomicSub',
  'atomicXor',
  'storageBarrier',
  'textureBarrier',
  'workgroupBarrier',
];

/** The family of a builtin function, by name. A `texture*` function is the texture suite's. */
export function familyOf(kind: string, name: string): Family | undefined {
  if (kind === 'ctor' || kind === 'conv') return 'constructors and conversions';
  if (kind === 'op') return 'operators';
  if (MATH.includes(name)) return 'math';
  if (DERIVATIVES_BITS_PACKING.includes(name)) return 'derivatives, bits and packing';
  if (ATOMICS_BARRIERS.includes(name)) return 'atomics, barriers and arrayLength';
  if (name.startsWith('texture')) return 'textures';
  return undefined;
}

/** Functions `core.def` carries that are not WGSL: Dawn's internal and experimental builtins,
 *  which no WGSL program can call and so no TypeShade program can either. */
export const NOT_WGSL: Readonly<Record<string, string>> = {
  addSat: 'a Dawn-internal saturating add, not a WGSL builtin',
  mulSat: 'a Dawn-internal saturating multiply, not a WGSL builtin',
  atomicStoreMax: 'a Dawn-internal atomic, not a WGSL builtin',
  atomicStoreMin: 'a Dawn-internal atomic, not a WGSL builtin',
  bufferArrayView: "Dawn's experimental buffer views, not WGSL",
  bufferLength: "Dawn's experimental buffer views, not WGSL",
  bufferView: "Dawn's experimental buffer views, not WGSL",
  getResource: "Dawn's experimental resource tables, not WGSL",
  hasResource: "Dawn's experimental resource tables, not WGSL",
  inputAttachmentLoad: "Dawn's experimental framebuffer fetch, not WGSL",
  print: "Dawn's experimental shader printf, not WGSL",
};

/** An extension WGSL has and TypeShade does not spell yet: its functions wait on it. */
export function extensionOf(name: string): string | undefined {
  if (name.startsWith('subgroupMatrix') || name.startsWith('subgroup_matrix'))
    return "Dawn's experimental subgroup matrices, outside the WGSL surface this package targets";
  if (name.startsWith('subgroup') || name.startsWith('quad'))
    return 'the `subgroups` extension: surface §50 spells its built-in values, and no issue asks for its functions yet';
  return undefined;
}

/** Types in `core.def` that TypeShade has no spelling for. A row that names one outside a
 *  constraint, or whose constraint admits nothing TypeShade has, has no instance to claim. */
export const ABSENT_TYPES = ['f16', 'u16', 'u64', 'i8', 'u8', 'subgroup_matrix'] as const;

/** The families whose rows are SUPPORTED: generated into the editor's declarations and held
 *  to both halves. A family's pull request adds itself here. Within a supported family, a row
 *  whose types `row-types.ts` has no form for yet (a matrix, a result struct) stays DEFERRED
 *  to it, and the pull request that adds the form claims the row. */
export const SUPPORTED_FAMILIES: ReadonlySet<Family> = new Set<Family>([
  'math',
  'derivatives, bits and packing',
  'atomics, barriers and arrayLength',
]);

/** Why a row has no instance TypeShade can spell, or undefined when it has one. */
function absentType(
  row: CoreDefRow,
  matchers: Readonly<Record<string, readonly string[]>>,
): string | undefined {
  const named = [...row.params.map((p) => p.type), row.ret].join(' ');
  for (const t of ABSENT_TYPES) {
    // A type written outside any constraint is one every instance needs.
    if (new RegExp(`\\b${t}\\b`).test(named)) return `every instance takes or returns \`${t}\``;
  }
  for (const [param, constraint] of Object.entries(row.implicit)) {
    const domain = matchers[constraint];
    if (domain === undefined) continue;
    const kept = domain.filter((d) => !ABSENT_TYPES.some((a) => d === a || d.startsWith(`${a}<`)));
    if (kept.length === 0) return `\`${param}: ${constraint}\` admits only types TypeShade lacks`;
  }
  return undefined;
}

/** What TypeShade says about one row. */
export type Claim =
  | { readonly status: 'REFUSED'; readonly reason: string }
  | { readonly status: 'SUPPORTED' }
  | { readonly status: 'DEFERRED'; readonly to: Family | 'an extension'; readonly reason?: string };

/** The claim on `row`, or undefined for a row nothing here knows (a re-bake's new name). */
export function claimOf(
  row: CoreDefRow,
  matchers: Readonly<Record<string, readonly string[]>>,
): Claim | undefined {
  const notWgsl = row.kind === 'fn' ? NOT_WGSL[row.name] : undefined;
  if (notWgsl !== undefined) return { status: 'REFUSED', reason: notWgsl };
  const absent = absentType(row, matchers);
  if (absent !== undefined) return { status: 'REFUSED', reason: absent };
  const extension = row.kind === 'fn' ? extensionOf(row.name) : undefined;
  if (extension !== undefined) return { status: 'DEFERRED', to: 'an extension', reason: extension };
  const family = familyOf(row.kind, row.name);
  if (family === undefined) return undefined;
  if (SUPPORTED_FAMILIES.has(family) && rowTypes(row) !== undefined) return { status: 'SUPPORTED' };
  return { status: 'DEFERRED', to: family };
}
