import { describe, byteSize, pack, type Layout } from '../../core/host-entry.js';
import type { Pack, PackBinding } from '../../core/manifest-types.js';
import type { RhiDevice, RhiSampler } from '../../rhi/rhi.js';
import type { ResidentArrayState } from '../../core/resident.js';
import { GlTextureImpl, type GlDrawing } from '../gl-draw.js';

export type Given =
  | { readonly kind: 'words'; readonly words: Uint32Array; readonly inPlace?: true }
  | { readonly kind: 'uniform'; readonly value: unknown }
  | { readonly kind: 'texture'; readonly texture: object }
  | {
      readonly kind: 'storage';
      readonly texture: object;
      readonly width: number;
      readonly height: number;
    }
  | { readonly kind: 'sampler'; readonly sampler: object }
  | {
      readonly kind: 'resident';
      readonly state: ResidentArrayState;
      readonly layout: Layout;
      readonly writes: boolean;
    };

export interface GlRuntimeParts {
  readonly rhi: RhiDevice;
  readonly drawing: GlDrawing;
  readonly nearest: RhiSampler;
  readonly device: WebGL2RenderingContext;
}

export interface GlPipelineOwner {
  readonly rt: GlRuntimeParts;
  readonly manifest: Pack;
}

export function storageOf(
  v: unknown,
  b: PackBinding,
  where: string,
): { kind: 'storage'; texture: object; width: number; height: number } {
  if (b.resource.textureDim === '2d-array')
    throw new TypeError(
      `${where} is an array, and a Texture of the WebGL2 runtime is 2D: the WebGL2 tier binds a texture_storage_2d_array to no texture yet.`,
    );
  if (!(v instanceof GlTextureImpl))
    throw new TypeError(
      `${where} takes a Texture of the runtime, made with { format: '${b.resource.storageFormat ?? '?'}' }; got ${describe(v)}. A host's own texture is not supported yet on the WebGL2 tier (Rule 11.8); the dispatch needs the size that a Texture of the runtime carries.`,
    );
  if (v.format !== b.resource.storageFormat)
    throw new TypeError(
      `${where} takes a ${b.resource.storageFormat ?? '?'} texture; this one is ${v.format}.`,
    );
  return { kind: 'storage', texture: v.texture, width: v.width, height: v.height };
}

export function packWords(layout: Layout, v: unknown, name: string): Uint32Array {
  const bytes = new ArrayBuffer(Math.ceil(byteSize(layout, v, name) / 4) * 4);
  pack(new DataView(bytes), 0, layout, v, name);
  return new Uint32Array(bytes);
}
