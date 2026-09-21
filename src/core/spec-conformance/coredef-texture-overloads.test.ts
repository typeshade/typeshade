// ═══ S1 — every `core.def` texture overload is CLAIMED ═══
//
// WHAT THIS CLOSES. A texture feature arrives in layers: a type spelling, an argument check,
// a stage rule, an emit, an ambient declaration, a CPU stub. Nothing forced them to arrive
// TOGETHER, so the spec audit of 2026-09-21 (#144) found six classes of program that this
// front end accepts and Tint refuses, every one of them a layer that was skipped. Case tests
// cannot close that: a case test is written for the row someone remembered.
//
// This suite reads Tint's OWN overload table — `fixtures/coredef-textures.json`, baked from
// `core.def` by `scripts/bake-coredef-textures.ts` — and forces every row to be claimed as
// exactly one of:
//
//   SUPPORTED   a `"use typeshade"` witness, synthesised from the row's own parameter list,
//               that compiles with no error and whose WGSL contains the call.
//   DEFERRED    an entry in the table below, with a reason and the issue or the recorded
//               deferral that owns it.
//
// A row that is in neither FAILS. That is the whole mechanism: a new overload in Tint's table,
// or a re-bake of the fixture, cannot land without someone deciding which column it is in.
//
// WHY TINT'S TABLE AND NOT THE SPEC PROSE. `core.def` is what Chromium matches a call against,
// so an overload missing here is a program Tint refuses. It also carries `@stage(...)` — the
// rule the spec states in prose and this package has to reproduce in two hand-written sets
// (`lower/function.ts`, the `fragment-only-builtin` lint). `stage-rules.test.ts` is the arm
// that compares those sets; this file pins the per-row half: a fragment-only overload's own
// witness must be refused from a vertex entry.
//
// THE DEFERRED TABLE IS SHRINK-ONLY, and not by a count: every deferred row that CAN be
// spelled is compiled here, and one that has quietly started to work must lose its entry
// (`a DEFERRED row the compiler has since learned`). So the table cannot rot into a list of
// things that were true once.
// SPEC CITATIONS. `wgsl.txt:N` and `glsl-es-300.txt:N` are the audit's own coordinates — the
// line in the W3C WGSL and Khronos GLSL ES 3.00 spec TEXTS as #144 read them, not files in
// this repository. They are kept verbatim so a row here can be matched against the issue
// that filed it; `core.def:N` is Tint's intrinsic table, of which
// `src/core/spec-conformance/fixtures/` holds the checked-in texture and stage slices.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compile } from '../../compiler/ts/compile.js'

/** One `fn texture*` overload of `core.def`, as `scripts/bake-coredef-textures.ts` writes it. */
interface CoreDefRow {
  readonly fn: string
  /** `@stage(...)`; empty means the overload is legal in every entry stage. */
  readonly stages: readonly string[]
  /** `implicit(A: iu32)` — the row's type parameters and what each ranges over. */
  readonly implicit: Readonly<Record<string, string>>
  readonly params: readonly { readonly name: string; readonly type: string }[]
  readonly ret: string
  /** The row key every claim below is written against. */
  readonly signature: string
}

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'coredef-textures.json')
const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
  readonly source: string
  readonly sha256: string
  readonly rows: readonly CoreDefRow[]
}
const ROWS = fixture.rows

// ─────────────────────────────────────────────────────────────────────────────
// The witness synthesiser
// ─────────────────────────────────────────────────────────────────────────────
//
// WHY SYNTHESISE RATHER THAN HAND-WRITE 88 PROGRAMS. The point of the fixture is that a row
// ARRIVING forces a claim. A hand-written witness per row makes that claim expensive, and an
// expensive claim gets waved through as a DEFERRED line. Deriving the program from the row's
// own parameter list makes the claim cheap and, more to the point, makes it impossible to
// claim a row with a witness that calls something else: the call text comes from the row.

type Stage = 'fragment' | 'vertex' | 'compute'

/** Format literals by the texel kind the row's `implicit(...)` names, per access mode.
 *  `read_write` uses `r32*` because a DEVICE reads and writes only those three
 *  (`src/core/ir/types.ts`, measured against `createBindGroupLayout` when that rule was
 *  written), and a witness has to
 *  be a program a device would take, not only one Tint compiles. */
const FORMAT: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  f32_texel_format: { read: 'r32float', write: 'rgba8unorm', read_write: 'r32float' },
  i32_texel_format: { read: 'r32sint', write: 'rgba8sint', read_write: 'r32sint' },
  u32_texel_format: { read: 'r32uint', write: 'rgba8uint', read_write: 'r32uint' },
  texel_format: { read: 'r32float', write: 'rgba8unorm', read_write: 'r32float' },
}

/** `core.def`'s access type names to the WGSL access mode each stands for. */
const ACCESS: Readonly<Record<string, string>> = {
  read: 'read',
  writable: 'write',
  read_write: 'read_write',
}

/** The handle declaration for the row's `texture:` parameter, or `null` when this package has
 *  no spelling for the type at all (`texel_buffer`, `texture_external`). */
function textureDecl(type: string, implicit: Readonly<Record<string, string>>): string | null {
  const storage = /^texture_storage_(\w+)<(\w+), (\w+)>$/.exec(type)
  if (storage !== null) {
    const kind = implicit[storage[2] ?? ''] ?? 'texel_format'
    const access = ACCESS[implicit[storage[3] ?? ''] ?? storage[3] ?? ''] ?? 'write'
    const format = FORMAT[kind]?.[access]
    if (format === undefined) return null
    return `texture_storage_${storage[1] ?? ''}<"${format}", "${access}">`
  }
  if (type.includes('texel_buffer') || type === 'texture_external') return null
  // `implicit(T: fiu32)` ranges over the three element kinds; f32 stands for the row.
  return type.replace('<T>', '<f32>')
}

/** How a witness CONSUMES the result, as one `f32`. Without a use the optimizer may drop the
 *  call, and "the witness emits the call" would be vacuously checkable. */
const SINK: Readonly<Record<string, string>> = {
  'vec4<f32>': 'r.x',
  'vec4<T>': 'r.x',
  'vec4<i32>': 'f32(r.x)',
  'vec4<u32>': 'f32(r.x)',
  f32: 'r',
  u32: 'f32(r)',
  'vec2<u32>': 'f32(r.x)',
  'vec3<u32>': 'f32(r.x)',
}

/** One argument, by the parameter's NAME in `core.def`: the type alone does not say, because
 *  `C` is a gather component in one row and a coordinate in the next. `null` means the
 *  package has no spelling for that argument — today only `@const offset` (F11). */
function argOf(name: string, type: string, stage: Stage): string | null {
  const uv = stage === 'fragment' ? 'v.uv' : 'vec2(0.5, 0.5)'
  switch (name) {
    case 'coords':
      if (type === 'vec2<f32>') return uv
      if (type === 'vec3<f32>') return 'vec3(0., 0., 1.)'
      if (type === 'f32') return '0.5'
      if (type === 'vec2<C>') return 'vec2i(0, 0)'
      if (type === 'vec3<C>') return 'vec3i(0, 0, 0)'
      return '0'
    case 'array_index':
    case 'level':
    case 'sample_index':
    case 'component':
      return type === 'f32' ? '0.' : '0'
    case 'bias':
    case 'depth_ref':
      return '0.5'
    case 'ddx':
    case 'ddy':
      return type === 'vec2<f32>' ? 'vec2(0., 0.)' : 'vec3(0., 0., 0.)'
    case 'value':
      if (type === 'vec4<f32>') return 'vec4(1., 0., 0., 1.)'
      if (type === 'vec4<i32>') return 'vec4i(1, 0, 0, 1)'
      return 'vec4u(1, 0, 0, 1)'
    default:
      return null
  }
}

/** A complete `"use typeshade"` module calling the row's overload once in `stage`, or `null`
 *  when the row names a type or an argument this package cannot spell at all. */
function witnessFor(row: CoreDefRow, stage: Stage): string | null {
  const decls: string[] = []
  const args: string[] = []
  for (const p of row.params) {
    const name = p.name.replace('@const ', '')
    if (name === 'texture') {
      const decl = textureDecl(p.type, row.implicit)
      if (decl === null) return null
      decls.push(`declare const tex: ${decl}`)
      args.push('tex')
      continue
    }
    if (name === 'sampler') {
      decls.push(`declare const smp: ${p.type}`)
      args.push('smp')
      continue
    }
    const arg = argOf(name, p.type, stage)
    if (arg === null) return null
    args.push(arg)
  }
  const call = `${row.fn}(${args.join(', ')})`
  let sink: string | null = null
  if (row.ret !== '') {
    const s = SINK[row.ret]
    if (s === undefined) return null
    sink = s
  }
  const head = `"use typeshade"\n${decls.join('\n')}\n`

  if (stage === 'compute') {
    const sinkDecl = sink === null ? '' : 'declare let out: storage<array<f32>>\n'
    const body = sink === null ? `  ${call}` : `  const r = ${call}\n  out[gid.x] = ${sink}`
    return `${head}${sinkDecl}@compute([64, 1, 1])
export function cs(@builtin("global_invocation_id") gid: vec3u): void {
${body}
}
`
  }
  if (stage === 'vertex') {
    const body =
      sink === null
        ? `  ${call}\n  return { pos: vec4(0., 0., 0., 1.) }`
        : `  const r = ${call}\n  return { pos: vec4(${sink}, 0., 0., 1.) }`
    return `${head}class Clip {
  @builtin("position") pos: vec4;
}
@vertex
export function vs(@builtin("vertex_index") i: u32): Clip {
${body}
}
`
  }
  const body =
    sink === null
      ? `  ${call}\n  return vec4(0., 0., 0., 1.)`
      : `  const r = ${call}\n  return vec4(${sink}, 0., 0., 1.)`
  return `${head}class V {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
}
@fragment
export function fs(v: V): vec4 {
${body}
}
`
}

/** The stage a SUPPORTED row's witness is written in: a `@stage(..., "compute")` row is a
 *  storage-texture op, which is what a compute entry is for; everything else reads in a
 *  fragment entry, where every stage rule admits it. */
const homeStage = (row: CoreDefRow): Stage =>
  row.stages.includes('compute') ? 'compute' : 'fragment'

const errorsOf = (src: string): string[] =>
  compile(src)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => d.message)

// ─────────────────────────────────────────────────────────────────────────────
// The deferrals
// ─────────────────────────────────────────────────────────────────────────────
//
// Each reason names the issue or the recorded deferral that OWNS the row, so a deferral is a
// decision someone made rather than a shrug. A row leaves this table by starting to work —
// the arm below compiles every deferral that can be spelled at all and fails if one passes.

const OFFSET =
  'the `@const offset` argument has no authoring spelling (audit F11); deferred by docs/use-typeshade-surface.md §36 and roadmap row 13c'
const DIMENSIONS_LEVEL =
  '`textureDimensions(t, level)` is refused as arity though the registry already spells it (audit F12); issue #147'
const NUM_LEVELS = '`textureNumLevels` absent (audit F3); deferred by docs §36 and roadmap row 13c'
const BASE_CLAMP =
  '`textureSampleBaseClampToEdge` absent (audit F5); deferred by docs §36 and roadmap row 13c'
const EXTERNAL =
  '`texture_external` absent (audit T6/F18); deferred by docs §36 and roadmap row 13c'
const STORAGE_1D_3D =
  'storage textures of dimension 1d and 3d absent (audit T7/T8/F17); deferred by docs §36 and roadmap row 13c'
const STORAGE_NUM_LAYERS =
  '`textureNumLayers` on a storage array is refused with the sampled-texture reason (audit F13); issue #147'
const DEPTH_PLAIN_READ =
  'a plain, non-comparison read of a depth texture needs separate samplers on GLSL ES 3.00, where a texture and its sampler are one object (audit F7/F9/F10); part of #133'
const BARRIER =
  '`textureBarrier()` is WGSL-only and belongs behind a capability (audit G15/T14); issue #152'
const TEXEL_BUFFER =
  '`texel_buffer` is a Dawn extension (`chromium_experimental_texel_buffer`), outside the WGSL 1.0 surface this package targets (docs/use-typeshade-surface.md); nothing spells it and no issue asks for one'

const DEFERRED: Readonly<Record<string, string>> = {
  // OFFSET (26)
  'textureGather(C, texture_2d<T>, sampler, vec2<f32>, vec2<i32>) -> vec4<T>': OFFSET,
  'textureGather(C, texture_2d_array<T>, sampler, vec2<f32>, A, vec2<i32>) -> vec4<T>': OFFSET,
  'textureGather(texture_depth_2d, sampler, vec2<f32>, vec2<i32>) -> vec4<f32>': OFFSET,
  'textureGather(texture_depth_2d_array, sampler, vec2<f32>, A, vec2<i32>) -> vec4<f32>': OFFSET,
  'textureGatherCompare(texture_depth_2d, sampler_comparison, vec2<f32>, f32, vec2<i32>) -> vec4<f32>':
    OFFSET,
  'textureGatherCompare(texture_depth_2d_array, sampler_comparison, vec2<f32>, A, f32, vec2<i32>) -> vec4<f32>':
    OFFSET,
  'textureSample(texture_2d<f32>, sampler, vec2<f32>, vec2<i32>) -> vec4<f32>': OFFSET,
  'textureSample(texture_2d_array<f32>, sampler, vec2<f32>, A, vec2<i32>) -> vec4<f32>': OFFSET,
  'textureSample(texture_3d<f32>, sampler, vec3<f32>, vec3<i32>) -> vec4<f32>': OFFSET,
  'textureSample(texture_depth_2d, sampler, vec2<f32>, vec2<i32>) -> f32': OFFSET,
  'textureSample(texture_depth_2d_array, sampler, vec2<f32>, A, vec2<i32>) -> f32': OFFSET,
  'textureSampleBias(texture_2d<f32>, sampler, vec2<f32>, f32, vec2<i32>) -> vec4<f32>': OFFSET,
  'textureSampleBias(texture_2d_array<f32>, sampler, vec2<f32>, A, f32, vec2<i32>) -> vec4<f32>':
    OFFSET,
  'textureSampleBias(texture_3d<f32>, sampler, vec3<f32>, f32, vec3<i32>) -> vec4<f32>': OFFSET,
  'textureSampleCompare(texture_depth_2d, sampler_comparison, vec2<f32>, f32, vec2<i32>) -> f32':
    OFFSET,
  'textureSampleCompare(texture_depth_2d_array, sampler_comparison, vec2<f32>, A, f32, vec2<i32>) -> f32':
    OFFSET,
  'textureSampleCompareLevel(texture_depth_2d, sampler_comparison, vec2<f32>, f32, vec2<i32>) -> f32':
    OFFSET,
  'textureSampleCompareLevel(texture_depth_2d_array, sampler_comparison, vec2<f32>, A, f32, vec2<i32>) -> f32':
    OFFSET,
  'textureSampleGrad(texture_2d<f32>, sampler, vec2<f32>, vec2<f32>, vec2<f32>, vec2<i32>) -> vec4<f32>':
    OFFSET,
  'textureSampleGrad(texture_2d_array<f32>, sampler, vec2<f32>, A, vec2<f32>, vec2<f32>, vec2<i32>) -> vec4<f32>':
    OFFSET,
  'textureSampleGrad(texture_3d<f32>, sampler, vec3<f32>, vec3<f32>, vec3<f32>, vec3<i32>) -> vec4<f32>':
    OFFSET,
  'textureSampleLevel(texture_2d<f32>, sampler, vec2<f32>, f32, vec2<i32>) -> vec4<f32>': OFFSET,
  'textureSampleLevel(texture_2d_array<f32>, sampler, vec2<f32>, A, f32, vec2<i32>) -> vec4<f32>':
    OFFSET,
  'textureSampleLevel(texture_3d<f32>, sampler, vec3<f32>, f32, vec3<i32>) -> vec4<f32>': OFFSET,
  'textureSampleLevel(texture_depth_2d, sampler, vec2<f32>, L, vec2<i32>) -> f32': OFFSET,
  'textureSampleLevel(texture_depth_2d_array, sampler, vec2<f32>, A, L, vec2<i32>) -> f32': OFFSET,
  // DIMENSIONS_LEVEL (10)
  'textureDimensions(texture_1d<T>, L) -> u32': DIMENSIONS_LEVEL,
  'textureDimensions(texture_2d<T>, L) -> vec2<u32>': DIMENSIONS_LEVEL,
  'textureDimensions(texture_2d_array<T>, L) -> vec2<u32>': DIMENSIONS_LEVEL,
  'textureDimensions(texture_3d<T>, L) -> vec3<u32>': DIMENSIONS_LEVEL,
  'textureDimensions(texture_cube<T>, L) -> vec2<u32>': DIMENSIONS_LEVEL,
  'textureDimensions(texture_cube_array<T>, L) -> vec2<u32>': DIMENSIONS_LEVEL,
  'textureDimensions(texture_depth_2d, L) -> vec2<u32>': DIMENSIONS_LEVEL,
  'textureDimensions(texture_depth_2d_array, L) -> vec2<u32>': DIMENSIONS_LEVEL,
  'textureDimensions(texture_depth_cube, L) -> vec2<u32>': DIMENSIONS_LEVEL,
  'textureDimensions(texture_depth_cube_array, L) -> vec2<u32>': DIMENSIONS_LEVEL,
  // NUM_LEVELS (10)
  'textureNumLevels(texture_1d<T>) -> u32': NUM_LEVELS,
  'textureNumLevels(texture_2d<T>) -> u32': NUM_LEVELS,
  'textureNumLevels(texture_2d_array<T>) -> u32': NUM_LEVELS,
  'textureNumLevels(texture_3d<T>) -> u32': NUM_LEVELS,
  'textureNumLevels(texture_cube<T>) -> u32': NUM_LEVELS,
  'textureNumLevels(texture_cube_array<T>) -> u32': NUM_LEVELS,
  'textureNumLevels(texture_depth_2d) -> u32': NUM_LEVELS,
  'textureNumLevels(texture_depth_2d_array) -> u32': NUM_LEVELS,
  'textureNumLevels(texture_depth_cube) -> u32': NUM_LEVELS,
  'textureNumLevels(texture_depth_cube_array) -> u32': NUM_LEVELS,
  // BASE_CLAMP (1)
  'textureSampleBaseClampToEdge(texture_2d<f32>, sampler, vec2<f32>) -> vec4<f32>': BASE_CLAMP,
  // EXTERNAL (3)
  'textureDimensions(texture_external) -> vec2<u32>': EXTERNAL,
  'textureLoad(texture_external, vec2<C>) -> vec4<f32>': EXTERNAL,
  'textureSampleBaseClampToEdge(texture_external, sampler, vec2<f32>) -> vec4<f32>': EXTERNAL,
  // STORAGE_1D_3D (22)
  'textureDimensions(texture_storage_1d<F, R>) -> u32': STORAGE_1D_3D,
  'textureDimensions(texture_storage_1d<F, W>) -> u32': STORAGE_1D_3D,
  'textureDimensions(texture_storage_3d<F, R>) -> vec3<u32>': STORAGE_1D_3D,
  'textureDimensions(texture_storage_3d<F, W>) -> vec3<u32>': STORAGE_1D_3D,
  'textureLoad(texture_storage_1d<F, R>, C) -> vec4<f32>': STORAGE_1D_3D,
  'textureLoad(texture_storage_1d<F, R>, C) -> vec4<i32>': STORAGE_1D_3D,
  'textureLoad(texture_storage_1d<F, R>, C) -> vec4<u32>': STORAGE_1D_3D,
  'textureLoad(texture_storage_1d<F, RW>, C) -> vec4<f32>': STORAGE_1D_3D,
  'textureLoad(texture_storage_1d<F, RW>, C) -> vec4<i32>': STORAGE_1D_3D,
  'textureLoad(texture_storage_1d<F, RW>, C) -> vec4<u32>': STORAGE_1D_3D,
  'textureLoad(texture_storage_3d<F, R>, vec3<C>) -> vec4<f32>': STORAGE_1D_3D,
  'textureLoad(texture_storage_3d<F, R>, vec3<C>) -> vec4<i32>': STORAGE_1D_3D,
  'textureLoad(texture_storage_3d<F, R>, vec3<C>) -> vec4<u32>': STORAGE_1D_3D,
  'textureLoad(texture_storage_3d<F, RW>, vec3<C>) -> vec4<f32>': STORAGE_1D_3D,
  'textureLoad(texture_storage_3d<F, RW>, vec3<C>) -> vec4<i32>': STORAGE_1D_3D,
  'textureLoad(texture_storage_3d<F, RW>, vec3<C>) -> vec4<u32>': STORAGE_1D_3D,
  'textureStore(texture_storage_1d<F, W>, C, vec4<f32>)': STORAGE_1D_3D,
  'textureStore(texture_storage_1d<F, W>, C, vec4<i32>)': STORAGE_1D_3D,
  'textureStore(texture_storage_1d<F, W>, C, vec4<u32>)': STORAGE_1D_3D,
  'textureStore(texture_storage_3d<F, W>, vec3<C>, vec4<f32>)': STORAGE_1D_3D,
  'textureStore(texture_storage_3d<F, W>, vec3<C>, vec4<i32>)': STORAGE_1D_3D,
  'textureStore(texture_storage_3d<F, W>, vec3<C>, vec4<u32>)': STORAGE_1D_3D,
  // STORAGE_NUM_LAYERS (2)
  'textureNumLayers(texture_storage_2d_array<F, R>) -> u32': STORAGE_NUM_LAYERS,
  'textureNumLayers(texture_storage_2d_array<F, W>) -> u32': STORAGE_NUM_LAYERS,
  // DEPTH_PLAIN_READ (10)
  'textureLoad(texture_depth_2d, vec2<C>, L) -> f32': DEPTH_PLAIN_READ,
  'textureLoad(texture_depth_2d_array, vec2<C>, A, L) -> f32': DEPTH_PLAIN_READ,
  'textureSample(texture_depth_2d, sampler, vec2<f32>) -> f32': DEPTH_PLAIN_READ,
  'textureSample(texture_depth_2d_array, sampler, vec2<f32>, A) -> f32': DEPTH_PLAIN_READ,
  'textureSample(texture_depth_cube, sampler, vec3<f32>) -> f32': DEPTH_PLAIN_READ,
  'textureSample(texture_depth_cube_array, sampler, vec3<f32>, A) -> f32': DEPTH_PLAIN_READ,
  'textureSampleLevel(texture_depth_2d, sampler, vec2<f32>, L) -> f32': DEPTH_PLAIN_READ,
  'textureSampleLevel(texture_depth_2d_array, sampler, vec2<f32>, A, L) -> f32': DEPTH_PLAIN_READ,
  'textureSampleLevel(texture_depth_cube, sampler, vec3<f32>, L) -> f32': DEPTH_PLAIN_READ,
  'textureSampleLevel(texture_depth_cube_array, sampler, vec3<f32>, A, L) -> f32': DEPTH_PLAIN_READ,
  // BARRIER (1)
  'textureBarrier()': BARRIER,
  // TEXEL_BUFFER (11)
  'textureDimensions(texel_buffer<F, R>) -> u32': TEXEL_BUFFER,
  'textureDimensions(texel_buffer<F, W>) -> u32': TEXEL_BUFFER,
  'textureLoad(texel_buffer<F, R>, C) -> vec4<f32>': TEXEL_BUFFER,
  'textureLoad(texel_buffer<F, R>, C) -> vec4<i32>': TEXEL_BUFFER,
  'textureLoad(texel_buffer<F, R>, C) -> vec4<u32>': TEXEL_BUFFER,
  'textureLoad(texel_buffer<F, RW>, C) -> vec4<f32>': TEXEL_BUFFER,
  'textureLoad(texel_buffer<F, RW>, C) -> vec4<i32>': TEXEL_BUFFER,
  'textureLoad(texel_buffer<F, RW>, C) -> vec4<u32>': TEXEL_BUFFER,
  'textureStore(texel_buffer<F, RW>, C, vec4<f32>)': TEXEL_BUFFER,
  'textureStore(texel_buffer<F, RW>, C, vec4<i32>)': TEXEL_BUFFER,
  'textureStore(texel_buffer<F, RW>, C, vec4<u32>)': TEXEL_BUFFER,
}

// ─────────────────────────────────────────────────────────────────────────────
// The stage holes that are open TODAY
// ─────────────────────────────────────────────────────────────────────────────
//
// A row here is SUPPORTED — its witness compiles — and this package does NOT yet refuse it
// from a vertex entry although Tint's `@stage(...)` does. Each is a program the front end
// accepts and Tint rejects: measured on 2026-09-21, all eight are refused by
// `createShaderModule` with "storage texture with 'write'/'read_write' access mode cannot be
// used by vertex pipeline stage". So the list is a defect list, not a design one, and it is
// shrink-only: the arm below fails a row that has started to be refused here, so a fix must
// delete its entry in the same commit.
const STAGE_GAPS: Readonly<Record<string, string>> = {
  // F21 (audit §2): `lower/function.ts` gates `textureStore` out of a vertex entry but not a
  // read of a WRITABLE storage texture, which `core.def` stages the same way. Closed by #145.
  'textureDimensions(texture_storage_2d<F, W>) -> vec2<u32>': 'F21, #145',
  'textureDimensions(texture_storage_2d_array<F, W>) -> vec2<u32>': 'F21, #145',
  'textureLoad(texture_storage_2d<F, RW>, vec2<C>) -> vec4<f32>': 'F21, #145',
  'textureLoad(texture_storage_2d<F, RW>, vec2<C>) -> vec4<i32>': 'F21, #145',
  'textureLoad(texture_storage_2d<F, RW>, vec2<C>) -> vec4<u32>': 'F21, #145',
  'textureLoad(texture_storage_2d_array<F, RW>, vec2<C>, A) -> vec4<f32>': 'F21, #145',
  'textureLoad(texture_storage_2d_array<F, RW>, vec2<C>, A) -> vec4<i32>': 'F21, #145',
  'textureLoad(texture_storage_2d_array<F, RW>, vec2<C>, A) -> vec4<u32>': 'F21, #145',
}

describe('every core.def texture overload is claimed (S1)', () => {
  it('reads a fixture whose rows are unique, so a claim names exactly one overload', () => {
    // The parser, not the table, is what a duplicate key would indict.
    const seen = new Set<string>()
    const duplicates = ROWS.filter((r) =>
      seen.has(r.signature) ? true : (seen.add(r.signature), false),
    )
    expect(duplicates.map((r) => r.signature)).toEqual([])
    expect(ROWS.length).toBeGreaterThan(100)
  })

  it('is SUPPORTED by a compile() witness, or DEFERRED with a reason and an issue', () => {
    const unclaimed: string[] = []
    for (const row of ROWS) {
      if (row.signature in DEFERRED) continue
      const src = witnessFor(row, homeStage(row))
      if (src === null) {
        unclaimed.push(`${row.signature} — no witness can be synthesised, and no deferral`)
        continue
      }
      const result = compile(src)
      const errors = result.diagnostics.filter((d) => d.category === 'error')
      if (errors.length > 0) {
        unclaimed.push(`${row.signature} — ${errors[0]?.message ?? ''}`)
        continue
      }
      if (!(result.wgsl ?? '').includes(`${row.fn}(`)) {
        unclaimed.push(`${row.signature} — witness compiled but emitted no ${row.fn}( call`)
      }
    }
    expect(unclaimed).toEqual([])
  })

  it('has no stale deferral: every deferred key is a row of the fixture', () => {
    const known = new Set(ROWS.map((r) => r.signature))
    expect(Object.keys(DEFERRED).filter((k) => !known.has(k))).toEqual([])
  })

  it('states a reason that names an issue or a recorded deferral, for every deferral', () => {
    const vague = [...new Set(Object.values(DEFERRED))].filter(
      (reason) => !/#\d+|roadmap|docs/.test(reason),
    )
    expect(vague).toEqual([])
  })

  it('loses the entry of a DEFERRED row the compiler has since learned', () => {
    // Shrink-only, by measurement rather than by a count: a deferral that has quietly
    // started to work is a lie the next reader would trust.
    const learned: string[] = []
    for (const row of ROWS) {
      if (!(row.signature in DEFERRED)) continue
      const src = witnessFor(row, homeStage(row))
      if (src === null) continue // no spelling at all — the deferral is its own evidence
      const result = compile(src)
      const errors = result.diagnostics.filter((d) => d.category === 'error')
      if (errors.length === 0 && (result.wgsl ?? '').includes(`${row.fn}(`)) {
        learned.push(row.signature)
      }
    }
    expect(learned).toEqual([])
  })

  it('refuses a fragment-only overload from a vertex entry, by the overload OWN witness', () => {
    // `wgsl.txt:24435` "Must only be used in a fragment shader stage."; `core.def` says it as
    // `@stage("fragment")`. This is the per-row half of the stage rule; `stage-rules.test.ts`
    // compares the compiler's two hand-written sets against the whole table.
    const accepted: string[] = []
    for (const row of ROWS) {
      if (row.signature in DEFERRED) continue
      if (row.stages.length === 0 || row.stages.includes('vertex')) continue
      const src = witnessFor(row, 'vertex')
      if (src === null) continue
      const refused = errorsOf(src).length > 0
      if (!refused && !(row.signature in STAGE_GAPS)) accepted.push(row.signature)
    }
    expect(accepted).toEqual([])
  })

  it('loses the entry of a STAGE_GAPS row the compiler has since learned to refuse', () => {
    const closed: string[] = []
    for (const signature of Object.keys(STAGE_GAPS)) {
      const row = ROWS.find((r) => r.signature === signature)
      expect(row, `${signature} is not a row of the fixture`).toBeDefined()
      if (row === undefined) continue
      const src = witnessFor(row, 'vertex')
      if (src !== null && errorsOf(src).length > 0) closed.push(signature)
    }
    expect(closed).toEqual([])
  })
})
