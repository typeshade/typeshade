import type { RhiColorAttachment } from '../rhi.js';

export type GL = WebGL2RenderingContext;

export type GlTextureKind = 'float' | 'uint' | 'sint' | 'depth';

export interface PolygonOffsetClamp {
  polygonOffsetClampEXT(factor: number, units: number, clamp: number): void;
}

export interface Slot {
  readonly binding: number;
  readonly kind: 'block' | 'texture' | 'data';
  readonly unit: number;
  readonly minimum?: number;
  readonly sampler?: number;
}

export interface DrawFace {
  readonly func: number;
  readonly fail: number;
  readonly zfail: number;
  readonly zpass: number;
}

export interface DrawState {
  readonly mode: number;
  readonly depth?: { readonly func: number; readonly write: boolean };
  readonly cull?: number;
  readonly frontFace: number;
  readonly blend?: {
    readonly src: [number, number];
    readonly dst: [number, number];
    readonly op: [number, number];
  };
  readonly mask: readonly [boolean, boolean, boolean, boolean];
  readonly stencil?: {
    readonly front: DrawFace;
    readonly back: DrawFace;
    readonly readMask: number;
    readonly writeMask: number;
  };
  readonly offset?: { readonly factor: number; readonly units: number; readonly clamp: number };
}

export interface ProvokingVertex {
  readonly FIRST_VERTEX_CONVENTION_WEBGL: number;
  readonly PROVOKING_VERTEX_WEBGL: number;
  provokingVertexWEBGL(mode: number): void;
}

export interface BlendComponent {
  readonly srcFactor?: string;
  readonly dstFactor?: string;
  readonly operation?: string;
}

export interface Attachment {
  readonly tex: WebGLTexture | 'screen';
  readonly kind: GlTextureKind;
  readonly a: RhiColorAttachment;
}
