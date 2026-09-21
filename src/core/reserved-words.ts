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
])

// ═══ The two per-target sets: what an AUTHORED name may not be ═══
//
// `RESERVED_WORDS` above is the blocklist for identifiers the emit-prod passes INVENT, so it
// is one merged list of letters-only spellings. A name the AUTHOR wrote is a different
// question, and it has to be asked per target: the two languages reserve different words, a
// module emitted for one target should not be refused for the other's list (issue #103), and
// a diagnostic has to name the target that reserves the word. These two sets are that data,
// each taken from its own authority and each carrying every spelling the language reserves,
// underscores and digits included.

/** Every spelling WGSL refuses as an identifier: the 27 keywords of the spec's Keyword
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
])

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
])
