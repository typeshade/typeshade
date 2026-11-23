import type { CpuValue } from './cpu-runtime.js';
import type { KernelFace } from './host-kernel.js';
import type { HostType } from './host-values.js';

export interface KernelCapacityTerm {
  readonly low: string;
  readonly high: string;
  readonly inclusive: boolean;
  readonly step: number;
  readonly pushes: number;
}

export interface KernelMade {
  readonly param: string;
  readonly count: string;
  readonly shown: string;
  readonly array?: 'f32' | 'i32' | 'u32';
  readonly width?: number;
  readonly struct?: HostType;
  readonly zero?: CpuValue;
  readonly length?: string;
  readonly capacity?: readonly KernelCapacityTerm[];
  readonly fill?: string;
  readonly grown?: true;
  readonly share?: 'every' | 'unwritten';
  readonly written?: string;
  readonly fillFrom?: { readonly param: string; readonly path: readonly string[] };
  readonly reads?: readonly string[];
  readonly checks?: readonly { readonly text: string; readonly write: boolean }[];
}

export function madeOf(k: KernelFace): KernelMade | undefined {
  return (k as KernelFace & { readonly made?: KernelMade }).made;
}

export function isMadeParam(made: KernelMade | undefined, name: string): boolean {
  return (
    made !== undefined && (name === made.param || name === made.count || name === made.written)
  );
}
