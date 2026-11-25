import type { KernelFace } from '../../host-kernel.js';
import type { ModuleDecl } from '../../ir/index.js';
import type { KernelPlan } from '../../passes/kernel-prune.js';
import type { PlanFold, PlanSchedule } from '../kernel-plan.js';

export interface Lowered {
  readonly face: KernelFace;
  readonly m: ModuleDecl;
  readonly fn: string;
  readonly plan: KernelPlan;
}

export interface PlannedGroup {
  readonly calls: readonly number[];
  readonly contracted?: readonly object[];
}

export type GroupFault =
  'skip-first-iteration' | 'drop-last-level' | 'zero-partials' | 'local-starts-at-one';

export type GroupStep =
  | {
      readonly entry: string;
      readonly wg: readonly [number, number, number];
      readonly values: Record<string, unknown>;
    }
  | { readonly clear: readonly string[] };

export interface FusedRun {
  readonly steps: readonly GroupStep[];
  readonly partials: PlanSchedule['partials'];
  readonly folds: readonly PlanFold[];
}
