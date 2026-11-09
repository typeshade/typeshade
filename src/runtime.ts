// === `typeshade/runtime`: the program runtime (change 0025, Rule 11.11) ===
//
// A host that builds on TypeShade loads a compiled program (its manifest, Rule 11.10) and runs
// its entries: the runtime takes the host's device or requests one, caches the pipelines, binds
// by name and packs by the manifest's layouts, and records and prints the console. It imports
// nothing of the compiler, so an application ships the runtime alone;
// `scripts/bundle-boundary.ts` holds that, and the bundle's size, in CI.

export {
  createRuntime,
  runtime,
  type DepthAttachment,
  type Frame,
  type LoadOptions,
  type PassTargets,
  type RenderPass,
  type Runtime,
  type RuntimeOptions,
} from './runtime/runtime.js';
export type {
  Bindings,
  BindingsOf,
  CompareFunction,
  ComputePipeline,
  Geometry,
  Program,
  RenderPipeline,
  RenderState,
  StencilFaceState,
  StencilOperation,
  StencilState,
} from './runtime/program.js';
export type { Sampler, SamplerOptions, Texture, TextureOptions } from './runtime/resources.js';
export type { Pack } from './core/manifest-types.js';
// The host type family (change 0116): each authorable value type of Appendix A of
// `docs/language-design.md` spelled as the shader spells it, a name for the host value of Rule
// 8.21. The host view imports the names it spells, and a host file imports them from here. Types
// only, so the bundle gains no byte.
export type {
  f32,
  f64,
  i32,
  u32,
  bool,
  vec2,
  vec3,
  vec4,
  vec2f,
  vec3f,
  vec4f,
  vec2i,
  vec3i,
  vec4i,
  vec2u,
  vec3u,
  vec4u,
  vec2b,
  vec3b,
  vec4b,
  vec2f64,
  vec3f64,
  vec4f64,
  vec2d,
  vec3d,
  vec4d,
  mat2x2,
  mat2x3,
  mat2x4,
  mat3x2,
  mat3x3,
  mat3x4,
  mat4x2,
  mat4x3,
  mat4x4,
  mat2,
  mat3,
  mat4,
  mat2x2f,
  mat2x3f,
  mat2x4f,
  mat3x2f,
  mat3x3f,
  mat3x4f,
  mat4x2f,
  mat4x3f,
  mat4x4f,
} from './runtime/host-types.js';
// Host resources (change 0138, milestone 1): uniforms and storage arrays in typed views of one
// memory region. `array` is a function and the host type family's `array<T>` at once.
export { array, uniform, zeros, type Buffer, type Uniform } from './runtime/resource.js';
export { resident, configure, type Resident } from './core/resident.js';
export {
  createDevice,
  type ChunkRate,
  type Device,
  type DeviceOptions,
  type DeviceStatistics,
} from './runtime/device.js';
export { callDevice, type DeviceReport } from './core/host-entry.js';
export { buildInfo, type TypeShadeBuildInfo } from './core/build-info.js';
export type { DeviceInfo } from './core/device-info.js';
// The report of a `fuse` scope and the sum of several (change 0071, Amendment 2): a host that
// holds reports types and merges them without importing `typeshade/fuse`.
export { mergeReports, type FuseReport } from './core/fuse-report.js';
// The flavor of the emulated double a device needs, from the signals a host has (change 0073), so
// a host that ships the runtime alone can pass it to `createDevice({ fp64Flavor })`.
export {
  isAppleGpu,
  recommendFp64Flavor,
  type Fp64FlavorSignals,
} from './core/fp64/flavor-select.js';
