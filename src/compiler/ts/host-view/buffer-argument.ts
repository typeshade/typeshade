import type { HostType } from '../../../core/host-values.js';

export function bufferArgument(t: HostType, spelled: string): string | undefined {
  if (t.k === 'num' || t.k === 'vec' || t.k === 'bool' || t.k === 'key')
    return `Buffer<${spelled}>`;
  if (t.k === 'mat' && t.e === 'f32') return `Buffer<${spelled}> | Buffer<f32>`;
  return undefined;
}
