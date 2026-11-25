import type { ComputeEntry, GpuDevice } from '../host-entry.js';
import type { CallOwner } from '../owner.js';
import { glContext } from '../gl-context.js';
import type { Tier } from '../tiers.js';

export type EntryTierFit =
  | { readonly why: string }
  | { readonly why?: undefined; readonly tier: 'webgpu'; readonly d: GpuDevice }
  | { readonly why?: undefined; readonly tier: 'webgl2'; readonly gl: WebGL2RenderingContext }
  | { readonly why?: undefined; readonly tier: 'cpu' };

export async function entryTierFit(
  e: ComputeEntry,
  owner: CallOwner,
  tier: Tier,
): Promise<EntryTierFit> {
  if (tier === 'webgpu') {
    const d = await owner.device();
    return d === null ? { why: 'there is no WebGPU device' } : { tier, d };
  }
  if (tier === 'webgl2') {
    if (e.gl === undefined) return { why: e.noGl ?? 'the entry has no WebGL2 program' };
    const gl = glContext();
    return gl === null ? { why: 'there is no WebGL2 context' } : { tier, gl };
  }
  if (e.barrier !== undefined)
    return { why: `it reaches ${e.barrier}, not supported yet on the CPU tier (Rule 8.24)` };
  if (e.noCpu !== undefined) return { why: e.noCpu };
  return { tier: 'cpu' };
}
