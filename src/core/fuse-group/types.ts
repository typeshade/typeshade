import type { KernelFace } from '../host-kernel.js';
import type { Tier } from '../tiers.js';

export interface GroupCall {
  readonly k: KernelFace;
  readonly arrays: readonly (object | undefined)[];
  readonly range: { readonly start: number; readonly n: number } | undefined;
  readonly tier: Tier;
  readonly held?: true;
}

export interface EntryCall {
  readonly entry: string;
  readonly tier: Tier;
}

export type PlannedCall = GroupCall | EntryCall;

export interface Group {
  readonly calls: readonly number[];
  readonly fused: boolean;
  readonly why?: string;
  readonly workgroupSize?: number;
  readonly contracted: readonly object[];
}
