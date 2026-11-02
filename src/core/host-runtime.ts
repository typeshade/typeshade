// ═══ What a generated host module imports (Rule 11.7) ═══
//
// A module the Vite plugin generates for a `.shade.ts` (`src/compiler/ts/host-face.ts`) holds the
// CPU tier's code for the module's functions as module code, and imports only this: the runtime
// that code closes over, and the host-value boundary (Rule 8.21). Nothing here generates code,
// parses TypeScript or walks the IR, so an application ships the op library and no compiler.

import type { ConsoleEvent } from './console.js';
import { printConsole } from './console-print.js';

export { createCodegenRuntime, type CodegenRuntime } from './cpu-codegen-runtime.js';
export { callCompute } from './host-compute.js';
export {
  type ComputeEntry,
  type DrawBinding,
  type EntryBinding,
  type GeneratedCpu,
  type HandleBinding,
  type Layout,
} from './host-entry.js';
export { callDraw, type FragmentEntry } from './host-draw.js';
export { callKernel, type KernelFace, type KernelParam, type KernelLoop } from './host-kernel.js';
export { resident, configure, type Resident } from './resident.js';
// The type of a module's default export, its manifest (Rule 11.10), which the host view names.
export type { Pack } from './manifest-types.js';
export type { Texture } from '../runtime/resources.js';
// The host type family (change 0116), which the host view imports the names it spells from, as it
// imports `Resident`, `Pack` and `Texture`.
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
  array,
} from '../runtime/host-types.js';
export {
  toShader,
  fromShader,
  constantOf,
  arity,
  notCallable,
  callMember,
  fromShaderIn,
  type HostType,
  type HostNumber,
  type HostClasses,
  type MemberSpec,
} from './host-values.js';

/** Where a `console.*` call in a host-called function goes: the host's own console, as a line
 *  of the CPU tier (surface §66). */
export function hostConsole(e: ConsoleEvent): void {
  printConsole(e, 'CPU');
}
