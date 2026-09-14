// === One Markdown sentence per GPU type, attribute and builtin (design doc §5) ===
//
// Shared by `hover.ts` (a documentation lookup) and `completions.ts` (an item's
// `documentation` field), so the two never describe the same name two different ways.

import { SUPPORTED_TYPE_NAMES } from '../compiler/ts/type-map.js'
import { ATTRIBUTE_NAMES, WGSL_BUILTIN_NAMES } from './ambient.js'

/** One Markdown sentence per GPU type name in `SUPPORTED_TYPE_NAMES`. */
export const TYPE_DOCS: Readonly<Record<string, string>> = {
  f32: '32-bit floating-point value.',
  f64: '64-bit floating-point value, emulated in software on both GPU targets.',
  i32: '32-bit signed integer value.',
  u32: '32-bit unsigned integer value.',
  bool: 'Boolean value.',
  vec2: 'A two-component vector of `f32`.',
  vec3: 'A three-component vector of `f32`.',
  vec4: 'A four-component vector of `f32`.',
  vec2f: 'A two-component vector of `f32` — same type as `vec2`.',
  vec3f: 'A three-component vector of `f32` — same type as `vec3`.',
  vec4f: 'A four-component vector of `f32` — same type as `vec4`.',
  vec2i: 'A two-component vector of `i32`.',
  vec3i: 'A three-component vector of `i32`.',
  vec4i: 'A four-component vector of `i32`.',
  vec2u: 'A two-component vector of `u32`.',
  vec3u: 'A three-component vector of `u32`.',
  vec4u: 'A four-component vector of `u32`.',
  vec2d: 'A two-component vector of `f64` — same type as `vec2f64`.',
  vec3d: 'A three-component vector of `f64` — same type as `vec3f64`.',
  vec4d: 'A four-component vector of `f64` — same type as `vec4f64`.',
  vec2f64: 'A two-component vector of `f64`.',
  vec3f64: 'A three-component vector of `f64`.',
  vec4f64: 'A four-component vector of `f64`.',
  mat4: '4x4 matrix of `f32`, column-major — same type as `mat4x4`.',
  mat4x4: '4x4 matrix of `f32` (or `f64` as `mat4x4<f64>`), column-major.',
}

/** One Markdown sentence per attribute name in `ATTRIBUTE_NAMES`. */
export const ATTRIBUTE_DOCS: Readonly<Record<string, string>> = {
  vertex: "Marks a top-level exported function as the pipeline's vertex-stage entry point.",
  fragment: "Marks a top-level exported function as the pipeline's fragment-stage entry point.",
  compute:
    'Marks a top-level exported function as a compute-stage entry point, with an optional workgroup size: `@compute([64])`.',
  builtin:
    'Binds a field or parameter to a WebGPU builtin value, such as `@builtin("vertex_index")`.',
  location: 'Binds a field to a numeric shader IO location, such as `@location(0)`.',
}

/** One Markdown sentence per `@builtin(...)` id in `WGSL_BUILTIN_NAMES`. */
export const BUILTIN_DOCS: Readonly<Record<string, string>> = {
  vertex_index: 'The index of the current vertex within its draw call.',
  instance_index: 'The index of the current instance within its draw call.',
  position:
    "The vertex's clip-space position (vertex output) or the fragment's window-space position (fragment input).",
  front_facing: 'Whether the current fragment belongs to a front-facing primitive.',
  frag_depth: "Overrides the fragment's depth value.",
  sample_index: 'The index of the sample currently being processed, under multisampling.',
  sample_mask: 'The set of samples covered by the current fragment invocation.',
  local_invocation_id: "The current invocation's id within its workgroup, as a 3-component vector.",
  local_invocation_index: "The current invocation's flattened index within its workgroup.",
  global_invocation_id: "The current invocation's id across the entire compute dispatch.",
  workgroup_id: "The id of the current invocation's workgroup within the dispatch.",
  num_workgroups: 'The number of workgroups dispatched, as given to the dispatch call.',
  subgroup_invocation_id: "The current invocation's index within its subgroup.",
  subgroup_size: 'The number of invocations in the current subgroup.',
  clip_distances: "Per-vertex clip distances against the pipeline's enabled user clip planes.",
}

/** Every documented type name — asserted in `docs.test.ts` to equal `SUPPORTED_TYPE_NAMES`. */
export const DOCUMENTED_TYPE_NAMES: readonly string[] = SUPPORTED_TYPE_NAMES
/** Every documented attribute name — asserted in `docs.test.ts` to equal `ATTRIBUTE_NAMES`. */
export const DOCUMENTED_ATTRIBUTE_NAMES: readonly string[] = ATTRIBUTE_NAMES
/** Every documented builtin name — asserted in `docs.test.ts` to equal `WGSL_BUILTIN_NAMES`. */
export const DOCUMENTED_BUILTIN_NAMES: readonly string[] = WGSL_BUILTIN_NAMES
