// Where the program runtime's CPU tier finds a program's CPU code (change 0120, O2 (a)): on the
// manifest object, under the `Symbol` key `CPU_PROGRAM`, which the default export of a module's
// host import carries and `JSON.stringify` drops. A manifest read from JSON, or made by
// `packModule()`, has none.

import type { Pack } from '../core/manifest-types.js';
import { CPU_PROGRAM, isCpuProgram, type CpuProgram } from '../rhi/cpu-program.js';

/** The CPU program `manifest` carries, or undefined. */
export function cpuProgramOf(manifest: Pack): CpuProgram | undefined {
  const p = (manifest as { readonly [CPU_PROGRAM]?: unknown })[CPU_PROGRAM];
  return isCpuProgram(p) ? p : undefined;
}
