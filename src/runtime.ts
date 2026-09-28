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
  ComputePipeline,
  Geometry,
  Program,
  RenderPipeline,
  RenderState,
} from './runtime/program.js';
export type { Sampler, SamplerOptions, Texture, TextureOptions } from './runtime/resources.js';
export type { Pack } from './core/manifest-types.js';
export { resident, configure, type Resident } from './core/resident.js';
