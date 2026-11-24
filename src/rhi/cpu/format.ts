export interface Format {
  readonly bytes: number;
  readonly channels: readonly number[];
  readonly store: 'unorm8' | 'f32' | 'u32' | 'i32' | 'u8' | 'depth' | 'opaque';
}

export const FORMATS: Readonly<Record<string, Format>> = {
  rgba8unorm: { bytes: 4, channels: [0, 1, 2, 3], store: 'unorm8' },
  bgra8unorm: { bytes: 4, channels: [2, 1, 0, 3], store: 'unorm8' },
  rg8unorm: { bytes: 2, channels: [0, 1], store: 'unorm8' },
  r8unorm: { bytes: 1, channels: [0], store: 'unorm8' },
  rgba8uint: { bytes: 4, channels: [0, 1, 2, 3], store: 'u8' },
  r32float: { bytes: 4, channels: [0], store: 'f32' },
  rg32float: { bytes: 8, channels: [0, 1], store: 'f32' },
  rgba32float: { bytes: 16, channels: [0, 1, 2, 3], store: 'f32' },
  r32uint: { bytes: 4, channels: [0], store: 'u32' },
  rgba32uint: { bytes: 16, channels: [0, 1, 2, 3], store: 'u32' },
  r32sint: { bytes: 4, channels: [0], store: 'i32' },
  rgba32sint: { bytes: 16, channels: [0, 1, 2, 3], store: 'i32' },
  rgba16float: { bytes: 8, channels: [], store: 'opaque' },
  depth16unorm: { bytes: 4, channels: [], store: 'depth' },
  depth24plus: { bytes: 4, channels: [], store: 'depth' },
  depth32float: { bytes: 4, channels: [], store: 'depth' },
  'depth24plus-stencil8': { bytes: 4, channels: [], store: 'depth' },
  'depth32float-stencil8': { bytes: 4, channels: [], store: 'depth' },
};
