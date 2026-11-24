export interface GlComputeInput {
  readonly workgroups: readonly [number, number, number];
  readonly memory: Readonly<Record<string, Uint32Array>>;
  readonly uniforms?: Readonly<Record<string, unknown>>;
  readonly textures?: Readonly<
    Record<string, { readonly texture: WebGLTexture; readonly sampler?: WebGLSampler | null }>
  >;
  readonly storageTextures?: Readonly<
    Record<
      string,
      {
        readonly texture: WebGLTexture;
        readonly width: number;
        readonly height: number;
        readonly layers?: number;
      }
    >
  >;
}

export interface GlComputeReport {
  readonly passes: number;
  readonly barrierPhases: number;
}
