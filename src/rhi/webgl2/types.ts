import type { GlBuffer } from './handles.js';
import type { GlState } from './state.js';

export type GL = WebGL2RenderingContext;

export type GlTextureKind = 'float' | 'uint' | 'sint' | 'depth';

export interface GlPassHost {
  upload(b: GlBuffer, target: number): void;
  firstVertexLast(
    strip: boolean,
    count: number,
    index: { buffer: GlBuffer; type: number } | undefined,
  ): { native: WebGLBuffer; count: number };
  dataTextureOf(b: GlBuffer): WebGLTexture;
}

export interface GlEncoderHost extends GlPassHost {
  state(): GlState;
}
