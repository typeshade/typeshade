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
export { resident, configure, type Resident } from './core/resident.js';
export {
  createDevice,
  type ChunkRate,
  type Device,
  type DeviceOptions,
  type DeviceStatistics,
} from './runtime/device.js';
export { callDevice, type DeviceReport } from './core/host-entry.js';
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
