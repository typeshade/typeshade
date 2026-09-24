// ═══ The TypeShade overlay on Tint's overload table (0017) ═══
//
// `fixtures/coredef.json` is every overload Tint matches a call against. This file is what
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

/** The scalar types TypeShade has, which an instance of a row may bind a type parameter to. */
export const TYPESHADE_SCALARS = ['f32', 'i32', 'u32', 'bool'] as const;

/** Types in `core.def` that TypeShade has no spelling for. A row that names one outside a
 *  constraint, or whose constraint admits nothing TypeShade has, has no instance to claim. */
export const ABSENT_TYPES = ['f16', 'u16', 'u64', 'i8', 'u8', 'subgroup_matrix'] as const;

/** The rows whose instances are held to both halves. A family's pull request adds its rows. */
export const SUPPORTED: ReadonlySet<string> = new Set<string>([]);
