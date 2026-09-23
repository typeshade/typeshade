// === GLSL and HLSL names, and what TypeShade calls the same thing (#218) ===
//
// A model writing a shader reaches first for the names it has read most, which are GLSL's and
// HLSL's, and so does an author coming from those languages. The compiler refuses such a name,
// and that is right: under Rule 2.1 an author-facing name comes from WGSL, from ECMAScript or
// from the table of §9.3, and `lerp` is none of the three, and Rule 9.6 keeps §9.3 shrink-only.
// An alias would also be wrong where the meanings differ: GLSL's `mod` floors where HLSL's
// `fmod` and WGSL's `%` truncate, and a wrong alias compiles in silence. But a refusal's second
// sentence is its remedy (Rule 12.1), and for `lerp` the remedy is `mix`, not "declare it in
// this file". This table is what the refusals name.
//
// ONE TABLE. It began as the MCP server's (typeshade/vscode-typeshade,
// `packages/mcp-server/src/vocabulary.ts`), whose `from`, `name` and `note` are carried here
// unchanged; the language service exports it beside the ambient library, so the compiler, the
// editor and that server read the same rows (Rule 12.7). `kind` and `io` are what a refusal
// needs to phrase a row: a built-in value is a parameter or a return field, not a name to call.
//
// Two invariants, held by `foreign-names.test.ts` against the ambient library: every target is
// a name TypeShade has, and no source is one. So a name TypeShade itself declares (`mod`,
// `saturate`, `clamp`) can never enter the table, and a refusal can never send an author to a
// name that fails in turn.

import { WGSL_BUILTIN_TYPES } from '../../core/sot.js';
import type { ShaderType } from '../../core/ir/types.js';

/** A name from another shading language, and what TypeShade calls the same thing.
 *
 *  Exported from `typeshade/language-service`. */
export interface ForeignName {
  /** The language the name comes from. */
  readonly from: 'GLSL' | 'HLSL' | 'GLSL and HLSL';
  /** The TypeShade name for the same thing, when there is one: a function, a type, an
   *  attribute (without its `@`), an address space, or a `@builtin` id. */
  readonly name?: string;
  /** What to write instead, when it is not one name (an operator, a statement), in Markdown. */
  readonly note?: string;
  /** What `name` or `note` is. */
  readonly kind:
    'function' | 'type' | 'attribute' | 'address space' | 'builtin' | 'operator' | 'statement';
  /** For a built-in value, whether an entry reads it (a parameter), writes it (a field of the
   *  entry's return), or either, as the foreign name means it: GLSL's `gl_Position` is the
   *  vertex output and its `gl_FragCoord` the fragment input, both `@builtin("position")`. */
  readonly io?: 'input' | 'output' | 'either';
}

/** Names a model is likely to bring from GLSL or HLSL, for things TypeShade spells otherwise.
 *  Only names TypeShade does not itself have are listed; a name both languages share with
 *  TypeShade (`clamp`, `smoothstep`, `saturate`) is not foreign.
 *
 *  Exported from `typeshade/language-service`. */
export const FOREIGN_NAMES: Readonly<Record<string, ForeignName>> = {
  lerp: { from: 'HLSL', name: 'mix', kind: 'function' },
  frac: { from: 'HLSL', name: 'fract', kind: 'function' },
  rsqrt: { from: 'HLSL', name: 'inverseSqrt', kind: 'function' },
  inversesqrt: { from: 'GLSL', name: 'inverseSqrt', kind: 'function' },
  ddx: { from: 'HLSL', name: 'dpdx', kind: 'function' },
  ddy: { from: 'HLSL', name: 'dpdy', kind: 'function' },
  dFdx: { from: 'GLSL', name: 'dpdx', kind: 'function' },
  dFdy: { from: 'GLSL', name: 'dpdy', kind: 'function' },
  fmod: {
    from: 'HLSL',
    note: 'the `%` operator, which truncates like `fmod`; `mod()` floors',
    kind: 'operator',
  },
  mul: {
    from: 'HLSL',
    note: 'the `*` operator: `m * v` is a matrix-vector product',
    kind: 'operator',
  },
  clip: { from: 'HLSL', note: '`if (x < 0.) { discard }` in a fragment entry', kind: 'statement' },
  texture: { from: 'GLSL', name: 'textureSample', kind: 'function' },
  texture2D: { from: 'GLSL', name: 'textureSample', kind: 'function' },
  textureLod: { from: 'GLSL', name: 'textureSampleLevel', kind: 'function' },
  textureGrad: { from: 'GLSL', name: 'textureSampleGrad', kind: 'function' },
  texelFetch: { from: 'GLSL', name: 'textureLoad', kind: 'function' },
  textureSize: { from: 'GLSL', name: 'textureDimensions', kind: 'function' },
  imageLoad: { from: 'GLSL', name: 'textureLoad', kind: 'function' },
  imageStore: { from: 'GLSL', name: 'textureStore', kind: 'function' },
  bitCount: { from: 'GLSL', name: 'countOneBits', kind: 'function' },
  countbits: { from: 'HLSL', name: 'countOneBits', kind: 'function' },
  bitfieldReverse: { from: 'GLSL', name: 'reverseBits', kind: 'function' },
  reversebits: { from: 'HLSL', name: 'reverseBits', kind: 'function' },
  bitfieldExtract: { from: 'GLSL', name: 'extractBits', kind: 'function' },
  bitfieldInsert: { from: 'GLSL', name: 'insertBits', kind: 'function' },
  findMSB: { from: 'GLSL', name: 'firstLeadingBit', kind: 'function' },
  firstbithigh: { from: 'HLSL', name: 'firstLeadingBit', kind: 'function' },
  findLSB: { from: 'GLSL', name: 'firstTrailingBit', kind: 'function' },
  firstbitlow: { from: 'HLSL', name: 'firstTrailingBit', kind: 'function' },
  floatBitsToUint: { from: 'GLSL', name: 'bitcast', kind: 'function' },
  floatBitsToInt: { from: 'GLSL', name: 'bitcast', kind: 'function' },
  uintBitsToFloat: { from: 'GLSL', name: 'bitcast', kind: 'function' },
  intBitsToFloat: { from: 'GLSL', name: 'bitcast', kind: 'function' },
  asuint: { from: 'HLSL', name: 'bitcast', kind: 'function' },
  asfloat: { from: 'HLSL', name: 'bitcast', kind: 'function' },
  packUnorm4x8: { from: 'GLSL', name: 'pack4x8unorm', kind: 'function' },
  packSnorm4x8: { from: 'GLSL', name: 'pack4x8snorm', kind: 'function' },
  unpackUnorm4x8: { from: 'GLSL', name: 'unpack4x8unorm', kind: 'function' },
  unpackSnorm4x8: { from: 'GLSL', name: 'unpack4x8snorm', kind: 'function' },
  packHalf2x16: { from: 'GLSL', name: 'pack2x16float', kind: 'function' },
  unpackHalf2x16: { from: 'GLSL', name: 'unpack2x16float', kind: 'function' },
  packUnorm2x16: { from: 'GLSL', name: 'pack2x16unorm', kind: 'function' },
  unpackUnorm2x16: { from: 'GLSL', name: 'unpack2x16unorm', kind: 'function' },
  packSnorm2x16: { from: 'GLSL', name: 'pack2x16snorm', kind: 'function' },
  unpackSnorm2x16: { from: 'GLSL', name: 'unpack2x16snorm', kind: 'function' },
  barrier: { from: 'GLSL', name: 'workgroupBarrier', kind: 'function' },
  GroupMemoryBarrierWithGroupSync: { from: 'HLSL', name: 'workgroupBarrier', kind: 'function' },
  atomicCompSwap: { from: 'GLSL', name: 'atomicCompareExchangeWeak', kind: 'function' },
  InterlockedAdd: { from: 'HLSL', name: 'atomicAdd', kind: 'function' },
  InterlockedMin: { from: 'HLSL', name: 'atomicMin', kind: 'function' },
  InterlockedMax: { from: 'HLSL', name: 'atomicMax', kind: 'function' },
  InterlockedAnd: { from: 'HLSL', name: 'atomicAnd', kind: 'function' },
  InterlockedOr: { from: 'HLSL', name: 'atomicOr', kind: 'function' },
  InterlockedXor: { from: 'HLSL', name: 'atomicXor', kind: 'function' },
  InterlockedExchange: { from: 'HLSL', name: 'atomicExchange', kind: 'function' },
  float: { from: 'GLSL and HLSL', name: 'f32', kind: 'type' },
  int: { from: 'GLSL and HLSL', name: 'i32', kind: 'type' },
  uint: { from: 'GLSL and HLSL', name: 'u32', kind: 'type' },
  double: { from: 'GLSL and HLSL', name: 'f64', kind: 'type' },
  float2: { from: 'HLSL', name: 'vec2', kind: 'type' },
  float3: { from: 'HLSL', name: 'vec3', kind: 'type' },
  float4: { from: 'HLSL', name: 'vec4', kind: 'type' },
  int2: { from: 'HLSL', name: 'vec2i', kind: 'type' },
  int3: { from: 'HLSL', name: 'vec3i', kind: 'type' },
  int4: { from: 'HLSL', name: 'vec4i', kind: 'type' },
  uint2: { from: 'HLSL', name: 'vec2u', kind: 'type' },
  uint3: { from: 'HLSL', name: 'vec3u', kind: 'type' },
  uint4: { from: 'HLSL', name: 'vec4u', kind: 'type' },
  ivec2: { from: 'GLSL', name: 'vec2i', kind: 'type' },
  ivec3: { from: 'GLSL', name: 'vec3i', kind: 'type' },
  ivec4: { from: 'GLSL', name: 'vec4i', kind: 'type' },
  uvec2: { from: 'GLSL', name: 'vec2u', kind: 'type' },
  uvec3: { from: 'GLSL', name: 'vec3u', kind: 'type' },
  uvec4: { from: 'GLSL', name: 'vec4u', kind: 'type' },
  bvec2: { from: 'GLSL', name: 'vec2b', kind: 'type' },
  bvec3: { from: 'GLSL', name: 'vec3b', kind: 'type' },
  bvec4: { from: 'GLSL', name: 'vec4b', kind: 'type' },
  dvec2: { from: 'GLSL', name: 'vec2f64', kind: 'type' },
  dvec3: { from: 'GLSL', name: 'vec3f64', kind: 'type' },
  dvec4: { from: 'GLSL', name: 'vec4f64', kind: 'type' },
  float4x4: { from: 'HLSL', name: 'mat4x4', kind: 'type' },
  groupshared: { from: 'HLSL', name: 'workgroup', kind: 'address space' },
  shared: { from: 'GLSL', name: 'workgroup', kind: 'address space' },
  numthreads: { from: 'HLSL', name: 'compute', kind: 'attribute' },
  local_size_x: { from: 'GLSL', name: 'compute', kind: 'attribute' },
  SV_Target: { from: 'HLSL', name: 'location', kind: 'attribute' },
  gl_Position: { from: 'GLSL', name: 'position', kind: 'builtin', io: 'output' },
  gl_FragCoord: { from: 'GLSL', name: 'position', kind: 'builtin', io: 'input' },
  SV_Position: { from: 'HLSL', name: 'position', kind: 'builtin', io: 'either' },
  gl_VertexID: { from: 'GLSL', name: 'vertex_index', kind: 'builtin', io: 'input' },
  gl_VertexIndex: { from: 'GLSL', name: 'vertex_index', kind: 'builtin', io: 'input' },
  SV_VertexID: { from: 'HLSL', name: 'vertex_index', kind: 'builtin', io: 'input' },
  gl_InstanceID: { from: 'GLSL', name: 'instance_index', kind: 'builtin', io: 'input' },
  gl_InstanceIndex: { from: 'GLSL', name: 'instance_index', kind: 'builtin', io: 'input' },
  SV_InstanceID: { from: 'HLSL', name: 'instance_index', kind: 'builtin', io: 'input' },
  gl_FrontFacing: { from: 'GLSL', name: 'front_facing', kind: 'builtin', io: 'input' },
  SV_IsFrontFace: { from: 'HLSL', name: 'front_facing', kind: 'builtin', io: 'input' },
  gl_FragDepth: { from: 'GLSL', name: 'frag_depth', kind: 'builtin', io: 'output' },
  SV_Depth: { from: 'HLSL', name: 'frag_depth', kind: 'builtin', io: 'output' },
  gl_SampleID: { from: 'GLSL', name: 'sample_index', kind: 'builtin', io: 'input' },
  SV_SampleIndex: { from: 'HLSL', name: 'sample_index', kind: 'builtin', io: 'input' },
  gl_SampleMaskIn: { from: 'GLSL', name: 'sample_mask', kind: 'builtin', io: 'input' },
  SV_Coverage: { from: 'HLSL', name: 'sample_mask', kind: 'builtin', io: 'either' },
  gl_GlobalInvocationID: {
    from: 'GLSL',
    name: 'global_invocation_id',
    kind: 'builtin',
    io: 'input',
  },
  SV_DispatchThreadID: { from: 'HLSL', name: 'global_invocation_id', kind: 'builtin', io: 'input' },
  gl_LocalInvocationID: { from: 'GLSL', name: 'local_invocation_id', kind: 'builtin', io: 'input' },
  SV_GroupThreadID: { from: 'HLSL', name: 'local_invocation_id', kind: 'builtin', io: 'input' },
  gl_LocalInvocationIndex: {
    from: 'GLSL',
    name: 'local_invocation_index',
    kind: 'builtin',
    io: 'input',
  },
  SV_GroupIndex: { from: 'HLSL', name: 'local_invocation_index', kind: 'builtin', io: 'input' },
  gl_WorkGroupID: { from: 'GLSL', name: 'workgroup_id', kind: 'builtin', io: 'input' },
  SV_GroupID: { from: 'HLSL', name: 'workgroup_id', kind: 'builtin', io: 'input' },
  gl_NumWorkGroups: { from: 'GLSL', name: 'num_workgroups', kind: 'builtin', io: 'input' },
};

/** The spelling an author writes for the type a built-in value has. */
function spelled(type: ShaderType): string {
  if (type.kind === 'scalar') return type.scalar;
  if (type.kind === 'vec') {
    const suffix = { f32: '', i32: 'i', u32: 'u', bool: 'b' }[type.elem];
    return `vec${String(type.n)}${suffix}`;
  }
  return type.kind;
}

/** The parameter or field name a remedy writes for a built-in value: `pos` for the position,
 *  as the surface's own examples name it, and the id in camel case otherwise. */
const paramName = (id: string): string =>
  id === 'position' ? 'pos' : id.replace(/_(\w)/g, (_, c: string) => c.toUpperCase());

/** `GLSL's`, `HLSL's`, or both. */
const possessive = (from: ForeignName['from']): string =>
  from === 'GLSL and HLSL' ? "GLSL's and HLSL's" : `${from}'s`;

/**
 * The sentence a refusal of `name` gives as its remedy when `name` is a GLSL or HLSL name
 * (`FOREIGN_NAMES`): `HLSL's lerp is mix here.`, `GLSL's gl_FragCoord is a parameter here:
 * @builtin("position") pos: vec4.` `undefined` for any other name, whose refusal keeps the
 * remedy it had. A name the file declares never reaches a refusal, so a helper the author
 * named `lerp` still wins (Rule 9.5).
 */
export function foreignNameRemedy(name: string): string | undefined {
  if (!Object.hasOwn(FOREIGN_NAMES, name)) return undefined;
  const row = FOREIGN_NAMES[name]!;
  const whose = `${possessive(row.from)} ${name}`;
  if (row.name === undefined) {
    // A note is Markdown for the MCP server; a diagnostic is plain text.
    return `${whose} is ${(row.note ?? '').replace(/`/g, '')}.`;
  }
  switch (row.kind) {
    case 'attribute':
      return `${whose} is @${row.name} here.`;
    case 'address space':
      return `${whose} is the ${row.name} address space here: let x: ${row.name}<T>.`;
    case 'builtin': {
      const type = WGSL_BUILTIN_TYPES[row.name as keyof typeof WGSL_BUILTIN_TYPES] as
        ShaderType | undefined;
      const declaration = `@builtin("${row.name}") ${paramName(row.name)}: ${type === undefined ? '…' : spelled(type)}`;
      const where =
        row.io === 'output'
          ? "a field of the entry's return"
          : row.io === 'either'
            ? "a parameter, or a field of the entry's return"
            : 'a parameter';
      return `${whose} is ${where} here: ${declaration}.`;
    }
    default:
      return `${whose} is ${row.name} here.`;
  }
}

/** `sentence` with `name`'s foreign-name remedy after it, when `name` has one: the shape of a
 *  refusal whose first sentence already names the mistake and has no second of its own. */
export function withForeignRemedy(sentence: string, name: string): string {
  const remedy = foreignNameRemedy(name);
  return remedy === undefined ? sentence : `${sentence} ${remedy}`;
}
