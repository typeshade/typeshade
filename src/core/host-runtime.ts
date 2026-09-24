// ═══ What a generated host module imports (Rule 11.7) ═══
//
// A module the Vite plugin generates for a `.shade.ts` (`src/compiler/ts/host-face.ts`) holds the
// CPU tier's code for the module's functions as module code, and imports only this: the runtime
// that code closes over, and the host-value boundary (Rule 8.21). Nothing here generates code,
// parses TypeScript or walks the IR, so an application ships the op library and no compiler.

import type { ConsoleEvent } from './console.js';

export { createCodegenRuntime, type CodegenRuntime } from './cpu-codegen-runtime.js';
export {
  callCompute,
  type ComputeEntry,
  type EntryBinding,
  type GeneratedCpu,
  type Layout,
} from './host-entry.js';
export {
  toShader,
  fromShader,
  constantOf,
  arity,
  notCallable,
  type HostType,
  type HostNumber,
} from './host-values.js';

/** Where a `console.*` call in a host-called function goes: the host's own console. */
export function hostConsole(e: ConsoleEvent): void {
  console[e.method](...e.args);
}
