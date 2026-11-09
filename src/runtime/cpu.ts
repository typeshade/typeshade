// The program runtime's CPU tier (change 0120, milestone M3): the runtime of `runtime.ts` over the
// CPU backend of the render hardware interface (`rhi/cpu.ts`). A program's dispatches and passes run
// its CPU code (Rule 11.7), which `load()` takes from the manifest's `CPU_PROGRAM` key and refuses
// without (O2 (a)).
//
// It is internal at M3: no public option reaches it, so no bundle carries it. Milestone M4 makes it
// the CPU tier of `createDevice()`, where `device.load()`, `device.frame()` and `device.draw()` run on
// it, and writes the rules and the surface that say so.

import { cpuDevice } from '../rhi/cpu.js';
import { RuntimeImpl, type Runtime, type RuntimeOptions } from './runtime.js';

/** A program runtime on a CPU device of its own. Its `tier` is `'cpu'`. A pass into a canvas takes
 *  the canvas's `2d` context as its target. */
export function cpuRuntime(options: Pick<RuntimeOptions, 'consoleBytes'> = {}): Runtime {
  return new RuntimeImpl(cpuDevice(), options, true) as Runtime;
}
