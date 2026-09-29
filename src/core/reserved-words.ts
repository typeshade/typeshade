// ═══ The two per-target sets: what an AUTHORED name may not be ═══
//
// A name the AUTHOR wrote has to be asked about per target: the two languages reserve
// different words, a module emitted for one target should not be refused for the other's list
// (issue #103), and a diagnostic has to name the target that reserves the word. These two sets
// are that data, each taken from its own authority and each carrying every spelling the
// language reserves, underscores and digits included. `RESERVED_WORDS` below, the blocklist
// for identifiers the emit-prod passes INVENT, is built from them, so the two questions can
// never be answered from two lists that have drifted apart.
//
// Implements: Rule 3.3 (docs/language-design.md; traced in reqs/).

/** Every spelling WGSL refuses as an identifier: the 26 keywords of the spec's Keyword
 *  Summary and the 146 tokens of its Reserved Words section, transcribed from the spec
 *  source (`wgsl/index.bs`, `wgsl.reserved.bs.include`). The spec's other two identifier
 *  rules — a bare `_`, and any name beginning with `__` — are shapes rather than spellings
 *  and are checked where this set is used. A predeclared name (`vec3f`, `f32`, `max`) is NOT
 *  here: WGSL lets a declaration shadow one. */
export const WGSL_RESERVED: ReadonlySet<string> = new Set([
  // Keywords (spec, Keyword Summary).
  ...`alias break case const const_assert continue continuing default diagnostic discard else
      enable false fn for if let loop override requires return struct switch true var while`.split(
    /\s+/,
  ),
  // Reserved Words (spec, Reserved Words), reserved for future use: a module containing one
  // is a shader-creation error, which is why Tint refuses `let as = …`.
  ...`NULL Self abstract active alignas alignof as asm asm_fragment async attribute auto await
      become cast catch class co_await co_return co_yield coherent column_major common compile
      compile_fragment concept const_cast consteval constexpr constinit crate debugger
      decltype delete demote demote_to_helper do dynamic_cast enum explicit export extends
      extern external fallthrough filter final finally friend from fxgroup get goto
      groupshared highp impl implements import inline instanceof interface layout lowp macro
      macro_rules match mediump meta mod module move mut mutable namespace new nil noexcept
      noinline nointerpolation non_coherent noncoherent noperspective null nullptr of operator
      package packoffset partition pass patch pixelfragment precise precision premerge priv
      protected pub public readonly ref regardless register reinterpret_cast require resource
      restrict self set shared sizeof smooth snorm static static_assert static_cast std
      subroutine super target template this thread_local throw trait try type typedef typeid
      typename typeof union unless unorm unsafe unsized use using varying virtual volatile
      wgsl where with writeonly yield`.split(/\s+/),
]);

/** Every spelling GLSL ES 3.00 refuses as an identifier, for the WebGL2 target: its keywords
 *  (§3.6) and type names (§3.7), plus the words it reserves for future use. Measured against
 *  the translator that receives this text — ANGLE's lexer (`src/compiler/translator/glslang.l`)
 *  decides each word BY SHADER VERSION, and this is the set it reports as a keyword or as
 *  `reserved_word` at version 300 with no extension enabled, which is what a WebGL2 context
 *  gives us. Two consequences of reading it from the version-gated source rather than from a
 *  later spec: `packed` is reserved in ES 1.00 and free in ES 3.00, and `buffer` and `shared`
 *  become keywords only in ES 3.10, so none of the three is here. */
export const GLSL_ES300_RESERVED: ReadonlySet<string> = new Set([
  // Keywords and the built-in type names, §3.6 and §3.7.
  ...`const uniform layout centroid flat smooth invariant precision highp mediump lowp
      break continue do for while switch case default if else in out inout
      float int uint void bool true false discard return struct
      mat2 mat3 mat4 mat2x2 mat2x3 mat2x4 mat3x2 mat3x3 mat3x4 mat4x2 mat4x3 mat4x4
      vec2 vec3 vec4 ivec2 ivec3 ivec4 bvec2 bvec3 bvec4 uvec2 uvec3 uvec4
      sampler2D sampler3D samplerCube sampler2DShadow samplerCubeShadow sampler2DArray
      sampler2DArrayShadow isampler2D isampler3D isamplerCube isampler2DArray usampler2D
      usampler3D usamplerCube usampler2DArray sampler2DRect sampler3DRect
      samplerExternalOES`.split(/\s+/),
  // Reserved for future use at version 300: ANGLE answers `reserved_word` for each of these,
  // so a shader carrying one is "Illegal use of reserved word" — the error issue #103 opened
  // with, for a struct field named `half`.
  ...`attribute varying resource subroutine common partition active filter
      asm class union enum typedef template this goto inline noinline public static extern
      external interface long short double half fixed unsigned superp input output
      hvec2 hvec3 hvec4 dvec2 dvec3 dvec4 fvec2 fvec3 fvec4 sizeof cast namespace using
      coherent restrict readonly writeonly volatile atomic_uint noperspective patch sample
      precise
      image1D image2D image3D imageCube image1DArray image2DArray imageBuffer imageCubeArray
      iimage1D iimage2D iimage3D iimageCube iimage1DArray iimage2DArray iimageBuffer
      iimageCubeArray uimage1D uimage2D uimage3D uimageCube uimage1DArray uimage2DArray
      uimageBuffer uimageCubeArray image1DShadow image2DShadow image1DArrayShadow
      image2DArrayShadow sampler1D sampler1DShadow sampler1DArray sampler1DArrayShadow
      sampler2DRectShadow isampler1D isampler1DArray isampler2DRect usampler1D
      usampler1DArray usampler2DRect sampler2DMS isampler2DMS usampler2DMS sampler2DMSArray
      isampler2DMSArray usampler2DMSArray samplerBuffer isamplerBuffer usamplerBuffer
      samplerCubeArray samplerCubeArrayShadow isamplerCubeArray usamplerCubeArray`.split(/\s+/),
]);

// ═══ The two per-target sets: what a DECLARED FUNCTION may not be named (change 0029) ═══
//
// A function the file declares wins over a builtin of its name (Rule 9.5), so a module can hold
// the author's `fract` and the compiler's own call of the builtin `fract`. Neither target lets it:
// WGSL hides a predeclared name for the whole module beside a declaration of it, and GLSL ES 3.00
// refuses a declaration of a built-in function's name outright. A writer therefore emits such a
// function under another name (`core/passes/rename-predeclared.ts`), and these two sets are the
// names it does that for. They are not reserved words, which nothing may be named
// (`GLSL_ES300_RESERVED` above): a declaration of one is legal, and is emitted differently.

/** Every name WGSL predeclares that a module-scope declaration would hide, read from the
 *  specification's "Predeclared Types and Type-Generators Summary" and "Predeclared enumerants"
 *  and its section on built-in functions: the built-in functions (`src/core/spec-conformance`
 *  holds the list to the baked names of the spec), the types and type-generators, the aliases
 *  of the vector and matrix types, and the enumerants the emitted text spells beside them, an
 *  access mode, an address space and a texel format. Measured on Tint, a declared `fract`
 *  hides the builtin, a declared `f32`, `array`, `atomic` or `vec3f` hides the type
 *  ("cyclic dependency", "does not take template arguments", "cannot use function as type"), and
 *  a declared `read`, `storage`, `workgroup` or `rgba8unorm` is refused where `var<storage,
 *  read>`, `var<workgroup>` and `texture_storage_2d<rgba8unorm, write>` name it ("cannot use
 *  function 'read' as access"). Not here: the built-in values (`position`) and the interpolation
 *  names (`flat`), which Tint reads as the attribute's own argument and a declaration of the
 *  same name leaves alone, measured. */
export const WGSL_PREDECLARED: ReadonlySet<string> = new Set([
  // Built-in functions, and the value constructors among them.
  ...`abs acos acosh all any array arrayLength asin asinh atan atan2 atanh atomicAdd
      atomicAnd atomicCompareExchangeWeak atomicExchange atomicLoad atomicMax atomicMin
      atomicOr atomicStore atomicStoreMax atomicStoreMin atomicSub atomicXor bitcast bool
      bufferArrayView bufferLength bufferView ceil clamp cos cosh countLeadingZeros
      countOneBits countTrailingZeros cross degrees determinant distance dot dot4I8Packed
      dot4U8Packed dpdx dpdxCoarse dpdxFine dpdy dpdyCoarse dpdyFine exp exp2 extractBits
      f16 f32 faceForward firstLeadingBit firstTrailingBit floor fma fract frexp fwidth
      fwidthCoarse fwidthFine i32 insertBits inverseSqrt ldexp length log log2 mat2x2 mat2x3
      mat2x4 mat3x2 mat3x3 mat3x4 mat4x2 mat4x3 mat4x4 max min mix modf normalize
      pack2x16float pack2x16snorm pack2x16unorm pack4x8snorm pack4x8unorm pack4xI8
      pack4xI8Clamp pack4xU8 pack4xU8Clamp pow quadBroadcast quadSwapDiagonal quadSwapX
      quadSwapY quantizeToF16 radians reflect refract reverseBits round saturate select sign
      sin sinh smoothstep sqrt step storageBarrier subgroupAdd subgroupAll subgroupAnd
      subgroupAny subgroupBallot subgroupBroadcast subgroupBroadcastFirst subgroupElect
      subgroupExclusiveAdd subgroupExclusiveMul subgroupInclusiveAdd subgroupInclusiveMul
      subgroupMax subgroupMin subgroupMul subgroupOr subgroupShuffle subgroupShuffleDown
      subgroupShuffleUp subgroupShuffleXor subgroupXor tan tanh textureBarrier
      textureDimensions textureGather textureGatherCompare textureLoad textureNumLayers
      textureNumLevels textureNumSamples textureSample textureSampleBaseClampToEdge
      textureSampleBias textureSampleCompare textureSampleCompareLevel textureSampleGrad
      textureSampleLevel textureStore transpose trunc u32 unpack2x16float unpack2x16snorm
      unpack2x16unorm unpack4x8snorm unpack4x8unorm unpack4xI8 unpack4xU8 vec2 vec3 vec4
      workgroupBarrier workgroupUniformLoad`.split(/\s+/),
  // The types and type-generators that are not also a built-in function.
  ...`atomic ptr sampler sampler_comparison texture_1d texture_2d texture_2d_array texture_3d
      texture_cube texture_cube_array texture_depth_2d texture_depth_2d_array
      texture_depth_cube texture_depth_cube_array texture_depth_multisampled_2d
      texture_external texture_multisampled_2d texture_storage_1d texture_storage_2d
      texture_storage_2d_array texture_storage_3d`.split(/\s+/),
  // The predeclared aliases: `vec3f`, `vec2u`, `vec4h`, `mat2x2f`, `mat4x3h`.
  ...[2, 3, 4].flatMap((n) => ['i', 'u', 'f', 'h'].map((t) => `vec${String(n)}${t}`)),
  ...[2, 3, 4].flatMap((c) =>
    [2, 3, 4].flatMap((r) => ['f', 'h'].map((t) => `mat${String(c)}x${String(r)}${t}`)),
  ),
  // The enumerants: the access modes, the address spaces and the texel formats.
  ...`read write read_write function private workgroup uniform storage`.split(/\s+/),
  ...`rgba8unorm rgba8snorm rgba8uint rgba8sint rgba16unorm rgba16snorm rgba16uint
      rgba16sint rgba16float rg8unorm rg8snorm rg8uint rg8sint rg16unorm rg16snorm rg16uint
      rg16sint rg16float r32uint r32sint r32float rg32uint rg32sint rg32float rgba32uint
      rgba32sint rgba32float bgra8unorm r8unorm r8snorm r8uint r8sint r16unorm r16snorm
      r16uint r16sint r16float rgb10a2unorm rgb10a2uint rg11b10ufloat`.split(/\s+/),
]);

/** Every built-in function of GLSL ES 3.00, the names of its section 8 (8.1 to 8.9). A program
 *  that declares a function under one is refused, measured on ANGLE: `'exp2' : Name of a built-in
 *  function cannot be redeclared as function`, for 83 of the 89 names whatever the parameters.
 *  ANGLE accepts a declaration of `mix`, `texture`, `textureLod`, `textureGrad`, `texelFetch` and
 *  `textureSize`, which nothing says another driver would, so the set is section 8 and not what
 *  the one translator refuses. */
export const GLSL_ES300_BUILTIN_FUNCTIONS: ReadonlySet<string> = new Set(
  `radians degrees sin cos tan asin acos atan sinh cosh tanh asinh acosh atanh
   pow exp log exp2 log2 sqrt inversesqrt
   abs sign floor trunc round roundEven ceil fract mod modf min max clamp mix step smoothstep
   isnan isinf floatBitsToInt floatBitsToUint intBitsToFloat uintBitsToFloat
   packSnorm2x16 unpackSnorm2x16 packUnorm2x16 unpackUnorm2x16 packHalf2x16 unpackHalf2x16
   length distance dot cross normalize faceforward reflect refract
   matrixCompMult outerProduct transpose determinant inverse
   lessThan lessThanEqual greaterThan greaterThanEqual equal notEqual any all not
   texture textureProj textureLod textureOffset texelFetch texelFetchOffset textureProjOffset
   textureLodOffset textureProjLod textureProjLodOffset textureGrad textureGradOffset
   textureProjGrad textureProjGradOffset textureSize dFdx dFdy fwidth`.split(/\s+/),
);

// ═══ Shader DSL — reserved-word vocabulary for GENERATED identifiers ═══
//
// Every emit-prod pass that INVENTS a short identifier — `mangle`'s local/helper
// pool and `emit-alias`'s type aliases — walks the same bijective base-52
// sequence (`a, b, … Z, aa, ab, …`) and so can land on a spelling the target
// language owns. One shared blocklist, because two lists drift: `mangle` had the
// keywords but not WGSL's separate FUTURE-keyword list, and `emit-alias` derived
// its blocklist from the words the emitted TEXT happens to contain — so both
// independently handed out `as`, which Tint rejects (X-GIS #1861).
//
// Contents: both languages' keywords, the type/qualifier vocabulary the BACKENDS
// write textually (`vec2`, `float`, `layout`, `precision` — none of it appears in
// the IR, so an identifier sweep cannot see it), and both reserved-word lists.
// Only letters-only spellings can ever be generated, so `_`- and digit-bearing
// entries are deliberately absent. Everything that DOES appear in the IR
// (intrinsic call targets, binding names, struct fields, overrides) is collected
// from the module by each caller instead — this list only has to cover the
// textual half.

/** Spellings a GENERATED identifier must never take. See the module header. */
export const RESERVED_WORDS: ReadonlySet<string> = new Set([
  // Both targets' own vocabularies, so a generated name can never take a spelling an AUTHORED
  // one is refused for. The two lists drifted before this: `with` is a WGSL reserved word that
  // this list did not have, and the generator reaches a 4-letter name easily — `mangle` handed
  // out `as` at the ~70th name, which is what X-GIS #1861 was.
  ...WGSL_RESERVED,
  ...GLSL_ES300_RESERVED,
  // WGSL
  'alias',
  'break',
  'case',
  'const',
  'const_assert',
  'continue',
  'continuing',
  'default',
  'diagnostic',
  'discard',
  'else',
  'enable',
  'false',
  'fn',
  'for',
  'if',
  'let',
  'loop',
  'override',
  'requires',
  'return',
  'struct',
  'switch',
  'true',
  'var',
  'while',
  // GLSL ES 3.00
  'attribute',
  'centroid',
  'coherent',
  'do',
  'flat',
  'highp',
  'in',
  'inout',
  'invariant',
  'layout',
  'lowp',
  'main',
  'mediump',
  'noperspective',
  'out',
  'precision',
  'readonly',
  'restrict',
  'smooth',
  'uniform',
  'varying',
  'void',
  'volatile',
  'writeonly',
  // scalar / vector / matrix / opaque types, both languages
  'bool',
  'f16',
  'f32',
  'float',
  'i32',
  'int',
  'u32',
  'uint',
  'half',
  'double',
  'atomic',
  'array',
  'ptr',
  'ref',
  'texture',
  // sampler types, GLSL ES 3.00 §3.7 — the same completion as glsl-sanitize's set
  // (X-GIS #1703): the float 2D/3D/Cube trio was ES-1.00-era and left every array/integer
  // sampler spelling absent.
  'sampler',
  'sampler2D',
  'sampler3D',
  'samplerCube',
  'sampler2DShadow',
  'samplerCubeShadow',
  'sampler2DArray',
  'sampler2DArrayShadow',
  'isampler2D',
  'isampler3D',
  'isamplerCube',
  'isampler2DArray',
  'usampler2D',
  'usampler3D',
  'usamplerCube',
  'usampler2DArray',
  'vec2',
  'vec3',
  'vec4',
  'bvec2',
  'bvec3',
  'bvec4',
  'ivec2',
  'ivec3',
  'ivec4',
  'uvec2',
  'uvec3',
  'uvec4',
  'mat2',
  'mat3',
  'mat4',
  'mat2x2',
  'mat2x3',
  'mat2x4',
  'mat3x2',
  'mat3x3',
  'mat3x4',
  'mat4x2',
  'mat4x3',
  'mat4x4',
  // ── the FUTURE-keyword lists (X-GIS #1861) ──
  // Both languages reserve a second, much longer vocabulary ALONGSIDE their
  // keywords — WGSL's "Reserved Words" section, GLSL ES 3.00's §3.6 list. `as`
  // is on WGSL's; `nthName` reaches it at the ~70th name in a scope, and Tint
  // rejects `let as = …`. Since the generator emits `[a-zA-Z]+`, EVERY
  // letters-only spelling on those lists is reachable and all of them belong
  // here — a partial list is exactly what failed. Kept as split text rather
  // than one entry per line: this is spec data, and it would otherwise triple
  // the file. Duplicates of the keywords above are harmless (this is a Set).
  ...`NULL Self abstract active alignas alignof as asm async auto await become buffer
      cast catch class common compile concept consteval constexpr constinit crate debugger
      decltype delete demote dvec2 dvec3 dvec4 enum explicit export extends extern external
      fallthrough filter final finally fixed friend from fvec2 fvec3 fvec4 fxgroup get goto
      groupshared hvec2 hvec3 hvec4 impl implements import inline input instanceof interface
      long macro match meta mod module move mut mutable namespace new nil noexcept noinline
      nointerpolation noncoherent null nullptr of operator output package packed packoffset
      partition pass patch pixelfragment precise premerge priv protected pub public
      regardless register require resource sample self set shared short sizeof snorm static
      std subroutine super superp target tempate template this throw trait try type typedef
      typeid typename typeof union unless unorm unsafe unsigned unsized use using virtual
      wgsl where yield`.split(/\s+/),
]);
