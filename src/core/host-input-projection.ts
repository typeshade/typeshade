// Implements: Rule 8.21 (docs/language-design.md; traced in reqs/).

import { shaderField } from './host-key.js';
import type { Layout } from './host-entry.js';

type ArrayLayout = Layout & { k: 'a' };

const inputProjections = new WeakMap<Layout, { logical: ArrayLayout; offsets: number[] }>();

export const projectionOf = (physical: Layout) => inputProjections.get(physical);

export function projectInputLayout(logical: ArrayLayout, physical: Layout): void {
  if (logical.e.k !== 'o' || physical.k !== 'a' || physical.e.k !== 'o') return;
  const fields = new Map(physical.e.f.map(([name, offset]) => [shaderField(name), offset]));
  const offsets = new Array<number>(logical.st / 4).fill(-1);
  for (const [name, offset] of logical.e.f)
    offsets[offset / 4] = fields.get(shaderField(name)) ?? -1;
  inputProjections.set(physical, { logical, offsets });
}

// Why: DataView has a non-generic and a generic constructor in TypeScript, and the cast fixes the base signature.
export class ProjectedInputView extends (DataView as new (buffer: ArrayBuffer) => DataView) {
  constructor(
    bytes: ArrayBuffer,
    private readonly stride: number,
    private readonly physicalStride: number,
    private readonly offsets: readonly number[],
  ) {
    super(bytes);
  }
  private at(offset: number): number {
    const field = this.offsets[(offset % this.stride) / 4]!;
    return field < 0 ? -1 : Math.floor(offset / this.stride) * this.physicalStride + field;
  }
  override setFloat32(offset: number, value: number, littleEndian?: boolean): void {
    const at = this.at(offset);
    if (at >= 0) super.setFloat32(at, value, littleEndian);
  }
  override setInt32(offset: number, value: number, littleEndian?: boolean): void {
    const at = this.at(offset);
    if (at >= 0) super.setInt32(at, value, littleEndian);
  }
  override setUint32(offset: number, value: number, littleEndian?: boolean): void {
    const at = this.at(offset);
    if (at >= 0) super.setUint32(at, value, littleEndian);
  }
}
