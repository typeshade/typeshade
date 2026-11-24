import type { GL } from './types.js';

export interface PolygonOffsetClamp {
  polygonOffsetClampEXT(factor: number, units: number, clamp: number): void;
}

export class GlState {
  readonly fbo: WebGLFramebuffer;
  readonly blitFbo: WebGLFramebuffer;
  readonly nearest: WebGLSampler;
  readonly maxColorAttachments: number;
  readonly polygonOffsetClamp: PolygonOffsetClamp | null;
  readonly provokingVertex: ProvokingVertex | null;
  readonly extensions = new Set<string>();
  #screen: { tex: WebGLTexture; w: number; h: number } | undefined;

  constructor(readonly gl: GL) {
    for (const ext of [
      'EXT_color_buffer_float',
      'EXT_color_buffer_half_float',
      'OES_texture_float_linear',
    ])
      if (gl.getExtension(ext) !== null) this.extensions.add(ext);
    this.fbo = gl.createFramebuffer()!;
    this.blitFbo = gl.createFramebuffer()!;
    this.nearest = gl.createSampler()!;
    this.maxColorAttachments = gl.getParameter(gl.MAX_COLOR_ATTACHMENTS) as number;
    this.polygonOffsetClamp = gl.getExtension(
      'EXT_polygon_offset_clamp',
    ) as PolygonOffsetClamp | null;
    if (this.polygonOffsetClamp !== null) this.extensions.add('EXT_polygon_offset_clamp');
    this.provokingVertex = gl.getExtension('WEBGL_provoking_vertex') as ProvokingVertex | null;
    if (this.provokingVertex !== null) this.extensions.add('WEBGL_provoking_vertex');
    gl.samplerParameteri(this.nearest, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.samplerParameteri(this.nearest, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.samplerParameteri(this.nearest, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.samplerParameteri(this.nearest, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  screen(): { tex: WebGLTexture; w: number; h: number } {
    const gl = this.gl;
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    if (this.#screen === undefined || this.#screen.w !== w || this.#screen.h !== h) {
      if (this.#screen !== undefined) gl.deleteTexture(this.#screen.tex);
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
      gl.bindTexture(gl.TEXTURE_2D, null);
      this.#screen = { tex, w, h };
    }
    return this.#screen;
  }
}

interface ProvokingVertex {
  readonly FIRST_VERTEX_CONVENTION_WEBGL: number;
  readonly PROVOKING_VERTEX_WEBGL: number;
  provokingVertexWEBGL(mode: number): void;
}
