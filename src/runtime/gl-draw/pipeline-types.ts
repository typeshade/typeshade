import type { Layout } from '../../core/host-entry.js';
import type { PackBinding } from '../../core/manifest-types.js';
import type { ResidentArrayState } from '../../core/resident.js';
import type { RhiBindGroupLayout, RhiRenderPass, RhiRenderPipeline } from '../../rhi/rhi.js';

export interface Slot {
  readonly binding: PackBinding;
  readonly index: number;
  readonly kind: 'block' | 'texture' | 'data';
  readonly sampler?: { readonly name: string; readonly index: number };
  readonly layout?: Layout;
}

export interface Built {
  readonly pipeline: RhiRenderPipeline;
  readonly layout: RhiBindGroupLayout;
  readonly slots: readonly Slot[];
}

export interface DrawRun {
  readonly run: (pass: RhiRenderPass) => void;
  readonly residents: readonly ResidentArrayState[];
}
