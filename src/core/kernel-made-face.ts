import type { KernelFace } from './host-kernel.js';

export interface KernelMade {
  readonly param: string;
  readonly shown: string;
  readonly array: 'f32' | 'i32' | 'u32';
  readonly length: string;
  readonly fill?: string;
}

export function madeOf(k: KernelFace): KernelMade | undefined {
  return (k as KernelFace & { readonly made?: KernelMade }).made;
}
