import type { Checked, ComputeEntry, GeneratedCpu, GpuDevice, Workgroups } from '../host-entry.js';

export interface EntryPrograms {
  gpu(d: GpuDevice, e: ComputeEntry, checked: Checked, wg: Workgroups): Promise<void>;
  gl(
    gl: WebGL2RenderingContext,
    e: ComputeEntry,
    checked: Checked,
    wg: readonly [number, number, number],
  ): Promise<void>;
  cpu(
    cpu: GeneratedCpu,
    e: ComputeEntry,
    values: Record<string, unknown>,
    wg: readonly [number, number, number],
  ): Promise<void>;
}

export const entryPrograms: { run?: EntryPrograms } = {};
